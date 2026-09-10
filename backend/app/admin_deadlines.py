"""Admin CRUD routes for event deadlines.

All endpoints are guarded with ``require_admin``.

Deliberate deviations from the admin list-endpoint convention:

* No pagination or ``columns`` — deadlines are a handful-of-rows settings
  list.
* DELETE is a **hard delete**: deadlines are trivially re-creatable config
  rows that nothing references, so the soft-delete convention (domain
  entities) doesn't apply.
"""

import logging

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Deadline, User
from app.permissions import require_admin
from app.response_builders import build_deadline_item, build_deadline_list, get_or_404, partial_update
from app.schemas import DeadlineCreate, DeadlineItem, DeadlineListResponse, DeadlineUpdate

logger = logging.getLogger(__name__)

deadline_admin_router = APIRouter(
    prefix="/api/admin/deadlines",
    tags=["admin-deadlines"],
)


@deadline_admin_router.get("")
def list_deadlines(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> DeadlineListResponse:
    """List all deadline rows (type, then due_date ASC with NULLs last, then id)."""
    return build_deadline_list(db)


@deadline_admin_router.post("", status_code=201)
def create_deadline(
    body: DeadlineCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> DeadlineItem:
    """Create a deadline row.

    ``type`` is a closed enum (the three deadline types) — admins create
    rows, not types. Undated rows are allowed (create now, date later);
    they are inert until a date is set.
    """
    deadline = Deadline(
        type=body.type,
        label=body.label,
        due_date=body.due_date,
        mode=body.mode,
    )
    db.add(deadline)
    db.commit()
    db.refresh(deadline)
    logger.info(
        "Admin %s created deadline (id=%s, type=%s, mode=%s, due=%s)",
        _admin.email,
        deadline.id,
        body.type.value,
        body.mode.value,
        body.due_date,
    )
    return build_deadline_item(deadline)


@deadline_admin_router.patch("/{deadline_id}")
def update_deadline(
    deadline_id: int,
    body: DeadlineUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> DeadlineItem:
    """Partially update a deadline row.

    Omitted/null fields are no-ops; ``""`` clears ``due_date`` to NULL
    (the ``_CLEAR`` sentinel convention).
    """
    deadline = get_or_404(db, Deadline, deadline_id, "Deadline not found")
    partial_update(deadline, body)
    db.commit()
    db.refresh(deadline)
    logger.info("Admin %s updated deadline (id=%s)", _admin.email, deadline_id)
    return build_deadline_item(deadline)


@deadline_admin_router.delete("/{deadline_id}", status_code=204)
def delete_deadline(
    deadline_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> Response:
    """Hard-delete a deadline row (config rows are trivially re-creatable)."""
    deadline = get_or_404(db, Deadline, deadline_id, "Deadline not found")
    db.delete(deadline)
    db.commit()
    logger.info("Admin %s deleted deadline (id=%s)", _admin.email, deadline_id)
    return Response(status_code=204)
