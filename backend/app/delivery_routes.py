"""Delivery person self-service routes.

All endpoints are guarded with ``require_delivery``.
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.display_ids import compute_display_ids, compute_position_maps
from app.models import Family, FamilyVerificationStatus, Person, User
from app.permissions import require_delivery
from app.response_builders import (
    batch_load_family_wishes,
    batch_load_person_wishes,
    build_wish_summary,
)
from app.schemas import (
    PackingSlipItem,
    PackingSlipPersonItem,
)

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

    # Batch person counts
    if families:
        family_ids = [f.id for f in families]
        counts = (
            db.query(Person.family_id, func.count(Person.id))
            .filter(Person.family_id.in_(family_ids), Person.deleted_at.is_(None))
            .group_by(Person.family_id)
            .all()
        )
        count_map = {fid: cnt for fid, cnt in counts}
    else:
        count_map = {}

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

    # Compute family display IDs (flat view)
    fam_display_map = compute_display_ids(db, "family", families, scope=None)

    # Batch-load family wish descriptions (wish rows)
    family_wish_map = batch_load_family_wishes(db, [f.id for f in families])

    # Collect people across all families
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

    # Batch-load wishes
    person_ids = [p.id for p in people]
    wishes_by_person = batch_load_person_wishes(db, person_ids)

    # Group people by family
    people_by_family: dict[int, list[Person]] = {fid: [] for fid in family_ids_set}
    for p in people:
        people_by_family.setdefault(p.family_id, []).append(p)

    # Compute person display IDs (one batched pass over all people — position
    # maps are scope-independent, so within-family positions are unchanged).
    person_display_map: dict[int, str] = {}
    if people:
        fam_pos_map, _, per_pos_map = compute_position_maps(db, "person", people, scope=None)
        person_display_map = {p.id: str(per_pos_map[p.id]) for p in people if p.id in per_pos_map and p.family_id in fam_pos_map}

    # Assemble response
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

    logger.info("Delivery %s listed packing slips (families=%d)", current_user.email, len(result))
    return result
