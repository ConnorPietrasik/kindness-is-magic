"""Admin CRUD routes for Families.

All endpoints are guarded with ``require_admin``.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    Family,
    FamilyVerificationStatus,
    Person,
    Referrer,
    User,
    UserRole,
    WishLockLevel,
)
from sqlalchemy import or_ as sql_or
from app.permissions import require_admin
from app.response_builders import (
    attach_family_wish,
    batch_load_family_wishes,
    batch_load_person_wishes,
    build_family_detail,
    build_family_list_item,
    build_family_review_summary,
    build_sort_clause,
    build_wish_summary,
    column_filtered_page,
    ColumnRequest,
    compute_display_ids,
    compute_position_maps,
    FAMILY_PERSON_COUNT,
    FAMILY_SORT_FIELDS,
    FAMILY_WISH,
    get_active_or_404,
    get_or_404,
    load_family_list_context,
    partial_update,
    restore_family_cascade,
    soft_delete_family_cascade,
)
from app.schemas import (
    AdminFamilyUpdate,
    FamilyCreate,
    FamilyDetail,
    FamilyDropdownItem,
    FamilyListResponse,
    FamilyReviewList,
    FamilyReviewRequest,
    PackingSlipItem,
    PackingSlipPersonItem,
)

logger = logging.getLogger(__name__)


family_admin_router = APIRouter(
    prefix="/api/admin/families",
    tags=["admin-families"],
)


@family_admin_router.get("/dropdown")
def get_families_dropdown(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[FamilyDropdownItem]:
    """Return all active families as minimal {id, family_name} entries."""
    families = db.query(Family).filter(Family.deleted_at.is_(None)).order_by(Family.id).all()
    return [FamilyDropdownItem(id=f.id, family_name=f.family_name) for f in families]


@family_admin_router.get("", response_model_exclude_unset=True)
def list_families(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    referrer_id: int | None = Query(None),
    columns: str | None = Query(None),
    search: str | None = Query(None),
    search_name: str | None = Query(None),
    search_contact: str | None = Query(None),
    search_phone: str | None = Query(None),
    search_wish: str | None = Query(None),
    verification_status: str | None = Query(None),
    wish_lock_level: WishLockLevel | None = Query(None),
    min_person_count: int | None = Query(None, ge=0),
    max_person_count: int | None = Query(None, ge=0),
    sort: str | None = Query(None),
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
    Verified families get sequential numbering matching the referrer's own view.
    Pending/rejected families get display_id "PENDING"/"REJECTED" so they
    don't disrupt the verified numbering.
    """
    # Build the base query for active families
    query = db.query(Family).filter(Family.deleted_at.is_(None))
    if referrer_id is not None:
        query = query.filter(Family.referrer_id == referrer_id)

    # Multi-field search: each active filter is ANDed together.
    # `search` uses OR across all fields; targeted params search single fields.
    if search is not None:
        pattern = f"%{search}%"
        query = query.filter(
            sql_or(
                Family.family_name.ilike(pattern),
                Family.contact_name.ilike(pattern),
                Family.phone_number.ilike(pattern),
                FAMILY_WISH.ilike(pattern),
            )
        )
    if search_name is not None:
        query = query.filter(Family.family_name.ilike(f"%{search_name}%"))
    if search_contact is not None:
        query = query.filter(Family.contact_name.ilike(f"%{search_contact}%"))
    if search_phone is not None:
        query = query.filter(Family.phone_number.ilike(f"%{search_phone}%"))
    if search_wish is not None:
        query = query.filter(FAMILY_WISH.ilike(f"%{search_wish}%"))

    if verification_status is not None:
        query = query.filter(Family.verification_status == verification_status)

    if wish_lock_level is not None:
        query = query.filter(Family.wish_lock_level == wish_lock_level)

    if min_person_count is not None:
        query = query.filter(FAMILY_PERSON_COUNT >= min_person_count)
    if max_person_count is not None:
        query = query.filter(FAMILY_PERSON_COUNT <= max_person_count)

    total = query.count()
    offset = (page - 1) * page_size

    sort_clause = build_sort_clause(sort, FAMILY_SORT_FIELDS, func.coalesce(Family.referrer_id, 0).asc())
    families = query.order_by(sort_clause, Family.id).offset(offset).limit(page_size).all()

    # Conditional lookups — skip queries for columns the client doesn't need
    cols = ColumnRequest.parse(columns)
    ctx = load_family_list_context(db, families, cols, scope=referrer_id, include_claim=True, show_status_labels=True)

    items = [FamilyDetail(**build_family_list_item(f, ctx)) for f in families]

    return column_filtered_page(items, columns, key="families", total=total, page=page, page_size=page_size, always_include={"id"})


@family_admin_router.get("/deleted", response_model_exclude_unset=True)
def list_deleted_families(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    referrer_id: int | None = Query(None),
    columns: str | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FamilyListResponse:
    """List soft-deleted families."""
    query = db.query(Family).filter(Family.deleted_at.isnot(None))
    if referrer_id is not None:
        query = query.filter(Family.referrer_id == referrer_id)

    total = query.count()
    offset = (page - 1) * page_size
    families = query.order_by(Family.deleted_at.desc(), Family.id).offset(offset).limit(page_size).all()

    # Conditional lookups
    cols = ColumnRequest.parse(columns)
    ctx = load_family_list_context(db, families, cols, scope=referrer_id, include_claim=False)

    items = [FamilyDetail(**build_family_list_item(f, ctx, display_id="DELETED")) for f in families]

    return column_filtered_page(items, columns, key="families", total=total, page=page, page_size=page_size, always_include={"id"})


@family_admin_router.get("/review-queue")
def list_review_queue(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[FamilyReviewList]:
    """List families awaiting admin wish approval."""
    families = (
        db.query(Family)
        .filter(
            Family.deleted_at.is_(None),
            Family.wish_lock_level == WishLockLevel.referrer,
            Family.wish_review_requested_at.isnot(None),
        )
        .order_by(Family.wish_review_requested_at.asc())
        .all()
    )

    # Batch person counts
    counts = db.query(Person.family_id, func.count(Person.id)).filter(Person.deleted_at.is_(None)).group_by(Person.family_id).all()
    count_map = {fid: cnt for fid, cnt in counts}

    # Batch referrer names
    referrer_ids = {f.referrer_id for f in families if f.referrer_id is not None}
    referrer_map: dict[int, str] = {}
    if referrer_ids:
        for ref in db.query(Referrer).filter(Referrer.id.in_(referrer_ids), Referrer.deleted_at.is_(None)).all():
            referrer_map[ref.id] = ref.name

    # Flat admin view — display_id is "{referrer_id_or_0}-{position}"
    display_map = compute_display_ids(db, "family", families, scope=None)

    return [
        FamilyReviewList(
            **build_family_review_summary(
                f, db, person_count=count_map.get(f.id, 0), referrer_map=referrer_map, display_id=display_map.get(f.id, "0")
            )
        )
        for f in families
    ]


# ---------------------------------------------------------------------------
# Packing slips (must be defined BEFORE /{fam_id} to avoid path collision)
# ---------------------------------------------------------------------------


@family_admin_router.get("/packing-slips")
def get_packing_slips(
    family_ids: str | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[PackingSlipItem]:
    """Return packing-slip data for families with admin-locked wishes.

    * No ``family_ids`` param → all verified, non-deleted families where
      ``wish_lock_level == admin``.
    * With ``family_ids`` → only the specified families (404 for any ID that
      is deleted or does not exist).
    """
    # --- Resolve families --------------------------------------------------- #
    if family_ids is not None:
        # Parse comma-separated IDs
        try:
            requested_ids = [int(x.strip()) for x in family_ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid family_ids parameter")

        if not requested_ids:
            return []

        families = db.query(Family).filter(Family.id.in_(requested_ids)).all()
        found_ids = {f.id for f in families}
        for rid in requested_ids:
            if rid not in found_ids:
                raise HTTPException(status_code=404, detail=f"Family {rid} not found or deleted")

        # Reject any deleted families
        for f in families:
            if f.deleted_at is not None:
                raise HTTPException(status_code=404, detail=f"Family {f.id} not found or deleted")

        # Filter to verified only (among the requested)
        families = [f for f in families if f.verification_status == FamilyVerificationStatus.verified]
    else:
        # Default: all admin-locked, verified, non-deleted families
        families = (
            db.query(Family)
            .filter(
                Family.deleted_at.is_(None),
                Family.verification_status == FamilyVerificationStatus.verified,
                Family.wish_lock_level == WishLockLevel.admin,
            )
            .order_by(Family.id)
            .all()
        )

    if not families:
        return []

    # --- Compute family display IDs ----------------------------------------- #
    fam_display_map = compute_display_ids(db, "family", families, scope=None)

    # --- Batch-load family wishes ------------------------------------------- #
    family_wish_map = batch_load_family_wishes(db, [f.id for f in families])

    # --- Collect people across all families --------------------------------- #
    family_ids_set = [f.id for f in families]
    people = (
        db.query(Person)
        .filter(
            Person.family_id.in_(family_ids_set),
            Person.deleted_at.is_(None),
        )
        .order_by(Person.family_id, Person.id)
        .all()
    )

    # --- Batch-load wishes -------------------------------------------------- #
    person_ids = [p.id for p in people]
    wishes_by_person = batch_load_person_wishes(db, person_ids)

    # --- Group people by family --------------------------------------------- #
    people_by_family: dict[int, list[Person]] = {fid: [] for fid in family_ids_set}
    for p in people:
        people_by_family.setdefault(p.family_id, []).append(p)

    # --- Compute person display IDs (one batched pass over all people) ------ #
    # Position maps are scope-independent (ROW_NUMBER partitions by family),
    # so a single call over the full batch yields the same within-family
    # positions as a per-family call — without a query round-trip per family.
    person_display_map: dict[int, str] = {}
    if people:
        fam_pos_map, _, per_pos_map = compute_position_maps(db, "person", people, scope=None)
        person_display_map = {p.id: str(per_pos_map[p.id]) for p in people if p.id in per_pos_map and p.family_id in fam_pos_map}

    # --- Assemble response -------------------------------------------------- #
    result: list[PackingSlipItem] = []
    for fam in families:
        fam_people = people_by_family.get(fam.id, [])
        result.append(
            PackingSlipItem(
                id=fam.id,
                display_id=fam_display_map.get(fam.id, "0"),
                family_wish=family_wish_map.get(fam.id, ""),
                people=[
                    PackingSlipPersonItem(
                        display_id=person_display_map.get(p.id, "0"),
                        given_name=p.given_name,
                        role=p.role,
                        age=p.age,
                        note=p.note,
                        wishes=[build_wish_summary(w, person_display_map.get(p.id, "0")) for w in wishes_by_person.get(p.id, [])],
                    )
                    for p in fam_people
                ],
            )
        )

    return result


@family_admin_router.get("/{fam_id}")
def get_family(
    fam_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FamilyDetail:
    fam = get_active_or_404(db, Family, fam_id, "Family not found")
    return FamilyDetail(**build_family_detail(fam, db, include_referrer_notes=True))


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
        contact_name=body.contact_name,
        bio=body.bio,
        address=body.address,
        phone_number=body.phone_number,
        pickup_window=body.pickup_window,
        verification_status=FamilyVerificationStatus.verified,
    )
    db.add(fam)
    # Family wish is a wish row, created in the same transaction
    attach_family_wish(db, fam, body.family_wish)
    db.commit()
    db.refresh(fam)
    logger.info("Admin %s created family '%s' (id=%s)", _admin.email, fam.family_name, fam.id)
    return FamilyDetail(**build_family_detail(fam, db, include_referrer_notes=True))


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
    # Validate delivery_user_id if being changed (0 means clear to NULL)
    if body.delivery_user_id is not None and body.delivery_user_id != 0:
        delivery_user = get_or_404(db, User, body.delivery_user_id, "Delivery user not found")
        if delivery_user.deleted_at is not None:
            raise HTTPException(status_code=422, detail="Delivery user is soft-deleted")
        if delivery_user.role != UserRole.delivery:
            raise HTTPException(status_code=422, detail="User is not a delivery person")
    partial_update(fam, body, exclude={"family_wish"})
    if body.family_wish is not None:
        attach_family_wish(db, fam, body.family_wish)
    db.commit()
    db.refresh(fam)
    logger.info("Admin %s updated family (id=%s)", _admin.email, fam_id)
    return FamilyDetail(**build_family_detail(fam, db, include_referrer_notes=True))


@family_admin_router.post("/{fam_id}/restore", status_code=200)
def restore_family(
    fam_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FamilyDetail:
    fam = get_or_404(db, Family, fam_id, "Family not found")
    if fam.deleted_at is None:
        raise HTTPException(status_code=400, detail="Family is not deleted")
    # Restore the family, all its soft-deleted people, and all its wishes
    fam.deleted_at = None
    restore_family_cascade(db, fam_id)
    db.commit()
    db.refresh(fam)
    logger.info("Admin %s restored family '%s' (id=%s)", _admin.email, fam.family_name, fam_id)
    return FamilyDetail(**build_family_detail(fam, db, include_referrer_notes=True))


@family_admin_router.delete("/{fam_id}", status_code=204)
def delete_family(
    fam_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> Response:
    fam = get_active_or_404(db, Family, fam_id, "Family not found")
    # Soft-delete the family's people and all its wishes to avoid orphans.
    now = datetime.now(timezone.utc)
    soft_delete_family_cascade(db, fam_id, now)
    fam.deleted_at = now
    db.commit()
    logger.info("Admin %s soft-deleted family '%s' (id=%s)", _admin.email, fam.family_name, fam_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Admin — Wish Approval Review
# ---------------------------------------------------------------------------


@family_admin_router.post("/{fam_id}/approve-wishes")
def admin_approve_wishes(
    fam_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FamilyDetail:
    """Admin fully approves wishes — family moves to admin lock (visible to donors).

    Accepts families at any lock level except ``admin`` (already fully approved).
    This lets admins skip the normal review flow and make a family's wishes
    donor-visible immediately.
    """
    fam = get_active_or_404(db, Family, fam_id, "Family not found")

    if fam.wish_lock_level == WishLockLevel.admin:
        raise HTTPException(
            status_code=400,
            detail="Wishes are already fully approved.",
        )

    fam.wish_lock_level = WishLockLevel.admin
    fam.wish_review_requested_at = None
    fam.wish_rejection_reason = None

    db.commit()
    db.refresh(fam)
    logger.info("Admin %s fully approved wishes for family '%s' (id=%s)", _admin.email, fam.family_name, fam_id)
    return FamilyDetail(**build_family_detail(fam, db, include_referrer_notes=True))


@family_admin_router.post("/{fam_id}/reject-wishes")
def admin_reject_wishes(
    fam_id: int,
    body: FamilyReviewRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FamilyDetail:
    """Admin rejects wishes — family moves back to referrer lock."""
    fam = get_active_or_404(db, Family, fam_id, "Family not found")

    if fam.wish_lock_level != WishLockLevel.referrer:
        raise HTTPException(
            status_code=400,
            detail="Cannot reject wishes at current lock level.",
        )
    if fam.wish_review_requested_at is None:
        raise HTTPException(
            status_code=400,
            detail="No pending review request to reject.",
        )

    fam.wish_lock_level = WishLockLevel.referrer
    fam.wish_review_requested_at = None
    fam.wish_rejection_reason = body.reason

    db.commit()
    db.refresh(fam)
    logger.info("Admin %s rejected wishes for family '%s' (id=%s)", _admin.email, fam.family_name, fam_id)
    return FamilyDetail(**build_family_detail(fam, db, include_referrer_notes=True))


@family_admin_router.post("/{fam_id}/reset-wish-state")
def admin_reset_wish_state(
    fam_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FamilyDetail:
    """Reset a family's wish state back to family-editable.

    Useful when a lock was applied in error or the family needs to revise
    after admin approval.  Also used by e2e test setup for clean baselines.
    """
    fam = get_active_or_404(db, Family, fam_id, "Family not found")

    fam.wish_lock_level = WishLockLevel.family
    fam.wish_review_requested_at = None
    fam.wish_rejection_reason = None

    db.commit()
    db.refresh(fam)
    logger.info("Admin %s reset wish state for family '%s' (id=%s)", _admin.email, fam.family_name, fam_id)
    return FamilyDetail(**build_family_detail(fam, db, include_referrer_notes=True))
