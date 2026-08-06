#!/usr/bin/env python3
"""Generate standalone HTML examples of all email types (no sending required).

Usage:
    python3 generate_email_examples.py [--output-dir /path/to/dir]

Outputs one HTML file per email type. Open them in a browser to preview.
"""

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

# Ensure we can import from app/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.mail import (
    _wrap_email,
    build_family_approved_email,
    build_family_invite_email,
    build_family_pending_email,
    build_invite_email,
    build_password_reset_email,
    build_referrer_approved_email,
    build_referrer_rejected_email,
)

# ---------------------------------------------------------------------------
# Example data
# ---------------------------------------------------------------------------

EXAMPLES = [
    {
        "filename": "01-referrer-invite.html",
        "label": "Referrer Invite",
        "body": build_invite_email(
            code="KRI-ABC12DEF",
            family_limit=5,
            expires_at=datetime(2025, 7, 15, 12, 0),
            from_name="Sarah Johnson",
        ),
        "unsubscribe": True,
    },
    {
        "filename": "02-referrer-invite-locked.html",
        "label": "Referrer Invite (email-locked)",
        "body": build_invite_email(
            code="KRI-XYZ98GHI",
            family_limit=3,
            expires_at=datetime(2025, 8, 1, 9, 30),
            from_name="Michael Chen",
            email="locked@example.com",
        ),
        "unsubscribe": True,
    },
    {
        "filename": "03-password-reset.html",
        "label": "Password Reset",
        "body": build_password_reset_email(reset_link="https://kindnessismagic.love/reset-password?token=eyJhbGciOiJIUzI1NiJ9.example"),
        "unsubscribe": False,  # exempt from unsubscribe
    },
    {
        "filename": "04-family-pending.html",
        "label": "Family Pending Approval (to referrer)",
        "body": build_family_pending_email(
            family_name="The Rodriguez Family",
            referrer_name="Sarah Johnson",
        ),
        "unsubscribe": True,
    },
    {
        "filename": "05-family-approved.html",
        "label": "Family Approved (to family)",
        "body": build_family_approved_email(
            family_name="The Rodriguez Family",
            referrer_name="Sarah Johnson",
        ),
        "unsubscribe": True,
    },
    {
        "filename": "06-family-invite.html",
        "label": "Family Invite (from referrer)",
        "body": build_family_invite_email(
            code="KFI-JKL34MNO",
            referrer_name="Sarah Johnson",
        ),
        "unsubscribe": True,
    },
    {
        "filename": "07-referrer-approved.html",
        "label": "Referrer Approved",
        "body": build_referrer_approved_email(
            referrer_name="David Park",
        ),
        "unsubscribe": True,
    },
    {
        "filename": "08-referrer-rejected.html",
        "label": "Referrer Rejected",
        "body": build_referrer_rejected_email(
            referrer_name="David Park",
        ),
        "unsubscribe": True,
    },
]


def main():
    parser = argparse.ArgumentParser(description="Generate email HTML examples")
    parser.add_argument(
        "--output-dir",
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "email_examples"),
        help="Output directory for HTML files (default: email_examples/)",
    )
    args = parser.parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Generating email examples into: {output_dir}\n")

    for example in EXAMPLES:
        unsubscribe_url = "https://kindnessismagic.love/api/auth/unsubscribe?token=example" if example["unsubscribe"] else None
        full_html = _wrap_email(example["body"], unsubscribe_url)

        filepath = output_dir / example["filename"]
        filepath.write_text(full_html, encoding="utf-8")
        print(f"  ✓ {example['filename']}  —  {example['label']}")

    print("\nDone. Open the files in a browser to preview.")
    print(f"  Example: open {output_dir / '01-referrer-invite.html'}")


if __name__ == "__main__":
    main()
