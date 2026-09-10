"""Tests for admin-configurable deadlines.

Stage 1 — CRUD API, public list, auth guards, ordering.
Stage 2 — enforcement: armed checks, batch actions, gift-claim gate.
"""

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.deadlines import (
    GIFT_CLAIM_BLOCKED_DETAIL,
    auto_promote_families,
    auto_submit_families,
    deadline_cutoff,
    is_type_armed,
    run_deadline_checks,
)
from app.models import (
    Deadline,
    DeadlineMode,
    DeadlineType,
    Family,
    FamilyClaim,
    FamilyVerificationStatus,
    Referrer,
    ReferrerApprovalStatus,
    WishLockLevel,
)
from tests.conftest import login_as, make_family

ADMIN_EMAIL = "admin@test.com"
ADMIN_PASSWORD = "AdminPass123!"


def _admin_login(client: TestClient) -> dict:
    return login_as(client, ADMIN_EMAIL, ADMIN_PASSWORD)


def _referrer_login(client: TestClient) -> dict:
    return login_as(client, "referrer@test.com", "RefPass1234!")


def _create_deadline(client: TestClient, **overrides) -> dict:
    """Create a deadline row as the (already-logged-in) admin and return the body.

    ``None`` values are dropped from the payload so callers can test
    *omitted* fields (e.g. the ``mode`` default).
    """
    payload = {
        "type": "family_info",
        "label": "Family information",
        "due_date": "2026-12-15",
        "mode": "enforced",
    }
    payload.update(overrides)
    payload = {k: v for k, v in payload.items() if v is not None}
    resp = client.post("/api/admin/deadlines", json=payload)
    assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.json()}"
    return resp.json()


def _list_public(client: TestClient) -> list[dict]:
    resp = client.get("/api/deadlines")
    assert resp.status_code == 200
    return resp.json()["deadlines"]


def _list_admin(client: TestClient) -> list[dict]:
    resp = client.get("/api/admin/deadlines")
    assert resp.status_code == 200
    return resp.json()["deadlines"]


# =========================================================================
# Public list (unauthenticated)
# =========================================================================


class TestPublicList:
    def test_unauthenticated_200_empty(self, test_client: TestClient):
        resp = test_client.get("/api/deadlines")
        assert resp.status_code == 200
        assert resp.json() == {"deadlines": []}

    def test_rows_visible_without_auth(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        created = _create_deadline(test_client, label="Gift drop-off", type="gift_dropoff")

        # Drop the session cookies — the public endpoint must work unauthenticated.
        test_client.cookies.clear()
        rows = _list_public(test_client)
        assert len(rows) == 1
        row = rows[0]
        assert row["id"] == created["id"]
        assert row["type"] == "gift_dropoff"
        assert row["label"] == "Gift drop-off"
        assert row["due_date"] == "2026-12-15"
        assert row["mode"] == "enforced"
        assert "created_at" in row

    def test_public_and_admin_lists_agree(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        _create_deadline(test_client)
        _create_deadline(test_client, type="gift_dropoff", due_date=None)
        assert _list_public(test_client) == _list_admin(test_client)


# =========================================================================
# Create
# =========================================================================


class TestCreate:
    def test_create_201_all_fields(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        body = _create_deadline(test_client, label="Submit by Dec 15", due_date="2026-12-15", mode="enforced")
        assert body["type"] == "family_info"
        assert body["label"] == "Submit by Dec 15"
        assert body["due_date"] == "2026-12-15"
        assert body["mode"] == "enforced"
        assert body["id"] > 0
        assert "created_at" in body

    def test_create_default_mode_display(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        body = _create_deadline(test_client, mode=None)
        assert body["mode"] == "display"

    def test_create_undated(self, test_client: TestClient, admin_user):
        """Undated rows are allowed (create now, date later); they are inert."""
        _admin_login(test_client)
        body = _create_deadline(test_client, due_date=None)
        assert body["due_date"] is None
        assert body["mode"] == "enforced"

    def test_create_rejects_unknown_type(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/deadlines",
            json={"type": "holiday", "label": "Holiday", "due_date": "2026-12-15", "mode": "display"},
        )
        assert resp.status_code == 422

    def test_create_rejects_empty_label(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/deadlines",
            json={"type": "family_info", "label": "", "due_date": "2026-12-15", "mode": "display"},
        )
        assert resp.status_code == 422

    def test_create_rejects_invalid_date(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/deadlines",
            json={"type": "family_info", "label": "X", "due_date": "not-a-date", "mode": "display"},
        )
        assert resp.status_code == 422

    def test_create_collapses_whitespace_in_label(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        body = _create_deadline(test_client, label="  Spaced\tout  ")
        assert body["label"] == "Spaced out"

    def test_create_rejects_html_in_label(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.post(
            "/api/admin/deadlines",
            json={"type": "family_info", "label": "<b>Bold</b>", "due_date": "2026-12-15", "mode": "display"},
        )
        assert resp.status_code == 422


# =========================================================================
# Patch
# =========================================================================


class TestPatch:
    def test_update_label_date_mode(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        created = _create_deadline(test_client)
        resp = test_client.patch(
            f"/api/admin/deadlines/{created['id']}",
            json={"label": "New label", "due_date": "2027-01-05", "mode": "display"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["label"] == "New label"
        assert body["due_date"] == "2027-01-05"
        assert body["mode"] == "display"
        assert body["type"] == "family_info"  # type is not updatable

    def test_clear_date_with_empty_string(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        created = _create_deadline(test_client)
        assert created["due_date"] is not None
        resp = test_client.patch(f"/api/admin/deadlines/{created['id']}", json={"due_date": ""})
        assert resp.status_code == 200
        assert resp.json()["due_date"] is None

    def test_null_fields_are_noops(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        created = _create_deadline(test_client)
        resp = test_client.patch(
            f"/api/admin/deadlines/{created['id']}",
            json={"label": None, "due_date": None, "mode": None},
        )
        assert resp.status_code == 200
        assert resp.json() == created

    def test_rejects_empty_label(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        created = _create_deadline(test_client)
        resp = test_client.patch(f"/api/admin/deadlines/{created['id']}", json={"label": ""})
        assert resp.status_code == 422

    def test_rejects_invalid_date(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        created = _create_deadline(test_client)
        resp = test_client.patch(f"/api/admin/deadlines/{created['id']}", json={"due_date": "2026-13-45"})
        assert resp.status_code == 422

    def test_404_missing_id(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.patch("/api/admin/deadlines/9999", json={"label": "Ghost"})
        assert resp.status_code == 404


# =========================================================================
# Delete
# =========================================================================


class TestDelete:
    def test_delete_204_then_absent_from_both_lists(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        created = _create_deadline(test_client)
        assert len(_list_public(test_client)) == 1

        resp = test_client.delete(f"/api/admin/deadlines/{created['id']}")
        assert resp.status_code == 204

        assert _list_public(test_client) == []
        assert _list_admin(test_client) == []

    def test_delete_404_missing_id(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        resp = test_client.delete("/api/admin/deadlines/9999")
        assert resp.status_code == 404


# =========================================================================
# Ordering
# =========================================================================


class TestOrdering:
    def test_type_then_due_date_asc_nulls_last_then_id(self, test_client: TestClient, admin_user):
        _admin_login(test_client)
        _create_deadline(test_client, type="gift_dropoff", label="G early", due_date="2026-12-01")
        _create_deadline(test_client, type="family_info", label="F late", due_date="2026-12-15")
        _create_deadline(test_client, type="family_info", label="F undated", due_date=None)
        _create_deadline(test_client, type="referrer_review", label="R", due_date="2026-12-10")
        _create_deadline(test_client, type="family_info", label="F early", due_date="2026-12-01")
        _create_deadline(test_client, type="family_info", label="F early 2", due_date="2026-12-01")

        rows = _list_public(test_client)
        # Types are grouped in enum declaration order (family_info,
        # referrer_review, gift_dropoff — the pipeline order), then by due
        # date ascending with NULLs last, then id.
        assert [(r["type"], r["due_date"], r["label"]) for r in rows] == [
            ("family_info", "2026-12-01", "F early"),
            ("family_info", "2026-12-01", "F early 2"),
            ("family_info", "2026-12-15", "F late"),
            ("family_info", None, "F undated"),
            ("referrer_review", "2026-12-10", "R"),
            ("gift_dropoff", "2026-12-01", "G early"),
        ]


# =========================================================================
# Auth guards
# =========================================================================


class TestAuth:
    def test_unauthenticated_admin_get_401(self, test_client: TestClient, admin_user):
        resp = test_client.get("/api/admin/deadlines")
        assert resp.status_code == 401

    @pytest.mark.parametrize(
        "method, path, body",
        [
            ("get", "/api/admin/deadlines", None),
            ("post", "/api/admin/deadlines", {"type": "family_info", "label": "X", "due_date": "2026-12-15", "mode": "display"}),
            ("patch", "/api/admin/deadlines/1", {"label": "X"}),
            ("delete", "/api/admin/deadlines/1", None),
        ],
    )
    def test_non_admin_403_on_all_endpoints(self, test_client: TestClient, referrer_user, method: str, path: str, body: dict):
        """Non-admin users get 403 on every admin deadline endpoint."""
        _referrer_login(test_client)
        resp = test_client.request(method, path, json=body)
        assert resp.status_code == 403


# =========================================================================
# Armed check (unit — no scheduler, no HTTP)
# =========================================================================

PAST_DUE = "2020-01-01"
FUTURE_DUE = "2099-01-01"


def _seed_deadline(db: Session, dl_type: DeadlineType, mode: DeadlineMode, due_date: str | None = None) -> Deadline:
    dl = Deadline(
        type=dl_type,
        label=dl_type.value,
        due_date=date.fromisoformat(due_date) if due_date else None,
        mode=mode,
    )
    db.add(dl)
    db.commit()
    db.refresh(dl)
    return dl


class TestArmedCheck:
    def test_cutoff_is_0900_utc_day_after_due_date(self):
        """Cutoff is 01:00 Pacific (fixed UTC-8) on due_date + 1 day == 09:00 UTC."""
        assert deadline_cutoff(date(2026, 12, 15)) == datetime(2026, 12, 16, 9, 0, tzinfo=timezone.utc)

    def test_armed_by_past_enforced_row(self, db: Session):
        _seed_deadline(db, DeadlineType.family_info, DeadlineMode.enforced, PAST_DUE)
        assert is_type_armed(db, DeadlineType.family_info) is True

    def test_not_armed_before_cutoff(self, db: Session):
        """The due date stays in effect through all of D; enforcement starts 01:00 Pacific on D+1."""
        due = date(2026, 12, 15)
        _seed_deadline(db, DeadlineType.family_info, DeadlineMode.enforced, due.isoformat())
        d16 = due + timedelta(days=1)
        assert is_type_armed(db, DeadlineType.family_info, now=datetime(2026, 12, 15, 23, 59, tzinfo=timezone.utc)) is False
        assert is_type_armed(db, DeadlineType.family_info, now=datetime(d16.year, d16.month, d16.day, 8, 59, tzinfo=timezone.utc)) is False
        assert is_type_armed(db, DeadlineType.family_info, now=datetime(d16.year, d16.month, d16.day, 9, 0, tzinfo=timezone.utc)) is True

    def test_not_armed_by_future_enforced_row(self, db: Session):
        _seed_deadline(db, DeadlineType.family_info, DeadlineMode.enforced, FUTURE_DUE)
        assert is_type_armed(db, DeadlineType.family_info) is False

    @pytest.mark.parametrize("mode", [DeadlineMode.display, DeadlineMode.remind])
    def test_not_armed_by_display_or_remind_rows(self, db: Session, mode: DeadlineMode):
        _seed_deadline(db, DeadlineType.gift_dropoff, mode, PAST_DUE)
        assert is_type_armed(db, DeadlineType.gift_dropoff) is False

    def test_not_armed_by_undated_enforced_row(self, db: Session):
        _seed_deadline(db, DeadlineType.gift_dropoff, DeadlineMode.enforced, None)
        assert is_type_armed(db, DeadlineType.gift_dropoff) is False

    def test_types_are_independent(self, db: Session):
        _seed_deadline(db, DeadlineType.family_info, DeadlineMode.enforced, PAST_DUE)
        assert is_type_armed(db, DeadlineType.referrer_review) is False
        assert is_type_armed(db, DeadlineType.gift_dropoff) is False

    def test_multiple_enforced_rows_arm_on_first_to_pass(self, db: Session):
        _seed_deadline(db, DeadlineType.referrer_review, DeadlineMode.enforced, PAST_DUE)
        _seed_deadline(db, DeadlineType.referrer_review, DeadlineMode.enforced, FUTURE_DUE)
        assert is_type_armed(db, DeadlineType.referrer_review) is True


# =========================================================================
# Batch actions (direct — no scheduler waits)
# =========================================================================


def _wf_family(db: Session, name: str = "Batch Family", **kwargs) -> Family:
    """Create a verified family in a given wish-workflow state."""
    kwargs.setdefault("contact_name", "Batch Contact")
    kwargs.setdefault("phone_number", "555-000-0000")
    kwargs.setdefault("verification_status", FamilyVerificationStatus.verified)
    fam = make_family(db, family_name=name, family_wish="A warm coat", **kwargs)
    db.commit()
    db.refresh(fam)
    return fam


class TestAutoSubmit:
    def test_submits_family_locked_families_without_pending_request(self, db: Session):
        """lock=family with no pending request gets requested_at (referrer queue).

        Includes families with an open rejection reason and does not clear
        the reason (a forced escalation must not claim \"fixed\").
        """
        _seed_deadline(db, DeadlineType.family_info, DeadlineMode.enforced, PAST_DUE)
        plain = _wf_family(db, "Plain")
        with_reason = _wf_family(db, "Flagged", wish_rejection_reason="Needs a photo")
        # Must NOT be touched: pending request, referrer lock, admin lock, soft-deleted
        pending = _wf_family(db, "Pending", wish_review_requested_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
        at_referrer = _wf_family(
            db, "AtReferrer", wish_lock_level=WishLockLevel.referrer, wish_review_requested_at=datetime(2026, 1, 1, tzinfo=timezone.utc)
        )
        at_admin = _wf_family(db, "AtAdmin", wish_lock_level=WishLockLevel.admin)
        soft_deleted = _wf_family(db, "Deleted", deleted_at=datetime.now(timezone.utc))

        applied = run_deadline_checks(db)

        assert applied == {DeadlineType.family_info: 2}
        db.refresh(plain)
        db.refresh(with_reason)
        db.refresh(pending)
        db.refresh(at_referrer)
        db.refresh(at_admin)
        db.refresh(soft_deleted)

        assert plain.wish_review_requested_at is not None
        assert plain.wish_lock_level == WishLockLevel.family
        assert with_reason.wish_review_requested_at is not None
        assert with_reason.wish_rejection_reason == "Needs a photo"  # reason rides along
        assert pending.wish_review_requested_at == datetime(2026, 1, 1, tzinfo=timezone.utc)  # untouched
        assert at_referrer.wish_lock_level == WishLockLevel.referrer  # untouched
        assert at_admin.wish_lock_level == WishLockLevel.admin  # untouched
        assert soft_deleted.wish_review_requested_at is None  # untouched

    def test_idempotent_second_run_is_noop(self, db: Session):
        _seed_deadline(db, DeadlineType.family_info, DeadlineMode.enforced, PAST_DUE)
        fam = _wf_family(db, "Once")

        first = run_deadline_checks(db)
        db.refresh(fam)
        submitted_at = fam.wish_review_requested_at
        assert first == {DeadlineType.family_info: 1}
        assert submitted_at is not None

        second = run_deadline_checks(db)
        db.refresh(fam)
        # Acted-on family left the match set — nothing to do.
        assert second == {DeadlineType.family_info: 0}
        assert fam.wish_review_requested_at == submitted_at

    def test_no_armed_type_no_changes(self, db: Session):
        _seed_deadline(db, DeadlineType.family_info, DeadlineMode.display, PAST_DUE)
        _seed_deadline(db, DeadlineType.referrer_review, DeadlineMode.enforced, FUTURE_DUE)
        fam = _wf_family(db, "Untouched")

        assert run_deadline_checks(db) == {}
        db.refresh(fam)
        assert fam.wish_review_requested_at is None


class TestAutoPromote:
    def test_promotes_family_locked_families_with_pending_request(self, db: Session):
        """lock=family with a pending request gets lock=referrer (admin queue).

        Does not clear the rejection reason and does not bump requested_at
        (admin queue keeps FIFO).
        """
        _seed_deadline(db, DeadlineType.referrer_review, DeadlineMode.enforced, PAST_DUE)
        requested_at = datetime(2026, 2, 1, 12, 0, tzinfo=timezone.utc)
        to_promote = _wf_family(db, "Ready", wish_review_requested_at=requested_at, wish_rejection_reason="Old flag")
        # Must NOT be touched: no pending request, admin-rejected (referrer lock, no request), admin lock
        not_submitted = _wf_family(db, "NotSubmitted")
        admin_rejected = _wf_family(db, "AdminRejected", wish_lock_level=WishLockLevel.referrer, wish_rejection_reason="Bad list")
        at_admin = _wf_family(db, "AtAdmin", wish_lock_level=WishLockLevel.admin)

        applied = run_deadline_checks(db)

        assert applied == {DeadlineType.referrer_review: 1}
        db.refresh(to_promote)
        db.refresh(not_submitted)
        db.refresh(admin_rejected)
        db.refresh(at_admin)

        assert to_promote.wish_lock_level == WishLockLevel.referrer
        assert to_promote.wish_review_requested_at == requested_at  # not bumped
        assert to_promote.wish_rejection_reason == "Old flag"  # not cleared
        assert not_submitted.wish_lock_level == WishLockLevel.family  # untouched
        assert admin_rejected.wish_lock_level == WishLockLevel.referrer  # untouched
        assert admin_rejected.wish_review_requested_at is None  # untouched
        assert at_admin.wish_lock_level == WishLockLevel.admin  # untouched

    def test_idempotent_second_run_is_noop(self, db: Session):
        _seed_deadline(db, DeadlineType.referrer_review, DeadlineMode.enforced, PAST_DUE)
        requested_at = datetime(2026, 2, 1, 12, 0, tzinfo=timezone.utc)
        fam = _wf_family(db, "Promoted", wish_review_requested_at=requested_at)

        assert run_deadline_checks(db) == {DeadlineType.referrer_review: 1}
        second = run_deadline_checks(db)
        db.refresh(fam)
        assert second == {DeadlineType.referrer_review: 0}
        assert fam.wish_lock_level == WishLockLevel.referrer
        assert fam.wish_review_requested_at == requested_at

    def test_batch_functions_only_act_on_their_own_match_set(self, db: Session):
        """Calling the batches directly (no deadlines at all): each matches its own stage only."""
        to_submit = _wf_family(db, "ToSubmit")
        to_promote = _wf_family(db, "ToPromote", wish_review_requested_at=datetime(2026, 3, 1, tzinfo=timezone.utc))

        assert auto_submit_families(db) == 1
        assert auto_promote_families(db) == 1
        db.commit()
        db.refresh(to_submit)
        db.refresh(to_promote)
        assert to_submit.wish_lock_level == WishLockLevel.family
        assert to_submit.wish_review_requested_at is not None
        assert to_promote.wish_lock_level == WishLockLevel.referrer


# =========================================================================
# Gift-claim gate (request-time evaluation, via the claim endpoint)
# =========================================================================


def _create_claimable_family(db: Session, name: str = "Claimable Family") -> Family:
    """Verified, admin-locked family — fully claimable."""
    fam = _wf_family(db, name, wish_lock_level=WishLockLevel.admin)
    return fam


def _create_user(client: TestClient, email: str, role: str) -> None:
    resp = client.post("/api/admin/users", json={"email": email, "password": "RolePass1234!", "role": role})
    assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.json()}"


ROLE_PASSWORD = "RolePass1234!"


class TestGiftClaimGate:
    def test_past_dated_enforced_row_blocks_gift_claims_immediately(self, test_client: TestClient, db: Session, admin_user):
        """The gate is request-time: a past-dated enforced gift_dropoff row created
        through the admin API blocks the next gift claim with the deadline 400
        message, with no daily-task run in between (the task is disabled via
        DISABLE_BACKGROUND_TASKS in tests).
        """
        _admin_login(test_client)
        fam = _create_claimable_family(db)
        _create_deadline(test_client, type="gift_dropoff", label="Gift drop-off", due_date=PAST_DUE, mode="enforced")

        resp = test_client.post(f"/api/families/{fam.id}/claim", json={"commitment_type": "gifts"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == GIFT_CLAIM_BLOCKED_DETAIL

        # No claim was created by the blocked attempt.
        claim = db.query(FamilyClaim).filter(FamilyClaim.family_id == fam.id).first()
        assert claim is None

    @pytest.mark.parametrize("role", ["donor", "referrer", "purchaser", "admin"])
    def test_blocks_every_claim_capable_role(self, test_client: TestClient, db: Session, admin_user, role: str):
        """The gate is a business rule, not a permission — admin included."""
        _admin_login(test_client)
        fam = _create_claimable_family(db)
        _create_deadline(test_client, type="gift_dropoff", label="Gift drop-off", due_date=PAST_DUE, mode="enforced")

        if role == "admin":
            # The bootstrap admin user already exists (admin_user fixture).
            pass
        elif role == "referrer":
            # Referrer users must reference a Referrer record.
            ref = Referrer(
                name="Gate Referrer",
                family_limit=5,
                phone_number="555-300-3000",
                family_invite_code="KFI-GATE01",
                approval_status=ReferrerApprovalStatus.approved,
            )
            db.add(ref)
            db.commit()
            db.refresh(ref)
            resp = test_client.post(
                "/api/admin/users",
                json={"email": f"{role}@test.com", "password": ROLE_PASSWORD, "role": role, "referrer_id": ref.id},
            )
            assert resp.status_code == 201, resp.json()
        else:
            _create_user(test_client, f"{role}@test.com", role)

        if role != "admin":
            login_as(test_client, f"{role}@test.com", ROLE_PASSWORD)

        resp = test_client.post(f"/api/families/{fam.id}/claim", json={"commitment_type": "gifts"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == GIFT_CLAIM_BLOCKED_DETAIL

    def test_cash_claims_allowed_while_armed(self, test_client: TestClient, db: Session, admin_user):
        _admin_login(test_client)
        fam = _create_claimable_family(db)
        _create_deadline(test_client, type="gift_dropoff", label="Gift drop-off", due_date=PAST_DUE, mode="enforced")
        _create_user(test_client, "cashdonor@test.com", "donor")
        login_as(test_client, "cashdonor@test.com", ROLE_PASSWORD)

        resp = test_client.post(f"/api/families/{fam.id}/claim", json={"commitment_type": "cash"})
        assert resp.status_code == 201

    def test_deleting_the_row_unblocks_the_claim(self, test_client: TestClient, db: Session, admin_user):
        _admin_login(test_client)
        fam = _create_claimable_family(db)
        created = _create_deadline(test_client, type="gift_dropoff", label="Gift drop-off", due_date=PAST_DUE, mode="enforced")

        resp = test_client.post(f"/api/families/{fam.id}/claim", json={"commitment_type": "gifts"})
        assert resp.status_code == 400

        resp = test_client.delete(f"/api/admin/deadlines/{created['id']}")
        assert resp.status_code == 204

        # Admin (claim-capable) can now claim the same family.
        resp = test_client.post(f"/api/families/{fam.id}/claim", json={"commitment_type": "gifts"})
        assert resp.status_code == 201
        assert resp.json()["commitment_type"] == "gifts"

    def test_display_and_remind_rows_do_not_block(self, test_client: TestClient, db: Session, admin_user):
        _admin_login(test_client)
        fam = _create_claimable_family(db)
        _create_deadline(test_client, type="gift_dropoff", label="Display", due_date=PAST_DUE, mode="display")
        _create_deadline(test_client, type="gift_dropoff", label="Remind", due_date=PAST_DUE, mode="remind")
        _create_user(test_client, "freeclaim@test.com", "donor")
        login_as(test_client, "freeclaim@test.com", ROLE_PASSWORD)

        resp = test_client.post(f"/api/families/{fam.id}/claim", json={"commitment_type": "gifts"})
        assert resp.status_code == 201

    def test_future_enforced_row_does_not_block(self, test_client: TestClient, db: Session, admin_user):
        _admin_login(test_client)
        fam = _create_claimable_family(db)
        _create_deadline(test_client, type="gift_dropoff", label="Future", due_date=FUTURE_DUE, mode="enforced")
        _create_user(test_client, "futureclaim@test.com", "donor")
        login_as(test_client, "futureclaim@test.com", ROLE_PASSWORD)

        resp = test_client.post(f"/api/families/{fam.id}/claim", json={"commitment_type": "gifts"})
        assert resp.status_code == 201

    def test_remoding_to_enforced_past_date_blocks_immediately(self, test_client: TestClient, db: Session, admin_user):
        """Armed-ness is request-time: a display/future row PATCHed to enforced + past date
        blocks the next gift claim with no task run in between."""
        _admin_login(test_client)
        fam = _create_claimable_family(db)
        created = _create_deadline(test_client, type="gift_dropoff", label="Gift drop-off", due_date=FUTURE_DUE, mode="display")
        _create_user(test_client, "remode@test.com", "donor")
        login_as(test_client, "remode@test.com", ROLE_PASSWORD)

        resp = test_client.post(f"/api/families/{fam.id}/claim", json={"commitment_type": "gifts"})
        assert resp.status_code == 201

        # Admin re-modes the row (display → enforced) and back-dates it.
        _admin_login(test_client)
        resp = test_client.patch(f"/api/admin/deadlines/{created['id']}", json={"mode": "enforced", "due_date": PAST_DUE})
        assert resp.status_code == 200

        login_as(test_client, "remode@test.com", ROLE_PASSWORD)
        resp = test_client.post(f"/api/families/{fam.id}/claim", json={"commitment_type": "gifts"})
        # The family is now already claimed by the first (allowed) attempt,
        # so the gate's 400 precedes the 409 — both prove the row arms.
        assert resp.status_code == 400
        assert resp.json()["detail"] == GIFT_CLAIM_BLOCKED_DETAIL
