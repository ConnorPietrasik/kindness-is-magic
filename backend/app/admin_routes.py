"""Admin CRUD routes for Referrers, Families, and People.

All endpoints are guarded with ``require_admin``.
"""

import logging
import math
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Family, Person, Referrer
from app.permissions import require_admin
from app.response_builders import (
    build_family_detail,
    build_referrer_detail,
    get_active_or_404,
    get_or_404,
    partial_update,
)
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

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Admin — Referrers
# ---------------------------------------------------------------------------

referrer_admin_router = APIRouter(
    prefix="/api/admin/referrers",
    tags=["admin-referrers"],
)


@referrer_admin_router.get("")
def list_referrers(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> ReferrerListResponse:
    total = db.query(Referrer).filter(Referrer.id != Family.ORPHAN_REFERRER_ID).count()
    referrers = (
        db.query(Referrer)
        .filter(Referrer.id != Family.ORPHAN_REFERRER_ID)
        .order_by(Referrer.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return ReferrerListResponse(
        referrers=[ReferrerSummary(id=r.id, name=r.name, family_limit=r.family_limit) for r in referrers],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total else 0,
    )


@referrer_admin_router.get("/{ref_id}")
def get_referrer(
    ref_id: int,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> ReferrerDetail:
    ref = get_or_404(db, Referrer, ref_id, "Referrer not found")
    return ReferrerDetail(**build_referrer_detail(ref, db))


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
    logger.info("Admin %s created referrer '%s' (id=%s)", _admin.email, ref.name, ref.id)
    return ReferrerDetail(**build_referrer_detail(ref, db))


@referrer_admin_router.patch("/{ref_id}")
def update_referrer(
    ref_id: int,
    body: ReferrerUpdate,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> ReferrerDetail:
    ref = get_or_404(db, Referrer, ref_id, "Referrer not found")
    partial_update(ref, body)
    db.commit()
    db.refresh(ref)
    logger.info("Admin %s updated referrer (id=%s)", _admin.email, ref_id)
    return ReferrerDetail(**build_referrer_detail(ref, db))


@referrer_admin_router.delete("/{ref_id}", status_code=204)
def delete_referrer(
    ref_id: int,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> Response:
    from app.models import Family, User

    ref = get_or_404(db, Referrer, ref_id, "Referrer not found")

    # Cascade families to orphan referrer (id=0)
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
    logger.info("Admin %s deleted referrer '%s' (id=%s)", _admin.email, ref.name, ref_id)
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
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> FamilyListResponse:
    total = db.query(Family).filter(Family.is_deleted == False).count()
    families = db.query(Family).filter(Family.is_deleted == False).order_by(Family.id).offset((page - 1) * page_size).limit(page_size).all()

    # Single aggregation query instead of N+1 count() calls
    counts = db.query(Person.family_id, func.count(Person.id)).filter(Person.is_deleted == False).group_by(Person.family_id).all()
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
        ],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total else 0,
    )


@family_admin_router.get("/{fam_id}")
def get_family(
    fam_id: int,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> FamilyDetail:
    fam = get_active_or_404(db, Family, fam_id, "Family not found")
    return FamilyDetail(**build_family_detail(fam, db))


@family_admin_router.post("", status_code=201)
def create_family(
    body: FamilyCreate,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> FamilyDetail:
    # Validate referrer exists
    get_or_404(db, Referrer, body.referrer_id, "Referrer not found")

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
    logger.info("Admin %s created family '%s' (id=%s)", _admin.email, fam.family_name, fam.id)
    return FamilyDetail(**build_family_detail(fam, db))


@family_admin_router.patch("/{fam_id}")
def update_family(
    fam_id: int,
    body: FamilyUpdate,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> FamilyDetail:
    fam = get_or_404(db, Family, fam_id, "Family not found")
    partial_update(fam, body)
    db.commit()
    db.refresh(fam)
    logger.info("Admin %s updated family (id=%s)", _admin.email, fam_id)
    return FamilyDetail(**build_family_detail(fam, db))


@family_admin_router.delete("/{fam_id}", status_code=204)
def delete_family(
    fam_id: int,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> Response:
    fam = get_active_or_404(db, Family, fam_id, "Family not found")
    # Soft-delete all persons in the family first to avoid orphans.
    db.query(Person).filter(Person.family_id == fam_id).update({Person.is_deleted: True}, synchronize_session=False)
    fam.is_deleted = True
    db.commit()
    logger.info("Admin %s soft-deleted family '%s' (id=%s)", _admin.email, fam.family_name, fam_id)
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
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> PersonListResponse:
    total = db.query(Person).filter(Person.is_deleted == False).count()
    people = db.query(Person).filter(Person.is_deleted == False).order_by(Person.id).offset((page - 1) * page_size).limit(page_size).all()
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
    _admin: object = Depends(require_admin),
) -> PersonDetail:
    per = get_active_or_404(db, Person, per_id, "Person not found")
    return PersonDetail.model_validate(per)


@people_admin_router.post("", status_code=201)
def create_person(
    body: PersonCreate,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
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
    _admin: object = Depends(require_admin),
) -> PersonDetail:
    per = get_active_or_404(db, Person, per_id, "Person not found")
    partial_update(per, body)
    db.commit()
    db.refresh(per)
    logger.info("Admin %s updated person (id=%s)", _admin.email, per_id)
    return PersonDetail.model_validate(per)


@people_admin_router.delete("/{per_id}", status_code=204)
def delete_person(
    per_id: int,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> Response:
    per = get_active_or_404(db, Person, per_id, "Person not found")
    per.is_deleted = True
    db.commit()
    logger.info("Admin %s soft-deleted person (id=%s)", _admin.email, per_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Admin — CSV Import
# ---------------------------------------------------------------------------

csv_admin_router = APIRouter(
    prefix="/api/admin",
    tags=["admin-csv"],
)


csv_sample = """# referrers
name,family_limit,phone_number
John Smith,10,555-0001
Jane Doe,15,555-0002

# families
referrer_name,family_name,family_wish,contact_name,bio,address,phone_number
John Smith,The Johnsons,A warm blanket,Mom Johnson,,,555-1111
Jane Doe,The Smiths,A computer,Dad Smith,,123 Main St,

# people
family_name,given_name,age,practical_wish,fun_wish,title,note
The Johnsons,Alice,8,Backpack,Doll,,
The Johnsons,Bob,12,New shoes,Game,,Allergic to peanuts
The Smiths,Charlie,5,Winter coat,Puzzle,,

# users
email,password,role,referrer_name_or_id,family_name_or_id
john@example.com,Password123!,referrer,John Smith,
jane@example.com,Password123!,referrer,Jane Doe,
mom@example.com,Password123!,family,,The Johnsons
dad@example.com,Password123!,family,,The Smiths"""


@csv_admin_router.get("/csv-sample")
def get_csv_sample(_admin: object = Depends(require_admin)):
    """Return a sample CSV template for admin reference."""
    return {"csv_template": csv_sample}


@csv_admin_router.post("/import-csv")
async def import_csv_data(
    request: Request,
    db: Session = Depends(get_db),
    _admin: object = Depends(require_admin),
) -> dict:
    """Import a CSV file (raw body) to bulk-create referrers, families, people, and users.

    The CSV uses section headers (``# referrers``, ``# families``, ``# people``,
    ``# users``) to group rows by entity type.
    """
    raw = await request.body()
    if not raw.strip():
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        content = raw.decode("latin-1")

    from app.csv_import import import_csv as do_import

    summary = do_import(db, content)
    logger.info(
        "Admin %s imported CSV — R:%d F:%d P:%d U:%d (errors: R:%d F:%d P:%d U:%d)",
        _admin.email,
        summary.referrers_created,
        summary.families_created,
        summary.people_created,
        summary.users_created,
        summary.referrers_errors,
        summary.families_errors,
        summary.people_errors,
        summary.users_errors,
    )
    return summary.to_dict()
