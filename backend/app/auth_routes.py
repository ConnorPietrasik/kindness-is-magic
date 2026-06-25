"""Authentication routes: /api/auth/*"""

import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.auth import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    get_password_hash,
    verify_password,
    clear_auth_cookies,
    set_auth_cookies,
    get_current_user,
)
from app.database import get_db
from app.models import User, UserRole, PasswordResetToken, Referrer, Family
from app.permissions import require_admin
from app.schemas import (
    UserCreate,
    UserLogin,
    UserResponse,
    ChangePassword,
    ForgotPassword,
    ResetPassword,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# Register (admin-only)
# ---------------------------------------------------------------------------


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    data: UserCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Create a new user. Admin-only."""
    # Validate role consistency
    if data.role == UserRole.admin:
        if data.referrer_id is not None or data.family_id is not None:
            raise HTTPException(
                status_code=400,
                detail="Admin users must not have referrer_id or family_id",
            )
    elif data.role == UserRole.referrer:
        if data.referrer_id is None:
            raise HTTPException(
                status_code=400,
                detail="Referrer users must have a referrer_id",
            )
        if data.family_id is not None:
            raise HTTPException(
                status_code=400,
                detail="Referrer users must not have a family_id",
            )
    elif data.role == UserRole.family:
        if data.family_id is None:
            raise HTTPException(
                status_code=400,
                detail="Family users must have a family_id",
            )
        if data.referrer_id is not None:
            raise HTTPException(
                status_code=400,
                detail="Family users must not have a referrer_id",
            )

    # Check for duplicate email
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    # Validate foreign key references exist
    if data.family_id is not None:
        if not db.query(Family).filter(Family.id == data.family_id).first():
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

    user = User(
        email=data.email,
        hashed_password=get_password_hash(data.password),
        role=data.role,
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
async def login(data: UserLogin, response: Response, db: Session = Depends(get_db)):
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

    return {
        "message": "Login successful",
        "user": UserResponse.model_validate(user),
    }


# ---------------------------------------------------------------------------
# Logout
# ---------------------------------------------------------------------------


@router.post("/logout")
async def logout(response: Response, _user: User = Depends(get_current_user)):
    """Clear auth cookies."""
    clear_auth_cookies(response)
    return {"message": "Logged out"}


# ---------------------------------------------------------------------------
# Token refresh
# ---------------------------------------------------------------------------


@router.post("/refresh")
async def refresh(
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
async def me(user: User = Depends(get_current_user)):
    """Return the current authenticated user's profile."""
    return user


# ---------------------------------------------------------------------------
# Change own password
# ---------------------------------------------------------------------------


@router.put("/me/password")
async def change_password(
    data: ChangePassword,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Change the authenticated user's password."""
    if not verify_password(data.old_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect old password")

    user.hashed_password = get_password_hash(data.new_password)
    db.commit()

    return {"message": "Password changed"}


# ---------------------------------------------------------------------------
# Forgot password (development: logs the token)
# ---------------------------------------------------------------------------


@router.post("/forgot-password")
async def forgot_password(data: ForgotPassword, db: Session = Depends(get_db)):
    """Generate a password-reset token. In dev mode the token is logged."""
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

    # In production this would send an email with the token
    logger.warning(
        "[DEV] Password reset token for %s: %s",
        user.email,
        raw_token,
    )

    return {"message": "If the email exists, a reset link has been sent"}


# ---------------------------------------------------------------------------
# Reset password
# ---------------------------------------------------------------------------


@router.post("/reset-password")
async def reset_password(data: ResetPassword, db: Session = Depends(get_db)):
    """Consume a reset token and set a new password."""
    reset = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == data.token,
        PasswordResetToken.used.is_(False),
    ).first()

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

    return {"message": "Password has been reset"}
