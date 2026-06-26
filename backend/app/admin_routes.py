"""Admin CRUD routes for Referrers, Families, and People.

All endpoints are guarded with ``require_admin``.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Family, Person, Referrer
from app.permissions import require_admin
from app.schemas import (
    FamilyCreate,
    FamilyDetail,
    FamilyListResponse,
    FamilySummary,
    FamilyUpdate,
    PersonCreate,
    PersonDetail,
    PersonListResponse,
    PersonSummary,
    PersonUpdate,
    ReferrerCreate,
    ReferrerDetail,
    ReferrerListResponse,
    ReferrerSummary,
    ReferrerUpdate,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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


def _partial_update(obj, schema_model):
    """Apply non-None fields from a Pydantic model to a SQLAlchemy object."""
    update_data = schema_model.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if value is not None:
            setattr(obj, field, value)


# ---------------------------------------------------------------------------
# Admin — Referrers
# ---------------------------------------------------------------------------

referrer_admin_router = APIRouter(
    prefix="/api/admin/referrers",
    tags=["admin-referrers"],
)


@referrer_admin_router.get("")
def list_referrers(
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> ReferrerListResponse:
    referrers = (
        db.query(Referrer)
        .filter(Referrer.id != Family.ORPHAN_REFERRER_ID)
        .all()
    )
    return ReferrerListResponse(
        referrers=[
            ReferrerSummary(id=r.id, name=r.name, family_limit=r.family_limit)
            for r in referrers
        ]
    )


@referrer_admin_router.get("/{ref_id}")
def get_referrer(
    ref_id: int,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> ReferrerDetail:
    ref = db.query(Referrer).filter(Referrer.id == ref_id).first()
    if ref is None:
        raise HTTPException(status_code=404, detail="Referrer not found")
    return ReferrerDetail(**_build_referrer_detail(ref, db))


@referrer_admin_router.post("", status_code=201)
def create_referrer(
    body: ReferrerCreate,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> ReferrerDetail:
    ref = Referrer(
        name=body.name,
        family_limit=body.family_limit,
        phone_number=body.phone_number,
    )
    db.add(ref)
    db.commit()
    db.refresh(ref)
    return ReferrerDetail(**_build_referrer_detail(ref, db))


@referrer_admin_router.patch("/{ref_id}")
def update_referrer(
    ref_id: int,
    body: ReferrerUpdate,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> ReferrerDetail:
    ref = db.query(Referrer).filter(Referrer.id == ref_id).first()
    if ref is None:
        raise HTTPException(status_code=404, detail="Referrer not found")
    _partial_update(ref, body)
    db.commit()
    db.refresh(ref)
    return ReferrerDetail(**_build_referrer_detail(ref, db))


@referrer_admin_router.delete("/{ref_id}", status_code=204)
def delete_referrer(
    ref_id: int,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> Response:
    from app.models import Family, User

    ref = db.query(Referrer).filter(Referrer.id == ref_id).first()
    if ref is None:
        raise HTTPException(status_code=404, detail="Referrer not found")

    # Cascade families to orphan referrer (id=1)
    db.query(Family).filter(Family.referrer_id == ref_id).update(
        {Family.referrer_id: Family.ORPHAN_REFERRER_ID},
        synchronize_session=False,
    )

    # Null out users.referrer_id
    db.query(User).filter(User.referrer_id == ref_id).update(
        {User.referrer_id: None},
        synchronize_session=False,
    )

    db.delete(ref)
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Admin — Families
# ---------------------------------------------------------------------------

family_admin_router = APIRouter(
    prefix="/api/admin/families",
    tags=["admin-families"],
)


@family_admin_router.get("")
def list_families(
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> FamilyListResponse:
    families = db.query(Family).all()
    return FamilyListResponse(
        families=[
            FamilySummary(id=f.id, family_name=f.family_name, contact_name=f.contact_name)
            for f in families
        ]
    )


@family_admin_router.get("/{fam_id}")
def get_family(
    fam_id: int,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> FamilyDetail:
    fam = db.query(Family).filter(Family.id == fam_id).first()
    if fam is None:
        raise HTTPException(status_code=404, detail="Family not found")
    return FamilyDetail(**_build_family_detail(fam, db))


@family_admin_router.post("", status_code=201)
def create_family(
    body: FamilyCreate,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> FamilyDetail:
    # Validate referrer exists
    ref = db.query(Referrer).filter(Referrer.id == body.referrer_id).first()
    if ref is None:
        raise HTTPException(status_code=404, detail="Referrer not found")

    fam = Family(
        referrer_id=body.referrer_id,
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


@family_admin_router.patch("/{fam_id}")
def update_family(
    fam_id: int,
    body: FamilyUpdate,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> FamilyDetail:
    fam = db.query(Family).filter(Family.id == fam_id).first()
    if fam is None:
        raise HTTPException(status_code=404, detail="Family not found")
    _partial_update(fam, body)
    db.commit()
    db.refresh(fam)
    return FamilyDetail(**_build_family_detail(fam, db))


@family_admin_router.delete("/{fam_id}", status_code=204)
def delete_family(
    fam_id: int,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> Response:
    fam = db.query(Family).filter(Family.id == fam_id).first()
    if fam is None:
        raise HTTPException(status_code=404, detail="Family not found")
    db.delete(fam)
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Admin — People
# ---------------------------------------------------------------------------

people_admin_router = APIRouter(
    prefix="/api/admin/people",
    tags=["admin-people"],
)


@people_admin_router.get("")
def list_people(
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> PersonListResponse:
    people = db.query(Person).all()
    return PersonListResponse(
        people=[
            PersonSummary(id=p.id, family_id=p.family_id, given_name=p.given_name, age=p.age)
            for p in people
        ]
    )


@people_admin_router.get("/{per_id}")
def get_person(
    per_id: int,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
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


@people_admin_router.post("", status_code=201)
def create_person(
    body: PersonCreate,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> PersonDetail:
    # Validate family exists
    fam = db.query(Family).filter(Family.id == body.family_id).first()
    if fam is None:
        raise HTTPException(status_code=404, detail="Family not found")

    per = Person(
        family_id=body.family_id,
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


@people_admin_router.patch("/{per_id}")
def update_person(
    per_id: int,
    body: PersonUpdate,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> PersonDetail:
    per = db.query(Person).filter(Person.id == per_id).first()
    if per is None:
        raise HTTPException(status_code=404, detail="Person not found")
    _partial_update(per, body)
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


@people_admin_router.delete("/{per_id}", status_code=204)
def delete_person(
    per_id: int,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> Response:
    per = db.query(Person).filter(Person.id == per_id).first()
    if per is None:
        raise HTTPException(status_code=404, detail="Person not found")
    db.delete(per)
    db.commit()
    return Response(status_code=204)
