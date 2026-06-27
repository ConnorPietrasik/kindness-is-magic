"""Family self-service routes: own info, people collection.

All endpoints are guarded with ``require_family``.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Family, Person
from app.permissions import require_family
from app.schemas import (
    FamilyDetail,
    PersonCreate,
    PersonDetail,
    PersonListResponse,
    PersonSummary,
    PersonUpdate,
    FamilyUpdate,
)

router = APIRouter(prefix="/api/family", tags=["family"])

# ---------------------------------------------------------------------------
# Schemas for family-initiated creates (no family_id in body)
# ---------------------------------------------------------------------------


class PersonCreateInFamily(BaseModel):
    given_name: str = Field(..., min_length=1, max_length=40)
    age: int = Field(..., ge=0, le=200)
    practical_wish: str = Field(..., min_length=1, max_length=400)
    fun_wish: str = Field(..., min_length=1, max_length=400)
    title: str | None = Field(None, max_length=40)
    note: str | None = Field(None, max_length=400)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_family_detail(fam: Family, db: Session) -> dict:
    """Build FamilyDetail dict with computed person_count."""
    person_count = db.query(Person).filter(Person.family_id == fam.id).count()
    return {
        "id": fam.id,
        "referrer_id": fam.referrer_id,
        "family_name": fam.family_name,
        "bio": fam.bio,
        "address": fam.address,
        "phone_number": fam.phone_number,
        "family_wish": fam.family_wish,
        "contact_name": fam.contact_name,
        "person_count": person_count,
    }


# ---------------------------------------------------------------------------
# Family — Self
# ---------------------------------------------------------------------------


@router.get("/me")
def get_self(
    user=Depends(require_family),
    db: Session = Depends(get_db),
) -> FamilyDetail:
    fam = db.query(Family).filter(Family.id == user.family_id).first()
    if fam is None:
        raise HTTPException(status_code=404, detail="Family record not found")
    return FamilyDetail(**_build_family_detail(fam, db))


@router.patch("/me")
def update_self(
    body: FamilyUpdate,
    user=Depends(require_family),
    db: Session = Depends(get_db),
) -> FamilyDetail:
    fam = db.query(Family).filter(Family.id == user.family_id).first()
    if fam is None:
        raise HTTPException(status_code=404, detail="Family record not found")

    # Partial update: set-only non-None fields
    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if value is not None:
            setattr(fam, field, value)

    db.commit()
    db.refresh(fam)
    return FamilyDetail(**_build_family_detail(fam, db))


# ---------------------------------------------------------------------------
# Family — People
# ---------------------------------------------------------------------------


@router.get("/people")
def list_people(
    user=Depends(require_family),
    db: Session = Depends(get_db),
) -> PersonListResponse:
    people = db.query(Person).filter(Person.family_id == user.family_id).all()
    return PersonListResponse(
        people=[
            PersonSummary(
                id=p.id,
                family_id=p.family_id,
                given_name=p.given_name,
                age=p.age,
            )
            for p in people
        ]
    )


@router.post("/people", status_code=201)
def create_person(
    body: PersonCreateInFamily,
    user=Depends(require_family),
    db: Session = Depends(get_db),
) -> PersonDetail:
    family_id = user.family_id

    per = Person(
        family_id=family_id,
        given_name=body.given_name,
        age=body.age,
        practical_wish=body.practical_wish,
        fun_wish=body.fun_wish,
        title=body.title,
        note=body.note,
    )
    db.add(per)
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
