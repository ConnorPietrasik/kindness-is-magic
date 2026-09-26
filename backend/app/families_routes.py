"""Public family endpoints (list + wish-list).

This router is resource-oriented (``/api/families``) and does **not**
require authentication.  It sits alongside the self-service ``/api/family``
router which is scoped to the authenticated family user.
"""

import logging
import math

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.auth import decode_access_token
from app.config import GIFT_CLAIM_CAP
from app.database import get_db
from app.deadlines import GIFT_CLAIM_BLOCKED_DETAIL, is_type_armed
from app.mail import send_claim_confirmation
from app.display_ids import compute_display_ids
from app.permissions import require_claim_capable
from app.models import (
    ClaimPaymentStatus,
    CommitmentType,
    DeadlineType,
    Family,
    FamilyVerificationStatus,
    FamilyClaim,
    Person,
    User,
    UserRole,
    WishLockLevel,
)
from app.response_builders import (
    batch_load_family_wishes,
    batch_load_person_wishes,
    build_claim_summary,
    build_family_info,
    claim_status_for,
    get_active_or_404,
)
from app.schemas import (
    FamilyClaimCreate,
    FamilyClaimSummary,
    FamilyWishListResponse,
    PersonWishItem,
    PublicFamilyListResponse,
    PublicFamilySummary,
    WishSummary,
)
from app.search_sort import FAMILY_MAX_AGE, FAMILY_MIN_AGE, FAMILY_PERSON_COUNT, PUBLIC_FAMILY_SORT_FIELDS, build_sort_clause

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/families", tags=["families"])


# ---------------------------------------------------------------------------
# Public families list
# ---------------------------------------------------------------------------


@router.get("")
def list_public_families(
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=100),
    min_person_count: int | None = Query(None, ge=1),
    max_person_count: int | None = Query(None, ge=1),
    min_age: int | None = Query(None, ge=0),
    max_age: int | None = Query(None, ge=0),
    sort: str | None = Query(None),
    include_claimed: bool = Query(False),
    access_token: str | None = Cookie(None, alias="access_token"),
    db: Session = Depends(get_db),
) -> PublicFamilyListResponse:
    """List verified families for the public donor browse page.

    * No authentication required.
    * Only returns families that are: verified, not soft-deleted, and
      wish_lock_level == admin (fully reviewed).
    * Families with any non-deleted claim (gifts or cash, pending, paid, or
      fulfilled — exactly what the reservation index blocks) are hidden by
      default. ``include_claimed=true`` reveals claimed families to admins
      (all of them) and to the claiming owner (their own only); any other
      visitor — including anonymous — gets the default hidden list. Revealed
      items carry ``claim_status`` ("active" / "pending" / "fulfilled" —
      "pending" = cash, unpaid, not expired).
    * Supports pagination, filtering by person count / age range, and sorting.
    * ``fulfilled_count`` is the global count of families whose sponsorship
      was completed (non-deleted fulfilled claim on a non-deleted family);
      it is not affected by the list filters.
    """
    # Extract current user id + role from access token (no DB lookup) —
    # scopes include_claimed to admin (all claimed) / owner (own claimed).
    current_user_id: int | None = None
    is_admin = False
    if access_token:
        try:
            payload = decode_access_token(access_token)
            current_user_id = int(payload.get("sub"))
            is_admin = payload.get("role") == UserRole.admin
        except Exception:
            pass

    # Base query: active, verified, admin-locked families
    query = db.query(Family).filter(
        Family.deleted_at.is_(None),
        Family.verification_status == FamilyVerificationStatus.verified,
        Family.wish_lock_level == WishLockLevel.admin,
    )

    # Hide families with any active claim by default. The subquery matches
    # the reservation index (non-deleted claims only), so a family frees the
    # moment its claim soft-deletes.
    if not include_claimed:
        claimed_family_ids = select(FamilyClaim.family_id).where(FamilyClaim.deleted_at.is_(None))
        query = query.filter(Family.id.notin_(claimed_family_ids))
    elif not is_admin:
        # include_claimed is gated: an owner passes it and sees their own
        # claimed families (the browse page's "Sponsored by me" section is
        # served by GET /api/donor/claims instead); anonymous visitors get
        # the default fully-hidden list.
        if current_user_id is not None:
            others_claims = select(FamilyClaim.family_id).where(
                FamilyClaim.deleted_at.is_(None),
                FamilyClaim.donor_user_id != current_user_id,
            )
        else:
            others_claims = select(FamilyClaim.family_id).where(FamilyClaim.deleted_at.is_(None))
        query = query.filter(Family.id.notin_(others_claims))

    # Build filter conditions using correlated subqueries
    filters = []
    person_count_expr = FAMILY_PERSON_COUNT
    min_age_expr = FAMILY_MIN_AGE
    max_age_expr = FAMILY_MAX_AGE

    if min_person_count is not None:
        filters.append(person_count_expr >= min_person_count)
    if max_person_count is not None:
        filters.append(person_count_expr <= max_person_count)
    if min_age is not None:
        filters.append(min_age_expr >= min_age)
    if max_age is not None:
        filters.append(max_age_expr <= max_age)

    if filters:
        query = query.filter(and_(*filters))

    # Count total before pagination
    total = query.count()

    # Sorting
    sort_clause = build_sort_clause(
        sort,
        PUBLIC_FAMILY_SORT_FIELDS,
        Family.id.asc(),
    )

    # Paginate — include correlated subquery aggregates in the SELECT
    offset = (page - 1) * page_size
    results = (
        query.add_columns(
            FAMILY_PERSON_COUNT.label("pc"),
            FAMILY_MIN_AGE.label("ma"),
            FAMILY_MAX_AGE.label("xa"),
        )
        .order_by(sort_clause, Family.id)
        .offset(offset)
        .limit(page_size)
        .all()
    )

    families = [row[0] for row in results] if results else []

    # Compute flat-format display IDs (unscoped)
    display_id_map = compute_display_ids(db, "family", families, scope=None)

    # Claim status for the revealed (include_claimed) families on this page.
    claims_by_family: dict[int, FamilyClaim] = {}
    if include_claimed and families:
        claims_by_family = {
            c.family_id: c
            for c in db.query(FamilyClaim).filter(
                FamilyClaim.family_id.in_([f.id for f in families]),
                FamilyClaim.deleted_at.is_(None),
            )
        }

    # Build response items from the single query result
    result_families = []
    for fam, pc, ma, xa in results or []:
        claim = claims_by_family.get(fam.id)
        result_families.append(
            PublicFamilySummary(
                id=fam.id,
                display_id=display_id_map.get(fam.id, "0"),
                bio=fam.bio,
                person_count=pc if pc else 0,
                min_age=ma,
                max_age=xa,
                claim_status=claim_status_for(claim) if claim is not None else None,
            )
        )

    total_pages = math.ceil(total / page_size) if total else 0

    # Global milestone count: families whose sponsorship is fulfilled. The
    # family join excludes soft-deleted families (deletion doesn't cascade to
    # claims). One non-deleted claim per family is enforced by the partial
    # unique index, so counting claims == counting families.
    fulfilled_count = (
        db.query(func.count(FamilyClaim.id))
        .join(Family, Family.id == FamilyClaim.family_id)
        .filter(
            FamilyClaim.deleted_at.is_(None),
            FamilyClaim.fulfilled_at.isnot(None),
            Family.deleted_at.is_(None),
        )
        .scalar()
    )

    return PublicFamilyListResponse(
        families=result_families,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        fulfilled_count=fulfilled_count,
    )


# ---------------------------------------------------------------------------
# Wish list
# ---------------------------------------------------------------------------


@router.get("/{family_id}/wish-list")
def get_family_wish_list(
    family_id: int,
    access_token: str | None = Cookie(None, alias="access_token"),
    db: Session = Depends(get_db),
) -> FamilyWishListResponse:
    """Return the public wish list for a family.

    * No authentication required.
    * Non-existent or soft-deleted families return 404.
    * Families that haven't been fully reviewed (wish_lock_level != admin)
      return 403.
    * Soft-deleted people are excluded from the people list.
    * ``claim_status`` is public to every visitor so the page can show the
      sponsored state: "active" to non-owners, "pending" only to the owner
      of an unpaid, not-yet-expired cash claim, "fulfilled" when done;
      ``claimed_by_current_user`` and the claim detail link only apply to
      the claiming donor.
    """
    fam = get_active_or_404(db, Family, family_id, "Family not found")

    if fam.wish_lock_level != WishLockLevel.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This family hasn't been fully approved yet.",
        )

    # Active people ordered by id
    people = db.query(Person).filter(Person.family_id == family_id, Person.deleted_at.is_(None)).order_by(Person.id).all()

    # Batch-load wishes for all people in one query (avoids N+1)
    person_ids = [p.id for p in people]
    wishes_by_person = batch_load_person_wishes(db, person_ids)

    # Compute display_id (unscoped — flat format for public view)
    display_id_map = compute_display_ids(db, "family", [fam], scope=None)
    display_id = display_id_map.get(fam.id, "0")

    # Check for active claim on this family
    active_claim = (
        db.query(FamilyClaim)
        .filter(
            FamilyClaim.family_id == family_id,
            FamilyClaim.deleted_at.is_(None),
        )
        .first()
    )

    # Check if current user is the claim owner
    claimed_by_current_user = False
    claim_status: str | None = None
    claim_id: int | None = None
    if active_claim:
        claim_id = active_claim.id
        # Check if current user is the claim owner
        current_user_id: int | None = None
        if access_token:
            try:
                payload = decode_access_token(access_token)
                current_user_id = int(payload.get("sub"))
            except Exception:
                pass
        if current_user_id is not None and active_claim.donor_user_id == current_user_id:
            claimed_by_current_user = True
        # "pending" is owner-only visibility: other viewers of an unpaid
        # cash claim see "active" (their discovery path is the 409 at claim
        # time), while the owner sees the payment-pending state.
        if active_claim.fulfilled_at is not None:
            claim_status = "fulfilled"
        elif claimed_by_current_user and claim_status_for(active_claim) == "pending":
            claim_status = "pending"
        else:
            claim_status = "active"

    # Family wish is a wish row — single lookup for this family
    family_wish = batch_load_family_wishes(db, [fam.id]).get(fam.id, "")

    return FamilyWishListResponse(
        display_id=display_id,
        bio=fam.bio,
        family_wish=family_wish,
        people=[
            PersonWishItem(
                given_name=p.given_name,
                role=p.role,
                age=p.age,
                note=p.note,
                wishes=[WishSummary.model_validate(w) for w in wishes_by_person.get(p.id, [])],
            )
            for p in people
        ],
        claimed_by_current_user=claimed_by_current_user,
        claim_status=claim_status,
        claim_id=claim_id,
    )


# ---------------------------------------------------------------------------
# Claim a family
# ---------------------------------------------------------------------------


@router.post("/{family_id}/claim", response_model=FamilyClaimSummary, status_code=status.HTTP_201_CREATED)
async def claim_family(
    family_id: int,
    data: FamilyClaimCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_claim_capable),
) -> FamilyClaimSummary:
    """Claim a family (gift promise or cash commitment).

    * Requires authentication with a claim-capable role.
    * Family must be fully reviewed (wish_lock_level == admin) — otherwise 403.
    * Validates family is not already actively claimed.
    * If commitment_type == "gifts", user must have < 5 active gift claims.
    * Cash claims have no limit.
    * For gift claims, a confirmation email is sent to the donor.

    Cash is the **admin/referrer recovery path only** (e.g. a donor paid the
    dedicated form directly with no cart: the admin cash-claims the intended
    family, then matches the payment). Donors and purchasers create cash
    claims via the cart checkout — this endpoint 403s their cash requests.
    Recovery cash claims are created ``pending`` and email-silent (the donor
    already paid in that flow; the confirmation at match is their email).
    """
    # 0. Cash door: donors and purchasers use the cart checkout, not this
    #    endpoint (an open donor cash POST would let anyone hide families
    #    unpaid — claimed families are hidden by default, and cash has no cap
    #    like gifts' GIFT_CLAIM_CAP).
    if data.commitment_type == CommitmentType.cash and user.role not in (UserRole.admin, UserRole.referrer):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cash sponsorships are created at checkout — add the family to your cart and pay.",
        )

    # 1. Validate family exists, is active, and is fully reviewed
    fam = get_active_or_404(db, Family, family_id, "Family not found")
    if fam.wish_lock_level != WishLockLevel.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This family hasn't been fully approved yet.",
        )

    # 1b. Gift drop-off deadline gate — request-time evaluation (no daily
    #     task run in between): an armed gift_dropoff deadline blocks new
    #     gift claims for every claim-capable role, admin included (a
    #     business rule — gifts can't arrive in time). Cash claims are
    #     unaffected.
    if data.commitment_type == CommitmentType.gifts and is_type_armed(db, DeadlineType.gift_dropoff):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=GIFT_CLAIM_BLOCKED_DETAIL)

    # 2. Check family is not already actively claimed
    existing_claim = (
        db.query(FamilyClaim)
        .filter(
            FamilyClaim.family_id == family_id,
            FamilyClaim.deleted_at.is_(None),
        )
        .first()
    )
    if existing_claim:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This family is already sponsored",
        )

    # 3. Check gift-claim cap
    if data.commitment_type == CommitmentType.gifts:
        current_gift_count = (
            db.query(func.count(FamilyClaim.id))
            .filter(
                FamilyClaim.donor_user_id == user.id,
                FamilyClaim.deleted_at.is_(None),
                FamilyClaim.fulfilled_at.is_(None),
                FamilyClaim.commitment_type == CommitmentType.gifts,
            )
            .scalar()
        )
        if current_gift_count >= GIFT_CLAIM_CAP:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Gift sponsorship limit of {GIFT_CLAIM_CAP} reached",
            )

    # 4. Create the claim — cash enters the payment flow as pending (no
    #    nudge email: the recovery flow's donor already paid; the
    #    confirmation at match is their email). Gifts are always "paid".
    claim = FamilyClaim(
        donor_user_id=user.id,
        family_id=family_id,
        commitment_type=data.commitment_type,
        payment_status=ClaimPaymentStatus.pending if data.commitment_type == CommitmentType.cash else ClaimPaymentStatus.paid,
    )
    db.add(claim)
    db.commit()
    db.refresh(claim)

    logger.info("User %s claimed family %s (commitment=%s)", user.id, family_id, data.commitment_type.value)

    # 5. Send confirmation email for gift claims (cash recovery claims are
    #    email-silent until the payment is matched)
    email_error: str | None = None
    if data.commitment_type == CommitmentType.gifts:
        email_error = await send_claim_confirmation(claim, fam, user, db)

    return build_claim_summary(claim, build_family_info(fam, db), email_error=email_error)
