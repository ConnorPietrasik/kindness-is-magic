"""Admin CRUD routes for Families.

All endpoints are guarded with ``require_admin``.
"""

import logging
import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Family, FamilyApprovalStatus, Person, Referrer, User
from app.permissions import require_admin
from app.response_builders import (
    build_family_detail,
    get_active_or_404,
    get_or_404,
    partial_update,
)
from app.schemas import (
    AdminFamilyUpdate,
    FamilyCreate,
    FamilyDetail,
    FamilyListResponse,
    FamilySummary,
)

logger = logging.getLogger(__name__)


family_admin_router = APIRouter(
    prefix="/api/admin/families",
    tags=["admin-families"],
)


@family_admin_router.get("")
def list_families(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    referrer_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FamilyListResponse:
    """List active (non-deleted) families with stable display IDs.

    Flat view: families are grouped by referrer (ordered by referrer_id, then
    id). Within each referrer group, families get a sequential position
    starting at 1. The display_id is ``{referrer_id}-{position}``, or
    ``0-{position}`` for orphans. Deleting a family causes later ones in the
    same group to shift up and fill the gap.

    Scoped view (referrer_id set): shows all active families for that referrer.
    Approved families get sequential numbering matching the referrer's own view.
    Pending/rejected families get display_id "PENDING"/"REJECTED" so they
    don't disrupt the approved numbering.
    """
    # Build the base query for active families
    query = db.query(Family).filter(Family.deleted_at.is_(None))
    if referrer_id is not None:
        query = query.filter(Family.referrer_id == referrer_id)

    total = query.count()
    offset = (page - 1) * page_size
    families = query.order_by(func.coalesce(Family.referrer_id, 0), Family.id).offset(offset).limit(page_size).all()

    # Single aggregation query for person counts
    counts = db.query(Person.family_id, func.count(Person.id)).filter(Person.deleted_at.is_(None)).group_by(Person.family_id).all()
    count_map = {fid: cnt for fid, cnt in counts}

    # Pre-compute stable positions via ROW_NUMBER.
    # Flat view: position within each referrer group (partitioned by referrer_id).
    # Scoped view: position among approved families only (pending/rejected excluded).
    pos_map: dict[int, int] = {}
    if families:
        family_ids = [f.id for f in families]
        if referrer_id is not None:
            # Scoped: ROW_NUMBER over approved families for this referrer
            positions = (
                db.query(
                    Family.id,
                    func.row_number().over(order_by=Family.id).label("rn"),
                )
                .filter(
                    Family.deleted_at.is_(None),
                    Family.referrer_id == referrer_id,
                    Family.approval_status == FamilyApprovalStatus.approved,
                )
                .all()
            )
            full_map = {fid: int(rn) for fid, rn in positions}
            pos_map = {fid: full_map[fid] for fid in family_ids if fid in full_map}
        else:
            # Flat: ROW_NUMBER partitioned by referrer, ordered by id
            positions = (
                db.query(
                    Family.id,
                    func.row_number()
                    .over(
                        partition_by=func.coalesce(Family.referrer_id, 0),
                        order_by=Family.id,
                    )
                    .label("rn"),
                )
                .filter(Family.deleted_at.is_(None))
                .all()
            )
            full_map = {fid: int(rn) for fid, rn in positions}
            pos_map = {fid: full_map[fid] for fid in family_ids if fid in full_map}

    def _family_display_id(f: Family) -> str:
        if referrer_id is not None:
            # Scoped: approved families get their position among approved only
            if f.approval_status == FamilyApprovalStatus.approved:
                return str(pos_map.get(f.id, 0))
            return f.approval_status.value.upper() if f.approval_status.value.upper() in ("PENDING", "REJECTED") else "UNKNOWN"
        # Flat: stable global position prefixed with referrer id
        ref_prefix = f.referrer_id if f.referrer_id is not None else 0
        return f"{ref_prefix}-{pos_map.get(f.id, 0)}"

    return FamilyListResponse(
        families=[
            FamilySummary(
                id=f.id,
                display_id=_family_display_id(f),
                family_name=f.family_name,
                family_wish=f.family_wish,
                contact_name=f.contact_name,
                referrer_id=f.referrer_id,
                approval_status=f.approval_status,
                deleted_at=f.deleted_at,
                person_count=count_map.get(f.id, 0),
            )
            for f in families
        ],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total else 0,
    )


@family_admin_router.get("/deleted")
def list_deleted_families(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    referrer_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FamilyListResponse:
    """List soft-deleted families."""
    query = db.query(Family).filter(Family.deleted_at.isnot(None))
    if referrer_id is not None:
        query = query.filter(Family.referrer_id == referrer_id)

    total = query.count()
    offset = (page - 1) * page_size
    families = query.order_by(Family.id).offset(offset).limit(page_size).all()

    counts = db.query(Person.family_id, func.count(Person.id)).filter(Person.deleted_at.is_(None)).group_by(Person.family_id).all()
    count_map = {fid: cnt for fid, cnt in counts}

    return FamilyListResponse(
        families=[
            FamilySummary(
                id=f.id,
                display_id="DELETED",
                family_name=f.family_name,
                family_wish=f.family_wish,
                contact_name=f.contact_name,
                referrer_id=f.referrer_id,
                approval_status=f.approval_status,
                deleted_at=f.deleted_at,
                person_count=count_map.get(f.id, 0),
            )
            for f in families
        ],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total else 0,
    )


@family_admin_router.get("/{fam_id}")
def get_family(
    fam_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FamilyDetail:
    fam = get_active_or_404(db, Family, fam_id, "Family not found")
    return FamilyDetail(**build_family_detail(fam, db))


@family_admin_router.post("", status_code=201)
def create_family(
    body: FamilyCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FamilyDetail:
    # Validate referrer exists if provided
    if body.referrer_id is not None:
        get_or_404(db, Referrer, body.referrer_id, "Referrer not found")

    fam = Family(
        referrer_id=body.referrer_id,
        family_name=body.family_name,
        family_wish=body.family_wish,
        contact_name=body.contact_name,
        bio=body.bio,
        address=body.address,
        phone_number=body.phone_number,
        approval_status=FamilyApprovalStatus.approved,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)
    logger.info("Admin %s created family '%s' (id=%s)", _admin.email, fam.family_name, fam.id)
    return FamilyDetail(**build_family_detail(fam, db))


@family_admin_router.patch("/{fam_id}")
def update_family(
    fam_id: int,
    body: AdminFamilyUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FamilyDetail:
    # Intentionally uses get_or_404 (not get_active_or_404) so admins can modify or restore soft-deleted families.
    fam = get_or_404(db, Family, fam_id, "Family not found")
    # Validate referrer exists if referrer_id is being changed (0 means clear to NULL)
    if body.referrer_id is not None and body.referrer_id != 0:
        get_or_404(db, Referrer, body.referrer_id, "Referrer not found")
    partial_update(fam, body)
    db.commit()
    db.refresh(fam)
    logger.info("Admin %s updated family (id=%s)", _admin.email, fam_id)
    return FamilyDetail(**build_family_detail(fam, db))


@family_admin_router.post("/{fam_id}/restore", status_code=200)
def restore_family(
    fam_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FamilyDetail:
    fam = get_or_404(db, Family, fam_id, "Family not found")
    if fam.deleted_at is None:
        raise HTTPException(status_code=400, detail="Family is not deleted")
    # Restore the family and all its soft-deleted people
    fam.deleted_at = None
    db.query(Person).filter(Person.family_id == fam_id).update({Person.deleted_at: None}, synchronize_session=False)
    db.commit()
    db.refresh(fam)
    logger.info("Admin %s restored family '%s' (id=%s)", _admin.email, fam.family_name, fam_id)
    return FamilyDetail(**build_family_detail(fam, db))


@family_admin_router.delete("/{fam_id}", status_code=204)
def delete_family(
    fam_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> Response:
    fam = get_active_or_404(db, Family, fam_id, "Family not found")
    # Soft-delete all persons in the family first to avoid orphans.
    now = datetime.now(timezone.utc)
    db.query(Person).filter(Person.family_id == fam_id).update({Person.deleted_at: now}, synchronize_session=False)
    fam.deleted_at = now
    db.commit()
    logger.info("Admin %s soft-deleted family '%s' (id=%s)", _admin.email, fam.family_name, fam_id)
    return Response(status_code=204)
