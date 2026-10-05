"""Admin routes for the sent-email log.

All endpoints are guarded with ``require_admin``.
"""

import logging

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.column_filter import ColumnRequest, column_filtered_page
from app.database import get_db
from app.mail import render_custom_message_html, send_email
from app.models import EmailKind, EmailStatus, SentEmail, User
from app.permissions import require_admin
from app.rate_limit import limiter
from app.schemas import AdminSendEmailRequest, AdminSendEmailResult, EmailListResponse, SentEmailSummary
from app.search_sort import EMAIL_SORT_FIELDS, build_sort_clause, escape_like

logger = logging.getLogger(__name__)

email_admin_router = APIRouter(
    prefix="/api/admin/emails",
    tags=["admin-emails"],
)


@email_admin_router.get("", response_model_exclude_unset=True)
def list_sent_emails(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    columns: str | None = Query(None),
    search: str | None = Query(None),
    kind: EmailKind | None = Query(None),
    status: EmailStatus | None = Query(None),
    sort: str | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> EmailListResponse:
    """List the full sent-email log with optional filters (newest first by default)."""
    query = db.query(SentEmail)

    if search is not None:
        pattern = f"%{escape_like(search)}%"
        query = query.filter(SentEmail.recipient_email.ilike(pattern, escape="\\"))

    if kind is not None:
        query = query.filter(SentEmail.kind == kind)

    if status is not None:
        query = query.filter(SentEmail.status == status)

    total = query.count()

    sort_clause = build_sort_clause(sort, EMAIL_SORT_FIELDS, SentEmail.sent_at.desc())
    emails = query.order_by(sort_clause, SentEmail.id.desc()).offset((page - 1) * page_size).limit(page_size).all()

    # Conditional lookup — skip the users query for columns the client doesn't need.
    # Soft-delete-aware: a deleted actor shows sender_name=None.
    cols = ColumnRequest.parse(columns)

    sender_map: dict[int, str] = {}
    if cols.needs("sender_name"):
        user_ids = {e.user_id for e in emails if e.user_id is not None}
        if user_ids:
            users = db.query(User).filter(User.id.in_(user_ids), User.deleted_at.is_(None)).all()
            sender_map = {u.id: u.display_name for u in users}

    items = [
        SentEmailSummary(
            id=e.id,
            recipient_email=e.recipient_email,
            kind=e.kind,
            status=e.status,
            failure_reason=e.failure_reason,
            sent_at=e.sent_at,
            sender_name=sender_map.get(e.user_id) if e.user_id is not None else None,
        )
        for e in emails
    ]

    return column_filtered_page(items, columns, key="emails", total=total, page=page, page_size=page_size, always_include={"id"})


# Default subject for admin custom emails when the admin leaves it blank.
CUSTOM_EMAIL_DEFAULT_SUBJECT = "A message from Kindness Is Magic ✨"


@email_admin_router.post("/send")
@limiter.limit("5/minute")
async def send_custom_email(
    request: Request,
    body: AdminSendEmailRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> AdminSendEmailResult:
    """Send a freeform email to any recipient.

    Reuses the shared ``send_email`` path as-is: the unsubscribe gate
    applies (unsubscribed recipients are blocked and reported, never
    bypassed), the branded wrap + unsubscribe footer are included, and one
    ``SentEmail`` row (kind ``custom_message``) records the attempt with
    the acting admin as the user. The message body itself is never stored
    — the log row is the only record of the send.
    """
    recipient = body.recipient_email.strip().lower()
    subject = (body.subject or "").strip() or CUSTOM_EMAIL_DEFAULT_SUBJECT
    html_body = render_custom_message_html(body.message)

    result = await send_email(
        to=recipient,
        subject=subject,
        html_body=html_body,
        db=db,
        kind=EmailKind.custom_message,
        user_id=admin.id,
    )
    return AdminSendEmailResult(**result)
