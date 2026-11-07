"""Tests for the email-campaign core: recipient resolution, creation, and the
one-recipient delivery step (process_next_campaign_email).

The delivery worker loop itself is never run in tests (it's behind
DISABLE_BACKGROUND_TASKS like the other background loops) — the pure step
function is exercised directly, per the run_claim_expiry pattern. Tests run
with SUPPRESS_SEND=1, so a "sent" outcome means the SMTP layer was skipped,
not that a message went out. SMTP failures are monkeypatched per the
test_admin_custom_email.py pattern.
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from sqlalchemy.orm import Session

from app.email_campaigns import (
    CampaignResolutionError,
    cancel_campaign,
    create_campaign,
    process_next_campaign_email,
    resolve_campaign_recipients,
)
from app.models import (
    EmailCampaign,
    EmailCampaignRecipient,
    EmailCampaignRecipientSource,
    EmailCampaignRecipientStatus,
    EmailCampaignStatus,
    EmailKind,
    EmailPreference,
    SentEmail,
    User,
    UserRole,
)


def _make_user(db: Session, email: str, role: UserRole, **kwargs) -> User:
    from app.auth import get_password_hash

    user = User(
        email=email,
        hashed_password=get_password_hash("Passw0rd!abc"),
        role=role,
        display_name=None,
        **kwargs,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _campaigns(db: Session) -> list[EmailCampaign]:
    return db.query(EmailCampaign).order_by(EmailCampaign.id).all()


def _recipients(db: Session, campaign_id: int) -> list[EmailCampaignRecipient]:
    return (
        db.query(EmailCampaignRecipient).filter(EmailCampaignRecipient.campaign_id == campaign_id).order_by(EmailCampaignRecipient.id).all()
    )


def _campaign_sent_rows(db: Session) -> list[SentEmail]:
    return db.query(SentEmail).filter(SentEmail.kind == EmailKind.campaign).all()


# ---------------------------------------------------------------------------
# Recipient resolution
# ---------------------------------------------------------------------------


class TestResolveCampaignRecipients:
    def test_role_selection_only_selected_roles(self, db: Session):
        donor = _make_user(db, "donor1@example.com", UserRole.donor)
        _make_user(db, "purchaser1@example.com", UserRole.purchaser)
        _make_user(db, "delivery1@example.com", UserRole.delivery)

        resolved = resolve_campaign_recipients(db, [UserRole.donor], [])

        assert [r["email"] for r in resolved] == ["donor1@example.com"]
        assert resolved[0]["user_id"] == donor.id
        assert resolved[0]["source"] == EmailCampaignRecipientSource.role

    def test_soft_deleted_users_excluded(self, db: Session):
        donor = _make_user(db, "donor1@example.com", UserRole.donor)
        _make_user(db, "donor2@example.com", UserRole.donor)
        donor.deleted_at = datetime.now(timezone.utc)
        db.commit()

        resolved = resolve_campaign_recipients(db, [UserRole.donor], [])

        assert [r["email"] for r in resolved] == ["donor2@example.com"]

    def test_manual_entries_normalized_and_deduped(self, db: Session):
        resolved = resolve_campaign_recipients(db, [], ["  A@Example.COM ", "a@example.com", "b@example.com"])

        assert [r["email"] for r in resolved] == ["a@example.com", "b@example.com"]
        assert all(r["user_id"] is None for r in resolved)
        assert all(r["source"] == EmailCampaignRecipientSource.manual for r in resolved)

    def test_dedup_role_and_manual_manual_wins(self, db: Session):
        donor = _make_user(db, "donor1@example.com", UserRole.donor)

        resolved = resolve_campaign_recipients(db, [UserRole.donor], ["DONOR1@example.com"])

        assert len(resolved) == 1
        assert resolved[0]["source"] == EmailCampaignRecipientSource.manual
        # The manual entry still carries the account id for display.
        assert resolved[0]["user_id"] == donor.id

    def test_role_order_by_user_id_then_manual(self, db: Session):
        # Created in reverse email order: id order (z first) must win over
        # any email-based ordering.
        _make_user(db, "z-donor@example.com", UserRole.donor)
        _make_user(db, "a-donor@example.com", UserRole.donor)

        resolved = resolve_campaign_recipients(db, [UserRole.donor], ["manual@example.com"])

        assert [r["email"] for r in resolved] == ["z-donor@example.com", "a-donor@example.com", "manual@example.com"]


# ---------------------------------------------------------------------------
# Campaign creation
# ---------------------------------------------------------------------------


class TestCreateCampaign:
    def test_create_success_roles_plus_manual(self, db: Session, admin_user):
        donor = _make_user(db, "donor1@example.com", UserRole.donor)

        campaign = create_campaign(
            db,
            created_by=admin_user,
            subject=None,
            message="Hello all",
            roles=[UserRole.donor],
            extra_emails=["extra@example.com"],
        )
        db.commit()
        db.refresh(campaign)

        assert campaign.status == EmailCampaignStatus.pending
        # Blank subject falls back to the shared default.
        assert campaign.subject == "A message from Kindness Is Magic ✨"
        assert campaign.message == "Hello all"
        assert campaign.roles == ["donor"]
        assert campaign.total_recipients == 2
        assert campaign.sent_count == 0
        assert campaign.failed_count == 0
        assert campaign.created_by == admin_user.id
        assert campaign.completed_at is None

        rows = _recipients(db, campaign.id)
        assert [(r.email, r.source, r.user_id, r.status) for r in rows] == [
            ("donor1@example.com", EmailCampaignRecipientSource.role, donor.id, EmailCampaignRecipientStatus.pending),
            ("extra@example.com", EmailCampaignRecipientSource.manual, None, EmailCampaignRecipientStatus.pending),
        ]

    def test_create_explicit_subject_kept(self, db: Session, admin_user):
        campaign = create_campaign(
            db,
            created_by=admin_user,
            subject="  Drive results  ",
            message="Hi",
            roles=[],
            extra_emails=["a@example.com"],
        )
        assert campaign.subject == "Drive results"

    def test_create_empty_selection_raises(self, db: Session, admin_user):
        try:
            create_campaign(db, created_by=admin_user, subject=None, message="Hi", roles=[], extra_emails=[])
            assert False, "expected CampaignResolutionError"
        except CampaignResolutionError:
            pass

    def test_create_roles_with_no_matching_users_raises(self, db: Session, admin_user):
        # No purchaser users exist in this test's schema.
        try:
            create_campaign(db, created_by=admin_user, subject=None, message="Hi", roles=[UserRole.purchaser], extra_emails=[])
            assert False, "expected CampaignResolutionError"
        except CampaignResolutionError:
            pass

    def test_create_over_cap_raises(self, db: Session, admin_user, monkeypatch):
        monkeypatch.setattr("app.email_campaigns.EMAIL_CAMPAIGN_MAX_RECIPIENTS", 1)

        try:
            create_campaign(
                db,
                created_by=admin_user,
                subject=None,
                message="Hi",
                roles=[],
                extra_emails=["a@example.com", "b@example.com"],
            )
            assert False, "expected CampaignResolutionError"
        except CampaignResolutionError:
            pass


# ---------------------------------------------------------------------------
# Delivery step (one recipient per call)
# ---------------------------------------------------------------------------


class TestProcessNextCampaignEmail:
    async def test_no_work_returns_none(self, db: Session):
        assert await process_next_campaign_email(db) is None

    async def test_sends_one_recipient_per_call(self, db: Session, admin_user):
        create_campaign(
            db, created_by=admin_user, subject="Subj", message="Body", roles=[], extra_emails=["a@example.com", "b@example.com"]
        )
        db.commit()
        campaign = _campaigns(db)[0]

        campaign_result = await process_next_campaign_email(db)

        assert campaign_result.id == campaign.id
        # Campaign flipped pending → sending (more recipients remain).
        db.refresh(campaign)
        assert campaign.status == EmailCampaignStatus.sending
        assert campaign.sent_count == 1
        assert campaign.failed_count == 0

        rows = _recipients(db, campaign.id)
        assert rows[0].status == EmailCampaignRecipientStatus.sent
        assert rows[0].sent_at is not None
        assert rows[0].failure_reason is None
        assert rows[1].status == EmailCampaignRecipientStatus.pending

        # One SentEmail log row per attempt: kind campaign, actor = admin.
        sent_rows = _campaign_sent_rows(db)
        assert len(sent_rows) == 1
        assert sent_rows[0].recipient_email == "a@example.com"
        assert sent_rows[0].user_id == admin_user.id
        assert sent_rows[0].status.value == "sent"

    async def test_second_call_sends_next_recipient_and_completes(self, db: Session, admin_user):
        create_campaign(
            db, created_by=admin_user, subject="Subj", message="Body", roles=[], extra_emails=["a@example.com", "b@example.com"]
        )
        db.commit()
        campaign = _campaigns(db)[0]

        await process_next_campaign_email(db)
        result = await process_next_campaign_email(db)

        db.refresh(campaign)
        assert campaign.status == EmailCampaignStatus.completed
        assert campaign.completed_at is not None
        assert campaign.sent_count == 2
        rows = _recipients(db, campaign.id)
        assert [r.status for r in rows] == [
            EmailCampaignRecipientStatus.sent,
            EmailCampaignRecipientStatus.sent,
        ]
        # No further work once completed.
        assert result is not None
        assert await process_next_campaign_email(db) is None

    async def test_oldest_campaign_processed_first(self, db: Session, admin_user):
        create_campaign(db, created_by=admin_user, subject="First", message="B", roles=[], extra_emails=["first@example.com"])
        db.flush()
        create_campaign(db, created_by=admin_user, subject="Second", message="B", roles=[], extra_emails=["second@example.com"])
        db.commit()
        first, second = _campaigns(db)

        result = await process_next_campaign_email(db)

        assert result.id == first.id
        assert _recipients(db, first.id)[0].status == EmailCampaignRecipientStatus.sent
        assert _recipients(db, second.id)[0].status == EmailCampaignRecipientStatus.pending

    async def test_unsubscribed_recipient_failed_and_campaign_continues(self, db: Session, admin_user):
        db.add(EmailPreference(email="a@example.com", unsubscribed_at=datetime.now(timezone.utc)))
        db.commit()
        create_campaign(
            db, created_by=admin_user, subject="Subj", message="Body", roles=[], extra_emails=["a@example.com", "b@example.com"]
        )
        db.commit()
        campaign = _campaigns(db)[0]

        await process_next_campaign_email(db)

        db.refresh(campaign)
        assert campaign.failed_count == 1
        assert campaign.sent_count == 0
        assert campaign.status == EmailCampaignStatus.sending
        rows = _recipients(db, campaign.id)
        assert rows[0].status == EmailCampaignRecipientStatus.failed
        assert rows[0].failure_reason == "unsubscribed"
        assert rows[0].sent_at is None
        # The failure is logged (kind campaign) — the gate was not bypassed.
        sent_rows = _campaign_sent_rows(db)
        assert sent_rows[0].status.value == "failed"
        assert sent_rows[0].failure_reason == "unsubscribed"

        # The campaign continues with the next recipient and completes.
        await process_next_campaign_email(db)
        db.refresh(campaign)
        assert campaign.status == EmailCampaignStatus.completed
        assert campaign.sent_count == 1

    async def test_smtp_error_marks_failed(self, db: Session, admin_user):
        create_campaign(db, created_by=admin_user, subject="Subj", message="Body", roles=[], extra_emails=["a@example.com"])
        db.commit()
        campaign = _campaigns(db)[0]

        async def _raise(message):
            raise Exception("Connection refused")

        with patch("app.mail.mail_manager.send_message", new=MagicMock(side_effect=_raise)):
            await process_next_campaign_email(db)

        db.refresh(campaign)
        # A failed send still completes the campaign (no pending rows left) —
        # failures are recorded, not retried.
        assert campaign.status == EmailCampaignStatus.completed
        assert campaign.failed_count == 1
        assert campaign.sent_count == 0
        row = _recipients(db, campaign.id)[0]
        assert row.status == EmailCampaignRecipientStatus.failed
        assert row.failure_reason == "smtp_error"

    async def test_resume_after_restart(self, db: Session, admin_user):
        create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            extra_emails=["a@example.com", "b@example.com", "c@example.com"],
        )
        db.commit()
        campaign = _campaigns(db)[0]

        await process_next_campaign_email(db)
        # Simulate a process restart: drop all in-session state so the next
        # step re-queries everything (the resume path).
        db.expire_all()

        await process_next_campaign_email(db)

        db.refresh(campaign)
        assert campaign.sent_count == 2
        assert campaign.status == EmailCampaignStatus.sending
        rows = _recipients(db, campaign.id)
        assert [r.status for r in rows] == [
            EmailCampaignRecipientStatus.sent,
            EmailCampaignRecipientStatus.sent,
            EmailCampaignRecipientStatus.pending,
        ]

    async def test_cancel_flips_pending_rows_and_stops_delivery(self, db: Session, admin_user):
        create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            extra_emails=["a@example.com", "b@example.com", "c@example.com"],
        )
        db.commit()
        campaign = _campaigns(db)[0]

        await process_next_campaign_email(db)  # send a@
        cancel_campaign(db, campaign)
        db.commit()
        db.refresh(campaign)

        assert campaign.status == EmailCampaignStatus.canceled
        rows = _recipients(db, campaign.id)
        assert [r.status for r in rows] == [
            EmailCampaignRecipientStatus.sent,
            EmailCampaignRecipientStatus.canceled,
            EmailCampaignRecipientStatus.canceled,
        ]
        # A canceled campaign is not picked up again.
        assert await process_next_campaign_email(db) is None

    async def test_cancel_with_no_pending_rows_settles_completed(self, db: Session, admin_user):
        # The in-flight window: the worker has settled every recipient row
        # but its terminal commit (campaign → completed) is not in yet. A
        # cancel landing here skipped nothing — it must settle the campaign
        # to completed, not canceled.
        create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            extra_emails=["a@example.com", "b@example.com"],
        )
        db.commit()
        campaign = _campaigns(db)[0]

        await process_next_campaign_email(db)  # sends a@ → sending, b@ still pending

        # Simulate the worker's mid-flight settlement of b@ without its
        # campaign terminal commit.
        _recipients(db, campaign.id)[1].status = EmailCampaignRecipientStatus.sent
        db.commit()
        db.refresh(campaign)
        assert campaign.status == EmailCampaignStatus.sending

        cancel_campaign(db, campaign)
        db.commit()
        db.refresh(campaign)
        assert campaign.status == EmailCampaignStatus.completed
        assert campaign.completed_at is not None

    async def test_cancel_is_idempotent_on_terminal_campaigns(self, db: Session, admin_user):
        campaign = create_campaign(db, created_by=admin_user, subject="Subj", message="Body", roles=[], extra_emails=["a@example.com"])
        db.commit()
        db.refresh(campaign)

        cancel_campaign(db, campaign)
        db.commit()
        db.refresh(campaign)
        assert campaign.status == EmailCampaignStatus.canceled

        # Second cancel is a no-op.
        cancel_campaign(db, campaign)
        db.commit()
        db.refresh(campaign)
        assert campaign.status == EmailCampaignStatus.canceled
