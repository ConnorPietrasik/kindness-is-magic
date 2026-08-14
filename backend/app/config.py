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
