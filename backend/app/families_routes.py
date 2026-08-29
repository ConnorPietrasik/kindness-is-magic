"""Public family endpoints (list + wish-list).

This router is resource-oriented (``/api/families``) and does **not**
require authentication.  It sits alongside the self-service ``/api/family``
router which is scoped to the authenticated family user.
"""

import logging
import math

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, status
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.auth import decode_access_token
from app.config import APP_BASE_URL, GIFT_CLAIM_CAP
from app.database import get_db
from app.mail import (
    build_claim_confirmation_email,
    build_admin_email_failure_notice,
    send_email,
    send_admin_notification,
)
from app.permissions import require_claim_capable
from app.models import (
    CommitmentType,
    EmailKind,
    Family,
    FamilyVerificationStatus,
    FamilyClaim,
    Person,
    User,
    WishLockLevel,
)
from app.response_builders import (
    PUBLIC_FAMILY_SORT_FIELDS,
    FAMILY_MAX_AGE,
    FAMILY_MIN_AGE,
    FAMILY_PERSON_COUNT,
    batch_load_person_wishes,
    build_family_info,
    build_sort_clause,
    compute_display_ids,
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
    access_token: str | None = Cookie(None, alias="access_token"),
    db: Session = Depends(get_db),
) -> PublicFamilyListResponse:
    """List verified families for the public donor browse page.

    * No authentication required.
    * Only returns families that are: verified, not soft-deleted, and
      wish_lock_level == admin (fully reviewed).
    * Supports pagination, filtering by person count / age range, and sorting.
    * If authenticated, sets ``claimed_by_current_user`` on families the
      current user has an active claim for.
    """
    # Extract current user id from access token (no DB lookup)
    current_user_id: int | None = None
    if access_token:
        try:
            payload = decode_access_token(access_token)
            current_user_id = int(payload.get("sub"))
        except Exception:
            pass

    # Base query: active, verified, admin-locked families
    query = db.query(Family).filter(
        Family.deleted_at.is_(None),
        Family.verification_status == FamilyVerificationStatus.verified,
        Family.wish_lock_level == WishLockLevel.admin,
    )

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

    # Build set of family IDs claimed by the current user
    claimed_family_ids: set[int] = set()
    if current_user_id is not None and families:
        family_ids = [f.id for f in families]
        claimed = (
            db.query(FamilyClaim.family_id)
            .filter(
                FamilyClaim.donor_user_id == current_user_id,
                FamilyClaim.family_id.in_(family_ids),
                FamilyClaim.deleted_at.is_(None),
                FamilyClaim.fulfilled_at.is_(None),
            )
            .all()
        )
        claimed_family_ids = {row[0] for row in claimed}

    # Build response items from the single query result
    result_families = []
    for fam, pc, ma, xa in results or []:
        result_families.append(
            PublicFamilySummary(
                id=fam.id,
                display_id=display_id_map.get(fam.id, "0"),
                bio=fam.bio,
                person_count=pc if pc else 0,
                min_age=ma,
                max_age=xa,
                claimed_by_current_user=fam.id in claimed_family_ids,
            )
        )

    total_pages = math.ceil(total / page_size) if total else 0

    return PublicFamilyListResponse(
        families=result_families,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
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
    * If authenticated, includes claim status info.
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
        claim_status = "fulfilled" if active_claim.fulfilled_at is not None else "active"
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

    return FamilyWishListResponse(
        display_id=display_id,
        bio=fam.bio,
        family_wish=fam.family_wish,
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


async def _send_claim_confirmation(
    claim: FamilyClaim,
    fam: Family,
    user: User,
    db: Session,
) -> str | None:
    """Send a claim confirmation email for gift commitments.

    Returns an error message string if the email failed, or None on success.
    """
    # Build display_id early so the except block can reference it
    display_id = compute_display_ids(db, "family", [fam], scope=None).get(fam.id, "0")

    try:
        # Load people + wishes for the email body
        people = db.query(Person).filter(Person.family_id == fam.id, Person.deleted_at.is_(None)).order_by(Person.id).all()
        person_ids = [p.id for p in people]
        wishes_by_person = batch_load_person_wishes(db, person_ids)

        # Build people data for the template
        people_data = [
            {
                "given_name": p.given_name,
                "age": p.age,
                "wishes": [
                    {"type": w.type.value, "description": w.description, "size": w.size, "color": w.color}
                    for w in wishes_by_person.get(p.id, [])
                ],
            }
            for p in people
        ]

        base = APP_BASE_URL
        claim_detail_url = f"{base}/donor/claims/{claim.id}"

        body = build_claim_confirmation_email(
            donor_name=user.display_name,
            family_display_id=display_id,
            family_wish=fam.family_wish,
            family_bio=fam.bio,
            people=people_data,
            claim_detail_url=claim_detail_url,
        )

        result = await send_email(
            to=user.email,
            subject=f"Claim Confirmation — Family {display_id}",
            html_body=body,
            db=db,
            kind=EmailKind.claim_confirmation,
            user_id=user.id,
        )

        if result["sent"]:
            return None
        if result.get("reason") == "unsubscribed":
            # Unsubscribe suppression is not an error
            return None

        # SMTP failure or other send failure
        logger.error(
            "Claim confirmation email failed: claim_id=%s donor_email=%s family_display_id=%s reason=%s",
            claim.id,
            user.email,
            display_id,
            result.get("reason"),
        )

        # Attempt admin notification (non-blocking)
        try:
            admin_body = build_admin_email_failure_notice(
                donor_email=user.email,
                family_display_id=display_id,
                claim_id=claim.id,
                error_summary=result.get("reason", "unknown"),
            )
            await send_admin_notification(
                subject="Claim Confirmation Email Failed",
                body_html=admin_body,
                db=db,
                kind=EmailKind.admin_failure_notice,
                user_id=user.id,
            )
        except Exception:  # noqa: BLE001
            logger.error("Admin notification also failed for claim %s", claim.id, exc_info=True)

        return "Confirmation email failed to send"

    except Exception:  # noqa: BLE001
        # Safety net for template rendering or other unexpected errors
        logger.error("Unexpected error sending claim confirmation for claim %s", claim.id, exc_info=True)
        try:
            admin_body = build_admin_email_failure_notice(
                donor_email=user.email,
                family_display_id=display_id,
                claim_id=claim.id,
                error_summary="unexpected error",
            )
            await send_admin_notification(
                subject="Claim Confirmation Email Failed",
                body_html=admin_body,
                db=db,
                kind=EmailKind.admin_failure_notice,
                user_id=user.id,
            )
        except Exception:  # noqa: BLE001
            logger.error("Admin notification also failed for claim %s", claim.id, exc_info=True)
        return "Confirmation email failed to send"


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
    """
    # 1. Validate family exists, is active, and is fully reviewed
    fam = get_active_or_404(db, Family, family_id, "Family not found")
    if fam.wish_lock_level != WishLockLevel.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This family hasn't been fully approved yet.",
        )

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
            detail="This family is already claimed",
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
                detail=f"Gift claim limit of {GIFT_CLAIM_CAP} reached",
            )

    # 4. Create the claim
    claim = FamilyClaim(
        donor_user_id=user.id,
        family_id=family_id,
        commitment_type=data.commitment_type,
    )
    db.add(claim)
    db.commit()
    db.refresh(claim)

    logger.info("User %s claimed family %s (commitment=%s)", user.id, family_id, data.commitment_type.value)

    # 5. Send confirmation email for gift claims
    email_error: str | None = None
    if data.commitment_type == CommitmentType.gifts:
        email_error = await _send_claim_confirmation(claim, fam, user, db)

    return FamilyClaimSummary(
        id=claim.id,
        family=build_family_info(fam, db),
        commitment_type=claim.commitment_type,
        notes=claim.notes,
        created_at=claim.created_at,
        fulfilled_at=claim.fulfilled_at,
        email_error=email_error,
    )
