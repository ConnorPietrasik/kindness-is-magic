"""Admin CRUD routes for Referrers.

All endpoints are guarded with ``require_admin``.
"""

import logging
import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.auth import generate_unique_family_invite_code
from app.database import get_db
from app.models import Referrer, ReferrerApprovalStatus, User
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
    ReferrerListResponse,
    ReferrerSummary,
)

logger = logging.getLogger(__name__)

referrer_admin_router = APIRouter(
    prefix="/api/admin/referrers",
    tags=["admin-referrers"],
)


@referrer_admin_router.get("")
def list_referrers(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    include_deleted: bool = Query(False),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ReferrerListResponse:
    query = db.query(Referrer)
    if not include_deleted:
        query = query.filter(Referrer.deleted_at.is_(None))
    total = query.count()
    referrers = query.order_by(Referrer.id).offset((page - 1) * page_size).limit(page_size).all()
    # Resolve approved_by_admin names in bulk
    admin_ids = {r.approved_by_admin_id for r in referrers if r.approved_by_admin_id is not None}
    admin_map: dict[int, str] = {}
    if admin_ids:
        admins = db.query(User).filter(User.id.in_(admin_ids), User.deleted_at.is_(None)).all()
        admin_map = {a.id: (a.display_name or a.email) for a in admins}

    return ReferrerListResponse(
        referrers=[
            ReferrerSummary(
                id=r.id,
                name=r.name,
                family_limit=r.family_limit,
                family_invite_code=r.family_invite_code,
                approval_status=r.approval_status,
                approved_by_admin_name=admin_map.get(r.approved_by_admin_id) if r.approved_by_admin_id else None,
                approved_at=r.approved_at,
                deleted_at=r.deleted_at,
            )
            for r in referrers
        ],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total else 0,
    )


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
def approve_referrer(
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
    _send_referrer_approved_email(ref, db)

    return ReferrerDetail(**build_referrer_detail(ref, db))


@referrer_admin_router.post("/{ref_id}/reject", status_code=200)
def reject_referrer(
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
    _send_referrer_rejected_email(ref, db)

    return ReferrerDetail(**build_referrer_detail(ref, db))


def _send_referrer_approved_email(ref: Referrer, db: Session) -> None:
    """Send approval notification email to the referrer."""
    from app.mail import build_referrer_approved_email, send_email

    referrer_user = db.query(User).filter(User.referrer_id == ref.id, User.deleted_at.is_(None)).first()
    if not referrer_user:
        return

    html_body = build_referrer_approved_email(ref.name)
    send_email(
        to=referrer_user.email,
        subject="Your Kindness Is Magic account has been approved ✨",
        html_body=html_body,
        db=db,
    )


def _send_referrer_rejected_email(ref: Referrer, db: Session) -> None:
    """Send rejection notification email to the referrer."""
    from app.mail import build_referrer_rejected_email, send_email

    referrer_user = db.query(User).filter(User.referrer_id == ref.id, User.deleted_at.is_(None)).first()
    if not referrer_user:
        return

    html_body = build_referrer_rejected_email(ref.name)
    send_email(
        to=referrer_user.email,
        subject="Update on your Kindness Is Magic account",
        html_body=html_body,
        db=db,
    )
