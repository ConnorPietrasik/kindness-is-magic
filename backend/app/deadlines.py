"""Deadline enforcement — armed checks, batch actions, and the daily task.

An enforced deadline takes effect at 01:00 Pacific (fixed UTC-8, no DST) on
the day after its announced due date — an hour of deliberate slack past
midnight for last-minute people. In code the cutoff is ``due_date + 1 day``
at 09:00 UTC; a row is armed when ``utcnow() >= cutoff``.

The batch actions are idempotent: a family leaves the match set once acted
on, so no "already applied" bookkeeping is needed (and a second enforced
row of the same type is a harmless no-op).

Enforcement is a one-way ratchet — changing a date or mode after the action
has run does not reverse escalated families; an admin reverses an individual
family with the existing reset-wish-state endpoint.
"""

import asyncio
import logging
from collections.abc import Callable
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy.orm import Session

from app.config import DEADLINE_ENFORCEMENT_HOUR_PACIFIC, DEADLINE_PACIFIC_UTC_OFFSET_HOURS
from app.database import get_db
from app.models import Deadline, DeadlineMode, DeadlineType, Family, WishLockLevel

logger = logging.getLogger(__name__)

# Cutoff hour in UTC: 01:00 at fixed UTC-8 == 09:00 UTC.
ENFORCEMENT_UTC_HOUR = (DEADLINE_ENFORCEMENT_HOUR_PACIFIC - DEADLINE_PACIFIC_UTC_OFFSET_HOURS) % 24

# Message shown to claim-capable users (including admins) when an armed
# gift_dropoff deadline blocks a new gift claim. The gate is a business rule
# (gifts can't arrive in time), not a permission — so it blocks every
# claim-capable role and cash claims are unaffected.
GIFT_CLAIM_BLOCKED_DETAIL = "The gift drop-off deadline has passed — new gift sponsorships are no longer accepted."


def deadline_cutoff(due_date: date) -> datetime:
    """Enforcement cutoff for a due date: 01:00 Pacific (fixed UTC-8) on due_date + 1 day.

    The announced deadline day (due_date) stays in effect through all of
    that day; enforcement starts at 09:00 UTC the following day.
    """
    next_day = due_date + timedelta(days=1)
    return datetime.combine(next_day, time(ENFORCEMENT_UTC_HOUR, 0), tzinfo=timezone.utc)


def is_type_armed(db: Session, dl_type: DeadlineType, now: datetime | None = None) -> bool:
    """True if any enforced, dated row of this type is at or past its cutoff.

    ``display``/``remind`` rows and undated rows never arm a type. A type
    with multiple enforced rows arms when the *first* cutoff passes.
    """
    now = now or datetime.now(timezone.utc)
    due_dates = (
        db.query(Deadline.due_date)
        .filter(Deadline.type == dl_type, Deadline.mode == DeadlineMode.enforced, Deadline.due_date.isnot(None))
        .all()
    )
    return any(now >= deadline_cutoff(due) for (due,) in due_dates)


# ---------------------------------------------------------------------------
# Batch actions (each idempotent — a family leaves the match set once acted on)
# ---------------------------------------------------------------------------


def auto_submit_families(db: Session) -> int:
    """Auto-submit (``family_info`` enforced action).

    Families at ``lock=family`` with no pending review request get
    ``requested_at = now`` (they enter the referrer queue).

    Settled semantics — do not "improve" them:
    * **Includes** families with an open rejection reason and **does not
      clear** the reason: a forced escalation must not claim "fixed" the
      way a voluntary request-review does. The reason rides along to the
      queues so admins see what the referrer flagged.
    * Never touches ``lock=referrer`` / ``lock=admin`` families or soft-
      deleted families.
    """
    now = datetime.now(timezone.utc)
    families = (
        db.query(Family)
        .filter(
            Family.wish_lock_level == WishLockLevel.family,
            Family.wish_review_requested_at.is_(None),
            Family.deleted_at.is_(None),
        )
        .all()
    )
    for fam in families:
        fam.wish_review_requested_at = now
    return len(families)


def auto_promote_families(db: Session) -> int:
    """Auto-promote (``referrer_review`` enforced action).

    Families at ``lock=family`` with a pending review request get
    ``lock = referrer`` (they enter the admin queue).

    Settled semantics — do not "improve" them:
    * Does **not** clear the rejection reason and does **not** bump
      ``requested_at`` — the admin queue keeps FIFO (longest-waiting first
      on deadline day).
    * Never touches ``lock=referrer`` / ``lock=admin`` families (admin-
      rejected families remain in the referrer's hands) or soft-deleted
      families.
    """
    families = (
        db.query(Family)
        .filter(
            Family.wish_lock_level == WishLockLevel.family,
            Family.wish_review_requested_at.isnot(None),
            Family.deleted_at.is_(None),
        )
        .all()
    )
    for fam in families:
        fam.wish_lock_level = WishLockLevel.referrer
    return len(families)


# Types that have a batch action. ``gift_dropoff`` is deliberately absent —
# its enforced action is the request-time claim gate, not a batch.
_BATCH_ACTIONS: dict[DeadlineType, Callable[[Session], int]] = {
    DeadlineType.family_info: auto_submit_families,
    DeadlineType.referrer_review: auto_promote_families,
}


def run_deadline_checks(db: Session) -> dict[DeadlineType, int]:
    """Run the batch action for every armed type that has one.

    Plain sync entry point (called by the daily background task and by
    tests). Commits if any batch acted on families. Returns
    ``{type: families_acted_on}`` for the armed types.
    """
    applied: dict[DeadlineType, int] = {}
    for dl_type, batch in _BATCH_ACTIONS.items():
        if is_type_armed(db, dl_type):
            applied[dl_type] = batch(db)
    if any(applied.values()):
        db.commit()
        logger.info("Deadline checks escalated %s", {t.value: n for t, n in applied.items()})
    return applied


# ---------------------------------------------------------------------------
# Daily background task
# ---------------------------------------------------------------------------


def _seconds_until_next_run(now: datetime | None = None) -> float:
    """Seconds from *now* until the next daily run at 09:00 UTC (01:00 Pacific)."""
    now = now or datetime.now(timezone.utc)
    next_run = datetime.combine(now.date(), time(ENFORCEMENT_UTC_HOUR, 0), tzinfo=timezone.utc)
    if next_run <= now:
        next_run += timedelta(days=1)
    return (next_run - now).total_seconds()


async def deadline_checks_loop() -> None:
    """Run the deadline checks immediately, then daily at 09:00 UTC.

    The immediate first run catches any cutoffs missed while the app was
    down; each daily run fires exactly at the enforcement cutoff hour.
    DB errors are logged and swallowed (the next run retries) — mirroring
    the bootstrap-admin seed. Cancelled on shutdown by the caller.

    No sub-daily polling: a row created with an already-past date
    (backdated) arms at the next 01:00 run, which is acceptable since
    backdating isn't a practical use case.
    """
    while True:
        try:
            db = next(get_db())
            try:
                run_deadline_checks(db)
            finally:
                db.close()
        except Exception as exc:  # noqa: BLE001
            logger.error("Deadline checks failed (will retry at the next run): %s", exc, exc_info=True)
        await asyncio.sleep(_seconds_until_next_run())
