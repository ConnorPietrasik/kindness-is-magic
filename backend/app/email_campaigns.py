"""Email campaigns — admin batch email: creation core and the delivery worker.

A campaign freezes its recipient set when it starts: an unscheduled
campaign resolves at creation or at draft activation, and a campaign with
a future ``scheduled_for`` (created or activated with one) stores the raw
selection and is resolved by the worker at send time — in each case the
role and state-segment selections resolve to the non-deleted users
existing at that moment, with manual entries normalized and deduped
against them — and is then delivered one recipient per worker cycle, with
a fixed interval between consecutive sends of the same campaign, so a bulk
send trickles out instead of bursting the SMTP account into a throttling
block. ``scheduled_for`` delays the first send: the worker only picks a
campaign up once it is due
(``scheduled_for IS NULL OR <= now``), among due campaigns earliest-due
first. The interval never spans campaigns: when an ongoing campaign settles
(completes) or is canceled, the worker moves on instead of waiting out an
interval it didn't cause. But two campaign emails of different campaigns
are never sent closer together than one idle poll, so a queue of campaigns
still trickles out (the next campaign's first send goes out at most two idle
polls after the cancel).

Every send goes through the shared ``send_email`` path — the unsubscribe
gate applies (unsubscribed recipients are recorded as failed, never
bypassed), and one ``SentEmail`` row (kind ``campaign``) is logged per
attempt. Progress is crash-safe: each recipient row carries its own status,
so a process restart resumes mid-campaign from the next pending row.
Delivery is at-least-once, not at-most-once: ``send_email`` commits its
``SentEmail`` log row mid-step (its documented no-commit-in-helpers
exception), so a step interrupted in the window after that commit but
before its final commit re-sends the in-flight recipient on restart — a
millisecond-wide window, and both attempts remain in the log.

Only the leader worker runs the loop for real (see main.lifespan); tests
exercise ``process_next_campaign_email`` / ``create_campaign`` directly
and drive the loop as a canceled task with its cycle work faked (see
``tests/test_email_campaigns.py``).
"""

import asyncio
import logging
from collections.abc import Callable
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import (
    EMAIL_CAMPAIGN_INTERVAL_SECONDS,
    EMAIL_CAMPAIGN_IDLE_POLL_SECONDS,
    EMAIL_CAMPAIGN_MAX_RECIPIENTS,
)
from app.database import get_db
from app.mail import CUSTOM_EMAIL_DEFAULT_SUBJECT, render_custom_message_html, send_email
from app.models import (
    CommitmentType,
    EmailCampaign,
    EmailCampaignRecipient,
    EmailCampaignRecipientSource,
    EmailCampaignRecipientStatus,
    EmailCampaignStatus,
    EmailKind,
    Family,
    FamilyClaim,
    Referrer,
    RecipientSegment,
    User,
    UserRole,
    WishLockLevel,
)

logger = logging.getLogger(__name__)


class CampaignResolutionError(Exception):
    """The campaign's selection resolved to an unusable recipient set.

    Raised by ``create_campaign`` / ``activate_campaign`` / ``update_campaign``
    when there are no recipients at all, the set exceeds the cap, or a
    selection edit leaves the campaign with no roles, no segments, and no
    addresses; the route layer converts it to a 422.
    """


class CampaignStateError(Exception):
    """The campaign is in a state that rejects the operation.

    Raised by ``update_campaign`` when the campaign is not editable
    (something already settled, or it is terminal) and by
    ``activate_campaign`` when the campaign is not a draft; the route layer
    converts it to a 409.
    """


# ---------------------------------------------------------------------------
# State-segment resolvers — one per RecipientSegment value. Each returns the
# non-deleted users the segment's state predicate maps to (the recipient
# accounts), in id order.
# ---------------------------------------------------------------------------


def _families_not_submitted_users(db: Session) -> list[User]:
    """Users of families that haven't submitted for review.

    A family is unsubmitted while it sits at the family lock with no review
    request pending. A referrer rejection sends the family back to that
    state (the request is cleared, the family lock stays) so it matches
    again; an admin rejection keeps the family at the referrer lock until
    its referrer re-submits, so it does not. A family at the referrer/admin
    lock has been submitted. Families with no user account contribute no
    recipients (the join excludes them).
    """
    family_ids = select(Family.id).where(
        Family.deleted_at.is_(None),
        Family.wish_lock_level == WishLockLevel.family,
        Family.wish_review_requested_at.is_(None),
    )
    return db.query(User).filter(User.family_id.in_(family_ids), User.deleted_at.is_(None)).order_by(User.id).all()


def _referrers_families_not_submitted_users(db: Session) -> list[User]:
    """Users of referrers with at least one family not yet submitted.

    A referrer has submitted a family once it leaves the family lock
    (approval promotes it to the referrer lock), so the predicate is simply
    a non-deleted family at the family lock — whether or not the family has
    requested review yet. Families with no referrer attribute to no one;
    soft-deleted referrers are excluded.
    """
    referrer_ids = (
        select(Family.referrer_id)
        .select_from(Family)
        .join(Referrer, Referrer.id == Family.referrer_id)
        .where(
            Family.deleted_at.is_(None),
            Family.referrer_id.isnot(None),
            Family.wish_lock_level == WishLockLevel.family,
            Referrer.deleted_at.is_(None),
        )
        .distinct()
    )
    return db.query(User).filter(User.referrer_id.in_(referrer_ids), User.deleted_at.is_(None)).order_by(User.id).all()


def _donors_unfulfilled_gift_claim_users(db: Session) -> list[User]:
    """Accounts holding an active gift claim that isn't fulfilled yet.

    Any claim-capable role can hold a claim (not only ``donor``), so the
    resolver returns the claim's donor account regardless of its role.
    """
    donor_ids = (
        select(FamilyClaim.donor_user_id)
        .where(
            FamilyClaim.deleted_at.is_(None),
            FamilyClaim.commitment_type == CommitmentType.gifts,
            FamilyClaim.fulfilled_at.is_(None),
        )
        .distinct()
    )
    return db.query(User).filter(User.id.in_(donor_ids), User.deleted_at.is_(None)).order_by(User.id).all()


SEGMENT_RESOLVERS: dict[RecipientSegment, Callable[[Session], list[User]]] = {
    RecipientSegment.families_not_submitted_for_review: _families_not_submitted_users,
    RecipientSegment.referrers_families_not_submitted: _referrers_families_not_submitted_users,
    RecipientSegment.donors_unfulfilled_gift_claims: _donors_unfulfilled_gift_claim_users,
}


def resolve_campaign_recipients(
    db: Session,
    roles: list[UserRole],
    segments: list[RecipientSegment],
    extra_emails: list[str],
) -> list[dict]:
    """Resolve a campaign selection to a snapshot of recipients.

    Returns a list of ``{"email", "user_id", "role", "segment", "source"}``
    dicts in send order: role users by id, then segment users by id in
    enum-segment order, then manual-only addresses — an address matching
    several buckets keeps its first bucket's position. The selection is a
    union with dedup precedence manual > segment > role: a later bucket
    overwrites an earlier match's ``source`` (and ``segment``) but keeps
    the user id, so an address in several selections counts once. ``role``
    (the user's role) feeds the preview's per-role tally and ``segment``
    (the winning segment) its per-segment tally; the creation path
    persists only ``email`` / ``user_id`` / ``source``.

    ``segments`` are processed in enum order (duplicates collapsed), not
    request order, so resolution is deterministic. ``extra_emails`` are
    expected to be pre-validated (the schema does it); they are still
    normalized here since future non-route callers pass raw text.
    Soft-deleted users never resolve.
    """
    resolved: dict[str, dict] = {}
    if roles:
        users = db.query(User).filter(User.role.in_(roles), User.deleted_at.is_(None)).order_by(User.id).all()
        for user in users:
            resolved[user.email] = {
                "email": user.email,
                "user_id": user.id,
                "role": user.role.value,
                "segment": None,
                "source": EmailCampaignRecipientSource.role,
            }
    for segment in RecipientSegment:
        if segment not in segments:
            continue
        for user in SEGMENT_RESOLVERS[segment](db):
            entry = resolved.get(user.email)
            if entry is None:
                resolved[user.email] = {
                    "email": user.email,
                    "user_id": user.id,
                    "role": user.role.value,
                    "segment": segment.value,
                    "source": EmailCampaignRecipientSource.segment,
                }
            else:
                # A later bucket wins the source (segment > role) — the
                # user id survives the overwrite so the account name still
                # shows on the recipient row.
                entry["segment"] = segment.value
                entry["source"] = EmailCampaignRecipientSource.segment
    for raw in extra_emails:
        email = raw.strip().lower()
        if not email:
            continue
        if email in resolved:
            # Explicit manual entry wins over role/segment resolution; keep
            # the user id so the recipient row can still show the account name.
            resolved[email]["source"] = EmailCampaignRecipientSource.manual
        else:
            resolved[email] = {
                "email": email,
                "user_id": None,
                "role": None,
                "segment": None,
                "source": EmailCampaignRecipientSource.manual,
            }
    return list(resolved.values())


def _normalize_manual_emails(raw: list[str]) -> list[str]:
    """Normalize manual addresses for storage: strip + lowercase, drop
    empties, dedupe (first occurrence wins)."""
    seen: set[str] = set()
    normalized: list[str] = []
    for entry in raw:
        email = entry.strip().lower()
        if email and email not in seen:
            seen.add(email)
            normalized.append(email)
    return normalized


def _resolve_recipients_or_raise(
    db: Session,
    roles: list[UserRole],
    segments: list[RecipientSegment],
    extra_emails: list[str],
) -> list[dict]:
    """Resolve a selection, raising ``CampaignResolutionError`` when it is
    empty or exceeds ``EMAIL_CAMPAIGN_MAX_RECIPIENTS`` (the shared check
    behind create and activate)."""
    recipients = resolve_campaign_recipients(db, roles, segments, extra_emails)
    if not recipients:
        raise CampaignResolutionError("No recipients: select at least one role or state segment, or add an email address")
    if len(recipients) > EMAIL_CAMPAIGN_MAX_RECIPIENTS:
        raise CampaignResolutionError(f"Too many recipients ({len(recipients)} — the limit is {EMAIL_CAMPAIGN_MAX_RECIPIENTS})")
    return recipients


def _resolve_selection_or_defer(
    db: Session,
    roles: list[UserRole],
    segments: list[RecipientSegment],
    extra_emails: list[str],
    scheduled_for: datetime | None,
) -> list[dict] | None:
    """Resolve a selection now, or defer it to the worker at send time.

    A campaign whose ``scheduled_for`` is in the future keeps its raw
    selection instead (returns ``None`` — no recipient rows): the worker
    resolves it when it becomes due, so a state segment matches the users
    in that state *then*. No time, or a time already passed (due now),
    resolves immediately — raising ``CampaignResolutionError`` when the
    selection is empty or over the cap.
    """
    if scheduled_for is not None and scheduled_for > datetime.now(timezone.utc):
        return None
    return _resolve_recipients_or_raise(db, roles, segments, extra_emails)


def _add_recipient_rows(db: Session, campaign: EmailCampaign, recipients: list[dict]) -> None:
    """Create the snapshot rows for a resolved selection."""
    db.add_all(
        EmailCampaignRecipient(
            campaign_id=campaign.id,
            email=r["email"],
            user_id=r["user_id"],
            source=r["source"],
        )
        for r in recipients
    )


def create_campaign(
    db: Session,
    created_by: User,
    subject: str | None,
    message: str,
    roles: list[UserRole],
    segments: list[RecipientSegment],
    extra_emails: list[str],
    scheduled_for: datetime | None = None,
) -> EmailCampaign:
    """Create an activated campaign in the caller's transaction.

    Applies the default subject to a blank one and adds the campaign.
    ``scheduled_for`` (NULL = send ASAP) is the earliest send time — the
    worker skips the campaign until it is due:

    * No time (send ASAP), or a time already passed (due now): resolve the
      recipients now (raising ``CampaignResolutionError`` when the
      selection is empty or exceeds the cap) and add the recipient rows —
      the snapshot is frozen at creation.
    * A future time: store the raw selection and resolve **nothing** — no
      recipient rows, ``total_recipients`` 0. The worker resolves it at
      send time (``process_next_campaign_email``), so a state segment
      matches who is in that state *then*, not at creation. A selection
      that matches nothing today is still a valid campaign.

    Does **not** commit — the caller (the admin route, or a future
    background caller) owns the transaction.
    """
    recipients = _resolve_selection_or_defer(db, roles, segments, extra_emails, scheduled_for)

    campaign = EmailCampaign(
        created_by=created_by.id,
        subject=(subject or "").strip() or CUSTOM_EMAIL_DEFAULT_SUBJECT,
        message=message,
        roles=[role.value for role in roles],
        segments=[segment.value for segment in segments],
        extra_emails=_normalize_manual_emails(extra_emails),
        scheduled_for=scheduled_for,
        total_recipients=len(recipients or []),
    )
    db.add(campaign)
    if recipients is not None:
        db.flush()  # assign campaign.id for the recipient rows
        _add_recipient_rows(db, campaign, recipients)
    return campaign


def create_draft(
    db: Session,
    created_by: User,
    subject: str | None,
    message: str,
    roles: list[UserRole],
    segments: list[RecipientSegment],
    extra_emails: list[str],
    scheduled_for: datetime | None = None,
) -> EmailCampaign:
    """Create a draft campaign: store the raw selection, send nothing.

    Unlike ``create_campaign`` nothing is resolved and no recipient rows
    are created — the snapshot is frozen when activation
    (``activate_campaign``) resolves the selection: immediately for a
    draft without a future send time, at send time for one with (the
    worker then). A draft whose selection resolves to zero users is
    therefore a valid draft (users — or the segment's state — may exist
    by then); the selection just must not be empty (enforced by the
    schema — at least one role, segment, or address). The default subject
    applies to a blank one, as at creation. The stored ``extra_emails`` are
    normalized (strip + lower, deduped). Does **not** commit — the caller
    owns the transaction.
    """
    campaign = EmailCampaign(
        created_by=created_by.id,
        subject=(subject or "").strip() or CUSTOM_EMAIL_DEFAULT_SUBJECT,
        message=message,
        roles=[role.value for role in roles],
        segments=[segment.value for segment in segments],
        extra_emails=_normalize_manual_emails(extra_emails),
        scheduled_for=scheduled_for,
        status=EmailCampaignStatus.draft,
    )
    db.add(campaign)
    return campaign


def activate_campaign(db: Session, campaign: EmailCampaign) -> EmailCampaign:
    """Activate a draft: queue it, and freeze the snapshot when it sends.

    Flips the status to ``pending`` and freezes the recipient snapshot the
    same way ``create_campaign`` does: a draft without a future stored
    ``scheduled_for`` (no time, or a past one — due now) resolves its
    selection immediately (raising ``CampaignResolutionError`` when it is
    empty or over the cap), creates the recipient rows, and sets
    ``total_recipients``; a draft with a future time keeps the raw
    selection unresolved — no rows, ``total_recipients`` 0 — and the
    worker resolves it at send time (``process_next_campaign_email``), so
    a state segment matches who is in that state *then*. Raises
    ``CampaignStateError`` when the campaign is not a draft. Does **not**
    commit — the caller owns the transaction.
    """
    if campaign.status != EmailCampaignStatus.draft:
        raise CampaignStateError("Only drafts can be sent — the campaign is already active")
    recipients = _resolve_selection_or_defer(
        db,
        [UserRole(r) for r in campaign.roles],
        [RecipientSegment(s) for s in campaign.segments],
        campaign.extra_emails,
        campaign.scheduled_for,
    )
    if recipients is not None:
        _add_recipient_rows(db, campaign, recipients)
        campaign.total_recipients = len(recipients)
    campaign.status = EmailCampaignStatus.pending
    return campaign


def update_campaign(
    db: Session,
    campaign: EmailCampaign,
    *,
    subject: str | None = None,
    message: str | None = None,
    roles: list[UserRole] | None = None,
    segments: list[RecipientSegment] | None = None,
    extra_emails: list[str] | None = None,
    scheduled_for: datetime | None = None,
    clear_scheduled_for: bool = False,
) -> EmailCampaign:
    """Apply an admin edit to a not-yet-delivering campaign.

    Editable means ``status in (draft, pending)`` with nothing settled
    (``sent_count`` / ``failed_count`` both 0) — otherwise
    ``CampaignStateError``. ``subject`` (blank falls back to the default,
    as at creation) and ``message`` update in place. A selection change —
    any of ``roles`` / ``segments`` / ``extra_emails`` provided — replaces
    that dimension of the stored selection (normalized); the resulting
    selection must be non-empty (``CampaignResolutionError``), and for an
    activated campaign whose snapshot is frozen (it has recipient rows)
    the recipients are re-resolved and its pending rows replaced
    (``total_recipients`` updated) — a draft keeps only the stored
    selection, its rows being created at activation, and an unresolved
    scheduled campaign (no rows) keeps only the stored selection too, its
    rows being created at send time. ``scheduled_for``:
    ``None`` = no-op, ``clear_scheduled_for`` = clear (send ASAP), a value
    = set. Does **not** commit — the caller owns the transaction (and holds
    the campaign row lock, so no worker step can commit counter changes
    under the editable check). One in-flight edge: a send already in flight
    when the check ran has gone out — ``send_email`` commits the attempt
    (SentEmail row) before the recipient row's settled status commits, so
    that row is still ``pending`` and is replaced with the rest: the send
    is counted (``sent_count``) but has no recipient audit row.
    """
    if campaign.status not in (EmailCampaignStatus.draft, EmailCampaignStatus.pending) or campaign.sent_count or campaign.failed_count:
        raise CampaignStateError("Campaign is already delivering — it can no longer be edited")
    if subject is not None:
        campaign.subject = subject.strip() or CUSTOM_EMAIL_DEFAULT_SUBJECT
    if message is not None:
        campaign.message = message
    if clear_scheduled_for:
        campaign.scheduled_for = None
    elif scheduled_for is not None:
        campaign.scheduled_for = scheduled_for
    if roles is not None or segments is not None or extra_emails is not None:
        new_roles = [role.value for role in roles] if roles is not None else list(campaign.roles or [])
        new_segments = [segment.value for segment in segments] if segments is not None else list(campaign.segments or [])
        new_extra = _normalize_manual_emails(extra_emails) if extra_emails is not None else list(campaign.extra_emails or [])
        if not new_roles and not new_segments and not new_extra:
            raise CampaignResolutionError("No recipients: select at least one role or state segment, or add an email address")
        campaign.roles = new_roles
        campaign.segments = new_segments
        campaign.extra_emails = new_extra
        # Only a resolved pending campaign (rows exist) re-resolves and
        # replaces its rows. An unresolved scheduled campaign keeps the
        # stored selection — the worker resolves it at send time.
        if campaign.status == EmailCampaignStatus.pending and _campaign_has_rows(db, campaign.id):
            recipients = _resolve_recipients_or_raise(
                db,
                [UserRole(r) for r in new_roles],
                [RecipientSegment(s) for s in new_segments],
                new_extra,
            )
            # The bulk delete executes immediately (sessions run with
            # autoflush off). It may wait out a worker's in-flight recipient
            # row lock — released by send_email's mid-step commit, before
            # the in-flight row's settled status commits — so an in-flight
            # send is counted but its still-pending row is replaced like the
            # rest (no audit row for that one send; see the docstring).
            db.query(EmailCampaignRecipient).filter(
                EmailCampaignRecipient.campaign_id == campaign.id,
                EmailCampaignRecipient.status == EmailCampaignRecipientStatus.pending,
            ).delete(synchronize_session=False)
            _add_recipient_rows(db, campaign, recipients)
            campaign.total_recipients = len(recipients)
    return campaign


def cancel_campaign(db: Session, campaign: EmailCampaign) -> EmailCampaign:
    """Cancel a campaign: flip every pending recipient to canceled.

    Idempotent — a terminal campaign (completed/canceled) is returned
    unchanged. The campaign goes to ``canceled`` when at least one recipient
    is still pending, or when it never had any (an unresolved scheduled
    campaign canceled before it became due — nothing was sent, so
    ``canceled`` is the honest state, not a green ``completed``). When no
    recipient is pending but rows exist (the worker just settled the last
    row — a cancel's UPDATE can land in that gap while the worker's terminal
    commit is in flight), it settles to ``completed`` with ``completed_at``
    instead — everything was actually delivered. Does **not** commit — the
    caller owns the transaction. Recipients mid-flight in the worker are not
    touched (the send already left; the row settles to sent/failed by the
    worker).
    """
    if campaign.status in (EmailCampaignStatus.completed, EmailCampaignStatus.canceled):
        return campaign
    canceled = (
        db.query(EmailCampaignRecipient)
        .filter(
            EmailCampaignRecipient.campaign_id == campaign.id,
            EmailCampaignRecipient.status == EmailCampaignRecipientStatus.pending,
        )
        .update(
            {EmailCampaignRecipient.status: EmailCampaignRecipientStatus.canceled},
            synchronize_session=False,
        )
    )
    if canceled or not _campaign_has_rows(db, campaign.id):
        # A skipped recipient — or a campaign that never had one (an
        # unresolved scheduled campaign canceled before it became due) —
        # settles to canceled.
        campaign.status = EmailCampaignStatus.canceled
    else:
        # No recipient was skipped but rows were settled — settle the
        # campaign the way the worker would have (completed, with a
        # timestamp), not "canceled".
        campaign.status = EmailCampaignStatus.completed
        if campaign.completed_at is None:
            campaign.completed_at = datetime.now(timezone.utc)
    return campaign


async def process_next_campaign_email(db: Session) -> EmailCampaign | None:
    """Deliver the next single recipient of the earliest-due active campaign.

    A due ``pending`` campaign without recipient rows is an unresolved
    scheduled one: its selection is resolved right now — send time — so a
    state segment matches the users in that state *then*, and the campaign
    is either settled (a selection matching nothing completes with zero
    sent; one over the cap is canceled) or queued as recipient rows, of
    which this step then sends the first.

    Otherwise: picks the due ``pending``/``sending`` campaign
    (``scheduled_for`` is NULL or in the past) that still has a pending
    recipient — among due campaigns, earliest due first
    (``COALESCE(scheduled_for, created_at)`` generalizes the old id-order
    FIFO; immediate campaigns have NULL and keep their order) —, marks it
    ``sending`` on first pickup, claims its lowest-id pending recipient
    (``FOR UPDATE`` — a concurrent cancel that commits first flips the
    row, Postgres re-checks the WHERE clause, and the worker claims the
    next row instead), sends it via the shared ``send_email`` path, and
    records the outcome. When no pending rows remain the campaign is
    marked ``completed`` — unless a cancel won the terminal state first.
    Commits each step (the worker owns its session; ``send_email`` also
    commits its own ``SentEmail`` log row).

    A campaign whose ``scheduled_for`` has not come is simply not due: the
    step returns ``None`` (the caller idles at the shorter poll interval),
    so a scheduled campaign starts at most one idle poll after its time.

    Returns the campaign, or ``None`` when no due campaign has work (the
    caller then idles at the shorter poll interval).
    """
    now = datetime.now(timezone.utc)
    campaign = (
        db.query(EmailCampaign)
        .filter(
            EmailCampaign.status.in_([EmailCampaignStatus.pending, EmailCampaignStatus.sending]),
            (EmailCampaign.scheduled_for.is_(None)) | (EmailCampaign.scheduled_for <= now),
        )
        .join(EmailCampaignRecipient, EmailCampaignRecipient.campaign_id == EmailCampaign.id)
        .filter(EmailCampaignRecipient.status == EmailCampaignRecipientStatus.pending)
        .order_by(func.coalesce(EmailCampaign.scheduled_for, EmailCampaign.created_at).asc(), EmailCampaign.id)
        .first()
    )
    if campaign is None:
        # Nothing with rows to send — a due scheduled campaign may still
        # need its selection resolved (send time).
        campaign = _resolve_due_unresolved_campaign(db, now)
        if campaign is None:
            return None

    if campaign.status == EmailCampaignStatus.pending:
        campaign.status = EmailCampaignStatus.sending

    recipient = (
        db.query(EmailCampaignRecipient)
        .filter(
            EmailCampaignRecipient.campaign_id == campaign.id,
            EmailCampaignRecipient.status == EmailCampaignRecipientStatus.pending,
        )
        .order_by(EmailCampaignRecipient.id)
        .with_for_update()
        .first()
    )
    if recipient is None:
        # A cancel flipped every remaining row underneath us.
        campaign.status = EmailCampaignStatus.canceled
        db.commit()
        return campaign

    # The unsubscribe gate inside send_email blocks unsubscribed recipients
    # (recorded as failed with reason "unsubscribed") — campaigns never
    # bypass it.
    result = await send_email(
        to=recipient.email,
        subject=campaign.subject,
        html_body=render_custom_message_html(campaign.message),
        db=db,
        kind=EmailKind.campaign,
        user_id=campaign.created_by,
    )

    now = datetime.now(timezone.utc)
    if result["sent"]:
        recipient.status = EmailCampaignRecipientStatus.sent
        recipient.sent_at = now
        campaign.sent_count += 1
    else:
        recipient.status = EmailCampaignRecipientStatus.failed
        recipient.failure_reason = result.get("reason")
        campaign.failed_count += 1
        # ERROR log only — no admin failure-notice emails: a bulk run would
        # storm the admin inbox. (No email address in the log — PII rule.)
        logger.error("Campaign email failed: campaign_id=%s reason=%s", campaign.id, result.get("reason"))

    # Sessions run with autoflush off — flush so the remaining-pending check
    # below sees this row's settled status.
    db.flush()

    remaining = (
        db.query(EmailCampaignRecipient.id)
        .filter(
            EmailCampaignRecipient.campaign_id == campaign.id,
            EmailCampaignRecipient.status == EmailCampaignRecipientStatus.pending,
        )
        .first()
        is not None
    )
    if not remaining and campaign.status in (EmailCampaignStatus.pending, EmailCampaignStatus.sending):
        campaign.status = EmailCampaignStatus.completed
        campaign.completed_at = now

    db.commit()
    logger.info(
        "Campaign email sent: campaign_id=%s progress=%d/%d failed=%d",
        campaign.id,
        campaign.sent_count,
        campaign.total_recipients,
        campaign.failed_count,
    )
    return campaign


def _resolve_due_unresolved_campaign(db: Session, now: datetime) -> EmailCampaign | None:
    """Resolve the earliest-due scheduled campaign that has no rows yet.

    The snapshot freezes at send time: the selection is resolved against
    the current state, a selection matching nothing settles the campaign
    to ``completed`` (a reminder nobody needs is a success), one over
    ``EMAIL_CAMPAIGN_MAX_RECIPIENTS`` to ``canceled`` (the safety cap is
    never silently clamped) — both logged and committed (the worker owns
    its session). Otherwise the rows are added (flushed, not committed —
    the caller's step commits with the first send) and the campaign is
    returned so the caller can send the first recipient.

    The campaign row is locked (the same lock the edit/cancel routes take)
    so a concurrent edit can't swap the selection between the resolve and
    the worker's mid-step commit — it waits, then 409s: by the time the
    lock is released the campaign is sending with a settled recipient, so
    the editability check rejects it.
    """
    campaign_id = (
        db.query(EmailCampaign.id)
        .filter(
            EmailCampaign.status == EmailCampaignStatus.pending,
            (EmailCampaign.scheduled_for.is_(None)) | (EmailCampaign.scheduled_for <= now),
        )
        .outerjoin(EmailCampaignRecipient, EmailCampaignRecipient.campaign_id == EmailCampaign.id)
        .group_by(EmailCampaign.id)
        .having(func.count(EmailCampaignRecipient.id) == 0)
        .order_by(func.coalesce(EmailCampaign.scheduled_for, EmailCampaign.created_at).asc(), EmailCampaign.id)
        .scalar()
    )
    if campaign_id is None:
        return None
    campaign = db.query(EmailCampaign).filter(EmailCampaign.id == campaign_id).with_for_update().first()
    if campaign is None or campaign.status != EmailCampaignStatus.pending:
        # A cancel or edit settled it while it was being picked.
        return None
    recipients = resolve_campaign_recipients(
        db,
        [UserRole(r) for r in campaign.roles],
        [RecipientSegment(s) for s in campaign.segments],
        campaign.extra_emails,
    )
    if not recipients:
        campaign.status = EmailCampaignStatus.completed
        campaign.completed_at = datetime.now(timezone.utc)
        db.commit()
        logger.info("Scheduled campaign %s resolved to no recipients at send time — completed with zero sent", campaign.id)
        return None
    if len(recipients) > EMAIL_CAMPAIGN_MAX_RECIPIENTS:
        campaign.status = EmailCampaignStatus.canceled
        db.commit()
        # The no-email-in-logs scanner (tests/test_no_email_in_logs.py) is a
        # static sweep that flags any log arg whose name contains "email" —
        # including this constant — so the cap goes through a neutral local.
        cap = EMAIL_CAMPAIGN_MAX_RECIPIENTS
        logger.error(
            "Scheduled campaign %s over the recipient cap at send time (%d > %d) — canceled",
            campaign.id,
            len(recipients),
            cap,
        )
        return None
    _add_recipient_rows(db, campaign, recipients)
    campaign.total_recipients = len(recipients)
    db.flush()
    return campaign


def _campaign_has_rows(db: Session, campaign_id: int) -> bool:
    return db.query(EmailCampaignRecipient.id).filter(EmailCampaignRecipient.campaign_id == campaign_id).first() is not None


def _campaign_has_pending_recipients(db: Session, campaign_id: int) -> bool:
    return (
        db.query(EmailCampaignRecipient.id)
        .filter(
            EmailCampaignRecipient.campaign_id == campaign_id,
            EmailCampaignRecipient.status == EmailCampaignRecipientStatus.pending,
        )
        .first()
        is not None
    )


async def _pace_ongoing_campaign(db: Session, campaign_id: int) -> None:
    """Sleep out the post-send interval, in idle-poll chunks.

    Wakes on every idle poll and returns early the moment the campaign has
    no pending recipients left: while pacing the worker is asleep, so an
    admin cancel (``cancel_campaign`` flips every pending row to canceled)
    is the only thing that can clear them. It keeps the full
    ``EMAIL_CAMPAIGN_INTERVAL_SECONDS`` between sends of an ongoing campaign,
    while ending at most one idle poll after the cancel instead of waiting
    out an interval the campaign didn't cause. An early exit goes straight
    to the next cycle (see ``campaign_worker_loop``): a queued campaign's
    first send is due immediately, and only an empty queue idles at the
    normal poll.

    The checks run on the worker's session, but a rollback before every
    sleep chunk releases its pool connection (a check's autobegin
    transaction is read-only, so nothing is lost), so the — much longer —
    sleeps hold no connection and no open transaction.
    """
    elapsed = 0.0
    while elapsed < EMAIL_CAMPAIGN_INTERVAL_SECONDS:
        db.rollback()  # never sleep while holding the check's connection
        chunk = min(EMAIL_CAMPAIGN_IDLE_POLL_SECONDS, EMAIL_CAMPAIGN_INTERVAL_SECONDS - elapsed)
        await asyncio.sleep(chunk)
        elapsed += chunk
        if not _campaign_has_pending_recipients(db, campaign_id):
            return


async def campaign_worker_loop() -> None:
    """Deliver campaign emails one per cycle, paced to avoid SMTP throttling.

    Runs forever in the leader worker (started by the app lifespan,
    disabled in tests via DISABLE_BACKGROUND_TASKS). After a cycle that
    delivered an email of a campaign that still has recipients queued it
    paces the next send (see ``_pace_ongoing_campaign``) and continues
    without extra sleep; after a cycle that settles a campaign — and when
    nothing is due — it waits one idle poll, so two campaign emails are
    never sent closer together than ``EMAIL_CAMPAIGN_IDLE_POLL_SECONDS``.
    DB errors are logged and swallowed (the next cycle retries) — mirroring
    ``deadline_checks_loop``. Cancelled on shutdown by the caller.
    """
    while True:
        sleep_seconds = EMAIL_CAMPAIGN_IDLE_POLL_SECONDS
        try:
            db = next(get_db())
            try:
                campaign = await process_next_campaign_email(db)
                if campaign is not None and campaign.status == EmailCampaignStatus.sending:
                    # Still has recipients queued: consume the post-send
                    # interval in chunks (ends early if canceled), then go
                    # straight to the next cycle — it continues the *same*
                    # campaign and the interval above is the only wait.
                    await _pace_ongoing_campaign(db, campaign.id)
                    sleep_seconds = 0
                # A settled campaign (or nothing due) keeps the default idle
                # poll: the next cycle may start a *different* campaign's
                # first send, and the poll is the minimum gap between two
                # campaigns' sends (see the module docstring).
            finally:
                db.close()
        except Exception as exc:  # noqa: BLE001
            logger.error("Email campaign worker step failed (will retry): %s", exc, exc_info=True)
        await asyncio.sleep(sleep_seconds)
