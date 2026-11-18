"""Tests for the email-campaign core: recipient resolution, creation, the
one-recipient delivery step (process_next_campaign_email), and the worker
loop's per-cycle decisions.

The background worker is not run for real in tests (it's behind
DISABLE_BACKGROUND_TASKS like the other background loops): the pure step
function and the pacing helper are exercised directly, per the
run_claim_expiry pattern, and the loop itself is driven as a canceled task
with its cycle work faked (TestCampaignWorkerLoop). Tests run with
SUPPRESS_SEND=1, so a "sent" outcome means the SMTP layer was skipped,
not that a message went out. SMTP failures are monkeypatched per the
test_admin_custom_email.py pattern.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session

import app.email_campaigns as ec
from app.email_campaigns import (
    CampaignResolutionError,
    CampaignStateError,
    activate_campaign,
    cancel_campaign,
    create_campaign,
    create_draft,
    process_next_campaign_email,
    resolve_campaign_recipients,
    update_campaign,
)
from app.models import (
    ClaimPaymentStatus,
    CommitmentType,
    EmailCampaign,
    EmailCampaignRecipient,
    EmailCampaignRecipientSource,
    EmailCampaignRecipientStatus,
    EmailCampaignStatus,
    EmailKind,
    EmailPreference,
    FamilyClaim,
    Referrer,
    ReferrerApprovalStatus,
    RecipientSegment,
    SentEmail,
    User,
    UserRole,
    WishLockLevel,
)
from tests.conftest import make_family


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


def _make_family(db: Session, name: str, **kwargs):
    """A family (plus its family wish) in a given review state.

    Defaults to the unsubmitted state (family lock, no review request).
    """
    fam = make_family(db, family_name=name, family_wish="A wish", contact_name="Contact", **kwargs)
    db.flush()
    return fam


def _make_referrer(db: Session, name: str, code: str) -> Referrer:
    ref = Referrer(
        name=name,
        family_limit=10,
        phone_number="555-000-0000",
        family_invite_code=code,
        approval_status=ReferrerApprovalStatus.approved,
    )
    db.add(ref)
    db.flush()
    return ref


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

        resolved = resolve_campaign_recipients(db, [UserRole.donor], [], [])

        assert [r["email"] for r in resolved] == ["donor1@example.com"]
        assert resolved[0]["user_id"] == donor.id
        assert resolved[0]["source"] == EmailCampaignRecipientSource.role

    def test_soft_deleted_users_excluded(self, db: Session):
        donor = _make_user(db, "donor1@example.com", UserRole.donor)
        _make_user(db, "donor2@example.com", UserRole.donor)
        donor.deleted_at = datetime.now(timezone.utc)
        db.commit()

        resolved = resolve_campaign_recipients(db, [UserRole.donor], [], [])

        assert [r["email"] for r in resolved] == ["donor2@example.com"]

    def test_manual_entries_normalized_and_deduped(self, db: Session):
        resolved = resolve_campaign_recipients(db, [], [], ["  A@Example.COM ", "a@example.com", "b@example.com"])

        assert [r["email"] for r in resolved] == ["a@example.com", "b@example.com"]
        assert all(r["user_id"] is None for r in resolved)
        assert all(r["source"] == EmailCampaignRecipientSource.manual for r in resolved)

    def test_dedup_role_and_manual_manual_wins(self, db: Session):
        donor = _make_user(db, "donor1@example.com", UserRole.donor)

        resolved = resolve_campaign_recipients(db, [UserRole.donor], [], ["DONOR1@example.com"])

        assert len(resolved) == 1
        assert resolved[0]["source"] == EmailCampaignRecipientSource.manual
        # The manual entry still carries the account id for display.
        assert resolved[0]["user_id"] == donor.id

    def test_role_order_by_user_id_then_manual(self, db: Session):
        # Created in reverse email order: id order (z first) must win over
        # any email-based ordering.
        _make_user(db, "z-donor@example.com", UserRole.donor)
        _make_user(db, "a-donor@example.com", UserRole.donor)

        resolved = resolve_campaign_recipients(db, [UserRole.donor], [], ["manual@example.com"])

        assert [r["email"] for r in resolved] == ["z-donor@example.com", "a-donor@example.com", "manual@example.com"]


# ---------------------------------------------------------------------------
# State-segment resolution
# ---------------------------------------------------------------------------


class TestResolveSegments:
    def test_families_not_submitted_resolves_family_users(self, db: Session):
        open_fam = _make_family(db, "Open")
        family_user = _make_user(db, "fam1@example.com", UserRole.family, family_id=open_fam.id)
        # Submitted (referrer lock) — excluded.
        submitted = _make_family(db, "Submitted", wish_lock_level=WishLockLevel.referrer)
        _make_user(db, "fam2@example.com", UserRole.family, family_id=submitted.id)
        # Soft-deleted — excluded.
        deleted = _make_family(db, "Deleted")
        _make_user(db, "fam3@example.com", UserRole.family, family_id=deleted.id)
        deleted.deleted_at = datetime.now(timezone.utc)
        db.commit()

        resolved = resolve_campaign_recipients(db, [], [RecipientSegment.families_not_submitted_for_review], [])

        assert [r["email"] for r in resolved] == ["fam1@example.com"]
        assert resolved[0]["source"] == EmailCampaignRecipientSource.segment
        assert resolved[0]["segment"] == "families_not_submitted_for_review"
        assert resolved[0]["user_id"] == family_user.id

    def test_families_with_pending_request_do_not_match(self, db: Session):
        pending = _make_family(db, "Pending request")
        _make_user(db, "fam1@example.com", UserRole.family, family_id=pending.id)
        pending.wish_review_requested_at = datetime.now(timezone.utc)
        db.commit()

        resolved = resolve_campaign_recipients(db, [], [RecipientSegment.families_not_submitted_for_review], [])

        assert resolved == []

    def test_families_sent_back_with_rejection_match(self, db: Session):
        sent_back = _make_family(db, "Sent back")
        _make_user(db, "fam1@example.com", UserRole.family, family_id=sent_back.id)
        sent_back.wish_rejection_reason = "Fix the sizes"
        db.commit()

        resolved = resolve_campaign_recipients(db, [], [RecipientSegment.families_not_submitted_for_review], [])

        assert [r["email"] for r in resolved] == ["fam1@example.com"]

    def test_families_without_users_contribute_nothing(self, db: Session):
        _make_family(db, "No users")

        resolved = resolve_campaign_recipients(db, [], [RecipientSegment.families_not_submitted_for_review], [])

        assert resolved == []

    def test_referrers_families_not_submitted_resolves_referrer_users(self, db: Session):
        active_ref = _make_referrer(db, "Active", "KFI-SEGAA1")
        idle_ref = _make_referrer(db, "Idle", "KFI-SEGBA2")
        active_user = _make_user(db, "ref1@example.com", UserRole.referrer, referrer_id=active_ref.id)
        _make_user(db, "ref2@example.com", UserRole.referrer, referrer_id=idle_ref.id)
        # active: an unsubmitted family (matches — the family hasn't
        # requested yet, the referrer hasn't submitted it) and a submitted
        # one (no effect on the outcome).
        _make_family(db, "Unsubmitted", referrer_id=active_ref.id)
        _make_family(db, "Submitted", referrer_id=active_ref.id, wish_lock_level=WishLockLevel.referrer)
        # idle: only submitted families → not in the segment.
        _make_family(db, "Only submitted", referrer_id=idle_ref.id, wish_lock_level=WishLockLevel.referrer)
        db.commit()

        resolved = resolve_campaign_recipients(db, [], [RecipientSegment.referrers_families_not_submitted], [])

        assert [r["email"] for r in resolved] == ["ref1@example.com"]
        assert resolved[0]["user_id"] == active_user.id

    def test_referrer_segment_skips_referrerless_and_deleted_referrers(self, db: Session):
        dead_ref = _make_referrer(db, "Deleted", "KFI-SEGC33")
        _make_user(db, "ref1@example.com", UserRole.referrer, referrer_id=dead_ref.id)
        # Unsubmitted family with no referrer — attributes to no one.
        _make_family(db, "Orphan")
        # Unsubmitted family of a soft-deleted referrer — excluded.
        _make_family(db, "Deleted referrer's", referrer_id=dead_ref.id)
        dead_ref.deleted_at = datetime.now(timezone.utc)
        db.commit()

        resolved = resolve_campaign_recipients(db, [], [RecipientSegment.referrers_families_not_submitted], [])

        assert resolved == []

    def test_donors_unfulfilled_gift_claims_resolves_claimant_accounts(self, db: Session):
        donor2 = _make_user(db, "donor2@example.com", UserRole.donor)  # no claims
        donor1 = _make_user(db, "donor1@example.com", UserRole.donor)
        donor3 = _make_user(db, "donor3@example.com", UserRole.donor)  # fulfilled only
        donor4 = _make_user(db, "donor4@example.com", UserRole.donor)  # deleted claim only
        purchaser = _make_user(db, "purch1@example.com", UserRole.purchaser)
        fams = [_make_family(db, name) for name in ("Gift", "Cash", "Fulfilled", "Purchaser gift", "Dead claim")]
        db.add_all(
            [
                # Unfulfilled gift claim (a donor) — matches.
                FamilyClaim(
                    donor_user_id=donor1.id,
                    family_id=fams[0].id,
                    commitment_type=CommitmentType.gifts,
                    payment_status=ClaimPaymentStatus.paid,
                ),
                # Pending cash claim (not a gift claim) — excluded.
                FamilyClaim(
                    donor_user_id=donor2.id,
                    family_id=fams[1].id,
                    commitment_type=CommitmentType.cash,
                    payment_status=ClaimPaymentStatus.pending,
                ),
                # Fulfilled gift claim — excluded.
                FamilyClaim(
                    donor_user_id=donor3.id,
                    family_id=fams[2].id,
                    commitment_type=CommitmentType.gifts,
                    payment_status=ClaimPaymentStatus.paid,
                    fulfilled_at=datetime.now(timezone.utc),
                ),
                # Unfulfilled gift claim held by a non-donor claimant —
                # still matches (any claim-capable role can claim).
                FamilyClaim(
                    donor_user_id=purchaser.id,
                    family_id=fams[3].id,
                    commitment_type=CommitmentType.gifts,
                    payment_status=ClaimPaymentStatus.paid,
                ),
            ]
        )
        dead_claim = FamilyClaim(
            donor_user_id=donor4.id, family_id=fams[4].id, commitment_type=CommitmentType.gifts, payment_status=ClaimPaymentStatus.paid
        )
        db.add(dead_claim)
        db.flush()
        dead_claim.deleted_at = datetime.now(timezone.utc)  # soft-deleted — excluded
        db.commit()

        resolved = resolve_campaign_recipients(db, [], [RecipientSegment.donors_unfulfilled_gift_claims], [])

        emails = {r["email"] for r in resolved}
        assert emails == {"donor1@example.com", "purch1@example.com"}

    def test_segment_beats_role_in_dedup(self, db: Session):
        open_fam = _make_family(db, "Open")
        user = _make_user(db, "fam1@example.com", UserRole.family, family_id=open_fam.id)

        resolved = resolve_campaign_recipients(db, [UserRole.family], [RecipientSegment.families_not_submitted_for_review], [])

        assert len(resolved) == 1
        assert resolved[0]["source"] == EmailCampaignRecipientSource.segment
        # The account id survives the overwrite (recipient shows the name).
        assert resolved[0]["user_id"] == user.id

    def test_manual_beats_segment_in_dedup(self, db: Session):
        open_fam = _make_family(db, "Open")
        user = _make_user(db, "fam1@example.com", UserRole.family, family_id=open_fam.id)

        resolved = resolve_campaign_recipients(db, [], [RecipientSegment.families_not_submitted_for_review], ["FAM1@example.com"])

        assert len(resolved) == 1
        assert resolved[0]["source"] == EmailCampaignRecipientSource.manual
        assert resolved[0]["user_id"] == user.id

    def test_duplicate_segments_collapsed(self, db: Session):
        open_fam = _make_family(db, "Open")
        _make_user(db, "fam1@example.com", UserRole.family, family_id=open_fam.id)

        resolved = resolve_campaign_recipients(
            db,
            [],
            [RecipientSegment.families_not_submitted_for_review, RecipientSegment.families_not_submitted_for_review],
            [],
        )

        assert [r["email"] for r in resolved] == ["fam1@example.com"]

    def test_winning_segment_is_last_enum_match(self, db: Session):
        # A user matching all three segments is attributed to the last one
        # in enum order (families < referrers < donors) — the by_segment
        # tally's key.
        open_fam = _make_family(db, "Open")
        ref = _make_referrer(db, "Multi", "KFI-SEGMM1")
        user = _make_user(db, "multi@example.com", UserRole.donor, family_id=open_fam.id, referrer_id=ref.id)
        _make_family(db, "Referrer family", referrer_id=ref.id)
        claim_fam = _make_family(db, "Claim family")
        db.add(
            FamilyClaim(
                donor_user_id=user.id, family_id=claim_fam.id, commitment_type=CommitmentType.gifts, payment_status=ClaimPaymentStatus.paid
            )
        )
        db.commit()

        resolved = resolve_campaign_recipients(
            db,
            [],
            [
                RecipientSegment.families_not_submitted_for_review,
                RecipientSegment.referrers_families_not_submitted,
                RecipientSegment.donors_unfulfilled_gift_claims,
            ],
            [],
        )

        assert [r["email"] for r in resolved] == ["multi@example.com"]
        assert resolved[0]["segment"] == "donors_unfulfilled_gift_claims"

    def test_send_order_roles_then_segments_then_manual(self, db: Session):
        open_fam = _make_family(db, "Open")
        # Created first → lowest id → first in the role bucket (both users
        # have the donor role; the segment match only changes the source).
        segment_user = _make_user(db, "seg@example.com", UserRole.donor, family_id=open_fam.id)
        _make_user(db, "role@example.com", UserRole.donor)

        resolved = resolve_campaign_recipients(
            db, [UserRole.donor], [RecipientSegment.families_not_submitted_for_review], ["m@example.com"]
        )

        assert [r["email"] for r in resolved] == ["seg@example.com", "role@example.com", "m@example.com"]
        assert resolved[0]["source"] == EmailCampaignRecipientSource.segment
        assert resolved[0]["user_id"] == segment_user.id
        assert resolved[1]["source"] == EmailCampaignRecipientSource.role


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
            segments=[],
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
            segments=[],
            extra_emails=["a@example.com"],
        )
        assert campaign.subject == "Drive results"

    def test_create_empty_selection_raises(self, db: Session, admin_user):
        try:
            create_campaign(db, created_by=admin_user, subject=None, message="Hi", roles=[], segments=[], extra_emails=[])
            assert False, "expected CampaignResolutionError"
        except CampaignResolutionError:
            pass

    def test_create_roles_with_no_matching_users_raises(self, db: Session, admin_user):
        # No purchaser users exist in this test's schema.
        try:
            create_campaign(db, created_by=admin_user, subject=None, message="Hi", roles=[UserRole.purchaser], segments=[], extra_emails=[])
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
                segments=[],
                extra_emails=["a@example.com", "b@example.com"],
            )
            assert False, "expected CampaignResolutionError"
        except CampaignResolutionError:
            pass

    def test_create_union_over_cap_raises(self, db: Session, admin_user, monkeypatch):
        monkeypatch.setattr("app.email_campaigns.EMAIL_CAMPAIGN_MAX_RECIPIENTS", 1)
        open_fam = _make_family(db, "Open")
        _make_user(db, "fam1@example.com", UserRole.family, family_id=open_fam.id)

        # The cap counts the deduped union across all three halves.
        try:
            create_campaign(
                db,
                created_by=admin_user,
                subject=None,
                message="Hi",
                roles=[],
                segments=[RecipientSegment.families_not_submitted_for_review],
                extra_emails=["a@example.com"],
            )
            assert False, "expected CampaignResolutionError"
        except CampaignResolutionError:
            pass

    def test_create_scheduled_stores_selection_without_resolving(self, db: Session, admin_user):
        open_fam = _make_family(db, "Open")
        _make_user(db, "fam1@example.com", UserRole.family, family_id=open_fam.id)

        campaign = create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[RecipientSegment.families_not_submitted_for_review],
            extra_emails=[],
            scheduled_for=datetime.now(timezone.utc) + timedelta(days=1),
        )
        db.commit()
        db.refresh(campaign)

        # The selection is stored, nothing resolved — the worker resolves
        # it at send time (a state segment must match who is in that state
        # *then*, not at creation).
        assert campaign.status == EmailCampaignStatus.pending
        assert campaign.segments == ["families_not_submitted_for_review"]
        assert campaign.total_recipients == 0
        assert _recipients(db, campaign.id) == []

    def test_create_scheduled_zero_match_selection_is_valid(self, db: Session, admin_user):
        # No purchaser users exist in this test's schema — the selection
        # matches nothing today, which is fine for a scheduled campaign
        # (the state may change by send time). Immediate creation would
        # 422 the same selection.
        campaign = create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[UserRole.purchaser],
            segments=[],
            extra_emails=[],
            scheduled_for=datetime.now(timezone.utc) + timedelta(days=1),
        )
        db.commit()
        db.refresh(campaign)

        assert campaign.status == EmailCampaignStatus.pending
        assert campaign.total_recipients == 0
        assert _recipients(db, campaign.id) == []


# ---------------------------------------------------------------------------
# Delivery step (one recipient per call)
# ---------------------------------------------------------------------------


class TestProcessNextCampaignEmail:
    async def test_no_work_returns_none(self, db: Session):
        assert await process_next_campaign_email(db) is None

    # -- Scheduled campaigns resolve their selection at send time ---------

    async def test_due_unresolved_campaign_resolves_at_send_time(self, db: Session, admin_user):
        # The family is submitted at creation (the segment matches nothing
        # then) and sent back before the send time — the snapshot freezes
        # at send time, so it matches *then*.
        fam = _make_family(db, "Submitted", wish_lock_level=WishLockLevel.referrer)
        _make_user(db, "fam1@example.com", UserRole.family, family_id=fam.id)
        create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[RecipientSegment.families_not_submitted_for_review],
            extra_emails=[],
            scheduled_for=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        db.commit()
        campaign = _campaigns(db)[0]
        assert _recipients(db, campaign.id) == []

        # The state changes (the family is sent back) and the time comes.
        fam.wish_lock_level = WishLockLevel.family
        campaign.scheduled_for = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()

        campaign_result = await process_next_campaign_email(db)

        assert campaign_result.id == campaign.id
        db.refresh(campaign)
        # The single recipient is sent in the same step — the campaign
        # settles to completed (resolve, send, no rows left).
        assert campaign.status == EmailCampaignStatus.completed
        assert campaign.total_recipients == 1
        assert campaign.sent_count == 1
        rows = _recipients(db, campaign.id)
        assert [(r.email, r.source, r.status) for r in rows] == [
            ("fam1@example.com", EmailCampaignRecipientSource.segment, EmailCampaignRecipientStatus.sent)
        ]

    async def test_activated_future_time_resolves_at_send_time(self, db: Session, admin_user):
        # The family is submitted when the draft activates (the segment
        # matches nothing then) and is sent back before the send time —
        # the snapshot freezes at send time, so it matches *then*.
        fam = _make_family(db, "Submitted", wish_lock_level=WishLockLevel.referrer)
        _make_user(db, "fam1@example.com", UserRole.family, family_id=fam.id)
        campaign = create_draft(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[RecipientSegment.families_not_submitted_for_review],
            extra_emails=[],
            scheduled_for=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        db.commit()
        db.refresh(campaign)

        activate_campaign(db, campaign)
        db.commit()
        db.refresh(campaign)
        # Activated unresolved — nothing matches at activation, and a
        # future-time activation never 422s on an empty match.
        assert campaign.status == EmailCampaignStatus.pending
        assert campaign.total_recipients == 0
        assert _recipients(db, campaign.id) == []

        # The state changes (the family is sent back) and the time comes.
        fam.wish_lock_level = WishLockLevel.family
        campaign.scheduled_for = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()

        campaign_result = await process_next_campaign_email(db)

        assert campaign_result.id == campaign.id
        db.refresh(campaign)
        assert campaign.status == EmailCampaignStatus.completed
        assert campaign.total_recipients == 1
        assert campaign.sent_count == 1

    async def test_not_yet_due_unresolved_campaign_not_touched(self, db: Session, admin_user):
        open_fam = _make_family(db, "Open")
        _make_user(db, "fam1@example.com", UserRole.family, family_id=open_fam.id)
        create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[RecipientSegment.families_not_submitted_for_review],
            extra_emails=[],
            scheduled_for=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        db.commit()
        campaign = _campaigns(db)[0]

        assert await process_next_campaign_email(db) is None

        # No resolution before the time — even though the segment matches
        # right now.
        db.refresh(campaign)
        assert campaign.status == EmailCampaignStatus.pending
        assert campaign.total_recipients == 0
        assert _recipients(db, campaign.id) == []

    async def test_due_unresolved_empty_selection_completes_with_zero_sent(self, db: Session, admin_user):
        # No purchaser users exist in this test's schema — the selection
        # matches nothing at send time: a reminder nobody needs is a
        # success, not an error.
        create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[UserRole.purchaser],
            segments=[],
            extra_emails=[],
            scheduled_for=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        db.commit()
        campaign = _campaigns(db)[0]
        # The time comes.
        campaign.scheduled_for = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()

        assert await process_next_campaign_email(db) is None

        db.refresh(campaign)
        assert campaign.status == EmailCampaignStatus.completed
        assert campaign.completed_at is not None
        assert campaign.sent_count == 0
        assert campaign.total_recipients == 0
        assert _recipients(db, campaign.id) == []
        # Nothing left to do.
        assert await process_next_campaign_email(db) is None

    async def test_due_unresolved_over_cap_canceled(self, db: Session, admin_user, monkeypatch):
        monkeypatch.setattr("app.email_campaigns.EMAIL_CAMPAIGN_MAX_RECIPIENTS", 1)
        # Two manual addresses: a valid selection at creation (no
        # resolution), over the cap at send time — the safety cap is
        # never silently clamped.
        create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[],
            extra_emails=["a@example.com", "b@example.com"],
            scheduled_for=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        db.commit()
        campaign = _campaigns(db)[0]
        # The time comes.
        campaign.scheduled_for = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()

        assert await process_next_campaign_email(db) is None

        db.refresh(campaign)
        assert campaign.status == EmailCampaignStatus.canceled
        assert campaign.sent_count == 0
        assert _recipients(db, campaign.id) == []
        assert await process_next_campaign_email(db) is None

    async def test_sends_one_recipient_per_call(self, db: Session, admin_user):
        create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[],
            extra_emails=["a@example.com", "b@example.com"],
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
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[],
            extra_emails=["a@example.com", "b@example.com"],
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
        create_campaign(db, created_by=admin_user, subject="First", message="B", roles=[], segments=[], extra_emails=["first@example.com"])
        db.flush()
        create_campaign(
            db, created_by=admin_user, subject="Second", message="B", roles=[], segments=[], extra_emails=["second@example.com"]
        )
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
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[],
            extra_emails=["a@example.com", "b@example.com"],
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
        create_campaign(db, created_by=admin_user, subject="Subj", message="Body", roles=[], segments=[], extra_emails=["a@example.com"])
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

    async def test_special_use_domain_failed_and_campaign_continues(self, db: Session, admin_user):
        # The mail layer's strict EmailStr rejects special-use domains that
        # the app's own (looser) validation accepts (e.g. .test) — the send
        # must be recorded as failed, not escape send_email (an escape wedges
        # the worker on this recipient forever), and the campaign must
        # continue with the next recipient.
        create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[],
            extra_emails=["a@example.test", "b@example.com"],
        )
        db.commit()
        campaign = _campaigns(db)[0]

        await process_next_campaign_email(db)

        db.refresh(campaign)
        assert campaign.status == EmailCampaignStatus.sending
        assert campaign.failed_count == 1
        assert campaign.sent_count == 0
        rows = _recipients(db, campaign.id)
        assert rows[0].status == EmailCampaignRecipientStatus.failed
        assert rows[0].failure_reason == "invalid_address"
        assert rows[0].sent_at is None

        await process_next_campaign_email(db)

        db.refresh(campaign)
        assert campaign.status == EmailCampaignStatus.completed
        assert campaign.sent_count == 1
        assert _recipients(db, campaign.id)[1].status == EmailCampaignRecipientStatus.sent

    async def test_resume_after_restart(self, db: Session, admin_user):
        create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[],
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
            segments=[],
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
            segments=[],
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

    async def test_cancel_unresolved_campaign_settles_canceled(self, db: Session, admin_user):
        # An unresolved scheduled campaign (no recipient rows) canceled
        # before it became due: nothing was sent or even queued, so the
        # honest terminal state is canceled — not a green completed.
        create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[],
            extra_emails=["a@example.com"],
            scheduled_for=datetime.now(timezone.utc) + timedelta(days=1),
        )
        db.commit()
        campaign = _campaigns(db)[0]
        assert campaign.status == EmailCampaignStatus.pending
        assert _recipients(db, campaign.id) == []

        cancel_campaign(db, campaign)
        db.commit()
        db.refresh(campaign)

        assert campaign.status == EmailCampaignStatus.canceled
        assert campaign.completed_at is None
        assert campaign.sent_count == 0
        assert _recipients(db, campaign.id) == []

    async def test_cancel_is_idempotent_on_terminal_campaigns(self, db: Session, admin_user):
        campaign = create_campaign(
            db, created_by=admin_user, subject="Subj", message="Body", roles=[], segments=[], extra_emails=["a@example.com"]
        )
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

    async def test_scheduled_campaign_not_due_is_skipped(self, db: Session, admin_user):
        # The campaign has frozen rows (an immediate create the admin
        # rescheduled) but its time has not come → no work.
        create_campaign(
            db,
            created_by=admin_user,
            subject="Later",
            message="Body",
            roles=[],
            segments=[],
            extra_emails=["a@example.com"],
        )
        db.commit()
        campaign = _campaigns(db)[0]
        update_campaign(db, campaign, scheduled_for=datetime.now(timezone.utc) + timedelta(hours=1))
        db.commit()

        assert await process_next_campaign_email(db) is None
        assert _recipients(db, campaign.id)[0].status == EmailCampaignRecipientStatus.pending

    async def test_scheduled_campaign_due_is_processed(self, db: Session, admin_user):
        create_campaign(
            db,
            created_by=admin_user,
            subject="Now",
            message="Body",
            roles=[],
            segments=[],
            extra_emails=["a@example.com"],
        )
        db.commit()
        campaign = _campaigns(db)[0]
        # Rescheduled into the past = due now.
        update_campaign(db, campaign, scheduled_for=datetime.now(timezone.utc) - timedelta(minutes=5))
        db.commit()

        result = await process_next_campaign_email(db)

        assert result.id == campaign.id
        assert _recipients(db, campaign.id)[0].status == EmailCampaignRecipientStatus.sent

    async def test_earliest_due_ordering(self, db: Session, admin_user):
        # Immediate campaign created first, rescheduled campaign (due in
        # the past) rescheduled second: the scheduled one is due earlier,
        # so it goes first even though it is younger.
        create_campaign(db, created_by=admin_user, subject="First", message="B", roles=[], segments=[], extra_emails=["first@example.com"])
        db.flush()
        create_campaign(
            db, created_by=admin_user, subject="Second", message="B", roles=[], segments=[], extra_emails=["second@example.com"]
        )
        db.commit()
        first, second = _campaigns(db)
        update_campaign(db, second, scheduled_for=datetime.now(timezone.utc) - timedelta(hours=1))
        db.commit()

        result = await process_next_campaign_email(db)

        assert result.id == second.id
        assert _recipients(db, second.id)[0].status == EmailCampaignRecipientStatus.sent
        assert _recipients(db, first.id)[0].status == EmailCampaignRecipientStatus.pending


# ---------------------------------------------------------------------------
# Drafts: create / activate / update
# ---------------------------------------------------------------------------


class TestCreateDraft:
    def test_draft_stores_selection_without_recipients(self, db: Session, admin_user):
        scheduled = datetime.now(timezone.utc) + timedelta(days=1)
        campaign = create_draft(
            db,
            created_by=admin_user,
            subject=None,
            message="Draft body",
            roles=[UserRole.donor],
            segments=[],
            extra_emails=["  A@Example.COM ", "a@example.com", "b@example.com"],
            scheduled_for=scheduled,
        )
        db.commit()
        db.refresh(campaign)

        assert campaign.status == EmailCampaignStatus.draft
        # Blank subject falls back to the shared default, as at creation.
        assert campaign.subject == "A message from Kindness Is Magic ✨"
        assert campaign.roles == ["donor"]
        # Manual entries are normalized and deduped for storage.
        assert campaign.extra_emails == ["a@example.com", "b@example.com"]
        assert campaign.scheduled_for == scheduled
        # No resolution: no rows, zero total.
        assert campaign.total_recipients == 0
        assert campaign.sent_count == 0
        assert campaign.failed_count == 0
        assert campaign.completed_at is None
        assert _recipients(db, campaign.id) == []

    def test_draft_without_schedule(self, db: Session, admin_user):
        campaign = create_draft(
            db, created_by=admin_user, subject="Later", message="Body", roles=[], segments=[], extra_emails=["a@example.com"]
        )
        db.commit()
        db.refresh(campaign)

        assert campaign.status == EmailCampaignStatus.draft
        assert campaign.scheduled_for is None
        assert campaign.roles == []
        assert campaign.extra_emails == ["a@example.com"]

    def test_draft_stores_segments_without_resolving(self, db: Session, admin_user):
        open_fam = _make_family(db, "Open")
        _make_user(db, "fam1@example.com", UserRole.family, family_id=open_fam.id)

        campaign = create_draft(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[RecipientSegment.families_not_submitted_for_review],
            extra_emails=[],
        )
        db.commit()
        db.refresh(campaign)

        assert campaign.status == EmailCampaignStatus.draft
        assert campaign.roles == []
        assert campaign.segments == ["families_not_submitted_for_review"]
        # No resolution until activation — the state may change by send time.
        assert campaign.total_recipients == 0
        assert _recipients(db, campaign.id) == []


class TestActivateCampaign:
    def test_activate_resolves_and_queues(self, db: Session, admin_user):
        donor = _make_user(db, "donor1@example.com", UserRole.donor)
        campaign = create_draft(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[UserRole.donor],
            segments=[],
            extra_emails=["extra@example.com"],
        )
        db.commit()
        db.refresh(campaign)

        activate_campaign(db, campaign)
        db.commit()
        db.refresh(campaign)

        assert campaign.status == EmailCampaignStatus.pending
        assert campaign.total_recipients == 2
        rows = _recipients(db, campaign.id)
        assert [(r.email, r.source, r.user_id, r.status) for r in rows] == [
            ("donor1@example.com", EmailCampaignRecipientSource.role, donor.id, EmailCampaignRecipientStatus.pending),
            ("extra@example.com", EmailCampaignRecipientSource.manual, None, EmailCampaignRecipientStatus.pending),
        ]

    def test_activate_future_time_defers_resolution(self, db: Session, admin_user):
        # A draft with a future send time activates unresolved — like a
        # scheduled creation, the worker resolves it at send time.
        scheduled = datetime.now(timezone.utc) + timedelta(days=2)
        campaign = create_draft(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[],
            extra_emails=["a@example.com"],
            scheduled_for=scheduled,
        )
        db.commit()
        db.refresh(campaign)

        activate_campaign(db, campaign)
        db.commit()
        db.refresh(campaign)

        assert campaign.status == EmailCampaignStatus.pending
        assert campaign.scheduled_for == scheduled
        assert campaign.total_recipients == 0
        assert _recipients(db, campaign.id) == []

    def test_activate_past_time_resolves_now(self, db: Session, admin_user):
        # A stored time that has passed is due now — activation resolves
        # immediately (no deferral to the worker).
        scheduled = datetime.now(timezone.utc) - timedelta(hours=1)
        campaign = create_draft(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[],
            extra_emails=["a@example.com"],
            scheduled_for=scheduled,
        )
        db.commit()
        db.refresh(campaign)

        activate_campaign(db, campaign)
        db.commit()
        db.refresh(campaign)

        assert campaign.status == EmailCampaignStatus.pending
        assert campaign.scheduled_for == scheduled
        assert campaign.total_recipients == 1
        assert [(r.email, r.source) for r in _recipients(db, campaign.id)] == [("a@example.com", EmailCampaignRecipientSource.manual)]

    def test_activate_resolves_segments(self, db: Session, admin_user):
        open_fam = _make_family(db, "Open")
        user = _make_user(db, "fam1@example.com", UserRole.family, family_id=open_fam.id)
        campaign = create_draft(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[RecipientSegment.families_not_submitted_for_review],
            extra_emails=[],
        )
        db.commit()
        db.refresh(campaign)

        activate_campaign(db, campaign)
        db.commit()
        db.refresh(campaign)

        assert campaign.status == EmailCampaignStatus.pending
        assert campaign.total_recipients == 1
        rows = _recipients(db, campaign.id)
        assert [(r.email, r.source, r.user_id) for r in rows] == [("fam1@example.com", EmailCampaignRecipientSource.segment, user.id)]

    def test_activate_segment_resolving_to_nothing_raises(self, db: Session, admin_user):
        # No families exist — a valid draft (selection non-empty) whose
        # segment resolves to nothing cannot be sent.
        campaign = create_draft(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[RecipientSegment.families_not_submitted_for_review],
            extra_emails=[],
        )
        db.commit()
        db.refresh(campaign)

        try:
            activate_campaign(db, campaign)
            assert False, "expected CampaignResolutionError"
        except CampaignResolutionError:
            pass

    def test_activate_empty_selection_raises(self, db: Session, admin_user):
        # No purchaser users exist in this test's schema — a valid draft
        # (selection non-empty) whose resolution is empty cannot be sent.
        campaign = create_draft(
            db, created_by=admin_user, subject="Subj", message="Body", roles=[UserRole.purchaser], segments=[], extra_emails=[]
        )
        db.commit()
        db.refresh(campaign)

        try:
            activate_campaign(db, campaign)
            assert False, "expected CampaignResolutionError"
        except CampaignResolutionError:
            pass

    def test_activate_over_cap_raises(self, db: Session, admin_user, monkeypatch):
        monkeypatch.setattr("app.email_campaigns.EMAIL_CAMPAIGN_MAX_RECIPIENTS", 1)
        campaign = create_draft(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[],
            extra_emails=["a@example.com", "b@example.com"],
        )
        db.commit()
        db.refresh(campaign)

        try:
            activate_campaign(db, campaign)
            assert False, "expected CampaignResolutionError"
        except CampaignResolutionError:
            pass

    def test_activate_non_draft_raises(self, db: Session, admin_user):
        campaign = create_campaign(
            db, created_by=admin_user, subject="Subj", message="Body", roles=[], segments=[], extra_emails=["a@example.com"]
        )
        db.commit()
        db.refresh(campaign)

        try:
            activate_campaign(db, campaign)
            assert False, "expected CampaignStateError"
        except CampaignStateError:
            pass


class TestUpdateCampaign:
    def test_draft_selection_swap(self, db: Session, admin_user):
        campaign = create_draft(
            db,
            created_by=admin_user,
            subject="Old",
            message="Old body",
            roles=[UserRole.donor],
            segments=[],
            extra_emails=["a@example.com"],
        )
        db.commit()
        db.refresh(campaign)

        update_campaign(
            db,
            campaign,
            subject="New",
            message="New body",
            roles=[],
            segments=[],
            extra_emails=["  B@Example.com "],
        )
        db.commit()
        db.refresh(campaign)

        assert campaign.status == EmailCampaignStatus.draft  # still a draft
        assert campaign.subject == "New"
        assert campaign.message == "New body"
        assert campaign.roles == []
        assert campaign.extra_emails == ["b@example.com"]
        # No resolution happens until activation — still no rows.
        assert campaign.total_recipients == 0
        assert _recipients(db, campaign.id) == []

    def test_draft_scheduled_for_set_and_clear(self, db: Session, admin_user):
        campaign = create_draft(
            db, created_by=admin_user, subject="Subj", message="Body", roles=[], segments=[], extra_emails=["a@example.com"]
        )
        db.commit()
        db.refresh(campaign)

        scheduled = datetime.now(timezone.utc) + timedelta(days=3)
        update_campaign(db, campaign, scheduled_for=scheduled)
        db.commit()
        db.refresh(campaign)
        assert campaign.scheduled_for == scheduled

        update_campaign(db, campaign, clear_scheduled_for=True)
        db.commit()
        db.refresh(campaign)
        assert campaign.scheduled_for is None

    def test_blank_subject_falls_back_to_default(self, db: Session, admin_user):
        campaign = create_draft(
            db, created_by=admin_user, subject="Subj", message="Body", roles=[], segments=[], extra_emails=["a@example.com"]
        )
        db.commit()
        db.refresh(campaign)

        update_campaign(db, campaign, subject="   ")
        db.commit()
        db.refresh(campaign)
        assert campaign.subject == "A message from Kindness Is Magic ✨"

    def test_pending_campaign_reresolves_and_replaces_rows(self, db: Session, admin_user):
        campaign = create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[],
            extra_emails=["a@example.com", "b@example.com"],
        )
        db.commit()
        db.refresh(campaign)
        assert campaign.total_recipients == 2

        update_campaign(db, campaign, extra_emails=["c@example.com"])
        db.commit()
        db.refresh(campaign)

        assert campaign.status == EmailCampaignStatus.pending
        assert campaign.total_recipients == 1
        rows = _recipients(db, campaign.id)
        assert [(r.email, r.status) for r in rows] == [("c@example.com", EmailCampaignRecipientStatus.pending)]

    def test_pending_campaign_keeps_scheduled_for_on_selection_edit(self, db: Session, admin_user):
        scheduled = datetime.now(timezone.utc) + timedelta(days=1)
        campaign = create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[],
            extra_emails=["a@example.com"],
        )
        db.commit()
        db.refresh(campaign)

        # Reschedule + selection edit in one update: the rows are
        # re-resolved/replaced, the schedule survives.
        update_campaign(db, campaign, extra_emails=["b@example.com"], scheduled_for=scheduled)
        db.commit()
        db.refresh(campaign)

        assert campaign.scheduled_for == scheduled
        assert [r.email for r in _recipients(db, campaign.id)] == ["b@example.com"]

    def test_draft_segments_swap_keeps_other_halves(self, db: Session, admin_user):
        campaign = create_draft(
            db,
            created_by=admin_user,
            subject="Old",
            message="Old body",
            roles=[UserRole.donor],
            segments=[RecipientSegment.families_not_submitted_for_review],
            extra_emails=["a@example.com"],
        )
        db.commit()
        db.refresh(campaign)

        # Replacing the segment half leaves the other halves stored.
        update_campaign(db, campaign, segments=[])
        db.commit()
        db.refresh(campaign)

        assert campaign.segments == []
        assert campaign.roles == ["donor"]
        assert campaign.extra_emails == ["a@example.com"]
        # No resolution happens until activation — still no rows.
        assert campaign.total_recipients == 0

    def test_pending_campaign_segment_edit_reresolves_state(self, db: Session, admin_user):
        open_fam = _make_family(db, "Open")
        _make_user(db, "fam1@example.com", UserRole.family, family_id=open_fam.id)
        campaign = create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[RecipientSegment.families_not_submitted_for_review],
            extra_emails=[],
        )
        db.commit()
        db.refresh(campaign)
        assert campaign.total_recipients == 1

        # The state changes (the family requests review) and the admin edits
        # the selection: the segment re-resolves to nothing, so the only
        # remaining recipient is the new manual address.
        open_fam.wish_review_requested_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(campaign)

        update_campaign(db, campaign, extra_emails=["b@example.com"])
        db.commit()
        db.refresh(campaign)

        assert campaign.total_recipients == 1
        rows = _recipients(db, campaign.id)
        assert [(r.email, r.source) for r in rows] == [("b@example.com", EmailCampaignRecipientSource.manual)]

    def test_unresolved_pending_selection_edit_stores_only(self, db: Session, admin_user):
        # A scheduled campaign has no rows — a selection edit stores the
        # new selection without resolving (it may match nothing, e.g. no
        # purchaser users exist in this test's schema).
        campaign = create_campaign(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[],
            extra_emails=["a@example.com"],
            scheduled_for=datetime.now(timezone.utc) + timedelta(days=1),
        )
        db.commit()
        db.refresh(campaign)

        update_campaign(db, campaign, roles=[UserRole.purchaser], segments=[], extra_emails=[])
        db.commit()
        db.refresh(campaign)

        assert campaign.roles == ["purchaser"]
        assert campaign.extra_emails == []
        assert campaign.total_recipients == 0
        assert _recipients(db, campaign.id) == []

    def test_update_empty_across_all_three_halves_raises(self, db: Session, admin_user):
        campaign = create_draft(
            db,
            created_by=admin_user,
            subject="Subj",
            message="Body",
            roles=[],
            segments=[RecipientSegment.families_not_submitted_for_review],
            extra_emails=["a@example.com"],
        )
        db.commit()
        db.refresh(campaign)

        try:
            update_campaign(db, campaign, roles=[], segments=[], extra_emails=[])
            assert False, "expected CampaignResolutionError"
        except CampaignResolutionError:
            pass

    def test_update_empty_selection_raises(self, db: Session, admin_user):
        campaign = create_draft(
            db, created_by=admin_user, subject="Subj", message="Body", roles=[], segments=[], extra_emails=["a@example.com"]
        )
        db.commit()
        db.refresh(campaign)

        try:
            update_campaign(db, campaign, roles=[], segments=[], extra_emails=[])
            assert False, "expected CampaignResolutionError"
        except CampaignResolutionError:
            pass

    def test_update_raises_on_sending_campaign(self, db: Session, admin_user):
        campaign = create_campaign(
            db, created_by=admin_user, subject="Subj", message="Body", roles=[], segments=[], extra_emails=["a@example.com"]
        )
        db.commit()
        db.refresh(campaign)
        # Simulate the worker having settled one recipient.
        campaign.status = EmailCampaignStatus.sending
        campaign.sent_count = 1
        db.commit()
        db.refresh(campaign)

        try:
            update_campaign(db, campaign, message="Changed")
            assert False, "expected CampaignStateError"
        except CampaignStateError:
            pass

    def test_update_raises_on_terminal_campaigns(self, db: Session, admin_user):
        campaign = create_campaign(
            db, created_by=admin_user, subject="Subj", message="Body", roles=[], segments=[], extra_emails=["a@example.com"]
        )
        db.commit()
        db.refresh(campaign)
        campaign.status = EmailCampaignStatus.completed
        db.commit()
        db.refresh(campaign)

        try:
            update_campaign(db, campaign, message="Changed")
            assert False, "expected CampaignStateError"
        except CampaignStateError:
            pass


class TestPaceOngoingCampaign:
    """Post-send pacing (``_pace_ongoing_campaign``).

    The loop's cycle work is faked in TestCampaignWorkerLoop; here the
    pacing helper itself is the unit under test. ``asyncio.sleep`` is faked
    (recorded, not awaited) and the interval constants shrunk, so no real
    time passes.
    """

    @staticmethod
    def _make_ongoing_campaign(db: Session, admin_user, subject: str) -> EmailCampaign:
        campaign = create_campaign(
            db,
            created_by=admin_user,
            subject=subject,
            message="Body.",
            roles=[],
            segments=[],
            extra_emails=["a@example.com", "b@example.com", "c@example.com"],
        )
        db.commit()
        campaign.status = EmailCampaignStatus.sending  # as the worker sets it
        db.commit()
        return campaign

    async def test_sleeps_full_interval_while_campaign_ongoing(self, db: Session, admin_user, monkeypatch):
        monkeypatch.setattr(ec, "EMAIL_CAMPAIGN_IDLE_POLL_SECONDS", 1)
        monkeypatch.setattr(ec, "EMAIL_CAMPAIGN_INTERVAL_SECONDS", 3)
        campaign = self._make_ongoing_campaign(db, admin_user, "Ongoing")

        sleeps: list = []

        async def fake_sleep(seconds: float) -> None:
            sleeps.append(seconds)

        monkeypatch.setattr("asyncio.sleep", fake_sleep)
        await ec._pace_ongoing_campaign(db, campaign.id)

        # Pending rows never cleared → the whole interval, in idle-poll chunks.
        assert sleeps == [1, 1, 1]

    async def test_ends_early_when_campaign_canceled(self, db: Session, admin_user, monkeypatch):
        monkeypatch.setattr(ec, "EMAIL_CAMPAIGN_IDLE_POLL_SECONDS", 1)
        monkeypatch.setattr(ec, "EMAIL_CAMPAIGN_INTERVAL_SECONDS", 3)
        campaign = self._make_ongoing_campaign(db, admin_user, "Canceled mid-pace")

        sleeps: list = []

        async def cancel_after_first_chunk(seconds: float) -> None:
            sleeps.append(seconds)
            if len(sleeps) == 1:
                # An admin cancel landing during the first chunk: all pending
                # rows settle to canceled (the worker's own cancel endpoint).
                campaign.status = EmailCampaignStatus.canceled
                db.query(EmailCampaignRecipient).filter(
                    EmailCampaignRecipient.campaign_id == campaign.id,
                    EmailCampaignRecipient.status == EmailCampaignRecipientStatus.pending,
                ).update(
                    {EmailCampaignRecipient.status: EmailCampaignRecipientStatus.canceled},
                    synchronize_session=False,
                )
                db.commit()

        monkeypatch.setattr("asyncio.sleep", cancel_after_first_chunk)
        await ec._pace_ongoing_campaign(db, campaign.id)

        # Cleared after the first wake → back to the idle poll immediately.
        assert sleeps == [1]

    async def test_last_chunk_capped_at_interval(self, db: Session, admin_user, monkeypatch):
        # Idle poll doesn't divide the interval → the last chunk is the
        # remainder, so the total is exactly the interval.
        monkeypatch.setattr(ec, "EMAIL_CAMPAIGN_IDLE_POLL_SECONDS", 2)
        monkeypatch.setattr(ec, "EMAIL_CAMPAIGN_INTERVAL_SECONDS", 5)
        campaign = self._make_ongoing_campaign(db, admin_user, "Capped chunks")

        sleeps: list = []

        async def fake_sleep(seconds: float) -> None:
            sleeps.append(seconds)

        monkeypatch.setattr("asyncio.sleep", fake_sleep)
        await ec._pace_ongoing_campaign(db, campaign.id)

        assert sleeps == [2, 2, 1]


class TestCampaignWorkerLoop:
    """The loop's per-cycle decisions: an ongoing campaign is paced and
    continued without extra sleep; a settled one (completed, or canceled by
    a terminal-state race) and a nothing-due cycle idle-poll — that poll is
    the minimum gap between two campaigns' sends.

    The loop runs forever, so it is driven as a task: the cycle work
    (``process_next_campaign_email``) and the pacing are faked, and
    ``asyncio.sleep`` is recorded while yielding to the real event loop, so
    the task can be canceled once the scripted cycles are done. The ``db``
    fixture is unused — with the fakes in place the loop's session never
    issues a query.
    """

    async def test_ongoing_paced_settled_and_idle_polls(self, monkeypatch):
        monkeypatch.setattr(ec, "EMAIL_CAMPAIGN_IDLE_POLL_SECONDS", 10)
        monkeypatch.setattr(ec, "EMAIL_CAMPAIGN_INTERVAL_SECONDS", 30)

        ongoing = SimpleNamespace(id=1, status=EmailCampaignStatus.sending)
        settled = SimpleNamespace(id=2, status=EmailCampaignStatus.completed)
        # Canceled = a cancel that won the terminal race inside the delivery
        # step: the loop treats it like settled (no pacing, idle poll).
        canceled = SimpleNamespace(id=3, status=EmailCampaignStatus.canceled)
        scripted = [ongoing, settled, canceled, None]  # cycle 5 onward: nothing is due
        sleeps: list = []
        paced: list = []
        real_sleep = asyncio.sleep

        async def fake_process(db: Session):
            return scripted.pop(0) if scripted else None

        async def fake_pace(db: Session, campaign_id: int):
            paced.append(campaign_id)

        async def fake_sleep(seconds: float):
            sleeps.append(seconds)
            if len(sleeps) >= 4:  # the scripted cycles are done — stop the loop
                task.cancel()
            await real_sleep(0)

        monkeypatch.setattr(ec, "process_next_campaign_email", fake_process)
        monkeypatch.setattr(ec, "_pace_ongoing_campaign", fake_pace)
        monkeypatch.setattr("asyncio.sleep", fake_sleep)

        task = asyncio.create_task(ec.campaign_worker_loop())
        with pytest.raises(asyncio.CancelledError):
            await task

        # Cycle 1: ongoing campaign — paced, then continued without extra
        # sleep (the pacing is the same campaign's only wait).
        # Cycles 2-3: settled / canceled — the next cycle may start a
        # *different* campaign's first send, so the idle poll is the
        # minimum gap between two campaigns' sends.
        # Cycle 4: nothing due — the idle poll.
        assert paced == [1]
        assert sleeps == [0, 10, 10, 10]
