"""Admin CRUD routes for Referrers.

All endpoints are guarded with ``require_admin``.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from sqlalchemy import func

from app.auth import generate_unique_family_invite_code
from app.column_filter import ColumnRequest, column_filtered_page
from app.database import get_db
from app.models import EmailKind, EmailStatus, Family, FamilyVerificationStatus, Referrer, ReferrerApprovalStatus, SentEmail, User
from app.permissions import require_admin
from app.response_builders import (
    build_referrer_detail,
    get_active_or_404,
    get_or_404,
    partial_update,
)
from app.schemas import (
    AdminReferrerUpdate,
    ReferrerCreate,
    ReferrerDetail,
    ReferrerDropdownItem,
    ReferrerListResponse,
)
from app.search_sort import REFERRER_SORT_FIELDS, build_sort_clause, escape_like

logger = logging.getLogger(__name__)

referrer_admin_router = APIRouter(
    prefix="/api/admin/referrers",
    tags=["admin-referrers"],
)


@referrer_admin_router.get("/dropdown")
def get_referrers_dropdown(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[ReferrerDropdownItem]:
    """Return all active referrers as minimal {id, name} entries."""
    referrers = db.query(Referrer).filter(Referrer.deleted_at.is_(None)).order_by(Referrer.id).all()
    return [ReferrerDropdownItem(id=r.id, name=r.name) for r in referrers]


@referrer_admin_router.get("", response_model_exclude_unset=True)
def list_referrers(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    columns: str | None = Query(None),
    search: str | None = Query(None),
    approval_status: ReferrerApprovalStatus | None = Query(None),
    sort: str | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ReferrerListResponse:
    """List active (non-deleted) referrers."""
    query = db.query(Referrer).filter(Referrer.deleted_at.is_(None))

    if search is not None:
        pattern = f"%{escape_like(search)}%"
        query = query.filter(Referrer.name.ilike(pattern, escape="\\"))

    if approval_status is not None:
        query = query.filter(Referrer.approval_status == approval_status)

    total = query.count()

    sort_clause = build_sort_clause(sort, REFERRER_SORT_FIELDS, Referrer.id.asc())
    referrers = query.order_by(sort_clause, Referrer.id).offset((page - 1) * page_size).limit(page_size).all()

    # Conditional lookups — skip DB queries for columns the client doesn't need
    cols = ColumnRequest.parse(columns)

    admin_map: dict[int, str] = {}
    if cols.needs("approved_by_admin_name"):
        admin_ids = {r.approved_by_admin_id for r in referrers if r.approved_by_admin_id is not None}
        if admin_ids:
            admins = db.query(User).filter(User.id.in_(admin_ids), User.deleted_at.is_(None)).all()
            admin_map = {a.id: a.display_name for a in admins}

    family_count_map: dict[int, int] = {}
    if cols.needs("family_count"):
        referrer_ids = {r.id for r in referrers}
        family_counts = (
            db.query(Family.referrer_id, func.count(Family.id))
            .filter(
                Family.referrer_id.in_(referrer_ids),
                Family.deleted_at.is_(None),
                Family.verification_status == FamilyVerificationStatus.verified,
            )
            .group_by(Family.referrer_id)
            .all()
        )
        family_count_map = {rid: count for rid, count in family_counts}

    items = [
        ReferrerDetail(**build_referrer_detail(r, db, family_count=family_count_map.get(r.id, 0), admin_map=admin_map)) for r in referrers
    ]

    return column_filtered_page(items, columns, key="referrers", total=total, page=page, page_size=page_size, always_include={"id"})


@referrer_admin_router.get("/deleted", response_model_exclude_unset=True)
def list_deleted_referrers(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    columns: str | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ReferrerListResponse:
    """List soft-deleted referrers."""
    query = db.query(Referrer).filter(Referrer.deleted_at.isnot(None))
    total = query.count()
    referrers = query.order_by(Referrer.deleted_at.desc(), Referrer.id).offset((page - 1) * page_size).limit(page_size).all()

    # Conditional lookups
    cols = ColumnRequest.parse(columns)

    admin_map: dict[int, str] = {}
    if cols.needs("approved_by_admin_name"):
        admin_ids = {r.approved_by_admin_id for r in referrers if r.approved_by_admin_id is not None}
        if admin_ids:
            admins = db.query(User).filter(User.id.in_(admin_ids), User.deleted_at.is_(None)).all()
            admin_map = {a.id: a.display_name for a in admins}

    family_count_map: dict[int, int] = {}
    if cols.needs("family_count"):
        referrer_ids = {r.id for r in referrers}
        family_counts = (
            db.query(Family.referrer_id, func.count(Family.id))
            .filter(
                Family.referrer_id.in_(referrer_ids),
                Family.deleted_at.is_(None),
                Family.verification_status == FamilyVerificationStatus.verified,
            )
            .group_by(Family.referrer_id)
            .all()
        )
        family_count_map = {rid: count for rid, count in family_counts}

    items = [
        ReferrerDetail(**build_referrer_detail(r, db, family_count=family_count_map.get(r.id, 0), admin_map=admin_map)) for r in referrers
    ]

    return column_filtered_page(items, columns, key="referrers", total=total, page=page, page_size=page_size, always_include={"id"})


@referrer_admin_router.get("/{ref_id}")
def get_referrer(
    ref_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ReferrerDetail:
    ref = get_active_or_404(db, Referrer, ref_id, "Referrer not found")
    return ReferrerDetail(**build_referrer_detail(ref, db))


@referrer_admin_router.post("", status_code=201)
def create_referrer(
    body: ReferrerCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ReferrerDetail:
    ref = Referrer(
        name=body.name,
        family_limit=body.family_limit,
        phone_number=body.phone_number,
        family_invite_code=generate_unique_family_invite_code(db),
        approval_status=ReferrerApprovalStatus.approved,
        approved_by_admin_id=_admin.id,
        approved_at=datetime.now(timezone.utc),
    )
    db.add(ref)
    db.commit()
    db.refresh(ref)
    logger.info("Admin %s created referrer '%s' (id=%s)", _admin.email, ref.name, ref.id)
    return ReferrerDetail(**build_referrer_detail(ref, db))


@referrer_admin_router.patch("/{ref_id}")
def update_referrer(
    ref_id: int,
    body: AdminReferrerUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ReferrerDetail:
    ref = get_or_404(db, Referrer, ref_id, "Referrer not found")
    partial_update(ref, body)
    db.commit()
    db.refresh(ref)
    logger.info("Admin %s updated referrer (id=%s)", _admin.email, ref_id)
    return ReferrerDetail(**build_referrer_detail(ref, db))


@referrer_admin_router.post("/{ref_id}/restore", status_code=200)
def restore_referrer(
    ref_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ReferrerDetail:
    ref = get_or_404(db, Referrer, ref_id, "Referrer not found")
    if ref.deleted_at is None:
        raise HTTPException(status_code=400, detail="Referrer is not deleted")
    ref.deleted_at = None
    db.commit()
    db.refresh(ref)
    logger.info("Admin %s restored referrer '%s' (id=%s)", _admin.email, ref.name, ref_id)
    return ReferrerDetail(**build_referrer_detail(ref, db))


@referrer_admin_router.delete("/{ref_id}", status_code=204)
def delete_referrer(
    ref_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> Response:
    ref = get_active_or_404(db, Referrer, ref_id, "Referrer not found")
    ref.deleted_at = datetime.now(timezone.utc)
    db.commit()
    logger.info("Admin %s soft-deleted referrer '%s' (id=%s)", _admin.email, ref.name, ref_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Admin — Referrer Approval
# ---------------------------------------------------------------------------


@referrer_admin_router.post("/{ref_id}/approve", status_code=200)
async def approve_referrer(
    ref_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ReferrerDetail:
    """Approve a pending referrer."""
    ref = get_or_404(db, Referrer, ref_id, "Referrer not found")

    ref.approval_status = ReferrerApprovalStatus.approved
    ref.approved_by_admin_id = _admin.id
    ref.approved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(ref)

    logger.info("Admin %s approved referrer '%s' (id=%s)", _admin.email, ref.name, ref_id)

    # Send approval email
    await _send_referrer_approved_email(ref, db, user_id=_admin.id)

    return ReferrerDetail(**build_referrer_detail(ref, db))


@referrer_admin_router.post("/{ref_id}/reject", status_code=200)
async def reject_referrer(
    ref_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ReferrerDetail:
    """Reject a pending (or previously approved) referrer."""
    ref = get_or_404(db, Referrer, ref_id, "Referrer not found")

    ref.approval_status = ReferrerApprovalStatus.rejected
    db.commit()
    db.refresh(ref)

    logger.info("Admin %s rejected referrer '%s' (id=%s)", _admin.email, ref.name, ref_id)

    # Send rejection email
    await _send_referrer_rejected_email(ref, db, user_id=_admin.id)

    return ReferrerDetail(**build_referrer_detail(ref, db))


@referrer_admin_router.post("/{ref_id}/reset-sent-emails", status_code=200)
def reset_sent_emails(
    ref_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ReferrerDetail:
    """Mark the referrer's sent invite emails as ``reset``.

    This clears the per-referrer lifetime invite cap and the 7-day
    per-recipient dedup, so the referrer can send up to their limit again
    (including to previously invited addresses). The history rows are kept —
    they simply no longer count toward the limits.
    """
    ref = get_or_404(db, Referrer, ref_id, "Referrer not found")
    referrer_user = db.query(User).filter(User.referrer_id == ref.id).first()
    reset_count = 0
    if referrer_user:
        reset_count = (
            db.query(SentEmail)
            .filter(
                SentEmail.user_id == referrer_user.id,
                SentEmail.kind == EmailKind.family_invite,
                SentEmail.status == EmailStatus.sent,
            )
            .update({SentEmail.status: EmailStatus.reset}, synchronize_session=False)
        )
    db.commit()
    db.refresh(ref)
    logger.info("Admin %s reset %d sent invite emails for referrer (id=%s)", _admin.email, reset_count, ref_id)
    return ReferrerDetail(**build_referrer_detail(ref, db))


async def _send_referrer_approved_email(ref: Referrer, db: Session, user_id: int) -> None:
    """Send approval notification email to the referrer."""
    from app.mail import build_referrer_approved_email, send_email

    referrer_user = db.query(User).filter(User.referrer_id == ref.id, User.deleted_at.is_(None)).first()
    if not referrer_user:
        return

    html_body = build_referrer_approved_email(ref.name)
    await send_email(
        to=referrer_user.email,
        subject="Your Kindness Is Magic account has been approved ✨",
        html_body=html_body,
        db=db,
        kind=EmailKind.referrer_approved,
        user_id=user_id,
    )


async def _send_referrer_rejected_email(ref: Referrer, db: Session, user_id: int) -> None:
    """Send rejection notification email to the referrer."""
    from app.mail import build_referrer_rejected_email, send_email

    referrer_user = db.query(User).filter(User.referrer_id == ref.id, User.deleted_at.is_(None)).first()
    if not referrer_user:
        return

    html_body = build_referrer_rejected_email(ref.name)
    await send_email(
        to=referrer_user.email,
        subject="Update on your Kindness Is Magic account",
        html_body=html_body,
        db=db,
        kind=EmailKind.referrer_rejected,
        user_id=user_id,
    )
