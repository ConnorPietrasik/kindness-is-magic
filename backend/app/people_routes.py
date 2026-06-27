"""Shared individual-person endpoints used by both referrers and family users.

Ownership is enforced via ``require_person_owner()`` which checks:
- Admin: always allowed
- Referrer: person.family.referrer_id == user.referrer_id
- Family: person.family_id == user.family_id
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Person, UserRole
from app.permissions import require_person_owner
from app.schemas import (
    PersonDetail,
    PersonUpdate,
)

router = APIRouter(prefix="/api/people", tags=["people"])

# ---------------------------------------------------------------------------
# Shared Person endpoints (multi-role ownership)
# ---------------------------------------------------------------------------


@router.get("/{per_id}")
def get_person(
    per_id: int,
    user=Depends(require_person_owner),
    db: Session = Depends(get_db),
) -> PersonDetail:
    per = db.query(Person).filter(Person.id == per_id).first()
    if per is None:
        raise HTTPException(status_code=404, detail="Person not found")
    return PersonDetail(
        id=per.id,
        family_id=per.family_id,
        given_name=per.given_name,
        title=per.title,
        age=per.age,
        practical_wish=per.practical_wish,
        fun_wish=per.fun_wish,
        note=per.note,
    )


@router.patch("/{per_id}")
def update_person(
    per_id: int,
    body: PersonUpdate,
    user=Depends(require_person_owner),
    db: Session = Depends(get_db),
) -> PersonDetail:
    per = db.query(Person).filter(Person.id == per_id).first()
    if per is None:
        raise HTTPException(status_code=404, detail="Person not found")

    # Partial update: set-only non-None fields
    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if value is not None:
            setattr(per, field, value)

    db.commit()
    db.refresh(per)
    return PersonDetail(
        id=per.id,
        family_id=per.family_id,
        given_name=per.given_name,
        title=per.title,
        age=per.age,
        practical_wish=per.practical_wish,
        fun_wish=per.fun_wish,
        note=per.note,
    )


@router.delete("/{per_id}", status_code=204)
def delete_person(
    per_id: int,
    user=Depends(require_person_owner),
    db: Session = Depends(get_db),
) -> Response:
    per = db.query(Person).filter(Person.id == per_id).first()
    if per is None:
        raise HTTPException(status_code=404, detail="Person not found")
    db.delete(per)
    db.commit()
    return Response(status_code=204)
