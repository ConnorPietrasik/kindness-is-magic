"""Business logic constants.

Centralises limits and thresholds so they are defined in one place and
imported wherever needed.
"""

import os

# Base URL for the application (used in emails, CORS, redirect links)
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost")

# Maximum number of active persons a family can have (non-admin creation)
MAX_FAMILY_PERSONS = 10

# Maximum active gift-claims per user
GIFT_CLAIM_CAP = 5

# After a refresh token is rotated, how long (seconds) the pre-rotation token
# is still accepted. The browser cookie jar is shared across tabs, so two tabs
# can legitimately present the same refresh token at the same moment; the
# window lets the slower of the two complete its rotation instead of being
# logged out. Presentations outside the window are treated as replays (401).
REFRESH_ROTATION_GRACE_SECONDS = 60

# ---------------------------------------------------------------------------
# Cash sponsorship (Zeffy) pricing and payment window
#
# A cash sponsorship covers a family at a flat amount; the groceries add-on is
# an optional per-family boolean. All prices are USD — the org's Zeffy account
# is expected to charge USD (non-USD payments are never auto-applied).
# Prices are env-overridable (defaults below) — e.g. CASH_CLAIM_AMOUNT_USD=1
# for a live $1 test donation; the cart total (and thus the required payment
# amount) always derives from these.
# ---------------------------------------------------------------------------
CASH_CLAIM_AMOUNT_USD = int(os.environ.get("CASH_CLAIM_AMOUNT_USD", "500"))
CASH_CLAIM_GROCERIES_AMOUNT_USD = int(os.environ.get("CASH_CLAIM_GROCERIES_AMOUNT_USD", "100"))
# A pending cash claim expires (soft-deleted by the hourly sweep) this many
# hours after created_at. Expiry is derived, not stored.
CASH_CLAIM_PAYMENT_HOURS = 48
# The app's own donor-facing "payment confirmed" email, OFF by default:
# Zeffy already emails the donor a receipt/confirmation for the same payment,
# and a second "we received your payment" email tends to confuse (which one
# is the real one? was it double-charged?). Set to true to send it on top
# of Zeffy's receipt.
SEND_PAYMENT_CONFIRMED_EMAIL = os.environ.get("SEND_PAYMENT_CONFIRMED_EMAIL", "false").lower() in ("1", "true")

# ---------------------------------------------------------------------------
# Zeffy (https://zeffy.com) — cash sponsorship payments
#
# The shipped .env.example carries mock values pointing at the bundled
# `zeffy-mock` compose service (e2e/mock/zeffy_mock.py) so the full checkout
# flow works in local dev/e2e without touching the real API. For live use,
# replace them with real values from the Zeffy dashboard (Settings →
# Integrations) and remove ZEFFY_API_BASE — `run-compose.sh prod setup`
# refuses the committed mock values. With no key set, checkout/confirm/
# admin-page 503 (the "unconfigured" behavior) and the webhook 503s.
# ---------------------------------------------------------------------------
# Base URL of the Zeffy API. Defaults to the real API; the dev/e2e stack
# points it at the bundled `zeffy-mock` compose service so the full checkout
# flow is testable without ever touching the real (rate-limited) Zeffy API.
ZEFFY_API_BASE = os.environ.get("ZEFFY_API_BASE", "https://api.zeffy.com")
ZEFFY_API_KEY = os.environ.get("ZEFFY_API_KEY", "")
# Public URL of the org's dedicated sponsorship donation form (checkout
# redirect target). Donors enter the cart total manually — Zeffy forms
# don't accept an amount pre-fill parameter, so the exact amount is
# carried by the cart page and the "please pay" email instead. The URL
# only pre-fills the donor's email.
ZEFFY_FORM_URL = os.environ.get("ZEFFY_FORM_URL", "")
# UUID of the dedicated campaign the form belongs to — stable, no runtime
# lookup. Validated once per process via GET /campaigns/{id}.
ZEFFY_CAMPAIGN_ID = os.environ.get("ZEFFY_CAMPAIGN_ID", "")
# whsec_... webhook secret (Settings → Integrations → Webhook) used to verify
# the Zeffy-Signature header on POST /api/zeffy/webhook.
ZEFFY_WEBHOOK_SECRET = os.environ.get("ZEFFY_WEBHOOK_SECRET", "")

# ---------------------------------------------------------------------------
# Event deadline enforcement timing
#
# Pacific is treated as a *fixed* UTC-8 (no DST handling) — up to an hour of
# drift during PDT is explicitly accepted. An enforced deadline takes effect
# at 01:00 Pacific on the day AFTER the announced due date — an hour of
# deliberate slack past midnight for last-minute people (the announced
# deadline remains midnight). In code the cutoff is due_date + 1 day at
# 09:00 UTC, i.e. 01:00 at fixed UTC-8.
# ---------------------------------------------------------------------------
DEADLINE_PACIFIC_UTC_OFFSET_HOURS = -8
DEADLINE_ENFORCEMENT_HOUR_PACIFIC = 1
