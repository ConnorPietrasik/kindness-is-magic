"""Admin CRUD routes for Referrers, Families, and People.

All endpoints are guarded with ``require_admin``.
"""

import logging
import math
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Family, Person, Referrer, User
from app.permissions import require_admin
from app.response_builders import (
    build_family_detail,
    build_referrer_detail,
    get_active_or_404,
    get_or_404,
    partial_update,
)
from app.schemas import (
    AdminFamilyUpdate,
    AdminReferrerUpdate,
    FamilyCreate,
    FamilyDetail,
    FamilyListResponse,
    FamilySummary,
    PersonCreate,
    PersonDetail,
    PersonListResponse,
    PersonSummary,
    PersonUpdate,
    ReferrerCreate,
    ReferrerDetail,
    ReferrerListResponse,
    ReferrerSummary,
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
    include_deleted: bool = Query(False),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ReferrerListResponse:
    query = db.query(Referrer)
    if not include_deleted:
        query = query.filter(Referrer.deleted_at.is_(None))
    total = query.count()
    referrers = query.order_by(Referrer.id).offset((page - 1) * page_size).limit(page_size).all()
    return ReferrerListResponse(
        referrers=[ReferrerSummary(id=r.id, name=r.name, family_limit=r.family_limit, deleted_at=r.deleted_at) for r in referrers],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total else 0,
    )


@referrer_admin_router.get("/{ref_id}")
def get_referrer(
    ref_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ReferrerDetail:
    ref = get_active_or_404(db, Referrer, ref_id, "Referrer not found")
    return ReferrerDetail(**build_referrer_detail(ref, db))


@referrer_admin_router.post("", status_code=201)
def create_referrer(
    body: ReferrerCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
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
    body: AdminReferrerUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ReferrerDetail:
    ref = get_or_404(db, Referrer, ref_id, "Referrer not found")
    partial_update(ref, body)
    db.commit()
    db.refresh(ref)
    logger.info("Admin %s updated referrer (id=%s)", _admin.email, ref_id)
    return ReferrerDetail(**build_referrer_detail(ref, db))


@referrer_admin_router.post("/{ref_id}/restore", status_code=200)
def restore_referrer(
    ref_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ReferrerDetail:
    ref = get_or_404(db, Referrer, ref_id, "Referrer not found")
    if ref.deleted_at is None:
        raise HTTPException(status_code=400, detail="Referrer is not deleted")
    ref.deleted_at = None
    db.commit()
    db.refresh(ref)
    logger.info("Admin %s restored referrer '%s' (id=%s)", _admin.email, ref.name, ref_id)
    return ReferrerDetail(**build_referrer_detail(ref, db))


@referrer_admin_router.delete("/{ref_id}", status_code=204)
def delete_referrer(
    ref_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> Response:
    ref = get_active_or_404(db, Referrer, ref_id, "Referrer not found")
    ref.deleted_at = datetime.now(timezone.utc)
    db.commit()
    logger.info("Admin %s soft-deleted referrer '%s' (id=%s)", _admin.email, ref.name, ref_id)
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
    include_deleted: bool = Query(False),
    referrer_id: int | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FamilyListResponse:
    query = db.query(Family)
    if not include_deleted:
        query = query.filter(Family.deleted_at.is_(None))
    if referrer_id is not None:
        query = query.filter(Family.referrer_id == referrer_id)
    total = query.count()
    families = query.order_by(Family.id).offset((page - 1) * page_size).limit(page_size).all()

    # Single aggregation query instead of N+1 count() calls
    counts = db.query(Person.family_id, func.count(Person.id)).filter(Person.deleted_at.is_(None)).group_by(Person.family_id).all()
    count_map = {fid: cnt for fid, cnt in counts}

    return FamilyListResponse(
        families=[
            FamilySummary(
                id=f.id,
                family_name=f.family_name,
                family_wish=f.family_wish,
                contact_name=f.contact_name,
                referrer_id=f.referrer_id,
                deleted_at=f.deleted_at,
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
    _admin: User = Depends(require_admin),
) -> FamilyDetail:
    fam = get_active_or_404(db, Family, fam_id, "Family not found")
    return FamilyDetail(**build_family_detail(fam, db))


@family_admin_router.post("", status_code=201)
def create_family(
    body: FamilyCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FamilyDetail:
    # Validate referrer exists if provided
    if body.referrer_id is not None:
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
    body: AdminFamilyUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FamilyDetail:
    # Intentionally uses get_or_404 (not get_active_or_404) so admins can modify or restore soft-deleted families.
    fam = get_or_404(db, Family, fam_id, "Family not found")
    # Validate referrer exists if referrer_id is being changed (0 means clear to NULL)
    if body.referrer_id is not None and body.referrer_id != 0:
        get_or_404(db, Referrer, body.referrer_id, "Referrer not found")
    partial_update(fam, body)
    db.commit()
    db.refresh(fam)
    logger.info("Admin %s updated family (id=%s)", _admin.email, fam_id)
    return FamilyDetail(**build_family_detail(fam, db))


@family_admin_router.post("/{fam_id}/restore", status_code=200)
def restore_family(
    fam_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FamilyDetail:
    fam = get_or_404(db, Family, fam_id, "Family not found")
    if fam.deleted_at is None:
        raise HTTPException(status_code=400, detail="Family is not deleted")
    # Restore the family and all its soft-deleted people
    fam.deleted_at = None
    db.query(Person).filter(Person.family_id == fam_id).update({Person.deleted_at: None}, synchronize_session=False)
    db.commit()
    db.refresh(fam)
    logger.info("Admin %s restored family '%s' (id=%s)", _admin.email, fam.family_name, fam_id)
    return FamilyDetail(**build_family_detail(fam, db))


@family_admin_router.delete("/{fam_id}", status_code=204)
def delete_family(
    fam_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> Response:
    fam = get_active_or_404(db, Family, fam_id, "Family not found")
    # Soft-delete all persons in the family first to avoid orphans.
    now = datetime.now(timezone.utc)
    db.query(Person).filter(Person.family_id == fam_id).update({Person.deleted_at: now}, synchronize_session=False)
    fam.deleted_at = now
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
def get_csv_sample(_admin: User = Depends(require_admin)):
    """Return a sample CSV template for admin reference."""
    return {"csv_template": csv_sample}


@csv_admin_router.post("/import-csv")
async def import_csv_data(
    request: Request,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
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
