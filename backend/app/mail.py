"""Email sending infrastructure via fastapi-mail (Gmail SMTP)."""

import logging
import os
from datetime import datetime
from urllib.parse import urlencode

import jwt
from fastapi_mail import ConnectionConfig, FastMail, MessageSchema
from sqlalchemy.orm import Session

from app.auth import SECRET_KEY, ALGORITHM
from app.config import APP_BASE_URL
from app.display_ids import compute_display_ids
from app.models import (
    EmailKind,
    EmailPreference,
    EmailStatus,
    Family,
    FamilyClaim,
    Person,
    SentEmail,
    User,
)
from app.response_builders import batch_load_family_wishes, batch_load_person_wishes

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration (from environment)
# ---------------------------------------------------------------------------

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")

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
    base = APP_BASE_URL
    path = "/api/auth/unsubscribe"
    params = urlencode({"token": token})
    return f"{base}{path}?{params}"


def check_unsubscribed(email: str, db: Session) -> bool:
    """Query the preference table. Returns True if unsubscribed_at is not null."""
    pref = db.query(EmailPreference).filter(EmailPreference.email == email.lower()).first()
    return pref is not None and pref.unsubscribed_at is not None


# ---------------------------------------------------------------------------
# Send email
# ---------------------------------------------------------------------------


def _record_sent_email(
    db: Session,
    to_addr: str,
    kind: EmailKind,
    user_id: int | None,
    status: EmailStatus,
    failure_reason: str | None,
) -> None:
    """Insert + commit one ``SentEmail`` row for a send attempt.

    Exception to the "no ``commit()`` in helper functions" rule: ``send_email``
    owns the send outcome, and the log row must persist independently of the
    caller's transaction (e.g. a failed send that the route turns into a 500).
    """
    db.add(SentEmail(user_id=user_id, recipient_email=to_addr, kind=kind, status=status, failure_reason=failure_reason))
    db.commit()


async def send_email(
    to: str,
    subject: str,
    html_body: str,
    db: Session,
    kind: EmailKind,
    user_id: int | None = None,
    exempt_unsubscribe: bool = False,
    include_unsubscribe_link: bool = True,
) -> dict:
    """Send an email via SMTP.

    * Checks unsubscribe unless ``exempt_unsubscribe=True``.
    * Wraps body with a branded header and optional unsubscribe footer.
    * Records one ``SentEmail`` log row per attempt (``user_id`` is the actor
      whose action triggered the send, NULL when unauthenticated).
    * SMTP failures are logged at ERROR level.
    * Returns ``{"sent": bool, "reason": str | None}``.
    """
    to_addr = to.lower()

    # Unsubscribe gate (skip for exempt emails like password resets)
    if not exempt_unsubscribe and check_unsubscribed(to_addr, db):
        logger.info("Email suppressed (unsubscribed): %s", to_addr)
        _record_sent_email(db, to_addr, kind, user_id, EmailStatus.failed, "unsubscribed")
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
        await mail_manager.send_message(message)
        logger.info("Email sent: to=%s subject=%s", to_addr, subject)
        _record_sent_email(db, to_addr, kind, user_id, EmailStatus.sent, None)
        return {"sent": True, "reason": None}
    except Exception as exc:  # noqa: BLE001
        logger.error("SMTP error sending email to %s: %s", to_addr, exc)
        _record_sent_email(db, to_addr, kind, user_id, EmailStatus.failed, "smtp_error")
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
    email: str | None = None,
) -> str:
    """Build the HTML body for a referrer invite email."""
    expires_str = expires_at.strftime("%B %d, %Y at %I:%M %p UTC") if expires_at else "Not specified"
    base = APP_BASE_URL
    from_line = (
        f"<p>You've been invited by <strong>{from_name}</strong> to help make a difference with <strong>Kindness Is Magic</strong> ✨</p>"
        if from_name
        else "<p>You're invited to help make a difference with <strong>Kindness Is Magic</strong> ✨</p>"
    )
    family_word = "family" if family_limit == 1 else "families"
    # Build the register link — include email query param when locked
    register_path = "/register-referrer"
    email_locked_note = ""
    if email:
        register_path += f"?{urlencode({'code': code, 'email': email})}"
        email_locked_note = f'<p style="font-size:14px;color:#666666;">This invite is locked to <strong>{email}</strong>. You\'ll register using this email address.</p>'
    return f"""{from_line}
<p>We'd love your help connecting {family_word} in need with the support and joy they deserve. Here's your unique invite code to get started:</p>
<p style="text-align:center;font-size:24px;font-weight:bold;letter-spacing:2px;padding:16px;background-color:#f0f4f0;border:1px dashed {_BRAND_COLOR};">{code}</p>
{email_locked_note}
<p>As a referrer, you'll be able to connect up to <strong>{family_limit}</strong> {family_word}. They deserve the kindness they need most.</p>
<p>This invite expires on <strong>{expires_str}</strong>.</p>
<p style="text-align:center;"><a href="{base}{register_path}" style="display:inline-block;padding:12px 24px;background-color:{_BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">Get Started</a></p>
<p style="margin-top:16px;">Thank you for being part of something wonderful. Together, we can make kindness magical.</p>"""


def build_password_reset_email(reset_link: str) -> str:
    """Build the HTML body for a password reset email."""
    return f"""<p>We received a request to reset your password for <strong>Kindness Is Magic</strong>.</p>
<p style="text-align:center;"><a href="{reset_link}" style="display:inline-block;padding:12px 24px;background-color:{_BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">Reset Password</a></p>
<p>If you didn't request this, you can safely ignore this email. Your password will not change.</p>
<p>This link expires in 24 hours.</p>"""


def build_family_pending_email(family_name: str, referrer_name: str) -> str:
    """Build the HTML body for a "new family pending verification" notification to the referrer."""
    base = APP_BASE_URL
    return f"""<p>Hi <strong>{referrer_name}</strong>,</p>
<p>A new family, <strong>{family_name}</strong>, has registered using your family invite code. Please confirm this is a family you intended to refer.</p>
<p style="text-align:center;"><a href="{base}/referrer/pending-families" style="display:inline-block;padding:12px 24px;background-color:{_BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">Verify Pending Families</a></p>
<p>They can start adding family members while they wait for your confirmation. You can confirm or reject them from your dashboard.</p>"""


def build_family_verified_email(family_name: str, referrer_name: str) -> str:
    """Build the HTML body for a "family verified" notification to the family contact."""
    base = APP_BASE_URL
    return f"""<p>Great news, <strong>{family_name}</strong>!</p>
<p>Your family has been <strong>confirmed</strong> by <strong>{referrer_name}</strong> ✨ You're now fully connected on Kindness Is Magic.</p>
<p style="text-align:center;"><a href="{base}/family" style="display:inline-block;padding:12px 24px;background-color:{_BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">Go to Dashboard</a></p>"""


def build_family_rejected_email(family_name: str, referrer_name: str) -> str:
    """Build the HTML body for a "family rejected by referrer" notification to the family contact."""
    return f"""<p>Hi <strong>{family_name}</strong>,</p>
<p><strong>{referrer_name}</strong> did not recognize you, so your family has not been confirmed on Kindness Is Magic.</p>
<p>If you believe this was a mistake, please contact <strong>{referrer_name}</strong> to sort it out.</p>"""


def build_family_invite_email(code: str, referrer_name: str, email: str) -> str:
    """Build the HTML body for a family invite email sent by a referrer."""
    base = APP_BASE_URL
    register_path = f"{base}/register-family?{urlencode({'code': code, 'email': email})}"
    return f"""<p>Hi there,</p>
<p>This is an invitation to join <strong>Kindness Is Magic</strong>, a program where supporters give holiday gifts to families. <strong>{referrer_name}</strong> has invited your family to take part.</p>
<p>Use the invite code below to register:</p>
<p style="text-align:center;font-size:24px;font-weight:bold;letter-spacing:2px;padding:16px;background-color:#f0f4f0;border:1px dashed {_BRAND_COLOR};">{code}</p>
<p style="text-align:center;"><a href="{register_path}" style="display:inline-block;padding:12px 24px;background-color:{_BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">Get Started</a></p>"""


def build_referrer_approved_email(referrer_name: str) -> str:
    """Build the HTML body for a referrer approval notification."""
    base = APP_BASE_URL
    return f"""<p>Hi <strong>{referrer_name}</strong>,</p>
<p>Great news — your Kindness Is Magic account has been <strong>approved</strong> ✨</p>
<p>You can now send family invite emails and connect families in need with the support and joy they deserve.</p>
<p style="text-align:center;"><a href="{base}/referrer" style="display:inline-block;padding:12px 24px;background-color:{_BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">Go to Dashboard</a></p>
<p style="margin-top:16px;">Thank you for being part of something wonderful.</p>"""


def build_referrer_rejected_email(referrer_name: str) -> str:
    """Build the HTML body for a referrer rejection notification."""
    return f"""<p>Hi <strong>{referrer_name}</strong>,</p>
<p>Thank you for your interest in helping with Kindness Is Magic.</p>
<p>After review, we've decided not to move forward with your account at this time. We appreciate your willingness to contribute and wish you the best.</p>"""


# ---------------------------------------------------------------------------
# Donor claim confirmation email
# ---------------------------------------------------------------------------


def _format_wish_text(desc: str, size: str | None, color: str | None) -> str:
    """Format a wish as ``Description (size, color)``.

    Present parts are joined with ``", "`` inside the parentheses; the
    parentheses are omitted when both size and color are empty.
    """
    parts = [p for p in (size, color) if p]
    return f"{desc} ({', '.join(parts)})" if parts else desc


def _build_wish_table_rows(people: list[dict]) -> str:
    """Build HTML table rows for people and their wishes.

    Each person dict has: given_name, age, wishes (list of
    {type, description, size, color}).
    Children (age < 18) get practical + fun columns.
    Adults (age >= 18) get a single 'Wish' column.
    """
    rows = ""
    for person in people:
        name = person["given_name"]
        age = person["age"]
        wishes = {w["type"]: w for w in person.get("wishes", [])}

        if age >= 18:
            # Adult: single wish column
            adult_wish = wishes.get("adult", {})
            adult_text = _format_wish_text(adult_wish.get("description", ""), adult_wish.get("size"), adult_wish.get("color"))
            rows += f"""<tr>
  <td style="padding:8px 12px;border-bottom:1px solid #eeeeee;">{name} (age {age})</td>
  <td style="padding:8px 12px;border-bottom:1px solid #eeeeee;">{adult_text}</td>
</tr>"""
        else:
            # Child: practical + fun columns
            practical = wishes.get("practical", {})
            fun = wishes.get("fun", {})
            p_text = _format_wish_text(practical.get("description", ""), practical.get("size"), practical.get("color"))
            f_text = _format_wish_text(fun.get("description", ""), fun.get("size"), fun.get("color"))
            rows += f"""<tr>
  <td style="padding:8px 12px;border-bottom:1px solid #eeeeee;">{name} (age {age})</td>
  <td style="padding:8px 12px;border-bottom:1px solid #eeeeee;">{p_text}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #eeeeee;">{f_text}</td>
</tr>"""

    return rows


def _build_wish_table_header(has_children: bool) -> str:
    """Build the table header row."""
    if has_children:
        return """<tr style="background-color:#f5f0fc;">
  <th style="padding:8px 12px;text-align:left;font-size:13px;color:#4c1d95;">Person</th>
  <th style="padding:8px 12px;text-align:left;font-size:13px;color:#4c1d95;">Practical Wish</th>
  <th style="padding:8px 12px;text-align:left;font-size:13px;color:#4c1d95;">Fun Wish</th>
</tr>"""
    else:
        return """<tr style="background-color:#f5f0fc;">
  <th style="padding:8px 12px;text-align:left;font-size:13px;color:#4c1d95;">Person</th>
  <th style="padding:8px 12px;text-align:left;font-size:13px;color:#4c1d95;">Wish</th>
</tr>"""


def build_claim_confirmation_email(
    donor_name: str,
    family_display_id: str,
    family_wish: str,
    family_bio: str | None,
    people: list[dict],
    claim_detail_url: str,
) -> str:
    """Build the HTML body for a donor claim confirmation email.

    Args:
        donor_name: The donor's display name.
        family_display_id: The family's display ID (e.g. "1-3").
        family_wish: The family's overall wish (e.g. "Warm clothes").
        family_bio: Optional family bio text.
        people: List of person dicts with given_name, age, and wishes.
            Each wish has type, description, and optional size.
        claim_detail_url: Full URL to the claim detail page.
    """
    has_children = any(p["age"] < 18 for p in people)

    bio_line = f"<p>{family_bio}</p>" if family_bio else ""

    family_wish_html = f"""<div style="background-color:#f5f0fc;padding:12px 16px;border-radius:4px;margin-bottom:12px;"><strong>Family wish:</strong> {family_wish}</div>"""

    if people:
        table_html = f"""<table style="width:100%;border-collapse:collapse;margin:16px 0;">
{_build_wish_table_header(has_children)}
{_build_wish_table_rows(people)}
</table>"""
    else:
        table_html = """<p style="color:#666666;font-style:italic;">No family members have been added to this family yet. You can check back later or contact the organization for details.</p>"""

    return f"""<p>Hi <strong>{donor_name}</strong>,</p>
<p>Thank you for sponsoring <strong>Family {family_display_id}</strong> on Kindness Is Magic ✨</p>
{bio_line}
<h2 style="font-size:16px;color:{_BRAND_COLOR};margin-top:20px;">Wish List</h2>
{family_wish_html}
{table_html}
<p style="text-align:center;margin-top:24px;"><a href="{claim_detail_url}" style="display:inline-block;padding:12px 24px;background-color:{_BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">View Your Sponsorship</a></p>
<p style="margin-top:16px;color:#666666;">This email is your record of the commitment you made. You can use it as a reference while shopping for gifts.</p>"""


def build_payment_email_failure_notice(donor_email: str, payment_kind: str, error_summary: str) -> str:
    """Build the HTML body for an admin notification about a failed payment-flow email."""
    base = APP_BASE_URL
    return f"""<p>An error occurred while sending a sponsorship payment email to a donor.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;">
<tr><td style="padding:6px 12px;font-weight:bold;width:140px;color:#4c1d95;">Donor email</td><td style="padding:6px 12px;border-bottom:1px solid #eeeeee;">{donor_email}</td></tr>
<tr><td style="padding:6px 12px;font-weight:bold;color:#4c1d95;">Email type</td><td style="padding:6px 12px;border-bottom:1px solid #eeeeee;">{payment_kind}</td></tr>
<tr><td style="padding:6px 12px;font-weight:bold;color:#4c1d95;">Error</td><td style="padding:6px 12px;border-bottom:1px solid #eeeeee;">{error_summary}</td></tr>
</table>
<p style="text-align:center;"><a href="{base}/admin" style="display:inline-block;padding:12px 24px;background-color:{_BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">Go to Admin Dashboard</a></p>"""


def build_admin_email_failure_notice(
    donor_email: str,
    family_display_id: str,
    claim_id: int,
    error_summary: str,
) -> str:
    """Build the HTML body for an admin notification about a failed confirmation email."""
    base = APP_BASE_URL
    return f"""<p>An error occurred while sending the sponsorship confirmation email to a donor.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;">
<tr><td style="padding:6px 12px;font-weight:bold;width:140px;color:#4c1d95;">Donor email</td><td style="padding:6px 12px;border-bottom:1px solid #eeeeee;">{donor_email}</td></tr>
<tr><td style="padding:6px 12px;font-weight:bold;color:#4c1d95;">Family</td><td style="padding:6px 12px;border-bottom:1px solid #eeeeee;">{family_display_id}</td></tr>
<tr><td style="padding:6px 12px;font-weight:bold;color:#4c1d95;">Sponsorship ID</td><td style="padding:6px 12px;border-bottom:1px solid #eeeeee;">{claim_id}</td></tr>
<tr><td style="padding:6px 12px;font-weight:bold;color:#4c1d95;">Error</td><td style="padding:6px 12px;border-bottom:1px solid #eeeeee;">{error_summary}</td></tr>
</table>
<p style="text-align:center;"><a href="{base}/admin" style="display:inline-block;padding:12px 24px;background-color:{_BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">Go to Admin Dashboard</a></p>"""


async def send_admin_notification(
    subject: str,
    body_html: str,
    db: Session,
    kind: EmailKind,
    user_id: int | None = None,
) -> dict:
    """Send a notification email to the admin address.

    Skips silently if ADMIN_EMAIL is not configured.
    Returns the same dict format as send_email.
    """
    if not ADMIN_EMAIL:
        logger.warning("Admin notification skipped: ADMIN_EMAIL not configured")
        return {"sent": False, "reason": "no_admin_email"}

    return await send_email(
        to=ADMIN_EMAIL,
        subject=f"[Kindness Is Magic] {subject}",
        html_body=body_html,
        db=db,
        kind=kind,
        user_id=user_id,
        exempt_unsubscribe=True,
        include_unsubscribe_link=False,
    )


# ---------------------------------------------------------------------------
# Gift claim confirmation — send flow (shared by the claim endpoint and the
# cash→gifts commitment toggle)
# ---------------------------------------------------------------------------


async def send_claim_confirmation(claim: FamilyClaim, fam: Family, user: User, db: Session) -> str | None:
    """Send the gift-claim confirmation email to the donor.

    Returns an error message string if the email failed, or None on success
    (unsubscribe suppression counts as success).
    """
    # Build display_id early so the except block can reference it
    display_id = compute_display_ids(db, "family", [fam], scope=None).get(fam.id, "0")

    try:
        # Load people + wishes for the email body
        people = db.query(Person).filter(Person.family_id == fam.id, Person.deleted_at.is_(None)).order_by(Person.id).all()
        person_ids = [p.id for p in people]
        wishes_by_person = batch_load_person_wishes(db, person_ids)

        # Build people data for the template
        people_data = [
            {
                "given_name": p.given_name,
                "age": p.age,
                "wishes": [
                    {"type": w.type.value, "description": w.description, "size": w.size, "color": w.color}
                    for w in wishes_by_person.get(p.id, [])
                ],
            }
            for p in people
        ]

        base = APP_BASE_URL
        claim_detail_url = f"{base}/donor/claims/{claim.id}"

        body = build_claim_confirmation_email(
            donor_name=user.display_name,
            family_display_id=display_id,
            family_wish=batch_load_family_wishes(db, [fam.id]).get(fam.id, ""),
            family_bio=fam.bio,
            people=people_data,
            claim_detail_url=claim_detail_url,
        )

        result = await send_email(
            to=user.email,
            subject=f"Sponsorship Confirmation — Family {display_id}",
            html_body=body,
            db=db,
            kind=EmailKind.claim_confirmation,
            user_id=user.id,
        )

        if result["sent"]:
            return None
        if result.get("reason") == "unsubscribed":
            # Unsubscribe suppression is not an error
            return None

        # SMTP failure or other send failure
        logger.error(
            "Claim confirmation email failed: claim_id=%s donor_email=%s family_display_id=%s reason=%s",
            claim.id,
            user.email,
            display_id,
            result.get("reason"),
        )
        return await _send_admin_failure_notice(db, user.email, f"Family {display_id}", claim.id, result.get("reason", "unknown"), user.id)

    except Exception:  # noqa: BLE001
        # Safety net for template rendering or other unexpected errors
        logger.error("Unexpected error sending claim confirmation for claim %s", claim.id, exc_info=True)
        return await _send_admin_failure_notice(db, user.email, f"Family {display_id}", claim.id, "unexpected error", user.id)


async def _send_admin_failure_notice(
    db: Session, donor_email: str, family_display_id: str, claim_id: int, error_summary: str, user_id: int | None
) -> str:
    """Attempt the admin failure notice (non-blocking) and return the error string."""
    try:
        admin_body = build_admin_email_failure_notice(
            donor_email=donor_email,
            family_display_id=family_display_id,
            claim_id=claim_id,
            error_summary=error_summary,
        )
        await send_admin_notification(
            subject="Sponsorship Confirmation Email Failed",
            body_html=admin_body,
            db=db,
            kind=EmailKind.admin_failure_notice,
            user_id=user_id,
        )
    except Exception:  # noqa: BLE001
        logger.error("Admin notification also failed for claim %s", claim_id, exc_info=True)
    return "Confirmation email failed to send"


# ---------------------------------------------------------------------------
# Cash sponsorship payment emails (Zeffy flow)
# ---------------------------------------------------------------------------

# Settled donor-reassurance copy — shown wherever a cash claim is unpaid so a
# donor whose payment doesn't auto-match never thinks the processor ate their
# money.
PAYMENT_REASSURANCE_LINE = "If your payment doesn't match automatically, an admin will review it within a day."


def _format_usd(amount_usd: int) -> str:
    """Format whole-dollar USD as ``$500`` (cart prices are whole dollars)."""
    return f"${amount_usd:,.0f}"


def _payment_cart_table(lines: list[dict]) -> str:
    """HTML table rows for cart lines.

    Each line dict: ``display_id`` (str), ``includes_groceries`` (bool),
    ``line_total_usd`` (int).
    """
    rows = ""
    for line in lines:
        groceries = " + groceries" if line.get("includes_groceries") else ""
        rows += f"""<tr>
  <td style="padding:8px 12px;border-bottom:1px solid #eeeeee;">Family {line["display_id"]}{groceries}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #eeeeee;text-align:right;">{_format_usd(line["line_total_usd"])}</td>
</tr>"""
    return rows


def _build_payment_table(lines: list[dict], total_usd: int) -> str:
    """Cart table with a bolded total row."""
    return f"""<table style="width:100%;border-collapse:collapse;margin:16px 0;">
{_payment_cart_table(lines)}
<tr>
  <td style="padding:8px 12px;font-weight:bold;">Total</td>
  <td style="padding:8px 12px;text-align:right;font-weight:bold;">{_format_usd(total_usd)}</td>
</tr>
</table>"""


def build_payment_request_email(
    donor_name: str,
    lines: list[dict],
    total_usd: int,
    expires_at: datetime,
    cart_url: str,
) -> str:
    """Build the HTML body for the "please pay" nudge email.

    Sent at checkout and at the gifts→cash toggle (at most once per payment
    window). Carries the cart families, the total, the expiry date, a link to
    the cart page, and the reassurance line below the content.

    Carries the how-to-pay instructions, since the Zeffy form can't
    pre-fill the amount: the donor must enter the exact total by hand, and
    the optional 11% "keep Zeffy free" tip (which goes to Zeffy, not the
    family) should be set to $0 via its "Other" option — with a screenshot
    (served from ``{APP_BASE_URL}/zeffy-tip-zero.png``) of how.
    """
    expires_str = expires_at.strftime("%B %d, %Y at %I:%M %p UTC") if expires_at else "the end of the payment window"
    n = len(lines)
    family_word = "family" if n == 1 else "families"
    return f"""<p>Hi <strong>{donor_name}</strong>,</p>
<p>Thank you for sponsoring {n} {family_word} on Kindness Is Magic ✨ Your sponsorship is reserved, but the {family_word} are only yours once payment lands.</p>
{_build_payment_table(lines, total_usd)}
<p style="text-align:center;margin-top:24px;"><a href="{cart_url}" style="display:inline-block;padding:12px 24px;background-color:{_BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">Go to your cart &amp; pay</a></p>
<p><strong>How to pay on Zeffy:</strong></p>
<ol style="margin:8px 0;padding-left:20px;">
  <li style="margin:6px 0;">Enter <strong>{_format_usd(total_usd)}</strong> exactly as the donation amount. The Zeffy form can't pre-fill it — and the exact total is what lets us match your payment to these {family_word} automatically.</li>
  <li style="margin:6px 0;">Set the optional <strong>"Help keep Zeffy free"</strong> tip to <strong>$0</strong>: choose <em>Other</em> in the tip dropdown and enter 0. The 11% default tip goes to Zeffy, not the family. We use Zeffy because it's fee-free, so every penny of your donation goes to the family — the tip is the only extra charge on the page.</li>
</ol>
<img src="{APP_BASE_URL}/zeffy-tip-zero.png" alt="Zeffy form: the 'Help keep Zeffy free' tip dropdown showing 11% — choose Other and enter $0" style="max-width:100%;border:1px solid #dddddd;border-radius:4px;margin:8px 0 4px;">
<p style="font-size:12px;color:#888888;text-align:center;">Choose "Other" in the tip dropdown and enter $0.</p>
<p>Your payment window closes on <strong>{expires_str}</strong>. If a sponsorship is still unpaid when the window closes, it is released back to the browse list.</p>
<p style="margin-top:16px;font-size:14px;color:#666666;">{PAYMENT_REASSURANCE_LINE}</p>"""


def build_payment_confirmed_email(
    donor_name: str,
    lines: list[dict],
    total_usd: int,
) -> str:
    """Build the HTML body for the payment-confirmed email.

    Sent from the shared apply path (confirm / webhook / Zeffy match) and
    admin mark-paid, so every payment — however recorded — gets exactly one
    confirmation. Only sent when ``SEND_PAYMENT_CONFIRMED_EMAIL`` is enabled
    (off by default — Zeffy already emails the donor its receipt). Notes the
    groceries add-ons and that Zeffy itself sends the tax receipt.
    """
    return f"""<p>Hi <strong>{donor_name}</strong>,</p>
<p>Your payment of <strong>{_format_usd(total_usd)}</strong> has been received — your sponsorship is confirmed ✨</p>
{_build_payment_table(lines, total_usd)}
<p>What happens next: the organization will purchase the families' wishes. <strong>Zeffy will email your tax receipt separately</strong> — no action is needed from you.</p>
<p style="text-align:center;margin-top:24px;"><a href="{APP_BASE_URL}/donor/claims" style="display:inline-block;padding:12px 24px;background-color:{_BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">View your sponsorships</a></p>"""


def build_payment_expired_email(
    donor_name: str,
    lines: list[dict],
) -> str:
    """Build the HTML body for the expiry notice.

    Also carries the reassurance line: a donor who paid but didn't
    auto-match watches their claim expire and must be told the money is being
    handled, not lost.
    """
    return f"""<p>Hi <strong>{donor_name}</strong>,</p>
<p>The following sponsorships in your cart were still unpaid when the payment window closed, so they have been released back to the browse list:</p>
{_payment_cart_table(lines)}
<p>If you paid but your payment didn't match automatically, <strong>your money has not been lost</strong> — it is being handled.</p>
<p style="margin-top:16px;font-size:14px;color:#666666;">{PAYMENT_REASSURANCE_LINE}</p>"""


def payment_request_already_sent(donor_email: str, window_anchor: datetime, db: Session) -> bool:
    """True if a "please pay" nudge was already sent after *window_anchor*.

    The window anchor is the ``min(created_at)`` of the donor's pending cash
    claims — the same derivation as the cart's displayed earliest expiry.
    Only ``sent`` rows count (a failed send doesn't block a retry in the same
    window). Served by the existing recipient+sent_at index.

    ``>=`` (not ``>``): the nudge is always recorded after its claims are
    created, and ``>=`` stays correct when both timestamps collapse to the
    same instant (e.g. one long database transaction).
    """
    return (
        db.query(SentEmail.id)
        .filter(
            SentEmail.recipient_email == donor_email.strip().lower(),
            SentEmail.kind == EmailKind.payment_request,
            SentEmail.status == EmailStatus.sent,
            SentEmail.sent_at >= window_anchor,
        )
        .first()
        is not None
    )
