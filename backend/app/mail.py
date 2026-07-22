"""Email sending infrastructure via fastapi-mail (Gmail SMTP)."""

import asyncio
import logging
import os
from datetime import datetime
from urllib.parse import urlencode

import jwt
from fastapi_mail import ConnectionConfig, FastMail, MessageSchema

from app.auth import SECRET_KEY, ALGORITHM
from app.database import SessionLocal
from app.models import EmailPreference

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration (from environment)
# ---------------------------------------------------------------------------

MAIL_SERVER = os.environ.get("MAIL_SERVER", "smtp.gmail.com")
MAIL_PORT = int(os.environ.get("MAIL_PORT", "587"))
MAIL_USERNAME = os.environ.get("MAIL_USERNAME", "")
MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD", "")
MAIL_FROM = os.environ.get("MAIL_FROM", os.environ.get("MAIL_USERNAME", "no-reply@kindnessismagic.love"))
MAIL_FROM_NAME = os.environ.get("MAIL_FROM_NAME", "Kindness Is Magic")

# SUPPRESS_SEND defaults to DEBUG so emails are suppressed in dev.
# Override by setting SUPPRESS_SEND explicitly in .env.
# Tests set this independently — do not rely on DEBUG coupling.
_SUPPRESS_RAW = os.environ.get("SUPPRESS_SEND", os.environ.get("DEBUG", "false")).lower()
SUPPRESS_SEND: bool = _SUPPRESS_RAW in ("1", "true")

# ---------------------------------------------------------------------------
# Singleton MailManager
# ---------------------------------------------------------------------------

conf = ConnectionConfig(
    MAIL_SERVER=MAIL_SERVER,
    MAIL_PORT=MAIL_PORT,
    MAIL_USERNAME=MAIL_USERNAME,
    MAIL_PASSWORD=MAIL_PASSWORD,
    MAIL_FROM=MAIL_FROM,
    MAIL_FROM_NAME=MAIL_FROM_NAME,
    MAIL_STARTTLS=True,
    MAIL_SSL_TLS=False,
    USE_CREDENTIALS=True,
    VALIDATE_CERTS=True,
    SUPPRESS_SEND=SUPPRESS_SEND,
)

mail_manager: FastMail = FastMail(conf)


# ---------------------------------------------------------------------------
# Unsubscribe helpers
# ---------------------------------------------------------------------------


def _unsubscribe_url(email: str) -> str:
    """Generate a signed JWT token embedding the email (no expiry).

    Produces a URL like ``GET /api/auth/unsubscribe?token=...``.
    """
    token = jwt.encode({"email": email}, SECRET_KEY, algorithm=ALGORITHM)
    base = os.environ.get("APP_BASE_URL", "http://localhost:3000")
    path = "/api/auth/unsubscribe"
    params = urlencode({"token": token})
    return f"{base}{path}?{params}"


def check_unsubscribed(email: str) -> bool:
    """Query the preference table. Returns True if unsubscribed_at is not null."""
    db = SessionLocal()
    try:
        pref = db.query(EmailPreference).filter(EmailPreference.email == email.lower()).first()
        return pref is not None and pref.unsubscribed_at is not None
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Send email
# ---------------------------------------------------------------------------


def send_email(
    to: str,
    subject: str,
    html_body: str,
    exempt_unsubscribe: bool = False,
    include_unsubscribe_link: bool = True,
) -> dict:
    """Send an email via SMTP.

    * Checks unsubscribe unless ``exempt_unsubscribe=True``.
    * Wraps body with a branded header and optional unsubscribe footer.
    * SMTP failures are logged at ERROR level.
    * Returns ``{"sent": bool, "reason": str | None}``.
    """
    to_addr = to.lower()

    # Unsubscribe gate (skip for exempt emails like password resets)
    if not exempt_unsubscribe and check_unsubscribed(to_addr):
        logger.info("Email suppressed (unsubscribed): %s", to_addr)
        return {"sent": False, "reason": "unsubscribed"}

    # Build full HTML with branded header and optional unsubscribe footer
    unsubscribe_url = _unsubscribe_url(to_addr) if include_unsubscribe_link else None
    full_html = _wrap_email(html_body, unsubscribe_url)

    message = MessageSchema(
        subject=subject,
        recipients=[to_addr],
        body=full_html,
        subtype="html",
    )

    try:
        asyncio.run(mail_manager.send_message(message))
        logger.info("Email sent: to=%s subject=%s", to_addr, subject)
        return {"sent": True, "reason": None}
    except Exception as exc:  # noqa: BLE001
        logger.error("SMTP error sending email to %s: %s", to_addr, exc)
        return {"sent": False, "reason": "smtp_error"}


# ---------------------------------------------------------------------------
# HTML wrappers
# ---------------------------------------------------------------------------

_BRAND_COLOR = "#4c1d95"  # brand-dark (matches frontend palette)


def _wrap_email(body_html: str, unsubscribe_url: str | None) -> str:
    """Wrap body content with a branded header and optional unsubscribe footer."""
    header = f"""<div style="font-family:Arial,sans-serif;background-color:{_BRAND_COLOR};color:#ffffff;padding:16px 24px;text-align:center;">\n  <h1 style="margin:0;font-size:20px;">Kindness Is Magic</h1>\n</div>"""

    content = f"""<div style="font-family:Arial,sans-serif;padding:24px;color:#333333;">\n{body_html}\n</div>"""

    footer = ""
    if unsubscribe_url:
        footer = f"""<div style="font-family:Arial,sans-serif;padding:16px 24px;text-align:center;font-size:12px;color:#999999;border-top:1px solid #eeeeee;">\n  If you no longer wish to receive these emails, <a href="{unsubscribe_url}" style="color:#999999;">click here to unsubscribe</a>.\n</div>"""

    return f"""<html><body style="margin:0;padding:0;background-color:#f9f9f9;">\n<table style="max-width:600px;margin:0 auto;background-color:#ffffff;width:100%;border-collapse:collapse;" cellpadding="0" cellspacing="0">\n<tr><td>\n{header}\n{content}\n{footer}\n</td></tr>\n</table>\n</body></html>"""


# ---------------------------------------------------------------------------
# Template helpers
# ---------------------------------------------------------------------------


def build_invite_email(
    code: str,
    family_limit: int,
    expires_at: datetime,
    from_name: str | None = None,
    unsubscribe_url: str | None = None,
) -> str:
    """Build the HTML body for a referrer invite email."""
    expires_str = expires_at.strftime("%B %d, %Y at %I:%M %p UTC") if expires_at else "Not specified"
    base = os.environ.get("APP_BASE_URL", "http://localhost:3000")
    from_line = (
        f"<p>You've been invited by <strong>{from_name}</strong> to help make a difference with <strong>Kindness Is Magic</strong> ✨</p>"
        if from_name
        else "<p>You're invited to help make a difference with <strong>Kindness Is Magic</strong> ✨</p>"
    )
    family_word = "family" if family_limit == 1 else "families"
    return f"""{from_line}
<p>We'd love your help connecting {family_word} in need with the support and joy they deserve. Here's your unique invite code to get started:</p>
<p style="text-align:center;font-size:24px;font-weight:bold;letter-spacing:2px;padding:16px;background-color:#f0f4f0;border:1px dashed {_BRAND_COLOR};">{code}</p>
<p>As a referrer, you'll be able to connect up to <strong>{family_limit}</strong> {family_word}. They deserve the kindness they need most.</p>
<p>This invite expires on <strong>{expires_str}</strong>.</p>
<p style="text-align:center;"><a href="{base}/register-referrer" style="display:inline-block;padding:12px 24px;background-color:{_BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">Get Started</a></p>
<p style="margin-top:16px;">Thank you for being part of something wonderful. Together, we can make kindness magical.</p>"""


def build_password_reset_email(reset_link: str) -> str:
    """Build the HTML body for a password reset email."""
    return f"""<p>We received a request to reset your password for <strong>Kindness Is Magic</strong>.</p>
<p style="text-align:center;"><a href="{reset_link}" style="display:inline-block;padding:12px 24px;background-color:{_BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">Reset Password</a></p>
<p>If you didn't request this, you can safely ignore this email. Your password will not change.</p>
<p>This link expires in 24 hours.</p>"""


def build_family_pending_email(family_name: str, referrer_name: str) -> str:
    """Build the HTML body for a "new family pending approval" notification to the referrer."""
    base = os.environ.get("APP_BASE_URL", "http://localhost:3000")
    return f"""<p>Hi <strong>{referrer_name}</strong>,</p>
<p>A new family, <strong>{family_name}</strong>, has registered through your family invite code and is awaiting your approval.</p>
<p style="text-align:center;"><a href="{base}/referrer/pending-families" style="display:inline-block;padding:12px 24px;background-color:{_BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">Review Pending Families</a></p>
<p>They can start adding family members while they wait for your approval. You can approve or reject them from your dashboard.</p>"""


def build_family_approved_email(family_name: str, referrer_name: str) -> str:
    """Build the HTML body for a "family approved" notification to the family contact."""
    base = os.environ.get("APP_BASE_URL", "http://localhost:3000")
    return f"""<p>Great news, <strong>{family_name}</strong>!</p>
<p>Your family has been <strong>approved</strong> by <strong>{referrer_name}</strong> ✨ You're now fully connected on Kindness Is Magic.</p>
<p style="text-align:center;"><a href="{base}/family" style="display:inline-block;padding:12px 24px;background-color:{_BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">Go to Dashboard</a></p>"""
