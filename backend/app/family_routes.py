"""Family self-service routes: own info, people collection.

All endpoints are guarded with ``require_family``.
"""

import logging
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Family, Person
from app.permissions import require_family
from app.response_builders import build_family_detail, get_active_or_404, partial_update
from app.schemas import (
    FamilyDetail,
    FamilyUpdate,
    PersonCreateInFamily,
    PersonDetail,
    PersonListResponse,
    PersonSummary,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/family", tags=["family"])

# ---------------------------------------------------------------------------
# Family — Self
# ---------------------------------------------------------------------------


@router.get("/me")
def get_self(
    user=Depends(require_family),
    db: Session = Depends(get_db),
) -> FamilyDetail:
    fam = get_active_or_404(db, Family, user.family_id, "Family record not found")
    return FamilyDetail(**build_family_detail(fam, db))


@router.patch("/me")
def update_self(
    body: FamilyUpdate,
    user=Depends(require_family),
    db: Session = Depends(get_db),
) -> FamilyDetail:
    fam = get_active_or_404(db, Family, user.family_id, "Family record not found")

    partial_update(fam, body)

    db.commit()
    db.refresh(fam)
    logger.info("Family user %s updated own profile (family id=%s)", user.email, fam.id)
    return FamilyDetail(**build_family_detail(fam, db))


# ---------------------------------------------------------------------------
# Family — People
# ---------------------------------------------------------------------------


@router.get("/people")
def list_people(
    user=Depends(require_family),
    db: Session = Depends(get_db),
) -> PersonListResponse:
    people = db.query(Person).filter(Person.family_id == user.family_id, Person.is_deleted == False).all()
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
    logger.info(
        "Family user %s created person '%s' (id=%s) in family %s",
        user.email,
        per.given_name,
        per.id,
        family_id,
    )
    return PersonDetail.model_validate(per)
