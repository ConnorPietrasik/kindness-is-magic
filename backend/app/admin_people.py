"""Admin CRUD routes for People.

All endpoints are guarded with ``require_admin``.
"""

import logging
import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Family, Person, User
from app.permissions import require_admin
from app.response_builders import (
    get_active_or_404,
    get_or_404,
    partial_update,
)
from app.schemas import (
    PersonCreate,
    PersonDetail,
    PersonListResponse,
    PersonSummary,
    PersonUpdate,
)

logger = logging.getLogger(__name__)

people_admin_router = APIRouter(
    prefix="/api/admin/people",
    tags=["admin-people"],
)


@people_admin_router.get("")
def list_people(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    include_deleted: bool = Query(False),
    family_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> PersonListResponse:
    query = db.query(Person)
    if not include_deleted:
        query = query.filter(Person.deleted_at.is_(None))
    if family_id is not None:
        query = query.filter(Person.family_id == family_id)
    total = query.count()
    people = query.order_by(Person.id).offset((page - 1) * page_size).limit(page_size).all()
    return PersonListResponse(
        people=[
            PersonSummary(
                id=p.id,
                family_id=p.family_id,
                given_name=p.given_name,
                age=p.age,
                deleted_at=p.deleted_at,
            )
            for p in people
        ],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total else 0,
    )


@people_admin_router.get("/{per_id}")
def get_person(
    per_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> PersonDetail:
    per = get_active_or_404(db, Person, per_id, "Person not found")
    return PersonDetail.model_validate(per)


@people_admin_router.post("", status_code=201)
def create_person(
    body: PersonCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> PersonDetail:
    # Validate family exists
    get_or_404(db, Family, body.family_id, "Family not found")

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
    logger.info("Admin %s created person '%s' (id=%s) in family %s", _admin.email, per.given_name, per.id, body.family_id)
    return PersonDetail.model_validate(per)


@people_admin_router.patch("/{per_id}")
def update_person(
    per_id: int,
    body: PersonUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> PersonDetail:
    # Intentionally uses get_or_404 (not get_active_or_404) so admins can modify or restore soft-deleted people.
    per = get_or_404(db, Person, per_id, "Person not found")
    partial_update(per, body)
    db.commit()
    db.refresh(per)
    logger.info("Admin %s updated person (id=%s)", _admin.email, per_id)
    return PersonDetail.model_validate(per)


@people_admin_router.post("/{per_id}/restore", status_code=200)
def restore_person(
    per_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> PersonDetail:
    per = get_or_404(db, Person, per_id, "Person not found")
    if per.deleted_at is None:
        raise HTTPException(status_code=400, detail="Person is not deleted")
    family = db.query(Family).filter(Family.id == per.family_id).first()
    if family and family.deleted_at is not None:
        raise HTTPException(status_code=400, detail="family_deleted")
    per.deleted_at = None
    db.commit()
    db.refresh(per)
    logger.info("Admin %s restored person (id=%s)", _admin.email, per_id)
    return PersonDetail.model_validate(per)


@people_admin_router.delete("/{per_id}", status_code=204)
def delete_person(
    per_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> Response:
    per = get_active_or_404(db, Person, per_id, "Person not found")
    per.deleted_at = datetime.now(timezone.utc)
    db.commit()
    logger.info("Admin %s soft-deleted person (id=%s)", _admin.email, per_id)
    return Response(status_code=204)
