"""Referrer self-service routes: own info, family CRUD, family people collection.

All endpoints are guarded with ``require_referrer``.
Ownership is enforced so a referrer can only act on their own families/people.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Family, Person, Referrer
from app.permissions import require_referrer
from app.schemas import (
    FamilyDetail,
    FamilyListResponse,
    FamilySummary,
    FamilyUpdate,
    PersonCreate,
    PersonDetail,
    PersonListResponse,
    PersonSummary,
    PersonUpdate,
    ReferrerDetail,
    ReferrerSelfUpdate,
)

router = APIRouter(prefix="/api/referrer", tags=["referrer"])

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


def _build_referrer_detail(ref: Referrer, db: Session) -> dict:
    """Build ReferrerDetail dict with computed family_count."""
    family_count = db.query(Family).filter(Family.referrer_id == ref.id).count()
    return {
        "id": ref.id,
        "name": ref.name,
        "family_limit": ref.family_limit,
        "phone_number": ref.phone_number,
        "family_count": family_count,
    }


def _partial_update(obj, schema_model):
    """Apply non-None fields from a Pydantic model to a SQLAlchemy object."""
    update_data = schema_model.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if value is not None:
            setattr(obj, field, value)


# ---------------------------------------------------------------------------
# Schemas for referrer-initiated creates (no referrer_id / family_id in body)
# ---------------------------------------------------------------------------


class FamilyCreateByReferrer(BaseModel):
    family_name: str = Field(..., min_length=1, max_length=40)
    family_wish: str = Field(..., min_length=1, max_length=400)
    contact_name: str = Field(..., min_length=1, max_length=40)
    bio: str | None = None
    address: str | None = Field(None, max_length=200)
    phone_number: str | None = Field(None, max_length=20)


class PersonCreateInFamily(BaseModel):
    given_name: str = Field(..., min_length=1, max_length=40)
    age: int = Field(..., ge=0, le=200)
    practical_wish: str = Field(..., min_length=1, max_length=400)
    fun_wish: str = Field(..., min_length=1, max_length=400)
    title: str | None = Field(None, max_length=40)
    note: str | None = Field(None, max_length=400)


# ---------------------------------------------------------------------------
# Referrer — Self
# ---------------------------------------------------------------------------


@router.get("/me")
def get_self(
    user=Depends(require_referrer),
    db: Session = Depends(get_db),
) -> ReferrerDetail:
    ref = db.query(Referrer).filter(Referrer.id == user.referrer_id).first()
    if ref is None:
        raise HTTPException(status_code=404, detail="Referrer record not found")
    return ReferrerDetail(**_build_referrer_detail(ref, db))


@router.patch("/me")
def update_self(
    body: ReferrerSelfUpdate,
    user=Depends(require_referrer),
    db: Session = Depends(get_db),
) -> ReferrerDetail:
    ref = db.query(Referrer).filter(Referrer.id == user.referrer_id).first()
    if ref is None:
        raise HTTPException(status_code=404, detail="Referrer record not found")
    _partial_update(ref, body)
    db.commit()
    db.refresh(ref)
    return ReferrerDetail(**_build_referrer_detail(ref, db))


# ---------------------------------------------------------------------------
# Referrer — Families
# ---------------------------------------------------------------------------


@router.get("/families")
def list_families(
    user=Depends(require_referrer),
    db: Session = Depends(get_db),
) -> FamilyListResponse:
    families = (
        db.query(Family)
        .filter(Family.referrer_id == user.referrer_id)
        .all()
    )
    return FamilyListResponse(
        families=[
            FamilySummary(
                id=f.id,
                family_name=f.family_name,
                family_wish=f.family_wish,
                contact_name=f.contact_name,
                referrer_id=f.referrer_id,
                person_count=db.query(Person).filter(Person.family_id == f.id).count(),
            )
            for f in families
        ]
    )


@router.get("/families/{fam_id}")
def get_family(
    fam_id: int,
    user=Depends(require_referrer),
    db: Session = Depends(get_db),
) -> FamilyDetail:
    fam = db.query(Family).filter(Family.id == fam_id).first()
    if fam is None:
        raise HTTPException(status_code=404, detail="Family not found")
    if fam.referrer_id != user.referrer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this resource",
        )
    return FamilyDetail(**_build_family_detail(fam, db))


@router.post("/families", status_code=201)
def create_family(
    body: FamilyCreateByReferrer,
    user=Depends(require_referrer),
    db: Session = Depends(get_db),
) -> FamilyDetail:
    referrer_id = user.referrer_id

    # Check family_limit not exceeded
    current_count = db.query(Family).filter(
        Family.referrer_id == referrer_id
    ).count()

    ref = db.query(Referrer).filter(Referrer.id == referrer_id).first()
    if ref is None:
        raise HTTPException(status_code=404, detail="Referrer record not found")

    if current_count >= ref.family_limit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Family limit of {ref.family_limit} reached",
        )

    fam = Family(
        referrer_id=referrer_id,
        family_name=body.family_name,
        family_wish=body.family_wish,
        contact_name=body.contact_name,
        bio=body.bio,
        address=body.address,
        phone_number=body.phone_number,
    )
    db.add(fam)
    db.commit()
    db.refresh(fam)
    return FamilyDetail(**_build_family_detail(fam, db))


@router.patch("/families/{fam_id}")
def update_family(
    fam_id: int,
    body: FamilyUpdate,
    user=Depends(require_referrer),
    db: Session = Depends(get_db),
) -> FamilyDetail:
    fam = db.query(Family).filter(Family.id == fam_id).first()
    if fam is None:
        raise HTTPException(status_code=404, detail="Family not found")
    if fam.referrer_id != user.referrer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this resource",
        )
    _partial_update(fam, body)
    db.commit()
    db.refresh(fam)
    return FamilyDetail(**_build_family_detail(fam, db))


@router.delete("/families/{fam_id}", status_code=204)
def delete_family(
    fam_id: int,
    user=Depends(require_referrer),
    db: Session = Depends(get_db),
) -> Response:
    fam = db.query(Family).filter(Family.id == fam_id).first()
    if fam is None:
        raise HTTPException(status_code=404, detail="Family not found")
    if fam.referrer_id != user.referrer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this resource",
        )
    db.delete(fam)
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Referrer — People within a family
# ---------------------------------------------------------------------------


@router.get("/families/{fid}/people")
def list_family_people(
    fid: int,
    user=Depends(require_referrer),
    db: Session = Depends(get_db),
) -> PersonListResponse:
    fam = db.query(Family).filter(Family.id == fid).first()
    if fam is None:
        raise HTTPException(status_code=404, detail="Family not found")
    if fam.referrer_id != user.referrer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this resource",
        )
    people = db.query(Person).filter(Person.family_id == fid).all()
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


@router.post("/families/{fid}/people", status_code=201)
def create_family_person(
    fid: int,
    body: PersonCreateInFamily,
    user=Depends(require_referrer),
    db: Session = Depends(get_db),
) -> PersonDetail:
    fam = db.query(Family).filter(Family.id == fid).first()
    if fam is None:
        raise HTTPException(status_code=404, detail="Family not found")
    if fam.referrer_id != user.referrer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this resource",
        )

    per = Person(
        family_id=fid,
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
