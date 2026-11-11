"""Authentication routes: /api/auth/*"""

import asyncio
import logging
import secrets
from datetime import datetime, timedelta, timezone
from html import escape
from urllib.parse import urlencode

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.config import APP_BASE_URL, REFRESH_ROTATION_GRACE_SECONDS

from app.auth import (
    INVITE_EXPIRY_HOURS,
    SECRET_KEY,
    ALGORITHM,
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    generate_invite_code,
    generate_unique_family_invite_code,
    get_password_hash,
    verify_password,
    clear_auth_cookies,
    set_auth_cookies,
    get_current_user,
)
from app.mail import send_email, build_invite_email, build_password_reset_email, build_family_pending_email
from app.database import get_db
from app.models import (
    EmailKind,
    EmailPreference,
    Family,
    FamilyVerificationStatus,
    PasswordResetToken,
    Referrer,
    ReferrerApprovalStatus,
    ReferrerInviteToken,
    RefreshToken,
    User,
    UserRole,
    default_display_name_from_email,
)
from app.permissions import require_admin
from app.response_builders import attach_family_wish
from app.schemas import (
    UserLogin,
    UserResponse,
    ChangePassword,
    ForgotPassword,
    ResetPassword,
    ReferrerInviteCreate,
    ReferrerInviteResponse,
    ReferrerSelfRegister,
    ReferrerSelfRegisterResponse,
    ReferrerSummary,
    FamilySelfRegister,
    FamilySelfRegisterResponse,
    FamilySummary,
    UpdateProfile,
    DonorSelfRegister,
    DonorSelfRegisterResponse,
)
from app.rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _issue_session(response: Response, user: User, db: Session) -> None:
    """Mint an access + refresh token pair and set the HttpOnly auth cookies.

    Used by every endpoint that logs a user in (login, refresh rotation,
    and the self-registration flows).

    The refresh-token row is only flushed — the caller MUST ``db.commit()``
    afterwards, or the row is rolled back at the end of the request and
    /refresh answers 401 "Your session has ended. Please log in again."
    (the cookie exists but the server has no record of the token).
    """
    # The access log middleware correlates log lines with the acting user via
    # ``sub`` (see log_request_middleware in main.py). No email in the token
    # — PII minimization; the user_id is enough to look it up if needed.
    access_token = create_access_token(data={"sub": str(user.id), "role": user.role})
    refresh_token = create_refresh_token(data={"sub": str(user.id)}, db=db)
    set_auth_cookies(response, access_token, refresh_token)


def _assert_referrer_login_allowed(user: User, db: Session) -> None:
    """Raise 401 if the user is a referrer whose referrer record was rejected.

    Enforced on both login and token refresh so rejected referrers are
    locked out even with existing sessions.
    """
    if user.role != UserRole.referrer or user.referrer_id is None:
        return
    ref = db.get(Referrer, user.referrer_id)
    if ref is not None and ref.deleted_at is None and ref.approval_status == ReferrerApprovalStatus.rejected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your account has been rejected.",
        )


def _get_inviter_name(user: User, db: Session) -> str | None:
    """Derive the sender name for invite emails from the authenticated user."""
    if user.display_name:
        return user.display_name
    if user.role == UserRole.admin:
        return "Kindness Fairy"
    if user.role == UserRole.referrer and user.referrer_id:
        ref = db.get(Referrer, user.referrer_id)
        if ref is not None and ref.deleted_at is None:
            return ref.name
    return None


# ---------------------------------------------------------------------------
# Unsubscribe (public, no auth)
#
# Two-step: GET renders a confirmation page, and the page's form POSTs to
# /unsubscribe/confirm, which performs the actual unsubscribe. A bare GET —
# mail-client link prefetchers, corporate URL scanners, forwarded-email
# preview bots — never writes the preference.
# ---------------------------------------------------------------------------


def _decode_unsubscribe_token(token: str) -> str:
    """Validate an unsubscribe token and return its normalized email.

    The token must be signed with the app key, be unexpired, and carry
    ``type: "unsubscribe"`` (so e.g. a session token replayed here is
    rejected as well).
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=400, detail="This unsubscribe link has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=400, detail="This unsubscribe link is no longer valid")

    if payload.get("type") != "unsubscribe":
        raise HTTPException(status_code=400, detail="This unsubscribe link is no longer valid")

    email: str | None = payload.get("email")
    if not email or not isinstance(email, str):
        raise HTTPException(status_code=400, detail="This unsubscribe link is no longer valid")
    return email.strip().lower()


def _unsubscribe_page_shell(title: str, content_html: str) -> str:
    """Minimal branded HTML shell for the unsubscribe pages (standalone — no SPA, no assets)."""
    return f"""<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title)} — Kindness Is Magic</title>
</head>
<body style="margin:0;padding:32px 16px;background-color:#f9f9f9;font-family:Arial,Helvetica,sans-serif;color:#333333;">
<div style="max-width:480px;margin:0 auto;background-color:#ffffff;border:1px solid #eeeeee;border-radius:8px;overflow:hidden;">
<div style="background-color:#4c1d95;color:#ffffff;padding:16px 24px;text-align:center;font-size:18px;font-weight:bold;">Kindness Is Magic</div>
<div style="padding:24px;">
<h1 style="font-size:18px;margin:0 0 16px;">{escape(title)}</h1>
{content_html}
</div>
</div>
</body>
</html>"""


def _unsubscribe_confirm_page(email: str, token: str) -> str:
    """Confirmation page shown for a valid, unexpired unsubscribe token."""
    confirm_url = f"{APP_BASE_URL}/api/auth/unsubscribe/confirm?{urlencode({'token': token})}"
    return _unsubscribe_page_shell(
        "Unsubscribe from Kindness Is Magic?",
        f"""<p>You're about to stop receiving program emails from Kindness Is Magic for <strong>{escape(email)}</strong>.</p>
<form method="post" action="{confirm_url}" style="text-align:center;margin:24px 0;">
  <button type="submit" style="padding:12px 24px;background-color:#4c1d95;color:#ffffff;border:none;border-radius:4px;font-size:14px;font-weight:bold;cursor:pointer;">Yes, unsubscribe me</button>
</form>
<p style="font-size:13px;color:#666666;margin:16px 0 0;">Security emails (such as password resets) will still be delivered.</p>
<p style="font-size:13px;margin:16px 0 0;"><a href="{APP_BASE_URL}" style="color:#4c1d95;">No — keep receiving emails</a></p>""",
    )


def _unsubscribe_done_page(email: str) -> str:
    """Confirmation page shown after a successful unsubscribe."""
    return _unsubscribe_page_shell(
        "You're unsubscribed",
        f"""<p><strong>{escape(email)}</strong> will no longer receive program emails from Kindness Is Magic.</p>
<p style="font-size:13px;color:#666666;margin:16px 0 0;">Security emails (such as password resets) will still be delivered. If this was a mistake, contact us and we'll restore your subscription.</p>
<p style="font-size:13px;margin:16px 0 0;"><a href="{APP_BASE_URL}" style="color:#4c1d95;">Go to the website</a></p>""",
    )


@router.get("/unsubscribe")
@limiter.limit("5/minute")
def unsubscribe(request: Request, token: str):
    """Render the unsubscribe confirmation page (public, no auth, rate-limited 5/minute).

    A valid token shows a page with the email address and a confirm button.
    The page's form is the only thing that POSTs to /unsubscribe/confirm —
    this endpoint itself never writes the preference.
    """
    email = _decode_unsubscribe_token(token)
    # no-store: the page shows the recipient's address and carries their
    # live credential — it must never sit in a browser or proxy cache.
    return HTMLResponse(_unsubscribe_confirm_page(email, token), headers={"Cache-Control": "no-store"})


@router.post("/unsubscribe/confirm")
@limiter.limit("5/minute")
def unsubscribe_confirm(
    request: Request,
    token: str,
    db: Session = Depends(get_db),
):
    """Perform the unsubscribe after the user confirms on the GET page.

    The confirmation form POSTs here carrying the same token in the query
    string; it is re-validated before the EmailPreference row is upserted.
    """
    email = _decode_unsubscribe_token(token)
    now = datetime.now(timezone.utc)

    # Upsert: insert or update unsubscribed_at
    existing = db.query(EmailPreference).filter(EmailPreference.email == email).first()
    if existing:
        existing.unsubscribed_at = now
    else:
        db.add(EmailPreference(email=email, unsubscribed_at=now))
    db.commit()

    logger.info("Email unsubscribed: %s", email)
    # no-store: the page shows the recipient's address (see above).
    return HTMLResponse(_unsubscribe_done_page(email), headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------


@router.post("/login")
@limiter.limit("5/minute")
def login(request: Request, data: UserLogin, response: Response, db: Session = Depends(get_db)):
    """Authenticate and set HttpOnly cookies."""
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    if user.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled",
        )

    # Rejected referrers cannot log in
    _assert_referrer_login_allowed(user, db)

    _issue_session(response, user, db)
    db.commit()

    logger.info("User logged in: user_id=%s role=%s", user.id, user.role)

    return {
        "message": "Login successful",
        "user": UserResponse.model_validate(user),
    }


# ---------------------------------------------------------------------------
# Logout
# ---------------------------------------------------------------------------


@router.post("/logout")
def logout(
    response: Response,
    refresh_token_cookie: str | None = Cookie(None, alias="refresh_token"),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Clear auth cookies and delete the server-side refresh tokens.

    Drops the presented token plus this user's rotated (grace-window) rows,
    so a pre-rotation token cannot refresh its way back in after logout.
    """
    # Delete the presented token and all rotated rows so nothing can be replayed.
    # (``token == None`` renders as ``IS NULL`` and never matches — the token
    # column is not nullable — so a missing cookie still clears rotated rows.)
    db.query(RefreshToken).filter(
        RefreshToken.user_id == _user.id,
        (RefreshToken.token == refresh_token_cookie) | RefreshToken.rotated_at.isnot(None),
    ).delete(synchronize_session="fetch")
    db.commit()

    clear_auth_cookies(response)
    logger.info("User logged out")
    return {"message": "Logged out"}


# ---------------------------------------------------------------------------
# Token refresh
# ---------------------------------------------------------------------------


@router.post("/refresh")
@limiter.limit("30/minute")
def refresh(
    request: Request,
    response: Response,
    refresh_token_cookie: str | None = Cookie(None, alias="refresh_token"),
    db: Session = Depends(get_db),
):
    """Rotate refresh token and issue a new access token.

    The old refresh token must exist in the DB (logout and password change
    delete it outright). Rotation stamps the row with ``rotated_at`` rather
    than deleting it, so a concurrent client that still holds the
    pre-rotation token (cookie jars are shared across tabs) is accepted
    within REFRESH_ROTATION_GRACE_SECONDS of the rotation.
    """
    if not refresh_token_cookie:
        raise HTTPException(status_code=401, detail="Your session has expired. Please log in again.")

    payload = decode_refresh_token(refresh_token_cookie)
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Your session is no longer valid. Please log in again.")

    user = db.get(User, int(user_id))
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    # Rejected referrers cannot refresh tokens
    _assert_referrer_login_allowed(user, db)

    # Validate the token exists on the server. Rotation stamps rotated_at
    # instead of deleting the row so a concurrent client presenting the
    # same (pre-rotation) token within the grace window still succeeds.
    stored = (
        db.query(RefreshToken)
        .filter(
            RefreshToken.user_id == user.id,
            RefreshToken.token == refresh_token_cookie,
        )
        .first()
    )
    if not stored:
        raise HTTPException(status_code=401, detail="Your session has ended. Please log in again.")

    now = datetime.now(timezone.utc)
    if stored.rotated_at is None:
        stored.rotated_at = now
    elif now - stored.rotated_at > timedelta(seconds=REFRESH_ROTATION_GRACE_SECONDS):
        # A replay well after rotation — treat as a stolen token.
        raise HTTPException(status_code=401, detail="Your session has ended. Please log in again.")
    # Within the grace window: a concurrent client replaying the token.
    # Tolerate it, but do NOT slide rotated_at — otherwise a captured token
    # could be replayed forever, minting new tokens indefinitely.

    # Housekeeping: drop this user's rotated rows past the grace window
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user.id,
        RefreshToken.rotated_at.isnot(None),
        RefreshToken.rotated_at < now - timedelta(seconds=REFRESH_ROTATION_GRACE_SECONDS),
    ).delete(synchronize_session=False)

    # Issue new tokens and set cookies
    _issue_session(response, user, db)

    db.commit()

    return {"message": "Token refreshed", "user": UserResponse.model_validate(user)}


# ---------------------------------------------------------------------------
# Me (current user profile)
# ---------------------------------------------------------------------------


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)):
    """Return the current authenticated user's profile."""
    return user


@router.patch("/me", response_model=UserResponse)
def update_profile(
    data: UpdateProfile,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update the authenticated user's profile (display_name)."""
    for field, value in data.to_update_dict().items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)

    logger.info("User updated profile")
    return user


# ---------------------------------------------------------------------------
# Change own password
# ---------------------------------------------------------------------------


@router.put("/me/password")
def change_password(
    data: ChangePassword,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Change the authenticated user's password."""
    if not verify_password(data.old_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect old password")

    user.hashed_password = get_password_hash(data.new_password)

    # Invalidate any existing password-reset tokens
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used_at.is_(None),
    ).delete(synchronize_session="fetch")

    # Invalidate all refresh tokens (force re-login on all devices)
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user.id,
    ).delete(synchronize_session="fetch")

    db.commit()

    logger.info("User changed password")
    return {"message": "Password changed"}


# ---------------------------------------------------------------------------
# Forgot password (development: logs the token)
# ---------------------------------------------------------------------------


@router.post("/forgot-password")
@limiter.limit("5/minute")
async def forgot_password(request: Request, data: ForgotPassword, db: Session = Depends(get_db)):
    """Generate a password-reset token and send a reset email."""
    # Disabled (soft-deleted) accounts are treated like unknown emails:
    # the same generic 200, no reset email — enumeration stays safe.
    user = db.query(User).filter(User.email == data.email, User.deleted_at.is_(None)).first()

    # Always return 200 to avoid email enumeration
    if not user:
        return {"message": "If the email exists, a reset link has been sent"}

    # Generate token
    raw_token = secrets.token_urlsafe(32)

    # Invalidate any existing reset tokens for this user
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used_at.is_(None),
    ).delete(synchronize_session="fetch")

    reset = PasswordResetToken(
        user_id=user.id,
        token=raw_token,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(reset)
    db.commit()

    # Send password reset email (exempt from unsubscribe block)
    base = APP_BASE_URL
    reset_link = f"{base}/reset-password/{raw_token}"
    html_body = build_password_reset_email(reset_link)
    result = await send_email(
        to=user.email,
        subject="Reset your Kindness Is Magic password",
        html_body=html_body,
        db=db,
        kind=EmailKind.password_reset,
        exempt_unsubscribe=True,
        include_unsubscribe_link=False,
    )

    if result["sent"]:
        logger.info("Password reset email sent: user_id=%s", user.id)
    else:
        logger.error("Password reset email failed: user_id=%s", user.id)

    return {"message": "If the email exists, a reset link has been sent"}


# ---------------------------------------------------------------------------
# Reset password
# ---------------------------------------------------------------------------


@router.post("/reset-password")
@limiter.limit("5/minute")
def reset_password(request: Request, data: ResetPassword, db: Session = Depends(get_db)):
    """Consume a reset token and set a new password."""
    reset = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.token == data.token,
            PasswordResetToken.used_at.is_(None),
        )
        .first()
    )

    if not reset:
        raise HTTPException(status_code=400, detail="That reset link is invalid or has expired. Please request a new one.")

    if reset.expires_at and reset.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="That reset link has expired. Please request a new one.")

    user = db.get(User, reset.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # A disabled account cannot complete the reset (mirrors login). The
    # token is left unconsumed so a restored account can still finish.
    if user.deleted_at is not None:
        raise HTTPException(status_code=403, detail="Account is disabled")

    user.hashed_password = get_password_hash(data.new_password)
    reset.used_at = datetime.now(timezone.utc)

    # Invalidate all refresh tokens (force re-login on all devices)
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user.id,
    ).delete(synchronize_session="fetch")

    db.commit()

    logger.info("User reset password via token: user_id=%s", user.id)
    return {"message": "Password has been reset"}


# ---------------------------------------------------------------------------
# Invite referrer (admin-only)
# ---------------------------------------------------------------------------


@router.post(
    "/invite-referrer",
    response_model=ReferrerInviteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def invite_referrer(
    data: ReferrerInviteCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Admin creates a one-time invite code for a referrer to self-register."""
    code = generate_invite_code()
    expires_at = datetime.now(timezone.utc) + timedelta(hours=INVITE_EXPIRY_HOURS)
    invite = ReferrerInviteToken(
        code=code,
        family_limit=data.family_limit,
        locked_email=data.email,
        expires_at=expires_at,
        created_by_admin_id=_admin.id,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)

    logger.info("Invite token created: %s (family_limit=%d)", code, data.family_limit)

    # Send invite email if email address provided
    email_error: str | None = None
    if data.email:
        inviter_name = _get_inviter_name(_admin, db)
        html_body = build_invite_email(
            code=code,
            family_limit=data.family_limit,
            expires_at=expires_at,
            from_name=inviter_name,
            email=data.email,
            email_message=data.email_message,
        )
        result = await send_email(
            to=data.email,
            subject="You're invited to join Kindness Is Magic",
            html_body=html_body,
            db=db,
            kind=EmailKind.referrer_invite,
            user_id=_admin.id,
        )
        if not result["sent"]:
            if result["reason"] == "unsubscribed":
                email_error = f"Email not sent (recipient unsubscribed). Share code {code} directly."
            else:
                email_error = f"Email not sent (SMTP error). Share code {code} directly."

    return {
        "code": invite.code,
        "family_limit": invite.family_limit,
        "locked_email": invite.locked_email,
        "expires_at": invite.expires_at,
        "created_at": invite.created_at,
        "email_error": email_error,
    }


# ---------------------------------------------------------------------------
# Register referrer (public, via invite code)
# ---------------------------------------------------------------------------


@router.post(
    "/register-referrer",
    response_model=ReferrerSelfRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("5/minute")
def register_referrer(
    request: Request,
    data: ReferrerSelfRegister,
    response: Response,
    db: Session = Depends(get_db),
):
    """Public self-registration: redeem an invite code to create a Referrer + User."""
    # 1. Look up the invite token
    invite = (
        db.query(ReferrerInviteToken)
        .filter(ReferrerInviteToken.code == data.code, ReferrerInviteToken.redeemed_by_user_id.is_(None))
        .first()
    )
    if not invite:
        raise HTTPException(status_code=400, detail="Invalid or already-used invite code")

    # 2. Check expiration
    if invite.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invite code has expired")

    # 3. Enforce locked_email (before duplicate-email check)
    if invite.locked_email and data.email != invite.locked_email:
        raise HTTPException(
            status_code=400,
            detail=f"This invite code is reserved for {invite.locked_email}",
        )

    # 4. Check for duplicate email
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    # 5. Atomic creation inside the session transaction
    # Email-locked codes auto-approve; unlocked codes start as pending
    if invite.locked_email:
        approval_status = ReferrerApprovalStatus.approved
        approved_by = invite.created_by_admin_id
        approved_at = datetime.now(timezone.utc)
    else:
        approval_status = ReferrerApprovalStatus.pending
        approved_by = None
        approved_at = None

    referrer = Referrer(
        name=data.name,
        phone_number=data.phone_number,
        family_limit=invite.family_limit,
        family_invite_code=generate_unique_family_invite_code(db),
        approval_status=approval_status,
        approved_by_admin_id=approved_by,
        approved_at=approved_at,
    )
    db.add(referrer)
    db.flush()  # Get referrer.id

    user = User(
        email=data.email,
        hashed_password=get_password_hash(data.password),
        role=UserRole.referrer,
        display_name=data.name,
        referrer_id=referrer.id,
    )
    db.add(user)
    db.flush()  # Get user.id

    # Mark the invite as redeemed
    invite.redeemed_by_user_id = user.id
    invite.redeemed_by_referrer_id = referrer.id
    db.commit()

    # 5. Issue auth cookies (auto-login) — commit so the refresh-token row
    # persists (see _issue_session)
    _issue_session(response, user, db)
    db.commit()

    logger.info("Referrer self-registered via invite %s: user_id=%s", data.code, user.id)

    return ReferrerSelfRegisterResponse(
        user=UserResponse.model_validate(user),
        referrer=ReferrerSummary.model_validate(referrer),
    )


# ---------------------------------------------------------------------------
# Register family (public, via family invite code)
# ---------------------------------------------------------------------------


@router.post(
    "/register-family",
    response_model=FamilySelfRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("5/minute")
async def register_family(
    request: Request,
    data: FamilySelfRegister,
    response: Response,
    db: Session = Depends(get_db),
):
    """Public self-registration: family registers via a referrer's family invite code."""
    # 1. Look up referrer by family_invite_code.
    # The lookup intentionally includes soft-deleted referrers so we can tell
    # "code belongs to an inactive referrer" apart from "code is bogus" and
    # show the family an actionable error.
    referrer = db.query(Referrer).filter(Referrer.family_invite_code == data.code).first()
    if not referrer:
        raise HTTPException(status_code=400, detail="Invalid invite code")
    # A deleted referrer can never confirm the family, and a rejected
    # referrer is locked out of the app — a family registered against either
    # would sit in a verification queue nobody can reach.
    if referrer.deleted_at is not None or referrer.approval_status == ReferrerApprovalStatus.rejected:
        raise HTTPException(
            status_code=400,
            detail="Your referrer's account is not active. Please contact them for a new invite code.",
        )

    # 2. Check for duplicate email
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    # 3. Atomic creation inside the session transaction
    family = Family(
        referrer_id=referrer.id,
        family_name=data.family_name,
        contact_name=data.contact_name,
        bio=data.bio,
        address=data.address,
        phone_number=data.phone_number,
        verification_status=FamilyVerificationStatus.pending,
    )
    db.add(family)
    # Family wish is a wish row, created in the same transaction
    attach_family_wish(db, family, data.family_wish)
    db.flush()  # Get family.id

    user = User(
        email=data.email,
        hashed_password=await asyncio.to_thread(get_password_hash, data.password),
        role=UserRole.family,
        display_name=default_display_name_from_email(data.email),
        family_id=family.id,
    )
    db.add(user)
    db.flush()  # Get user.id

    db.commit()

    # 4. Issue auth cookies (auto-login) — commit so the refresh-token row
    # persists (see _issue_session)
    _issue_session(response, user, db)
    db.commit()

    logger.info("Family self-registered via invite: user_id=%s (referrer_id=%s)", user.id, referrer.id)

    # 5. Send notification email to referrer
    referrer_user = db.query(User).filter(User.referrer_id == referrer.id, User.deleted_at.is_(None)).first()
    if referrer_user:
        display_name = referrer_user.display_name or referrer.name
        html_body = build_family_pending_email(data.family_name, display_name)
        await send_email(
            to=referrer_user.email,
            subject=f"New family awaiting your verification — {data.family_name}",
            html_body=html_body,
            db=db,
            kind=EmailKind.family_pending,
            user_id=user.id,
        )

    # 6. Build response
    person_count = 0  # No persons yet
    # Pending families use "PENDING" display_id (they don't have a stable
    # position yet — the referrer's view only shows verified families).
    return FamilySelfRegisterResponse(
        user=UserResponse.model_validate(user),
        family=FamilySummary(
            id=family.id,
            display_id="PENDING",
            family_name=family.family_name,
            family_wish=data.family_wish,
            contact_name=family.contact_name,
            referrer_id=family.referrer_id,
            verification_status=family.verification_status,
            deleted_at=family.deleted_at,
            person_count=person_count,
            wish_lock_level=family.wish_lock_level,
            wish_review_requested_at=family.wish_review_requested_at,
            wish_rejection_reason=family.wish_rejection_reason,
        ),
    )


# ---------------------------------------------------------------------------
# Register donor (public, open — no invite code required)
# ---------------------------------------------------------------------------


@router.post(
    "/register-donor",
    response_model=DonorSelfRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("5/minute")
def register_donor(
    request: Request,
    data: DonorSelfRegister,
    response: Response,
    db: Session = Depends(get_db),
):
    """Public self-registration: create a donor user (no approval gate)."""
    # 1. Check for duplicate email
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    # 2. Create user
    user = User(
        email=data.email,
        hashed_password=get_password_hash(data.password),
        role=UserRole.donor,
        display_name=data.display_name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # 3. Issue auth cookies (auto-login) — commit so the refresh-token row
    # persists (see _issue_session)
    _issue_session(response, user, db)
    db.commit()

    logger.info("Donor self-registered: user_id=%s", user.id)

    return DonorSelfRegisterResponse(user=UserResponse.model_validate(user))
