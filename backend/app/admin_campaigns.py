"""Admin routes for email campaigns (batch email).

All endpoints are guarded with ``require_admin``.

Campaigns are mutable only while nothing has settled — a draft (or a
pending campaign with no sent/failed recipients) can be edited, and a
draft can be sent (its recipients resolve at activation), rescheduled, or
deleted. Once delivery has started the only post-creation mutation is
cancel; an activated campaign is an immutable audit record (it is never
deleted). Drafts never send on their own — activation is a human action.

The recipient set is a snapshot taken when the campaign starts (see
``email_campaigns.create_campaign`` / ``activate_campaign``): an
unscheduled campaign at creation or draft activation, and a campaign with
a future ``scheduled_for`` at send time — created or activated with one,
the worker resolves it when it becomes due. Delivery is paced by the
background worker (one recipient per cycle — see
``email_campaigns.campaign_worker_loop``), so creating a campaign returns
immediately with the full progress shape (an unresolved scheduled
campaign reports 0 recipients until then).

Deliberate deviations from the admin list-endpoint convention: the campaign
list has no pagination/``columns`` (a handful-of-rows table, like
deadlines) — the *recipient* list inside the detail is the paginated one.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.column_filter import ColumnRequest, column_filtered_page
from app.database import get_db
from app.email_campaigns import (
    CampaignResolutionError,
    CampaignStateError,
    activate_campaign,
    cancel_campaign,
    create_campaign,
    create_draft,
    resolve_campaign_recipients,
    update_campaign,
)
from app.models import EmailCampaign, EmailCampaignRecipient, EmailCampaignRecipientSource, EmailCampaignStatus, User
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
    AdminCampaignUpdateRequest,
    EmailCampaignDetailResponse,
    EmailCampaignListResponse,
    EmailCampaignPreviewResponse,
    EmailCampaignRecipientSummary,
    _CLEAR,
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


def _validate_scheduled_for(value: datetime | None) -> datetime | None:
    """Reject a past send time (422); treat a naive datetime as UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    if value <= datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail="scheduled_for must be in the future")
    return value


def _campaign_for_update(db: Session, campaign_id: int) -> EmailCampaign:
    """Locked fetch or 404.

    The callers check the campaign's state and mutate it in the same
    transaction; the row lock keeps a concurrent request (or a worker step)
    from changing that state between the check and the mutation — when the
    lock is granted Postgres re-checks the latest committed row, so a lost
    race surfaces as the caller's 409 rather than a duplicate mutation.
    """
    campaign = db.query(EmailCampaign).filter(EmailCampaign.id == campaign_id).with_for_update().first()
    if campaign is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    return campaign


# /preview must be registered before /{campaign_id} — "preview" would
# otherwise match the int path param and 422.
@campaign_admin_router.post("/preview")
def preview_email_campaign(
    body: AdminCampaignPreviewRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> EmailCampaignPreviewResponse:
    """Resolve the selection without creating — the blast size before commit.

    Same resolution as create applies at send time (roles + segments +
    manual dedup, soft-deletes excluded), no side effects — an estimate
    for a scheduled campaign, whose recipients are finalized when it
    sends. An address in several selections counts once, in the winning
    bucket (manual > segment > role).
    """
    resolved = resolve_campaign_recipients(db, body.roles, body.segments, body.extra_emails)
    by_role: dict[str, int] = {}
    by_segment: dict[str, int] = {}
    manual = 0
    for r in resolved:
        if r["source"] == EmailCampaignRecipientSource.role and r["role"] is not None:
            by_role[r["role"]] = by_role.get(r["role"], 0) + 1
        elif r["source"] == EmailCampaignRecipientSource.segment and r["segment"] is not None:
            by_segment[r["segment"]] = by_segment.get(r["segment"], 0) + 1
        else:
            manual += 1
    return EmailCampaignPreviewResponse(total=len(resolved), by_role=by_role, by_segment=by_segment, manual=manual)


@campaign_admin_router.post("", status_code=201)
@limiter.limit("5/minute")
def create_email_campaign(
    request: Request,
    body: AdminCampaignCreateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Create an email campaign: queue it, or save it as a draft.

    Activated (``save_as_draft`` false): queue delivery in the background
    worker (one recipient per paced cycle). Send ASAP: the recipient
    snapshot is frozen at creation. A future ``scheduled_for`` delays both
    the first send and the snapshot — the worker resolves the selection at
    send time. Draft (``save_as_draft`` true): store the selection without
    resolving — it sends nothing until a human sends it
    (``POST /{id}/send``). The 5/minute guard swallows accidental
    double-submits — each create becomes many real emails.
    """
    scheduled_for = _validate_scheduled_for(body.scheduled_for)
    try:
        if body.save_as_draft:
            campaign = create_draft(
                db,
                created_by=admin,
                subject=body.subject,
                message=body.message,
                roles=body.roles,
                segments=body.segments,
                extra_emails=body.extra_emails,
                scheduled_for=scheduled_for,
            )
        else:
            campaign = create_campaign(
                db,
                created_by=admin,
                subject=body.subject,
                message=body.message,
                roles=body.roles,
                segments=body.segments,
                extra_emails=body.extra_emails,
                scheduled_for=scheduled_for,
            )
    except CampaignResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    db.refresh(campaign)
    if body.save_as_draft:
        logger.info("Admin %s saved email campaign draft (id=%s)", admin.id, campaign.id)
    else:
        logger.info(
            "Admin %s created email campaign (id=%s, recipients=%s, scheduled=%s)",
            admin.id,
            campaign.id,
            campaign.total_recipients,
            scheduled_for,
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


@campaign_admin_router.patch("/{campaign_id}")
def update_email_campaign(
    campaign_id: int,
    body: AdminCampaignUpdateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Edit a campaign that has not started delivering yet.

    Editable while nothing has settled — a draft, or a pending campaign
    with no sent/failed recipients (409 once delivery has started or the
    campaign is terminal): the subject, message, the recipient selection
    (for an activated campaign the recipients are re-resolved, so a stale
    queued campaign emails the current users) and the send time (``""``
    clears it — send as soon as possible). The campaign row is locked for
    the duration, so no worker step can commit counter changes between the
    check and the update; a send already in flight when the check ran has
    gone out (see ``update_campaign``).
    """
    campaign = _campaign_for_update(db, campaign_id)
    if campaign.status not in (EmailCampaignStatus.draft, EmailCampaignStatus.pending) or campaign.sent_count or campaign.failed_count:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Campaign is already delivering — it can no longer be edited")

    clear_scheduled = body.scheduled_for is _CLEAR
    scheduled_for = None if clear_scheduled else _validate_scheduled_for(body.scheduled_for)
    try:
        update_campaign(
            db,
            campaign,
            subject=body.subject,
            message=body.message,
            roles=body.roles,
            segments=body.segments,
            extra_emails=body.extra_emails,
            scheduled_for=scheduled_for,
            clear_scheduled_for=clear_scheduled,
        )
    except CampaignResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except CampaignStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    db.commit()
    db.refresh(campaign)
    logger.info("Admin %s updated email campaign (id=%s)", admin.id, campaign.id)
    return build_campaign_summary(db, campaign, sender_name=_sender_name(db, campaign.created_by))


@campaign_admin_router.post("/{campaign_id}/send")
@limiter.limit("5/minute")
def send_email_campaign(
    request: Request,
    campaign_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Send a draft: queue delivery.

    The stored selection is re-resolved and the snapshot freezes at the
    send time: immediately when the draft has no send time (or a past one
    — due now), at the stored time when it is in the future (the worker
    resolves it then — a draft saved earlier emails the users existing
    then). 409 for a non-draft — the campaign row is locked, so a
    concurrent send of the same draft waits, re-checks, and 409s instead
    of building a second recipient snapshot (which would email everyone
    twice); 422 when an immediate send's selection resolves to nothing or
    exceeds the cap.
    """
    campaign = _campaign_for_update(db, campaign_id)
    if campaign.status != EmailCampaignStatus.draft:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only drafts can be sent — the campaign is already active")
    try:
        activate_campaign(db, campaign)
    except CampaignResolutionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.commit()
    db.refresh(campaign)
    logger.info(
        "Admin %s sent email campaign draft (id=%s, recipients=%s, scheduled=%s)",
        admin.id,
        campaign.id,
        campaign.total_recipients,
        campaign.scheduled_for,
    )
    return build_campaign_summary(db, campaign, sender_name=_sender_name(db, campaign.created_by))


@campaign_admin_router.delete("/{campaign_id}", status_code=204)
def delete_email_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Delete a draft — nothing was ever sent, so there is no audit record
    to keep. 409 once activated: an activated campaign is an immutable
    audit record (cancel it, don't delete it). The row lock makes the
    check race-safe — a concurrent send that commits first flips the row
    to pending under the delete, which then 409s.
    """
    campaign = _campaign_for_update(db, campaign_id)
    if campaign.status != EmailCampaignStatus.draft:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only drafts can be deleted — activated campaigns are kept as an audit record",
        )
    logger.info("Admin %s deleted email campaign draft (id=%s)", admin.id, campaign_id)
    db.delete(campaign)
    db.commit()
    return None


@campaign_admin_router.post("/{campaign_id}/cancel")
def cancel_email_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Cancel a campaign: its pending recipients will not be emailed.

    Idempotent — canceling a completed/canceled campaign is a 200 no-op.
    Already-sent recipients are of course unaffected. Drafts are not
    canceled but deleted (409). The campaign row is locked for the
    duration, so a concurrent edit (which holds the same lock) can't
    replace recipients underneath: a cancel that loses the race re-checks
    the latest committed row once the lock is granted and either cancels
    the post-edit rows or 409s on the new state.
    """
    campaign = _campaign_for_update(db, campaign_id)
    if campaign.status == EmailCampaignStatus.draft:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Drafts cannot be canceled — delete the draft instead")
    cancel_campaign(db, campaign)
    db.commit()
    db.refresh(campaign)
    logger.info("Admin %s canceled email campaign (id=%s)", admin.id, campaign.id)
    # Identify the creator (soft-delete-aware), not the acting admin — the
    # canceling admin may not be the one who created the campaign.
    return build_campaign_summary(db, campaign, sender_name=_sender_name(db, campaign.created_by))
