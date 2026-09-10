"""Public deadline endpoints (read-only).

This router is resource-oriented (``/api/deadlines``) and does **not**
require authentication — deadline rows feed the display banners for all
roles, including anonymous visitors.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.response_builders import build_deadline_list
from app.schemas import DeadlineListResponse

router = APIRouter(prefix="/api/deadlines", tags=["deadlines"])


@router.get("")
def list_public_deadlines(
    db: Session = Depends(get_db),
) -> DeadlineListResponse:
    """List all deadline rows (type, then due_date ASC with NULLs last, then id).

    No authentication required.
    """
    return build_deadline_list(db)
