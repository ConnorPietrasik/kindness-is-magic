"""Admin routes for the thank-you-emails section.

All endpoints are guarded with ``require_admin``.

* ``GET /`` — the donors owed a thank-you: sponsors with at least one
  fulfilled sponsorship plus general-donation buyers, merged per lowercased
  email. Both populations are derived live (no snapshot table):

  * claim side — a donor account holding an active (non-deleted) claim
    with ``fulfilled_at`` set; the donor lookup deliberately includes
    soft-deleted accounts (the claim is the candidate — its email is
    still owed a thank-you);
  * general side — mirrored Zeffy payments stored on no live claim, with a
    buyer email and not fully refunded. The mirror spans the org's Zeffy
    campaigns: the general-donation campaign's rows arrive through their
    own form, and the dedicated campaign's unmatched rows may be wrong-form
    general donations (a donor who paid on the sponsorship form without a
    cart to match) — both are candidates. A matched payment is never a
    candidate: it is a sponsorship, not a general donation. The mirror's
    "seen" state is NOT filtered — it is the reconciliation page's
    "no action needed" acknowledgment, not a candidate signal.

  Standard page envelope, ``columns`` supported. Local read — works
  unconfigured.
* ``POST /thanked`` / ``POST /unthanked`` — the per-donor thanked state
  (the ``DonorThank`` row): the manual mark for out-of-band thanking, and
  the page's auto-mark after a thank-you email is sent. Idempotent
  (re-marking refreshes the timestamp and actor). The email rides in the
  body, not the path — the request middleware logs every path (PII
  minimization: no donor emails in logs), mirroring the resubscribe
  endpoint's body-carrying precedent.
"""

import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.column_filter import ColumnRequest, column_filtered_page
from app.database import get_db
from app.models import DonorThank, Family, FamilyClaim, User, ZeffyPaymentRecord
from app.permissions import require_admin
from app.response_builders import build_thank_you_donor
from app.schemas import (
    ThankYouDonor,
    ThankYouDonorsResponse,
    ThankYouMarkRequest,
    ThankYouThankedResponse,
)
from app.search_sort import parse_sort_field

logger = logging.getLogger(__name__)

thank_you_admin_router = APIRouter(
    prefix="/api/admin/thank-you",
    tags=["admin-thank-you"],
)

# Sortable fields for the Python-sorted donor list (the rows are derived
# aggregates, so the sort runs in Python via parse_sort_field rather than a
# SQLAlchemy column registry). "thanked_at" reads the donor's DonorThank row.
THANK_YOU_SORT_FIELDS: frozenset[str] = frozenset(
    {"email", "display_name", "claim_count", "general_total_cents", "latest_fulfilled_at", "latest_donation_at", "thanked_at"}
)

# Sentinel so None datetimes sort to one end with a comparable key.
_EPOCH_MIN = datetime.min.replace(tzinfo=timezone.utc)


def _fulfilled_claim_rows(db: Session):
    """One row per fulfilled active claim: donor (email, display name),
    family name, fulfillment time — oldest first.

    Deliberate exceptions to the soft-delete rule: the donor account and
    the family are read even when soft-deleted — the claim is the
    candidate, its donor email is still owed a thank-you, and the names
    are display data only.
    """
    return (
        db.query(
            User.email,
            User.display_name,
            Family.family_name,
            FamilyClaim.fulfilled_at,
        )
        .join(User, User.id == FamilyClaim.donor_user_id)
        .join(Family, Family.id == FamilyClaim.family_id)
        .filter(FamilyClaim.deleted_at.is_(None), FamilyClaim.fulfilled_at.isnot(None))
        .order_by(FamilyClaim.fulfilled_at, FamilyClaim.id)
        .all()
    )


def _general_donation_rows(db: Session):
    """One row per candidate general-donation payment: lowercased buyer
    email, buyer name, amount, Zeffy time — oldest first.

    Candidate = a buyer email is present, the payment id is stored on no
    live claim (same match semantics as the Zeffy reconciliation — a
    soft-deleted claim does not count), and the payment is not fully
    refunded (a partial refund is still a donation). The mirror's
    ``buyer_email`` is stored as received, so the grouping key is
    lowercased here.
    """
    live_payment_ids = db.query(FamilyClaim.zeffy_payment_id).filter(
        FamilyClaim.deleted_at.is_(None),
        FamilyClaim.zeffy_payment_id.isnot(None),
    )
    return (
        db.query(
            func.lower(ZeffyPaymentRecord.buyer_email),
            ZeffyPaymentRecord.buyer_name,
            ZeffyPaymentRecord.amount_cents,
            ZeffyPaymentRecord.created_at,
        )
        .filter(
            ZeffyPaymentRecord.buyer_email.isnot(None),
            ZeffyPaymentRecord.refund_status != "full",
            ZeffyPaymentRecord.payment_id.notin_(live_payment_ids),
        )
        .order_by(ZeffyPaymentRecord.created_at, ZeffyPaymentRecord.id)
        .all()
    )


def _collect_candidates(db: Session) -> dict[str, dict]:
    """Merge the two candidate populations into one dict keyed by
    lowercased donor email.

    The claim side runs first so the account's display name takes
    precedence over the buyer name (falling back to the *newest* buyer
    name — rows are oldest-first, so last write wins).
    """
    candidates: dict[str, dict] = {}

    def slot(email: str) -> dict:
        return candidates.setdefault(
            email,
            {
                "email": email,
                "display_name": None,
                "buyer_name": None,
                "claim_count": 0,
                "claim_family_names": [],
                "latest_fulfilled_at": None,
                "general_payment_count": 0,
                "general_total_cents": 0,
                "latest_donation_at": None,
            },
        )

    for email, display_name, family_name, fulfilled_at in _fulfilled_claim_rows(db):
        s = slot(email)
        s["claim_count"] += 1
        s["claim_family_names"].append(family_name)
        s["latest_fulfilled_at"] = fulfilled_at
        if display_name:
            s["display_name"] = display_name

    for email, buyer_name, amount_cents, created_at in _general_donation_rows(db):
        s = slot(email)
        s["general_payment_count"] += 1
        s["general_total_cents"] += amount_cents
        s["latest_donation_at"] = created_at
        if buyer_name:
            s["buyer_name"] = buyer_name

    for s in candidates.values():
        s["display_name"] = s["display_name"] or s["buyer_name"]
    return candidates


def _source_matches(candidate: dict, source: str | None) -> bool:
    """The ``source`` filter: a kind narrows to donors having that side;
    ``both`` requires both sides."""
    if source is None:
        return True
    has_claims = candidate["claim_count"] > 0
    has_general = candidate["general_payment_count"] > 0
    if source == "both":
        return has_claims and has_general
    return has_claims if source == "claims" else has_general


def _thanked_matches(thanks: DonorThank | None, thanked: bool | None) -> bool:
    if thanked is None:
        return True
    return (thanks is not None) is thanked


def _search_matches(candidate: dict, pattern: str) -> bool:
    """Global search: the email, the display name, or a sponsored family
    name (plain substring on already-lowercased input)."""
    if pattern in candidate["email"]:
        return True
    if (candidate["display_name"] or "").lower().find(pattern) != -1:
        return True
    return any(pattern in family_name.lower() for family_name in candidate["claim_family_names"])


def _sort_key(candidate: dict, thanks: DonorThank | None, field: str):
    if field == "display_name":
        return (candidate["display_name"] or "").lower()
    if field == "thanked_at":
        return thanks.thanked_at if thanks is not None else _EPOCH_MIN
    value = candidate[field]
    if value is None:
        return _EPOCH_MIN
    return value


def _is_current_candidate(db: Session, email: str) -> bool:
    """Whether a lowercased *email* is a current candidate — the list's own
    two candidate definitions (an active fulfilled claim on an account with
    this email, or a candidate general-donation payment under it), checked
    with targeted queries instead of re-running the list page's full row
    scans. The filters intentionally mirror :func:`_fulfilled_claim_rows`
    and :func:`_general_donation_rows` so the mark endpoints can't drift
    from what the list shows."""
    has_claim = (
        db.query(FamilyClaim.id)
        .join(User, User.id == FamilyClaim.donor_user_id)
        .filter(
            FamilyClaim.deleted_at.is_(None),
            FamilyClaim.fulfilled_at.isnot(None),
            func.lower(User.email) == email,
        )
        .first()
        is not None
    )
    if has_claim:
        return True
    live_payment_ids = db.query(FamilyClaim.zeffy_payment_id).filter(
        FamilyClaim.deleted_at.is_(None),
        FamilyClaim.zeffy_payment_id.isnot(None),
    )
    return (
        db.query(ZeffyPaymentRecord.id)
        .filter(
            func.lower(ZeffyPaymentRecord.buyer_email) == email,
            ZeffyPaymentRecord.refund_status != "full",
            ZeffyPaymentRecord.payment_id.notin_(live_payment_ids),
        )
        .first()
        is not None
    )


def _require_thank_you_candidate(db: Session, email: str) -> None:
    """404 when the email is not a current candidate — the mark is only
    meaningful for donors the list can show (the page offers the action
    per row)."""
    if not _is_current_candidate(db, email):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No thank-you donor matches this email")


@thank_you_admin_router.get("", response_model=ThankYouDonorsResponse, response_model_exclude_unset=True)
def list_thank_you_donors(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    columns: str | None = Query(None),
    search: str | None = Query(None),
    source: Literal["claims", "general", "both"] | None = Query(None),
    thanked: bool | None = Query(None),
    sort: str | None = Query(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict:
    """The donors owed a thank-you (see module docstring), one row per
    lowercased email.

    ``search`` matches the email, the display name, or a sponsored family
    name; ``source`` narrows to a candidate kind; ``thanked`` filters by
    the thanked state. The derived rows sort in Python via
    ``parse_sort_field`` over ``THANK_YOU_SORT_FIELDS`` (``-`` prefix for
    descending); the default is email ascending. Standard page envelope;
    ``columns`` supported.
    """
    candidates = _collect_candidates(db)

    # Thanked state for the whole population (small table — one read). The
    # actor lookup follows the column request, as in the sent-email log: a
    # soft-deleted actor shows thanked_by_name=None.
    thanks_by_email = {t.email: t for t in db.query(DonorThank).all()}
    cols = ColumnRequest.parse(columns)
    actor_ids: set[int] = set()
    if cols.needs("thanked_by_name"):
        actor_ids = {t.thanked_by for t in thanks_by_email.values() if t.thanked_by is not None}
    actor_names: dict[int, str] = {}
    if actor_ids:
        users = db.query(User).filter(User.id.in_(actor_ids), User.deleted_at.is_(None)).all()
        actor_names = {u.id: u.display_name for u in users}

    rows = [
        (candidate, thanks)
        for candidate, thanks in ((c, thanks_by_email.get(c["email"])) for c in candidates.values())
        if _source_matches(candidate, source) and _thanked_matches(thanks, thanked)
    ]
    if search:
        pattern = search.strip().lower()
        if pattern:
            rows = [(c, t) for c, t in rows if _search_matches(c, pattern)]

    field, descending = parse_sort_field(sort, THANK_YOU_SORT_FIELDS, "email")
    rows.sort(key=lambda ct: _sort_key(ct[0], ct[1], field), reverse=descending)

    total = len(rows)
    start = (page - 1) * page_size
    page_rows = rows[start : start + page_size]

    items = [
        build_thank_you_donor(
            candidate,
            thanks,
            actor_names.get(thanks.thanked_by) if thanks is not None and thanks.thanked_by is not None else None,
        )
        for candidate, thanks in page_rows
    ]

    # Always include the fields the client needs regardless of the column
    # selection (the zeffy page's precedent): email drives the row's actions,
    # source the filter chips, a missing thanked_at reads as "unthanked" —
    # and the draft dialog (context block + subject/paragraphs) is built from
    # the row's claim/general side, so hiding a table column must not hollow
    # out the draft.
    return column_filtered_page(
        items,
        columns,
        model=ThankYouDonor,
        key="donors",
        total=total,
        page=page,
        page_size=page_size,
        always_include={
            "email",
            "source",
            "thanked_at",
            "display_name",
            "claim_count",
            "claim_family_names",
            "general_payment_count",
            "general_total_cents",
            "latest_donation_at",
        },
    )


@thank_you_admin_router.post("/thanked", response_model=ThankYouThankedResponse)
def mark_donor_thanked(
    body: ThankYouMarkRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ThankYouThankedResponse:
    """Mark a donor thanked — the manual mark for out-of-band thanking
    (the page also calls this after a thank-you email sends). Idempotent:
    re-marking refreshes the timestamp and the actor. 404 when the email
    is not a current candidate."""
    donor_email = body.email.strip().lower()
    _require_thank_you_candidate(db, donor_email)

    thanks = db.get(DonorThank, donor_email)
    now = datetime.now(timezone.utc)
    if thanks is None:
        thanks = DonorThank(email=donor_email, thanked_at=now, thanked_by=admin.id)
        db.add(thanks)
    else:
        thanks.thanked_at = now
        thanks.thanked_by = admin.id
    db.commit()
    db.refresh(thanks)

    logger.info("Donor marked thanked by admin %s", admin.id)
    return ThankYouThankedResponse(email=thanks.email, thanked_at=thanks.thanked_at)


@thank_you_admin_router.post("/unthanked", response_model=ThankYouThankedResponse)
def unmark_donor_thanked(
    body: ThankYouMarkRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> ThankYouThankedResponse:
    """Clear the thanked mark (a correction). 404 when no row exists —
    the resubscribe endpoint's posture for a missing record."""
    donor_email = body.email.strip().lower()
    thanks = db.get(DonorThank, donor_email)
    if thanks is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This donor is not marked as thanked")

    db.delete(thanks)
    db.commit()
    logger.info("Donor unmarked thanked by admin %s", admin.id)
    return ThankYouThankedResponse(email=donor_email, thanked_at=None)
