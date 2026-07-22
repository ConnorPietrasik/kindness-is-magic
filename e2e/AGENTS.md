# E2E Tests — Agent Instructions

## Running

E2E tests require the full stack. Check it first:

```bash
curl -sf http://localhost/login > /dev/null 2>&1 && echo "up" || echo "down"
```

If the stack is down, **ask the user to bring it up** before proceeding.

Run and capture output:

```bash
cd /dockerx/kindness-is-magic/e2e && npx playwright test > /tmp/e2e-test-output.txt 2>&1
```

Check the exit code. `tail -1` the file for the summary; on failure, read it for tracebacks.

## Architecture

See `playwright.config.ts` (4 projects: admin, referrer, family, guest) and `helpers/global-setup.ts` (seeds DB via CSV, generates storageState files). Projects run in config order and share seed data — later projects depend on earlier ones not destroying it.

## Conventions

- **No `data-testid` attributes.** Selectors use labels, roles, headings, visible text.
- Use `{ exact: true }` when text could collide (e.g., "Family" matches "Family ID: N").
- Reuse helpers from `helpers/auth.ts` and `helpers/assertions.ts`.
- **Unique test data per run.** Use `Math.random().toString(36).slice(2, 6)` suffixes on names/emails so re-runs without a DB wipe don't collide with stale records from prior runs.

## Cleanup — The Golden Rule

**Never delete CSV-seeded records in `test.afterAll`.** Only clean up records your test *created*. If a test navigates to a seeded record to find its ID, do NOT store that ID for deletion.

All entities use soft-delete (`deleted_at`). Lookups filter active records only. Soft-deleting a seeded record causes CSV re-import to create a duplicate at a new ID, orphaning any users/people that reference the old one. This produces silent 404s that are hard to trace.

## Adding Tests

1. File in `tests/`, name matching the flow (e.g., `module-flow.spec.ts`).
2. Add `testMatch` to the appropriate project in `playwright.config.ts`.
3. Clean up ad-hoc records in `test.afterAll` via helpers in `helpers/api.ts`.
