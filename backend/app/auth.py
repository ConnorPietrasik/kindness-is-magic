"""Authentication utilities: bcrypt password hashing, JWT creation/verification, cookie helpers."""

import os

import bcrypt
import jwt
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_db

# ---------------------------------------------------------------------------
# Configuration (from environment)
# ---------------------------------------------------------------------------
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-change-me")
REFRESH_SECRET_KEY = os.environ.get(
    "REFRESH_SECRET_KEY", "dev-refresh-secret-key-change-me"
)
ALGORITHM = "HS256"

ACCESS_TOKEN_EXPIRE_MINUTES = int(
    os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "30")
)
REFRESH_TOKEN_EXPIRE_DAYS = int(os.environ.get("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

# ---------------------------------------------------------------------------
# Password hashing (bcrypt)
# ---------------------------------------------------------------------------


def get_password_hash(password: str) -> str:
    """Hash a plain-text password with bcrypt (rounds=12)."""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plain-text password against a bcrypt hash."""
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Create a short-lived JWT access token."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update(exp=expire)
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: dict) -> str:
    """Create a long-lived JWT refresh token."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update(exp=expire, type="refresh")
    return jwt.encode(to_encode, REFRESH_SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Decode and validate an access token. Raises HTTPException on failure."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def decode_refresh_token(token: str) -> dict:
    """Decode and validate a refresh token."""
    try:
        payload = jwt.decode(token, REFRESH_SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "refresh":
            raise jwt.InvalidTokenError("Not a refresh token")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ---------------------------------------------------------------------------
# Cookie helpers
# ---------------------------------------------------------------------------

# Detect production (HTTPS) vs development (HTTP) via an env var
_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"


def set_auth_cookies(response, access_token: str, refresh_token: str):
    """Set HttpOnly cookies for access and refresh tokens on a Response object."""
    from fastapi.responses import Response

    response.set_cookie(
        key="access_token",
        value=access_token,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=_SECURE,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        httponly=True,
        secure=_SECURE,
        samesite="lax",
        path="/",
    )


def clear_auth_cookies(response):
    """Clear the auth cookies on a Response object."""
    from fastapi.responses import Response

    for cookie_name in ("access_token", "refresh_token"):
        response.delete_cookie(key=cookie_name, path="/")


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


async def get_current_user(
    access_token: str | None = Cookie(None, alias="access_token"),
    db: Session = Depends(get_db),
):
    """Extract the current User from the HttpOnly access_token cookie."""
    from app.models import User

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if access_token is None:
        raise credentials_exception

    try:
        payload = decode_access_token(access_token)
        user_id: str | None = payload.get("sub")
    except HTTPException:
        raise credentials_exception

    if user_id is None:
        raise credentials_exception

    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None or not user.is_active:
        raise credentials_exception

    return user


Currentuser = Annotated["app.models.User", Depends(get_current_user)]
