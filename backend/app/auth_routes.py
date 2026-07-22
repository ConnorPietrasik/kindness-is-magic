"""Authentication routes: /api/auth/*"""

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

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
from app.models import User, UserRole, PasswordResetToken, Referrer, Family, FamilyApprovalStatus, ReferrerInviteToken, EmailPreference
from app.permissions import require_admin
from app.schemas import (
    UserCreate,
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
)
from app.rate_limit import limiter
from app.user_validation import validate_user_role_consistency

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _resolve_display_name(role: UserRole, referrer_name: str | None = None) -> str | None:
    """Return the default display_name for a user based on role.

    * admin → "Kindness Fairy"
    * referrer → referrer's name (if provided)
    * family → None
    """
    if role == UserRole.admin:
        return "Kindness Fairy"
    if role == UserRole.referrer and referrer_name:
        return referrer_name
    return None


def _get_inviter_name(user: User, db: Session) -> str | None:
    """Derive the sender name for invite emails from the authenticated user."""
    if user.display_name:
        return user.display_name
    if user.role == UserRole.admin:
        return "Kindness Fairy"
    if user.role == UserRole.referrer and user.referrer_id:
        ref = db.query(Referrer).filter(Referrer.id == user.referrer_id).first()
        if ref:
            return ref.name
    return None


# ---------------------------------------------------------------------------
# Unsubscribe (public, no auth)
# ---------------------------------------------------------------------------


@router.get("/unsubscribe")
@limiter.limit("5/minute")
def unsubscribe(request: Request, token: str, db: Session = Depends(get_db)):
    """Unsubscribe an email address from marketing emails.

    No authentication required. Rate-limited to 5/minute.
    Accepts a signed JWT token (no expiry) embedding the email.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=400, detail="Invalid or malformed unsubscribe token")

    email: str | None = payload.get("email")
    if not email or not isinstance(email, str):
        raise HTTPException(status_code=400, detail="Invalid or malformed unsubscribe token")

    email_lower = email.strip().lower()
    now = datetime.now(timezone.utc)

    # Upsert: insert or update unsubscribed_at
    existing = db.query(EmailPreference).filter(EmailPreference.email == email_lower).first()
    if existing:
        existing.unsubscribed_at = now
    else:
        db.add(EmailPreference(email=email_lower, unsubscribed_at=now))
    db.commit()

    logger.info("Email unsubscribed: %s", email_lower)
    return {"message": f"Email {email_lower} has been unsubscribed."}


# ---------------------------------------------------------------------------
# Register (admin-only)
# ---------------------------------------------------------------------------


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    data: UserCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Create a new user. Admin-only."""
    # Validate role consistency
    errors = validate_user_role_consistency(data.role, data.referrer_id, data.family_id)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))

    # Check for duplicate email
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    # Validate foreign key references exist
    if data.family_id is not None:
        fam = db.query(Family).filter(Family.id == data.family_id).first()
        if not fam or fam.deleted_at is not None:
            raise HTTPException(
                status_code=404,
                detail=f"Family with id={data.family_id} not found",
            )
    if data.referrer_id is not None:
        if not db.query(Referrer).filter(Referrer.id == data.referrer_id).first():
            raise HTTPException(
                status_code=404,
                detail=f"Referrer with id={data.referrer_id} not found",
            )

    # Resolve display_name: use provided value or apply role-based default
    display_name = data.display_name
    if display_name is None:
        referrer_name = None
        if data.referrer_id is not None:
            ref = db.query(Referrer).filter(Referrer.id == data.referrer_id).first()
            if ref:
                referrer_name = ref.name
        display_name = _resolve_display_name(data.role, referrer_name)

    user = User(
        email=data.email,
        hashed_password=get_password_hash(data.password),
        role=data.role,
        display_name=display_name,
        referrer_id=data.referrer_id,
        family_id=data.family_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    logger.info("User created: %s (role=%s)", user.email, user.role)
    return user


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
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled",
        )

    access_token = create_access_token(data={"sub": str(user.id), "role": user.role})
    refresh_token = create_refresh_token(data={"sub": str(user.id)})

    set_auth_cookies(response, access_token, refresh_token)

    logger.info("User logged in: %s (role=%s)", user.email, user.role)

    return {
        "message": "Login successful",
        "user": UserResponse.model_validate(user),
    }


# ---------------------------------------------------------------------------
# Logout
# ---------------------------------------------------------------------------


@router.post("/logout")
def logout(response: Response, _user: User = Depends(get_current_user)):
    """Clear auth cookies."""
    clear_auth_cookies(response)
    logger.info("User logged out: %s", _user.email)
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
    """Rotate refresh token and issue a new access token."""
    if not refresh_token_cookie:
        raise HTTPException(status_code=401, detail="No refresh token")

    payload = decode_refresh_token(refresh_token_cookie)
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user = db.query(User).filter(User.id == int(user_id), User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    # Issue new tokens (rotation)
    new_access = create_access_token(data={"sub": str(user.id), "role": user.role})
    new_refresh = create_refresh_token(data={"sub": str(user.id)})

    set_auth_cookies(response, new_access, new_refresh)

    return {"message": "Token refreshed", "user": UserResponse.model_validate(user)}


# ---------------------------------------------------------------------------
# Me (current user profile)
# ---------------------------------------------------------------------------


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)):
    """Return the current authenticated user's profile."""
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
    db.commit()

    logger.info("User changed password: %s", user.email)
    return {"message": "Password changed"}


# ---------------------------------------------------------------------------
# Forgot password (development: logs the token)
# ---------------------------------------------------------------------------


@router.post("/forgot-password")
@limiter.limit("5/minute")
def forgot_password(request: Request, data: ForgotPassword, db: Session = Depends(get_db)):
    """Generate a password-reset token and send a reset email."""
    user = db.query(User).filter(User.email == data.email).first()

    # Always return 200 to avoid email enumeration
    if not user:
        return {"message": "If the email exists, a reset link has been sent"}

    # Generate token
    raw_token = secrets.token_urlsafe(32)

    # Invalidate any existing reset tokens for this user
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used.is_(False),
    ).delete()

    reset = PasswordResetToken(
        user_id=user.id,
        token=raw_token,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(reset)
    db.commit()

    # Send password reset email (exempt from unsubscribe block)
    base = os.environ.get("APP_BASE_URL", "http://localhost:3000")
    reset_link = f"{base}/reset-password?token={raw_token}"
    html_body = build_password_reset_email(reset_link)
    result = send_email(
        to=user.email,
        subject="Reset your Kindness Is Magic password",
        html_body=html_body,
        exempt_unsubscribe=True,
        include_unsubscribe_link=False,
    )

    if result["sent"]:
        logger.info("Password reset email sent: user_id=%s email=%s", user.id, user.email)
    else:
        logger.error("Password reset email failed: user_id=%s email=%s", user.id, user.email)

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
            PasswordResetToken.used.is_(False),
        )
        .first()
    )

    if not reset:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    if reset.expires_at and reset.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Reset token has expired")

    user = db.query(User).filter(User.id == reset.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.hashed_password = get_password_hash(data.new_password)
    reset.used = True
    db.commit()

    logger.info("User reset password via token: %s", user.email)
    return {"message": "Password has been reset"}


# ---------------------------------------------------------------------------
# Invite referrer (admin-only)
# ---------------------------------------------------------------------------


@router.post(
    "/invite-referrer",
    response_model=ReferrerInviteResponse,
    status_code=status.HTTP_201_CREATED,
)
def invite_referrer(
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
        expires_at=expires_at,
        used=False,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)

    logger.info("Invite token created: %s (family_limit=%d)", code, data.family_limit)

    # Send invite email if email address provided
    email_sent: bool | None = None
    email_send_reason: str | None = None
    if data.email:
        inviter_name = _get_inviter_name(_admin, db)
        html_body = build_invite_email(
            code=code,
            family_limit=data.family_limit,
            expires_at=expires_at,
            from_name=inviter_name,
        )
        result = send_email(
            to=data.email,
            subject="You're invited to join Kindness Is Magic",
            html_body=html_body,
        )
        email_sent = result["sent"]
        email_send_reason = result["reason"]

    return {
        "code": invite.code,
        "family_limit": invite.family_limit,
        "expires_at": invite.expires_at,
        "created_at": invite.created_at,
        "email_sent": email_sent,
        "email_send_reason": email_send_reason,
    }


# ---------------------------------------------------------------------------
# Register referrer (public, via invite code)
# ---------------------------------------------------------------------------


@router.post(
    "/register-referrer",
    response_model=ReferrerSelfRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
def register_referrer(
    data: ReferrerSelfRegister,
    response: Response,
    db: Session = Depends(get_db),
):
    """Public self-registration: redeem an invite code to create a Referrer + User."""
    # 1. Look up the invite token
    invite = db.query(ReferrerInviteToken).filter(ReferrerInviteToken.code == data.code, ReferrerInviteToken.used.is_(False)).first()
    if not invite:
        raise HTTPException(status_code=400, detail="Invalid or already-used invite code")

    # 2. Check expiration
    if invite.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invite code has expired")

    # 3. Check for duplicate email
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    # 4. Atomic creation inside the session transaction
    referrer = Referrer(
        name=data.name,
        phone_number=data.phone_number,
        family_limit=invite.family_limit,
        family_invite_code=generate_unique_family_invite_code(db),
    )
    db.add(referrer)
    db.flush()  # Get referrer.id

    user = User(
        email=data.email,
        hashed_password=get_password_hash(data.password),
        role=UserRole.referrer,
        display_name=data.name,
        referrer_id=referrer.id,
        is_active=True,
    )
    db.add(user)
    db.flush()  # Get user.id

    # Mark the invite as redeemed
    invite.used = True
    invite.redeemed_by_user_id = user.id
    invite.redeemed_by_referrer_id = referrer.id
    db.commit()

    # 5. Issue auth cookies (auto-login)
    access_token = create_access_token(data={"sub": str(user.id), "role": user.role})
    refresh_token = create_refresh_token(data={"sub": str(user.id)})
    set_auth_cookies(response, access_token, refresh_token)

    logger.info("Referrer self-registered via invite %s: %s", data.code, data.email)

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
def register_family(
    data: FamilySelfRegister,
    response: Response,
    db: Session = Depends(get_db),
):
    """Public self-registration: family registers via a referrer's family invite code."""
    # 1. Look up referrer by family_invite_code
    referrer = db.query(Referrer).filter(Referrer.family_invite_code == data.code).first()
    if not referrer:
        raise HTTPException(status_code=400, detail="Invalid invite code")

    # 2. Check for duplicate email
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    # 3. Atomic creation inside the session transaction
    family = Family(
        referrer_id=referrer.id,
        family_name=data.family_name,
        family_wish=data.family_wish,
        contact_name=data.contact_name,
        bio=data.bio,
        address=data.address,
        phone_number=data.phone_number,
        approval_status=FamilyApprovalStatus.pending,
    )
    db.add(family)
    db.flush()  # Get family.id

    user = User(
        email=data.email,
        hashed_password=get_password_hash(data.password),
        role=UserRole.family,
        family_id=family.id,
        is_active=True,
    )
    db.add(user)
    db.flush()  # Get user.id

    db.commit()

    # 4. Issue auth cookies (auto-login)
    access_token = create_access_token(data={"sub": str(user.id), "role": user.role})
    refresh_token = create_refresh_token(data={"sub": str(user.id)})
    set_auth_cookies(response, access_token, refresh_token)

    logger.info("Family self-registered via invite: %s (referrer_id=%s)", data.email, referrer.id)

    # 5. Send notification email to referrer
    referrer_user = db.query(User).filter(User.referrer_id == referrer.id).first()
    if referrer_user:
        display_name = referrer_user.display_name or referrer.name
        html_body = build_family_pending_email(data.family_name, display_name)
        send_email(
            to=referrer_user.email,
            subject=f"New family awaiting approval — {data.family_name}",
            html_body=html_body,
        )

    # 6. Build response
    person_count = 0  # No persons yet
    return FamilySelfRegisterResponse(
        user=UserResponse.model_validate(user),
        family=FamilySummary(
            id=family.id,
            family_name=family.family_name,
            family_wish=family.family_wish,
            contact_name=family.contact_name,
            referrer_id=family.referrer_id,
            approval_status=family.approval_status,
            deleted_at=family.deleted_at,
            person_count=person_count,
        ),
    )
