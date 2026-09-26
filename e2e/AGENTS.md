# E2E Tests — Agent Instructions

## Running

Check if the stack is up first:

```bash
curl -sf http://localhost/login > /dev/null 2>&1 && echo "up" || echo "down"
```

If the stack is down, **ask the user to bring it up** before proceeding.

If the stack is up, it always contains the current code. Do not waste time probing.

Run and capture output:

```bash
cd /dockerx/kindness-is-magic/e2e && npx playwright test > /tmp/e2e-test-output.txt 2>&1
```

Check the exit code. `tail -1` the file for the summary; on failure, read it for tracebacks.

Run a subset of tests by file pattern:

```bash
npx playwright test tests/admin-*.spec.ts
npx playwright test tests/role-*.spec.ts
```

## Architecture

Each test file is self-contained and creates its own data. Tests that need authenticated sessions create their own browser contexts with storageState files — do not rely on project-level storageState. The five storageState accounts (admin, referrer, family, purchaser, delivery) exist before any test runs, even with `--grep` — the admin is the bootstrap admin from `.env` (`ADMIN_EMAIL`/`ADMIN_PASSWORD`); the other four are CSV-seeded.

Unlike those five, there is no `donor.json` storageState (the CSV does seed a donor account, but tests don't use it). Donor users are created dynamically per-test via API and log in through the UI.

## Zeffy-dependent tests

`donor-cart.spec.ts` and `admin-zeffy-payments.spec.ts` run the cash-sponsorship flow against the bundled `zeffy-mock` (see `helpers/zeffy-mock.ts`). They self-skip with a printed reason when the stack's `.env` is not wired to the mock — so with real Zeffy credentials configured, these two specs skip by design. Don't work around it: the real API is org-rate-limited and tests must never hit it. A standard dev stack (`.env.example` values) runs them.

## Conventions

- **`data-id` on table rows.** Family and people table rows carry `data-id={entity.id}` so tests can extract the raw DB ID for API calls. The visible ID column shows the presentational `display_id` (e.g. `3-2-1`), which must not be parsed as a DB key.
- **`data-testid="role-badge"` on the dashboard role badge.** Assert the logged-in role through it (e.g. `getByTestId("role-badge").toHaveText("Admin")`), not a bare `getByText("Admin")` — display names default to the email local-part capitalized, so with the `.env.example` admin (`admin@example.test`) the profile name is also "Admin" and the bare text matches both (strict-mode violation).
- Use `{ exact: true }` when text could collide (e.g., "Family" matches "Family ID: N").
- Reuse helpers from `helpers/auth.ts`, `helpers/assertions.ts`, and `helpers/api.ts`.
- **Unique test data per run.** Use `Math.random().toString(36).slice(2, 8)` suffixes on names/emails so re-runs without a DB wipe don't collide with stale records from prior runs.
- **`test.describe.serial()` for shared module state.** When tests within a file share module-level variables (IDs, credentials), wrap them in `test.describe.serial()` so they run in order on a single worker. Module state is cached per worker process, **not per test**: a plain `describe` whose tests land in multiple batches on the same worker re-runs `beforeAll` with the same import-time values (e.g. the same random email), and setup collides with its own earlier data (409 — emails stay reserved even after soft-delete).
- **Mock payments are tag-scoped.** The zeffy specs share one mock across the fully-parallel suite; the reset/seed/list helpers take a tag — only ever touch your own spec's tag.
- **APIs for setup/teardown only.** Use `helpers/api.ts` to create test data before tests and clean up in `test.afterAll`. Do not use APIs to find IDs, navigate, or verify state that the test is meant to exercise through the UI. If a test is about the UI, the UI is the path.

## Cleanup — The Golden Rule

**Never delete CSV-seeded records in `test.afterAll`.** Only clean up records your test *created*. If a test navigates to a seeded record to find its ID, do NOT store that ID for deletion.

All entities use soft-delete (`deleted_at`). Lookups filter active records only. Soft-deleting a seeded record causes CSV re-import to create a duplicate at a new ID, orphaning any users/people that reference the old one. This produces silent 404s that are hard to trace.


