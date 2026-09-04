"""Business logic constants.

Centralises limits and thresholds so they are defined in one place and
imported wherever needed.
"""

import os

# Base URL for the application (used in emails, CORS, redirect links)
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost")

# Maximum number of active persons a family can have (non-admin creation)
MAX_FAMILY_PERSONS = 10

# Maximum active gift-claims per user
GIFT_CLAIM_CAP = 5

# After a refresh token is rotated, how long (seconds) the pre-rotation token
# is still accepted. The browser cookie jar is shared across tabs, so two tabs
# can legitimately present the same refresh token at the same moment; the
# window lets the slower of the two complete its rotation instead of being
# logged out. Presentations outside the window are treated as replays (401).
REFRESH_ROTATION_GRACE_SECONDS = 60
