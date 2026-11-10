"""Admin routes for email campaigns (batch email).

All endpoints are guarded with ``require_admin``.

Campaigns are immutable after creation — the only post-creation mutation is
cancel. The recipient set is a snapshot taken at creation (see
``email_campaigns.create_campaign``); delivery is paced by the background
worker (one recipient per cycle — see ``email_campaigns.campaign_worker_loop``),
so creating a campaign returns immediately with the full progress shape.

Deliberate deviations from the admin list-endpoint convention: the campaign
list has no pagination/``columns`` (a handful-of-rows table, like
deadlines) — the *recipient* list inside the detail is the paginated one.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.column_filter import ColumnRequest, column_filtered_page
from app.database import get_db
from app.email_campaigns import (
    CampaignResolutionError,
    cancel_campaign,
    create_campaign,
    resolve_campaign_recipients,
)
from app.models import EmailCampaign, EmailCampaignRecipient, User
from app.permissions import require_admin
from app.rate_limit import limiter
from app.response_builders import (
    build_campaign_detail,
    build_campaign_recipient_item,
    build_campaign_summary,
    campaign_status_counts,
    get_or_404,
)
from app.schemas import (
    AdminCampaignCreateRequest,
    AdminCampaignPreviewRequest,
    EmailCampaignDetailResponse,
    EmailCampaignListResponse,
    EmailCampaignPreviewResponse,
    EmailCampaignRecipientSummary,
)
from app.search_sort import CAMPAIGN_RECIPIENT_SORT_FIELDS, build_sort_clause, escape_like

logger = logging.getLogger(__name__)

campaign_admin_router = APIRouter(
    prefix="/api/admin/email-campaigns",
    tags=["admin-email-campaigns"],
)


def _sender_name(db: Session, user_id: int | None) -> str | None:
    """Soft-delete-aware display name for a campaign's creating admin."""
    if user_id is None:
        return None
    user = db.query(User).filter(User.id == user_id, User.deleted_at.is_(None)).first()
    return user.display_name if user else None


# /preview must be registered before /{campaign_id} — "preview" would
# otherwise match the int path param and 422.
@campaign_admin_router.post("/preview")
def preview_email_campaign(
    body: AdminCampaignPreviewRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> EmailCampaignPreviewResponse:
    """Resolve the selection without creating — the blast size before commit.

    Same resolution as create (roles + manual dedup, soft-deletes excluded),
    no side effects. An address in both selections counts once, as manual.
    """
    resolved = resolve_campaign_recipients(db, body.roles, body.extra_emails)
    by_role: dict[str, int] = {}
    manual = 0
    for r in resolved:
        if r["source"].value == "role" and r["role"] is not None:
            by_role[r["role"]] = by_role.get(r["role"], 0) + 1
        else:
            manual += 1
    return EmailCampaignPreviewResponse(total=len(resolved), by_role=by_role, manual=manual)


@campaign_admin_router.post("", status_code=201)
@limiter.limit("5/minute")
def create_email_campaign(
    request: Request,
    body: AdminCampaignCreateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Create an email campaign: freeze the recipient snapshot and queue it.

    Delivery starts in the background worker (one recipient per paced
    cycle). The 5/minute guard swallows accidental double-submits — each
    create becomes many real emails.
    """
    try:
        campaign = create_campaign(
            db,
            created_by=admin,
            subject=body.subject,
            message=body.message,
            roles=body.roles,
            extra_emails=body.extra_emails,
        )
    except CampaignResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    db.refresh(campaign)
    logger.info(
        "Admin %s created email campaign (id=%s, recipients=%s)",
        admin.id,
        campaign.id,
        campaign.total_recipients,
    )
    return build_campaign_summary(db, campaign, sender_name=admin.display_name)


@campaign_admin_router.get("")
def list_email_campaigns(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> EmailCampaignListResponse:
    """All campaigns, newest first, with live progress counts."""
    campaigns = db.query(EmailCampaign).order_by(EmailCampaign.created_at.desc(), EmailCampaign.id.desc()).all()

    # One GROUP BY for every row on the page (no N+1).
    counts = campaign_status_counts(db, [c.id for c in campaigns])

    # Soft-delete-aware sender names, like the sent-email log.
    user_ids = {c.created_by for c in campaigns if c.created_by is not None}
    users = db.query(User).filter(User.id.in_(user_ids), User.deleted_at.is_(None)).all() if user_ids else []
    sender_map = {u.id: u.display_name for u in users}

    items = [build_campaign_summary(db, c, sender_name=sender_map.get(c.created_by), counts=counts.get(c.id)) for c in campaigns]
    return EmailCampaignListResponse(campaigns=items)


@campaign_admin_router.get("/{campaign_id}", response_model_exclude_unset=True)
def get_email_campaign(
    campaign_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    columns: str | None = Query(None),
    search: str | None = Query(None),
    sort: str | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> EmailCampaignDetailResponse:
    """Campaign detail (incl. message body) + its recipients, paginated."""
    campaign = get_or_404(db, EmailCampaign, campaign_id, "Campaign not found")

    query = db.query(EmailCampaignRecipient).filter(EmailCampaignRecipient.campaign_id == campaign.id)
    if search is not None:
        pattern = f"%{escape_like(search)}%"
        query = query.filter(EmailCampaignRecipient.email.ilike(pattern, escape="\\"))
    total = query.count()

    sort_clause = build_sort_clause(sort, CAMPAIGN_RECIPIENT_SORT_FIELDS, EmailCampaignRecipient.id.asc())
    recipients = query.order_by(sort_clause, EmailCampaignRecipient.id).offset((page - 1) * page_size).limit(page_size).all()

    # Conditional lookup — account names only when the client asks for them.
    cols = ColumnRequest.parse(columns)
    name_map: dict[int, str] = {}
    if cols.needs("user_display_name"):
        user_ids = {r.user_id for r in recipients if r.user_id is not None}
        if user_ids:
            users = db.query(User).filter(User.id.in_(user_ids), User.deleted_at.is_(None)).all()
            name_map = {u.id: u.display_name for u in users}

    items = [
        build_campaign_recipient_item(r, user_display_name=name_map.get(r.user_id) if r.user_id is not None else None) for r in recipients
    ]
    recipients_page = column_filtered_page(
        items,
        columns,
        model=EmailCampaignRecipientSummary,
        key="recipients",
        total=total,
        page=page,
        page_size=page_size,
        always_include={"id"},
    )
    return {
        **recipients_page,
        "campaign": build_campaign_detail(db, campaign, sender_name=_sender_name(db, campaign.created_by)),
    }


@campaign_admin_router.post("/{campaign_id}/cancel")
def cancel_email_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Cancel a campaign: its pending recipients will not be emailed.

    Idempotent — canceling a completed/canceled campaign is a 200 no-op.
    Already-sent recipients are of course unaffected.
    """
    campaign = get_or_404(db, EmailCampaign, campaign_id, "Campaign not found")
    cancel_campaign(db, campaign)
    db.commit()
    db.refresh(campaign)
    logger.info("Admin %s canceled email campaign (id=%s)", admin.id, campaign.id)
    # Identify the creator (soft-delete-aware), not the acting admin — the
    # canceling admin may not be the one who created the campaign.
    return build_campaign_summary(db, campaign, sender_name=_sender_name(db, campaign.created_by))
