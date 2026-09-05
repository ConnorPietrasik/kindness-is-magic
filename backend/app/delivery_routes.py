"""Delivery person self-service routes.

All endpoints are guarded with ``require_delivery``.
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.display_ids import compute_display_ids
from app.models import Family, FamilyVerificationStatus, User
from app.permissions import require_delivery
from app.response_builders import batch_load_person_counts, build_packing_slips
from app.schemas import PackingSlipItem

logger = logging.getLogger(__name__)

delivery_router = APIRouter(
    prefix="/api/delivery",
    tags=["delivery"],
)


@delivery_router.get("/families")
def list_families(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_delivery),
) -> list[dict]:
    """List families assigned to the current delivery person.

    Returns summary info: display_id, family_name, address, phone_number,
    contact_name, person_count.  Only verified, non-deleted families are
    included.
    """
    families = (
        db.query(Family)
        .filter(
            Family.deleted_at.is_(None),
            Family.verification_status == FamilyVerificationStatus.verified,
            Family.delivery_user_id == current_user.id,
        )
        .order_by(Family.id)
        .all()
    )

    # Batch person counts (scoped to the assigned families)
    count_map = batch_load_person_counts(db, [f.id for f in families])

    # Compute display IDs (flat view)
    pos_map = compute_display_ids(db, "family", families, scope=None)

    result = []
    for f in families:
        result.append(
            {
                "id": f.id,
                "display_id": pos_map.get(f.id, "0"),
                "family_name": f.family_name,
                "address": f.address,
                "phone_number": f.phone_number,
                "contact_name": f.contact_name,
                "person_count": count_map.get(f.id, 0),
            }
        )

    logger.info("Delivery %s listed families (total=%d)", current_user.email, len(result))
    return result


@delivery_router.get("/packing-slips")
def get_packing_slips(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_delivery),
) -> list[PackingSlipItem]:
    """Return packing-slip data for families assigned to the current delivery person.

    Only verified, non-deleted families are included.
    """
    families = (
        db.query(Family)
        .filter(
            Family.deleted_at.is_(None),
            Family.verification_status == FamilyVerificationStatus.verified,
            Family.delivery_user_id == current_user.id,
        )
        .order_by(Family.id)
        .all()
    )

    if not families:
        return []

    result = build_packing_slips(db, families)
    logger.info("Delivery %s listed packing slips (families=%d)", current_user.email, len(result))
    return result
