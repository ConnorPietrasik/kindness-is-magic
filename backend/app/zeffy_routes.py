"""Zeffy public endpoints: the payment webhook.

The webhook is the **primary automatic apply path** — the donor keeps their
cart open and Zeffy delivers ``payment.completed`` the moment payment lands.
Admin-facing Zeffy endpoints (manual match / unmatch) live in
``admin_zeffy.py``.
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import FamilyClaim, User
from app.payments import apply_payment_to_claims, cart_window_anchor, claims_total_usd, pending_cash_claims_for
import app.zeffy as zeffy

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/zeffy", tags=["zeffy"])


@router.post("/webhook")
async def zeffy_webhook(
    request: Request,
    db: Session = Depends(get_db),
):
    """Zeffy payment webhook.

    Verifies the signature on the **raw** body (HMAC-SHA256 of ``{t}.
    {rawBody}`` under the ``whsec_`` secret, constant-time compare, 5-minute
    replay window). 2xx acks every processed delivery — Zeffy retries
    non-2xx up to 5 times, and a duplicate delivery is handled by the apply
    path's idempotency (already-applied payment → no-op, no re-email).

    Business-level ignores (other event type, other campaign/status, unknown
    donor, empty cart, non-exact amount) log + 200: the donor-initiated
    payment flow and the admin unmatched list are the backstops.

    503 when the webhook secret is unset; 400 on signature failure (a 500
    would have Zeffy retrying a broken signature forever).
    """
    if not zeffy.ZEFFY_WEBHOOK_SECRET:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Zeffy webhook is not configured")

    raw = await request.body()
    parsed = zeffy.parse_webhook_signature(request.headers.get("Zeffy-Signature"))
    if parsed is None:
        logger.warning("Zeffy webhook rejected: missing or malformed Zeffy-Signature header")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid signature")
    t, v1 = parsed
    if not zeffy.webhook_timestamp_is_fresh(t):
        logger.warning("Zeffy webhook rejected: timestamp outside the replay window (t=%s)", t)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stale signature")
    if not zeffy.verify_webhook_signature(t, v1, raw):
        logger.warning("Zeffy webhook rejected: signature mismatch")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid signature")

    try:
        envelope = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON body")

    if envelope.get("type") != "payment.completed":
        logger.info("Zeffy webhook: ignoring event type %s", envelope.get("type"))
        return {"status": "ignored"}

    data = envelope.get("data") or {}
    if data.get("status") != "succeeded":
        logger.info("Zeffy webhook: payment %s status %s — ignoring", data.get("id"), data.get("status"))
        return {"status": "ignored"}
    if zeffy.ZEFFY_CAMPAIGN_ID and data.get("campaign_id") != zeffy.ZEFFY_CAMPAIGN_ID:
        logger.info(
            "Zeffy webhook: payment %s is on campaign %s (dedicated campaign is %s) — ignoring",
            data.get("id"),
            data.get("campaign_id"),
            zeffy.ZEFFY_CAMPAIGN_ID,
        )
        return {"status": "ignored"}

    payment = zeffy.parse_payment(data)

    # Duplicate delivery (Zeffy retries non-2xx up to 5 times; our acks are
    # 2xx, but a retry can still race an apply): the payment id is already
    # stored → explicit idempotent ack, no business checks, no re-email.
    already = db.query(FamilyClaim.id).filter(FamilyClaim.zeffy_payment_id == payment.id, FamilyClaim.deleted_at.is_(None)).first()
    if already is not None:
        logger.info("Zeffy webhook: payment %s already stored on a claim — ack no-op", payment.id)
        return {"status": "already-applied"}

    buyer_email = payment.buyer.email if payment.buyer is not None else None
    if not buyer_email:
        logger.info("Zeffy webhook: payment %s has no buyer email — ignoring (admin manual match is the backstop)", payment.id)
        return {"status": "ignored"}

    donor = db.query(User).filter(func.lower(User.email) == buyer_email.strip().lower(), User.deleted_at.is_(None)).first()
    if donor is None:
        logger.info("Zeffy webhook: buyer %s has no account — ignoring (admin manual match is the backstop)", buyer_email)
        return {"status": "ignored"}

    claims = pending_cash_claims_for(db, donor.id)
    if not claims:
        logger.info("Zeffy webhook: %s has no pending cart — ignoring (admin manual match is the backstop)", buyer_email)
        return {"status": "ignored"}

    total_cents = claims_total_usd(claims) * 100
    anchor = cart_window_anchor(claims)
    if payment.currency != "usd" or payment.amount != total_cents or anchor is None or payment.created < int(anchor.timestamp()):
        logger.info(
            "Zeffy webhook: payment %s (%s %s, created %s) doesn't exactly match %s's cart ($%s) — ignoring (admin manual match is the backstop)",
            payment.id,
            payment.amount // 100,
            payment.currency,
            payment.created,
            buyer_email,
            total_cents // 100,
        )
        return {"status": "ignored"}

    applied = await apply_payment_to_claims(db, claims, payment)
    if applied:
        logger.info("Zeffy webhook: applied payment %s to claims %s", payment.id, [c.id for c in claims])
        return {"status": "applied"}
    logger.info("Zeffy webhook: payment %s already applied — ack no-op", payment.id)
    return {"status": "already-applied"}
