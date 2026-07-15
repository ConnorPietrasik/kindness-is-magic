"""Rate limiter configuration — shared to avoid circular imports."""

from slowapi import Limiter
from slowapi.util import get_remote_address


def _rate_limit_key(request):
    """Return None for test clients so tests aren't rate-limited."""
    addr = get_remote_address(request)
    if addr == "testclient":
        return None
    return addr


limiter = Limiter(key_func=_rate_limit_key)
