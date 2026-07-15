"""Shared individual-person endpoints used by both referrers and family users.

Ownership is enforced via ``require_person_owner()`` which checks:
- Admin: always allowed
- Referrer: person.family.referrer_id == user.referrer_id
- Family: person.family_id == user.family_id
"""

import logging
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Person
from app.permissions import PersonOwner, require_person_owner
from app.response_builders import get_active_or_404, partial_update
from app.schemas import (
    PersonDetail,
    PersonUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/people", tags=["people"])

# ---------------------------------------------------------------------------
# Shared Person endpoints (multi-role ownership)
# ---------------------------------------------------------------------------


@router.get("/{per_id}")
def get_person(
    per_id: int,
    owner: PersonOwner = Depends(require_person_owner),
    db: Session = Depends(get_db),
) -> PersonDetail:
    # Reuse the Person already loaded by require_person_owner (with Family joined).
    # For admins, person is None so we load it fresh.
    per = owner.person
    if per is None:
        per = get_active_or_404(db, Person, per_id, "Person not found")
    return PersonDetail.model_validate(per)


@router.patch("/{per_id}")
def update_person(
    per_id: int,
    body: PersonUpdate,
    owner: PersonOwner = Depends(require_person_owner),
    db: Session = Depends(get_db),
) -> PersonDetail:
    per = owner.person
    if per is None:
        per = get_active_or_404(db, Person, per_id, "Person not found")

    partial_update(per, body)

    db.commit()
    db.refresh(per)
    logger.info("%s updated person (id=%s)", owner.user.email, per_id)
    return PersonDetail.model_validate(per)


@router.delete("/{per_id}", status_code=204)
def delete_person(
    per_id: int,
    owner: PersonOwner = Depends(require_person_owner),
    db: Session = Depends(get_db),
) -> Response:
    per = owner.person
    if per is None:
        per = get_active_or_404(db, Person, per_id, "Person not found")
    per.is_deleted = True
    db.commit()
    logger.info("%s soft-deleted person (id=%s)", owner.user.email, per_id)
    return Response(status_code=204)
