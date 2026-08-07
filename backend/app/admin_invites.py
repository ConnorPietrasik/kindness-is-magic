"""Admin CRUD routes for Referrer Invite Tokens.

All endpoints are guarded with ``require_admin``.
"""

import logging
import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Referrer, ReferrerInviteToken, User
from app.permissions import require_admin
from app.response_builders import apply_column_filter, ColumnRequest
from app.schemas import InviteListResponse, ReferrerInviteSummary

logger = logging.getLogger(__name__)

invite_admin_router = APIRouter(
    prefix="/api/admin/invites",
    tags=["admin-invites"],
)


def _build_invite_summary(
    invite: ReferrerInviteToken,
    admin_map: dict[int, str],
    referrer_map: dict[int, tuple[str, "Referrer.approval_status"]],
) -> ReferrerInviteSummary:
    """Build a ReferrerInviteSummary from a token row using pre-loaded maps."""
    created_by_name = admin_map.get(invite.created_by_admin_id) if invite.created_by_admin_id else None

    redeemed = invite.redeemed_by_user_id is not None
    referrer_name: str | None = None
    approval_status = None
    if invite.redeemed_by_referrer_id is not None:
        ref_data = referrer_map.get(invite.redeemed_by_referrer_id)
        if ref_data is not None:
            referrer_name, approval_status = ref_data

    return ReferrerInviteSummary(
        id=invite.id,
        code=invite.code,
        family_limit=invite.family_limit,
        locked_email=invite.locked_email,
        expires_at=invite.expires_at,
        created_at=invite.created_at,
        created_by_admin_name=created_by_name,
        redeemed=redeemed,
        redeemed_by_referrer_name=referrer_name,
        referrer_approval_status=approval_status,
    )


def _resolve_invite_relations(invite: ReferrerInviteToken, db: Session):
    """Resolve admin and referrer lookups for a single invite (get/revoke endpoints)."""
    admin_map: dict[int, str] = {}
    if invite.created_by_admin_id is not None:
        admin = db.query(User).filter(User.id == invite.created_by_admin_id, User.deleted_at.is_(None)).first()
        if admin:
            admin_map[invite.created_by_admin_id] = admin.display_name

    referrer_map: dict[int, tuple[str, "Referrer.approval_status"]] = {}
    if invite.redeemed_by_referrer_id is not None:
        ref = db.query(Referrer).filter(Referrer.id == invite.redeemed_by_referrer_id, Referrer.deleted_at.is_(None)).first()
        if ref:
            referrer_map[invite.redeemed_by_referrer_id] = (ref.name, ref.approval_status)

    return admin_map, referrer_map


@invite_admin_router.get("")
def list_invites(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    redeemed: bool | None = Query(None),
    expired: bool | None = Query(None),
    columns: str | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> InviteListResponse:
    """List all invite tokens with optional filters."""
    query = db.query(ReferrerInviteToken)

    if redeemed is not None:
        if redeemed:
            query = query.filter(ReferrerInviteToken.redeemed_by_user_id.isnot(None))
        else:
            query = query.filter(ReferrerInviteToken.redeemed_by_user_id.is_(None))

    now = datetime.now(timezone.utc)
    if expired is not None:
        if expired:
            query = query.filter(ReferrerInviteToken.expires_at < now)
        else:
            query = query.filter(ReferrerInviteToken.expires_at >= now)

    total = query.count()
    invites = query.order_by(ReferrerInviteToken.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    # Conditional lookups — skip queries for columns the client doesn't need
    cols = ColumnRequest.parse(columns)

    admin_map: dict[int, str] = {}
    if cols.needs("created_by_admin_name"):
        admin_ids = {inv.created_by_admin_id for inv in invites if inv.created_by_admin_id is not None}
        if admin_ids:
            admins = db.query(User).filter(User.id.in_(admin_ids), User.deleted_at.is_(None)).all()
            admin_map = {a.id: a.display_name for a in admins}

    referrer_map: dict[int, tuple[str, Referrer.approval_status]] = {}
    if cols.needs("redeemed_by_referrer_name", "referrer_approval_status"):
        referrer_ids = {inv.redeemed_by_referrer_id for inv in invites if inv.redeemed_by_referrer_id is not None}
        if referrer_ids:
            refs = db.query(Referrer).filter(Referrer.id.in_(referrer_ids), Referrer.deleted_at.is_(None)).all()
            referrer_map = {r.id: (r.name, r.approval_status) for r in refs}

    items = [_build_invite_summary(inv, admin_map, referrer_map) for inv in invites]

    # NOTE: Returns a plain dict (not InviteListResponse) because apply_column_filter
    # produces partial dicts with only requested columns. FastAPI validates this dict
    # against the annotated response model — required fields are always included so
    # validation passes. See response_builders.apply_column_filter for details.
    return {
        "invites": apply_column_filter(items, columns, always_include={"id"}),
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": math.ceil(total / page_size) if total else 0,
    }


@invite_admin_router.get("/{invite_id}")
def get_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ReferrerInviteSummary:
    """Get a single invite token by id."""
    invite = db.query(ReferrerInviteToken).filter(ReferrerInviteToken.id == invite_id).first()
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite not found")
    admin_map, referrer_map = _resolve_invite_relations(invite, db)
    return _build_invite_summary(invite, admin_map, referrer_map)


@invite_admin_router.post("/{invite_id}/revoke", status_code=200)
def revoke_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ReferrerInviteSummary:
    """Revoke an unredeemed invite by setting expires_at to now."""
    invite = db.query(ReferrerInviteToken).filter(ReferrerInviteToken.id == invite_id).first()
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite not found")

    if invite.redeemed_by_user_id is not None:
        raise HTTPException(status_code=400, detail="Cannot revoke an already-redeemed invite")

    invite.expires_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(invite)

    logger.info("Admin %s revoked invite %s (id=%s)", _admin.email, invite.code, invite_id)
    admin_map, referrer_map = _resolve_invite_relations(invite, db)
    return _build_invite_summary(invite, admin_map, referrer_map)
