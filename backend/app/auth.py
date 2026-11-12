"""Authentication utilities: bcrypt password hashing, JWT creation/verification, cookie helpers."""

import os
import secrets

import bcrypt
import jwt
from datetime import datetime, timedelta, timezone
from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db

# ---------------------------------------------------------------------------
# Configuration (from environment)
# ---------------------------------------------------------------------------
# Built-in fallback keys, committed to the repository — fine for DEBUG/dev,
# but anyone who can read the repo can forge tokens with them.
# validate_production_secrets() refuses to boot outside DEBUG with either.
_DEFAULT_SECRET_KEY = "dev-secret-key-change-me-in-production-aaaabbbbccccdddd"
_DEFAULT_REFRESH_SECRET_KEY = "dev-refresh-secret-key-change-me-in-production-aaaabbbbccccdddd"

SECRET_KEY = os.environ.get("SECRET_KEY", _DEFAULT_SECRET_KEY)
REFRESH_SECRET_KEY = os.environ.get("REFRESH_SECRET_KEY", _DEFAULT_REFRESH_SECRET_KEY)
ALGORITHM = "HS256"

ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.environ.get("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
INVITE_EXPIRY_HOURS = int(os.environ.get("INVITE_EXPIRY_HOURS", "168"))


def validate_production_secrets() -> None:
    """Fail closed if a non-DEBUG process would sign with the built-in dev keys.

    The fallback keys are public in the repository, so signing with them in
    production lets anyone mint access-token cookies (including admin ids) and
    unsubscribe tokens. Empty keys are rejected for the same reason. Called
    from the app lifespan in every worker before any request is served; a
    no-op when DEBUG=true.
    """
    if os.environ.get("DEBUG", "false").lower() == "true":
        return
    if not SECRET_KEY or SECRET_KEY == _DEFAULT_SECRET_KEY:
        raise RuntimeError(
            "Refusing to start: SECRET_KEY is unset, empty, or still the built-in dev default, "
            "which is public in the repository and would allow forged admin sessions. "
            'Generate a unique one: python -c "import secrets; print(secrets.token_urlsafe(48))"'
        )
    if not REFRESH_SECRET_KEY or REFRESH_SECRET_KEY == _DEFAULT_REFRESH_SECRET_KEY:
        raise RuntimeError(
            "Refusing to start: REFRESH_SECRET_KEY is unset, empty, or still the built-in dev default, "
            "which is public in the repository. "
            'Generate a unique one: python -c "import secrets; print(secrets.token_urlsafe(48))"'
        )


# ---------------------------------------------------------------------------
# Invite code generation
# ---------------------------------------------------------------------------


def generate_invite_code(prefix: str = "KRI") -> str:
    """Return a human-readable invite code like KRI-A7X9P2.

    The *prefix* defaults to ``KRI`` for referrer invite tokens.
    Pass ``KFI`` for family invite codes.
    """
    raw = secrets.token_urlsafe(6).upper()[:6]  # 6 chars from base62-ish pool
    return f"{prefix}-{raw}"


def generate_unique_family_invite_code(db: "Session") -> str:
    """Generate a KFI- prefixed family invite code that is unique in the DB.

    Retries on collision (extremely unlikely with 6 random chars).
    """
    from app.models import Referrer

    code = generate_invite_code(prefix="KFI")
    while db.query(Referrer).filter(Referrer.family_invite_code == code).first():
        code = generate_invite_code(prefix="KFI")
    return code


# ---------------------------------------------------------------------------
# Password hashing (bcrypt)
# ---------------------------------------------------------------------------


# bcrypt only accepts passwords of at most 72 bytes (UTF-8); longer input raises ValueError.
PASSWORD_MAX_LENGTH = 72


def get_password_hash(password: str) -> str:
    """Hash a plain-text password with bcrypt (rounds=12).

    Raises ValueError if the password exceeds 72 bytes in UTF-8.
    """
    password_bytes = password.encode("utf-8")
    if len(password_bytes) > PASSWORD_MAX_LENGTH:
        raise ValueError(f"too long (max {PASSWORD_MAX_LENGTH} characters)")
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password_bytes, salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plain-text password against a bcrypt hash.

    Returns False (rather than raising bcrypt's ValueError) when the candidate
    exceeds 72 UTF-8 bytes: no stored password can ever be that long (every
    write path enforces the limit), so over-long input can only be a wrong
    password.
    """
    plain_bytes = plain.encode("utf-8")
    if len(plain_bytes) > PASSWORD_MAX_LENGTH:
        return False
    return bcrypt.checkpw(plain_bytes, hashed.encode("utf-8"))


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Create a short-lived JWT access token."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update(exp=expire)
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(
    data: dict,
    db: "Session | None" = None,
) -> str:
    """Create a long-lived JWT refresh token.

    Each token gets a unique ``jti`` claim so that server-side rotation
    can distinguish the old token from the new one even when all other
    claims are identical.

    If *db* is provided the raw JWT string is also persisted to the
    ``refresh_tokens`` table so that the server can validate / revoke it
    on rotation, logout, and password change.
    """
    from app.models import RefreshToken

    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update(exp=expire, type="refresh", jti=secrets.token_urlsafe(16))
    token = jwt.encode(to_encode, REFRESH_SECRET_KEY, algorithm=ALGORITHM)

    if db is not None:
        user_id = int(data["sub"])
        db.add(
            RefreshToken(
                user_id=user_id,
                token=token,
                expires_at=expire,
            )
        )
        db.flush()

    return token


def decode_access_token(token: str) -> dict:
    """Decode and validate an access token. Raises HTTPException on failure."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session has expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session is no longer valid. Please log in again.",
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
            detail="Your session has expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session is no longer valid. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ---------------------------------------------------------------------------
# Cookie helpers
# ---------------------------------------------------------------------------


def set_auth_cookies(response, access_token: str, refresh_token: str):
    """Set HttpOnly cookies for access and refresh tokens on a Response object.

    Reads DEBUG from os.environ at call time so test monkeypatching works
    regardless of when the app modules were first imported.
    """
    _debug = os.environ.get("DEBUG", "false").lower() == "true"

    response.set_cookie(
        key="access_token",
        value=access_token,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=not _debug,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        httponly=True,
        secure=not _debug,
        samesite="lax",
        path="/",
    )


def clear_auth_cookies(response):
    """Clear the auth cookies on a Response object."""

    for cookie_name in ("access_token", "refresh_token"):
        response.delete_cookie(key=cookie_name, path="/")


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------


async def get_current_user(
    access_token: str | None = Cookie(None, alias="access_token"),
    db: Session = Depends(get_db),
):
    """Extract the current User from the HttpOnly access_token cookie."""
    from app.models import User

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Please log in again.",
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

    user = db.get(User, int(user_id))
    if user is None or user.deleted_at is not None:
        raise credentials_exception

    return user
