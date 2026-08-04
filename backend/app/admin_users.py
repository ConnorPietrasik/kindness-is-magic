"""Admin CRUD routes for Users and CSV Import.

All endpoints are guarded with ``require_admin``.
"""

import logging
import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.auth import get_password_hash
from app.database import get_db
from app.models import Family, Referrer, User
from app.permissions import require_admin
from app.response_builders import (
    _CLEAR,
    _resolve_sentinels,
    build_user_detail,
    get_active_or_404,
    get_or_404,
    partial_update,
)
from app.schemas import (
    AdminUserCreate,
    AdminUserUpdate,
    UserDetail,
    UserListResponse,
    UserPasswordReset,
)
from app.user_validation import validate_user_role_consistency

logger = logging.getLogger(__name__)


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
John Smith,The Johnsons,A fleece blanket,Mom Johnson,Family of four,123 Oak St,555-1111
Jane Doe,The Smiths,A coffee maker,Dad Smith,Young family,456 Main St,555-2222

# people
family_name,given_name,age,wish,size,fun_wish,title,note
The Johnsons,Mom,34,Black bathrobe,M,,,mother
The Johnsons,Dad,36,Electric shaving kit,,,father,
The Johnsons,Alice,8,Backpack,,Doll set,daughter,
The Johnsons,Bob,12,Tennis shoes,3Y,Board game,son,Allergic to peanuts
The Smiths,Dad,38,Home tool kit,,,father,
The Smiths,Charlie,5,Winter coat,5,Puzzle,son,

# users
email,password,role,referrer_name_or_id,family_name_or_id,display_name
john@example.com,Password123!,referrer,John Smith,,John S.
jane@example.com,Password123!,referrer,Jane Doe,,Jane D.
mom@example.com,Password123!,family,,The Johnsons,Mom Johnson
dad@example.com,Password123!,family,,The Smiths,Dad Smith"""


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


# ---------------------------------------------------------------------------
# Admin — Users
# ---------------------------------------------------------------------------

user_admin_router = APIRouter(
    prefix="/api/admin/users",
    tags=["admin-users"],
)


def _apply_role_filter(query, role: str | None, roles: str | None):
    """Apply role filtering to a user query.

    Supports single ``role`` (backward-compatible) or comma-separated
    ``roles`` for multi-role filtering (e.g. ``roles=admin,purchaser``).
    If both are provided, ``roles`` takes precedence.
    """
    if roles is not None:
        role_values = [r.strip() for r in roles.split(",") if r.strip()]
        if role_values:
            query = query.filter(User.role.in_(role_values))
    elif role is not None:
        query = query.filter(User.role == role)
    return query


@user_admin_router.get("")
def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    role: str | None = Query(None),
    roles: str | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> UserListResponse:
    """List active (non-deleted) users with stable display IDs.

    Supports single ``role`` filter (backward-compatible) or
    comma-separated ``roles`` for multi-role filtering.
    """
    query = db.query(User).filter(User.deleted_at.is_(None))
    query = _apply_role_filter(query, role, roles)
    if search is not None:
        pattern = f"%{search}%"
        query = query.filter(
            or_(
                User.email.ilike(pattern),
                User.display_name.ilike(pattern),
            )
        )
    total = query.count()
    users = query.order_by(User.id).offset((page - 1) * page_size).limit(page_size).all()

    # Stable positions via ROW_NUMBER over all active users (respecting role/search filters)
    pos_map: dict[int, int] = {}
    if users:
        user_ids = [u.id for u in users]
        # Rebuild the same filtered query for ROW_NUMBER
        pos_query = db.query(User).filter(User.deleted_at.is_(None))
        pos_query = _apply_role_filter(pos_query, role, roles)
        if search is not None:
            pattern = f"%{search}%"
            pos_query = pos_query.filter(
                or_(
                    User.email.ilike(pattern),
                    User.display_name.ilike(pattern),
                )
            )
        positions = pos_query.with_entities(
            User.id,
            func.row_number().over(order_by=User.id).label("rn"),
        ).all()
        full_map = {uid: int(rn) for uid, rn in positions}
        pos_map = {uid: full_map[uid] for uid in user_ids if uid in full_map}

    # Pre-load referrer and family name maps to avoid N+1 queries
    referrer_ids = {u.referrer_id for u in users if u.referrer_id is not None}
    family_ids = {u.family_id for u in users if u.family_id is not None}

    referrer_map: dict[int, str] = {}
    if referrer_ids:
        for ref in db.query(Referrer).filter(Referrer.id.in_(referrer_ids), Referrer.deleted_at.is_(None)).all():
            referrer_map[ref.id] = ref.name

    family_map: dict[int, str] = {}
    if family_ids:
        for fam in db.query(Family).filter(Family.id.in_(family_ids), Family.deleted_at.is_(None)).all():
            family_map[fam.id] = fam.family_name

    return UserListResponse(
        users=[
            UserDetail(
                **build_user_detail(u, db, referrer_map=referrer_map, family_map=family_map),
                display_id=str(pos_map.get(u.id, 0)),
            )
            for u in users
        ],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total else 0,
    )


@user_admin_router.get("/deleted")
def list_deleted_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    role: str | None = Query(None),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> UserListResponse:
    """List soft-deleted users."""
    query = db.query(User).filter(User.deleted_at.isnot(None))
    if role is not None:
        query = query.filter(User.role == role)
    if search is not None:
        pattern = f"%{search}%"
        query = query.filter(
            or_(
                User.email.ilike(pattern),
                User.display_name.ilike(pattern),
            )
        )
    total = query.count()
    users = query.order_by(User.id).offset((page - 1) * page_size).limit(page_size).all()

    # Pre-load referrer and family name maps to avoid N+1 queries
    referrer_ids = {u.referrer_id for u in users if u.referrer_id is not None}
    family_ids = {u.family_id for u in users if u.family_id is not None}

    referrer_map: dict[int, str] = {}
    if referrer_ids:
        for ref in db.query(Referrer).filter(Referrer.id.in_(referrer_ids), Referrer.deleted_at.is_(None)).all():
            referrer_map[ref.id] = ref.name

    family_map: dict[int, str] = {}
    if family_ids:
        for fam in db.query(Family).filter(Family.id.in_(family_ids), Family.deleted_at.is_(None)).all():
            family_map[fam.id] = fam.family_name

    return UserListResponse(
        users=[
            UserDetail(
                **build_user_detail(u, db, referrer_map=referrer_map, family_map=family_map),
                display_id="DELETED",
            )
            for u in users
        ],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total else 0,
    )


@user_admin_router.get("/{user_id}")
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> UserDetail:
    user = get_active_or_404(db, User, user_id, "User not found")
    return UserDetail(**build_user_detail(user, db))


@user_admin_router.post("", status_code=201)
def create_user(
    body: AdminUserCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> UserDetail:
    # Role-FK consistency
    errors = validate_user_role_consistency(body.role, body.referrer_id, body.family_id)
    if errors:
        raise HTTPException(status_code=422, detail=errors)

    # FK targets must exist and not be soft-deleted
    if body.referrer_id is not None:
        ref = get_or_404(db, Referrer, body.referrer_id, "Referrer not found")
        if ref.deleted_at is not None:
            raise HTTPException(status_code=422, detail="Referrer is soft-deleted")
    if body.family_id is not None:
        fam = get_or_404(db, Family, body.family_id, "Family not found")
        if fam.deleted_at is not None:
            raise HTTPException(status_code=422, detail="Family is soft-deleted")

    # Check for duplicate email
    existing = db.query(User).filter(User.email == body.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already in use")

    user = User(
        email=body.email,
        hashed_password=get_password_hash(body.password),
        role=body.role,
        display_name=body.display_name,
        referrer_id=body.referrer_id,
        family_id=body.family_id,
        deleted_at=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.info("Admin %s created user '%s' (id=%s)", _admin.email, user.email, user.id)
    return UserDetail(**build_user_detail(user, db))


@user_admin_router.patch("/{user_id}")
def update_user(
    user_id: int,
    body: AdminUserUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> UserDetail:
    # Intentionally uses get_or_404 (not get_active_or_404) so admins can modify soft-deleted users.
    user = get_or_404(db, User, user_id, "User not found")

    # Resolve sentinels (0 → _CLEAR for FKs) so validation sees the effective values.
    update_data = body.model_dump(exclude_unset=True)
    resolved = _resolve_sentinels(user, update_data)
    raw_ref = resolved.get("referrer_id", user.referrer_id) if "referrer_id" in resolved else user.referrer_id
    raw_fam = resolved.get("family_id", user.family_id) if "family_id" in resolved else user.family_id
    new_referrer_id = None if raw_ref is _CLEAR else raw_ref
    new_family_id = None if raw_fam is _CLEAR else raw_fam

    # Validate role-FK consistency whenever role or FK fields touch.
    # Use the effective role (updated or current) against the effective FK values.
    effective_role = body.role if body.role is not None else user.role
    if body.role is not None or "referrer_id" in update_data or "family_id" in update_data:
        errors = validate_user_role_consistency(effective_role, new_referrer_id, new_family_id)
        if errors:
            raise HTTPException(status_code=422, detail=errors)

    # FK targets must exist and not be soft-deleted
    if new_referrer_id is not None:
        ref = get_or_404(db, Referrer, new_referrer_id, "Referrer not found")
        if ref.deleted_at is not None:
            raise HTTPException(status_code=422, detail="Referrer is soft-deleted")
    if new_family_id is not None:
        fam = get_or_404(db, Family, new_family_id, "Family not found")
        if fam.deleted_at is not None:
            raise HTTPException(status_code=422, detail="Family is soft-deleted")

    partial_update(user, body)
    db.commit()
    db.refresh(user)
    logger.info("Admin %s updated user (id=%s)", _admin.email, user_id)
    return UserDetail(**build_user_detail(user, db))


@user_admin_router.post("/{user_id}/restore", status_code=200)
def restore_user(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> UserDetail:
    user = get_or_404(db, User, user_id, "User not found")
    if user.deleted_at is None:
        raise HTTPException(status_code=400, detail="User is not deleted")
    user.deleted_at = None
    db.commit()
    db.refresh(user)
    logger.info("Admin %s restored user '%s' (id=%s)", _admin.email, user.email, user_id)
    return UserDetail(**build_user_detail(user, db))


@user_admin_router.post("/{user_id}/reset-password", status_code=200)
def reset_user_password(
    user_id: int,
    body: UserPasswordReset,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> UserDetail:
    user = get_or_404(db, User, user_id, "User not found")
    user.hashed_password = get_password_hash(body.password)
    db.commit()
    db.refresh(user)
    logger.info("Admin %s reset password for user '%s' (id=%s)", _admin.email, user.email, user_id)
    return UserDetail(**build_user_detail(user, db))


@user_admin_router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> Response:
    user = get_active_or_404(db, User, user_id, "User not found")
    user.deleted_at = datetime.now(timezone.utc)
    db.commit()
    logger.info("Admin %s soft-deleted user '%s' (id=%s)", _admin.email, user.email, user_id)
    return Response(status_code=204)
