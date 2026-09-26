"""Mock Zeffy API + donation form for the dev/e2e stack.

Runs as the ``zeffy-mock`` compose service (python:3.11-slim, stdlib only) so
the full cash-sponsorship flow — checkout, manual confirm, admin
unmatched-payments page, manual match — works end to end without a single
call to the real, org-rate-limited Zeffy API.

Endpoints implemented (subset of https://api.zeffy.com/api/v1 the backend
uses — read-only):

* ``GET /api/v1/campaigns/{id}``  — 200 for the configured campaign, 404 else
* ``GET /api/v1/payments``        — filters: campaign, status, created[gte],
                                    starting_after, limit; newest-first;
                                    cursor envelope {object, data, has_more,
                                    next_cursor}
* ``GET /api/v1/payments/{id}``   — 200 / 404
* ``GET /form``                   — the mock donation form: echoes the
                                    query params it receives (the backend
                                    sends the donor's email; Zeffy forms
                                    can't pre-fill the amount)

Test control endpoints (called by the Playwright suite, not by the backend).
Control calls are scoped by a ``tag`` (spec file name) — the suite runs
fully parallel and the mock is shared, so each spec seeds/resets only its own
payments. The API itself ignores tags (payments carry a ``_tag`` key that is
stripped from every /api/v1 response):

* ``GET  /__control/payments?tag=X`` — dump that tag's payment list
* ``POST /__control/payments``       — upsert one payment (JSON object) or a
                                       list of them; each may carry a ``tag``
                                       field (stripped before storage as
                                       ``_tag``); missing fields get defaults
                                       (fresh ``created``, mock campaign,
                                       ``succeeded``/``usd``/``online``)
* ``POST /__control/reset?tag=X``    — clear that tag's payment list
                                       (no tag = clear everything)

Auth: every ``/api/v1`` request must carry ``Authorization: Bearer <key>``
matching ``MOCK_API_KEY`` (wired from ``ZEFFY_API_KEY`` in compose), else 401 —
mirrors the real API so a key mismatch still surfaces as the backend's
"misconfigured" 503 path.

Payments live in memory only — the stack's DB is wiped regularly and the mock
restarts with the stack, so nothing is persisted.
"""

import html
import json
import os
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("MOCK_PORT", "8931"))
# Defaults mirror the committed .env.example values; compose passes the
# stack's real ZEFFY_* values through so the two never drift apart.
MOCK_CAMPAIGN_ID = os.environ.get("MOCK_CAMPAIGN_ID", "11111111-1111-4111-8111-111111111111")
MOCK_API_KEY = os.environ.get("MOCK_API_KEY", "e2e-mock-zeffy-key")

_lock = threading.Lock()
_payments: list[dict] = []  # newest-first is derived at read time


def _log(message: str) -> None:
    print(f"[zeffy-mock] {message}", flush=True)


def _default_payment(raw: dict) -> dict:
    """Fill in the fields the backend's parser expects."""
    return {
        "id": raw.get("id") or str(uuid.uuid4()),
        "created": int(raw.get("created") if raw.get("created") is not None else time.time()),
        "amount": int(raw.get("amount", 50000)),
        "currency": raw.get("currency", "usd"),
        "status": raw.get("status", "succeeded"),
        "type": raw.get("type", "online"),
        "campaign_id": raw.get("campaign_id") or MOCK_CAMPAIGN_ID,
        "description": raw.get("description") or "E2E mock campaign",
        "contact": raw.get("contact"),
        "buyer": raw.get(
            "buyer",
            {
                "email": raw.get("email"),
                "first_name": raw.get("first_name") or "E2E",
                "last_name": raw.get("last_name") or "Donor",
                "is_corporate": False,
                "company_name": None,
            },
        ),
        "receipt_url": raw.get("receipt_url") or f"https://receipts.example/mock/{raw.get('id', 'payment')}",
        "refund_status": raw.get("refund_status", "none"),
    }


def _public_payment(payment: dict) -> dict:
    """Strip internal ``_``-prefixed keys (tags) from an API-facing payload."""
    return {k: v for k, v in payment.items() if not k.startswith("_")}


def _campaign_response() -> dict:
    return {
        "id": MOCK_CAMPAIGN_ID,
        "object": "campaign",
        "title": "E2E mock campaign",
        "url": "/form",
        "status": "open",
        "type": "donation-form",
        "currency": "usd",
    }


class ZeffyMockHandler(BaseHTTPRequestHandler):
    server_version = "ZeffyMock/1.0"

    # ------------------------------------------------------------------ util

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status: int, code: str, message: str) -> None:
        self._send_json(status, {"error": {"code": code, "message": message}})

    def _read_json_body(self) -> object:
        length = int(self.headers.get("Content-Length") or 0)
        if length == 0:
            return None
        try:
            return json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            return None

    def _authorized(self) -> bool:
        return self.headers.get("Authorization") == f"Bearer {MOCK_API_KEY}"

    def log_message(self, fmt: str, *args) -> None:  # noqa: N802 — stdlib API
        _log(self.address_string() + " — " + fmt % args)

    # ------------------------------------------------------------------- GET

    def do_GET(self) -> None:  # noqa: N802 — stdlib API
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query)

        if path == "/":
            with _lock:
                count = len(_payments)
            self._send_json(200, {"status": "ok", "campaign_id": MOCK_CAMPAIGN_ID, "payments": count, "now": int(time.time())})
            return

        if path == "/form":
            self._serve_form(query)
            return

        if path == "/__control/payments":
            tag = query.get("tag", [None])[0]
            with _lock:
                rows = [p for p in _payments if tag is None or p.get("_tag") == tag]
            self._send_json(200, {"payments": [_public_payment(p) for p in rows]})
            return

        if not path.startswith("/api/v1"):
            self._send_error_json(404, "not_found", f"unknown path: {path}")
            return

        _log(f"API {path} {parsed.query}")
        if not self._authorized():
            self._send_error_json(401, "unauthorized", "invalid API key")
            return

        if path.startswith("/api/v1/campaigns/"):
            campaign_id = path.removeprefix("/api/v1/campaigns/")
            if campaign_id == MOCK_CAMPAIGN_ID:
                self._send_json(200, _campaign_response())
            else:
                self._send_error_json(404, "not_found", "campaign not found")
            return

        if path == "/api/v1/payments":
            self._list_payments(query)
            return

        if path.startswith("/api/v1/payments/"):
            payment_id = path.removeprefix("/api/v1/payments/")
            with _lock:
                payment = next((p for p in _payments if p["id"] == payment_id), None)
            if payment is None:
                self._send_error_json(404, "not_found", "payment not found")
            else:
                self._send_json(200, _public_payment(payment))
            return

        self._send_error_json(404, "not_found", f"unknown path: {path}")

    def _list_payments(self, query: dict) -> None:
        campaign = query.get("campaign", [None])[0]
        status = query.get("status", [None])[0]
        created_gte = query.get("created[gte]", [None])[0]
        starting_after = query.get("starting_after", [None])[0]
        try:
            limit = int(query.get("limit", ["10"])[0])
        except ValueError:
            limit = 10

        with _lock:
            rows = [dict(p) for p in _payments]
        rows.sort(key=lambda p: (p["created"], p["id"]), reverse=True)
        if campaign:
            rows = [p for p in rows if p["campaign_id"] == campaign]
        if status:
            rows = [p for p in rows if p["status"] == status]
        if created_gte:
            try:
                rows = [p for p in rows if p["created"] >= int(created_gte)]
            except ValueError:
                pass
        if starting_after:
            idx = next((i for i, p in enumerate(rows) if p["id"] == starting_after), None)
            rows = rows[idx + 1 :] if idx is not None else []

        page = rows[:limit]
        self._send_json(
            200,
            {
                "object": "list",
                "data": [_public_payment(p) for p in page],
                "has_more": len(rows) > limit,
                "next_cursor": page[-1]["id"] if len(rows) > limit else None,
            },
        )

    def _serve_form(self, query: dict) -> None:
        params = "".join(f"{k}={html.escape(v[0])}" for k, v in sorted(query.items()))
        email = query.get("email", [""])[0]
        body = f"""<!doctype html>
<html>
<head><meta charset="utf-8"><title>E2E mock Zeffy form</title></head>
<body style="font-family: sans-serif; max-width: 40rem; margin: 3rem auto;">
<h1>E2E mock Zeffy form</h1>
<p>This is the local mock donation form served by the <code>zeffy-mock</code>
compose service. No real payment happens here.</p>
<h2>Query params received</h2>
<pre id="params" style="background: #f3f4f6; padding: 1rem;">{params}</pre>
<p>Donor email: <strong>{html.escape(email)}</strong></p>
</body>
</html>
"""
        encoded = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    # ------------------------------------------------------------------ POST

    def do_POST(self) -> None:  # noqa: N802 — stdlib API
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        query = parse_qs(parsed.query)

        if path == "/__control/reset":
            tag = query.get("tag", [None])[0]
            with _lock:
                removed = sum(1 for p in _payments if tag is None or p.get("_tag") == tag)
                _payments[:] = [p for p in _payments if tag is not None and p.get("_tag") != tag]
            _log(f"control: reset tag={tag!r} (removed {removed})")
            self._send_json(200, {"ok": True, "removed": removed})
            return

        if path == "/__control/payments":
            body = self._read_json_body()
            if body is None:
                self._send_error_json(400, "bad_request", "expected a JSON payment object or list")
                return
            items = body if isinstance(body, list) else [body]
            if not items or not all(isinstance(item, dict) for item in items):
                self._send_error_json(400, "bad_request", "expected a JSON payment object or list of objects")
                return
            with _lock:
                for raw in items:
                    tag = raw.pop("tag", None)
                    payment = _default_payment(raw)
                    if tag is not None:
                        payment["_tag"] = tag
                    existing = next((p for p in _payments if p["id"] == payment["id"]), None)
                    if existing is not None:
                        existing.update(payment)
                    else:
                        _payments.append(payment)
                snapshot = [_public_payment(p) for p in _payments]
            _log(f"control: seeded {len(items)} payment(s) — total {len(snapshot)}")
            self._send_json(200, {"ok": True, "payments": snapshot})
            return

        self._send_error_json(404, "not_found", f"unknown path: {path}")


def main() -> None:
    _log(f"mock Zeffy API + form on 0.0.0.0:{PORT} (campaign {MOCK_CAMPAIGN_ID})")
    ThreadingHTTPServer(("0.0.0.0", PORT), ZeffyMockHandler).serve_forever()


if __name__ == "__main__":
    main()
