"""Referrer self-service routes: own info, family CRUD, family people collection.

All endpoints are guarded with ``require_referrer``.
Ownership is enforced so a referrer can only act on their own families/people.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Family, Person, Referrer
from app.permissions import require_referrer
from app.response_builders import (
    build_family_detail,
    build_referrer_detail,
    get_active_or_404,
    get_or_404,
    partial_update,
)
from app.schemas import (
    FamilyCreateByReferrer,
    FamilyDetail,
    FamilyListResponse,
    FamilySummary,
    FamilyUpdate,
    PersonCreateInFamily,
    PersonDetail,
    PersonListResponse,
    PersonSummary,
    ReferrerDetail,
    ReferrerSelfUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/referrer", tags=["referrer"])

# ---------------------------------------------------------------------------
# Referrer — Self
# ---------------------------------------------------------------------------


@router.get("/me")
def get_self(
    user=Depends(require_referrer),
    db: Session = Depends(get_db),
) -> ReferrerDetail:
    ref = get_or_404(db, Referrer, user.referrer_id, "Referrer record not found")
    return ReferrerDetail(**build_referrer_detail(ref, db))


@router.patch("/me")
def update_self(
    body: ReferrerSelfUpdate,
    user=Depends(require_referrer),
    db: Session = Depends(get_db),
) -> ReferrerDetail:
    ref = get_or_404(db, Referrer, user.referrer_id, "Referrer record not found")
    partial_update(ref, body)
    db.commit()
    db.refresh(ref)
    logger.info("Referrer %s updated own profile (id=%s)", user.email, ref.id)
    return ReferrerDetail(**build_referrer_detail(ref, db))


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
        .filter(
            Family.referrer_id == user.referrer_id,
            Family.is_deleted == False,
        )
        .all()
    )

    # Single aggregation query instead of N+1 count() calls
    counts = (
        db.query(Person.family_id, func.count(Person.id))
        .filter(Person.is_deleted == False)
        .group_by(Person.family_id)
        .all()
    )
    count_map = {fid: cnt for fid, cnt in counts}

    return FamilyListResponse(
        families=[
            FamilySummary(
                id=f.id,
                family_name=f.family_name,
                family_wish=f.family_wish,
                contact_name=f.contact_name,
                referrer_id=f.referrer_id,
                is_deleted=f.is_deleted,
                person_count=count_map.get(f.id, 0),
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
    fam = get_active_or_404(db, Family, fam_id, "Family not found")
    if fam.referrer_id != user.referrer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this resource",
        )
    return FamilyDetail(**build_family_detail(fam, db))


@router.post("/families", status_code=201)
def create_family(
    body: FamilyCreateByReferrer,
    user=Depends(require_referrer),
    db: Session = Depends(get_db),
) -> FamilyDetail:
    referrer_id = user.referrer_id

    # Check family_limit not exceeded (exclude soft-deleted families)
    current_count = db.query(Family).filter(
        Family.referrer_id == referrer_id,
        Family.is_deleted == False,
    ).count()

    ref = get_or_404(db, Referrer, referrer_id, "Referrer record not found")

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
    logger.info("Referrer %s created family '%s' (id=%s)", user.email, fam.family_name, fam.id)
    return FamilyDetail(**build_family_detail(fam, db))


@router.patch("/families/{fam_id}")
def update_family(
    fam_id: int,
    body: FamilyUpdate,
    user=Depends(require_referrer),
    db: Session = Depends(get_db),
) -> FamilyDetail:
    fam = get_active_or_404(db, Family, fam_id, "Family not found")
    if fam.referrer_id != user.referrer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this resource",
        )
    partial_update(fam, body)
    db.commit()
    db.refresh(fam)
    logger.info("Referrer %s updated family (id=%s)", user.email, fam_id)
    return FamilyDetail(**build_family_detail(fam, db))


@router.delete("/families/{fam_id}", status_code=204)
def delete_family(
    fam_id: int,
    user=Depends(require_referrer),
    db: Session = Depends(get_db),
) -> Response:
    fam = get_active_or_404(db, Family, fam_id, "Family not found")
    if fam.referrer_id != user.referrer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this resource",
        )
    # Soft-delete all persons in the family first to avoid orphans.
    db.query(Person).filter(Person.family_id == fam_id).update(
        {Person.is_deleted: True}, synchronize_session=False
    )
    fam.is_deleted = True
    db.commit()
    logger.info("Referrer %s soft-deleted family '%s' (id=%s)", user.email, fam.family_name, fam_id)
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
    fam = get_active_or_404(db, Family, fid, "Family not found")
    if fam.referrer_id != user.referrer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this resource",
        )
    people = db.query(Person).filter(
        Person.family_id == fid, Person.is_deleted == False
    ).all()
    return PersonListResponse(
        people=[
            PersonSummary(
                id=p.id,
                family_id=p.family_id,
                given_name=p.given_name,
                age=p.age,
                is_deleted=p.is_deleted,
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
    fam = get_or_404(db, Family, fid, "Family not found")
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
    logger.info("Referrer %s created person '%s' (id=%s) in family %s", user.email, per.given_name, per.id, fid)
    return PersonDetail.model_validate(per)
