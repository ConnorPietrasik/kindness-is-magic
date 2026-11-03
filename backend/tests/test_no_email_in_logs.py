"""Regression test: no email addresses may appear in structured log call sites.

Enforces the backend/AGENTS.md rule "No emails in logs (PII minimization)":
the actor is always the user_id, so logger calls must not pass email values
(attributes ending in `.email`, email-named variables) as format arguments.

The single sanctioned exception is the unsubscribe endpoint, where the address
may belong to no user (allowlisted by message text, not line number, so it
survives line drift).

This is a static AST sweep over app/ — it needs no DB or app import.
"""

import ast
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent / "app"

LOG_LEVELS = {"debug", "info", "warning", "error", "exception", "critical"}

# (module filename, format-string substring) pairs exempt from the sweep.
ALLOWED = {
    ("auth_routes.py", "Email unsubscribed"),  # unsubscribe endpoint (see AGENTS.md)
}


def _is_email_expr(node: ast.expr) -> bool:
    """True if the expression is (or embeds) an email-valued attribute or variable."""
    if isinstance(node, ast.Attribute):
        return node.attr.lower().endswith("email")
    if isinstance(node, ast.Name):
        name = node.id.lower()
        return name in ("email", "recipient") or "email" in name
    if isinstance(node, ast.JoinedStr):  # f-string: check embedded expressions
        return any(_is_email_expr(p.value) for p in node.values if isinstance(p, ast.FormattedValue))
    return False


def _iter_violations():
    for path in sorted(APP_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
                continue
            func = node.func
            if func.attr not in LOG_LEVELS or not (isinstance(func.value, ast.Name) and func.value.id == "logger"):
                continue
            args = list(node.args)
            # Plain-string format: skip the message itself. F-strings (or other
            # expressions) keep their embedded expressions in the sweep.
            if args and isinstance(args[0], ast.Constant) and isinstance(args[0].value, str):
                message = args[0].value
                if any(path.name == fname and substring in message for fname, substring in ALLOWED):
                    continue
                value_args = args[1:]
            else:
                value_args = args
            value_args = value_args + [kw.value for kw in node.keywords]
            for arg in value_args:
                if _is_email_expr(arg):
                    yield f"{path.relative_to(APP_DIR.parent)}:{node.lineno}: logger.{func.attr}(...) arg={ast.unparse(arg)}"


def test_no_emails_in_log_calls():
    violations = list(_iter_violations())
    assert not violations, "emails found in log call sites (see backend/AGENTS.md 'No emails in logs'):\n" + "\n".join(violations)
