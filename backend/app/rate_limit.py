"""Rate limiter configuration — shared to avoid circular imports."""

import os

from slowapi import Limiter
from slowapi.util import get_remote_address


def _rate_limit_key(request):
    """Return the rate-limit key (client IP), or None to skip rate-limiting.

    Behind a reverse proxy (Traefik in prod) the TCP peer is the proxy, so
    the real client IP is the LAST entry of X-Forwarded-For: each proxy
    appends the peer it saw, and clients can only prepend, never append —
    only Traefik can reach the backend. Without the header (direct
    connection, tests) the TCP peer is used.

    Returns None to skip rate-limiting in test/dev environments:

    - Pytest httpx clients report 'testclient'.
    - In Docker dev stacks the requests come from internal container IPs
      (not localhost), so we also disable rate-limiting when DEBUG is True.

    Reads os.environ at call time so test monkeypatching works regardless
    of when the app modules were first imported.
    """
    xff = request.headers.get("x-forwarded-for", "")
    addr = xff.split(",")[-1].strip() or get_remote_address(request)
    if addr == "testclient":
        return None
    # Skip rate-limiting in non-production (dev + e2e test) environments
    if os.environ.get("DEBUG", "false").lower() == "true":
        return None
    return addr


limiter = Limiter(key_func=_rate_limit_key)
