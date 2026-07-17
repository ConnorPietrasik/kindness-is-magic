# Frontend — Agent Instructions

## Stack

- **React 19** with **TypeScript** (`.tsx` files, strict mode enabled)
- **TypeScript** with `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`
- **Vite** as the build tool
- **Tailwind CSS v4** via `@tailwindcss/vite` plugin
- **React Query** (`@tanstack/react-query`) for server state
- **Axios** for HTTP requests
- **React Router v7** for client-side routing
- **Vitest** + **@testing-library/react** + **@testing-library/jest-dom** + **@testing-library/user-event** for unit/component tests

## TypeScript

- Never use `any`. Use `unknown` and narrow, or import the correct type from `src/types/`.
- Explicitly type exported functions, hooks, and APIs. Infer local variable types when obvious.

## Frontend Rules

- All remote server state must be managed by React Query. `useState` is only for local UI state (not duplicated server data).
- Keep API calls in `src/lib/api.ts`; do not call Axios directly from page components.
- Prefer reusing components from `src/components/` and `useCrudManager` over duplicating patterns.
- Use Tailwind utility classes for styling. Do not add CSS modules, styled-components, or arbitrary CSS files. Modify `src/index.css` only for global styles, Tailwind `@theme` changes, or application-wide behavior. Avoid inline styles except for dynamic values that cannot be expressed with Tailwind.

## React Query Rules

- Use the hook's `isLoading`/`isError`/`data` instead of manual request flags.
- Mutations must invalidate affected queries after success (see `useCrudManager` for the pattern).
- Query keys should be stable arrays, passed as parameters or defined near their usage.

## Testing

### What to test where

- **Vitest** — pure utilities, API layer, hooks, context, route guards, and components with non-trivial logic. Tests run in jsdom with no real network.
- **Playwright** — full user flows: login, CRUD operations, role-based access, CSV upload, password reset. Vitest does not replace Playwright.

### Conventions

- **Mock only external boundaries.** Mock Axios/API calls and browser APIs when necessary. Do not mock React, React Query, or component internals.
- **Use a real `QueryClient`** (created fresh per test with `retry: false`) when testing hooks or context. Don't mock React Query's hooks.
- **Pass mock API functions as options** to hooks rather than using `vi.mock` on imports — hooks accept API functions as parameters.
- **Use `@testing-library/user-event`** (`user.click()`, `user.type()`) over `fireEvent`.
- **Use `@testing-library/jest-dom`** matchers (`toBeInTheDocument()`, `toHaveValue()`).
- **Use explicit `cleanup()` in `afterEach`** for tests that render components with `<Navigate>` or dialogs — RTL auto-cleanup doesn't fire reliably in this vitest config.
- **Wrap route components in `<MemoryRouter>`** rather than mocking `useNavigate`.
- **No snapshot testing.** Not useful for this app's component structure.
- **No coverage targets.** Cover logic, not line counts.

## API Proxy

Vite dev server proxies `/api` → `http://backend:8000` (see `vite.config.mts`). In production the backend sits behind the same origin. All API calls use relative paths — never hardcode absolute backend URLs in application code.

## Authentication

- **Cookie-based auth** (HttpOnly cookies), **not** JWT in localStorage.
- Axios `withCredentials: true` sends cookies with every request.
- On `401`, the Axios interceptor attempts a silent refresh via `POST /api/auth/refresh` with thundering-herd protection (single in-flight refresh, pending 401s retry afterward).
- If refresh fails, the interceptor rejects — `AuthContext` sets `user=null` and React Router navigates to `/login` (no hard redirect).

## API Layer

- Functions are grouped by domain: auth, admin, referrer, family, shared.
- Functions return `response.data`, not raw Axios response objects. **Exception:** `loginRequest` and `registerRequest` return the full axios response (AuthContext destructures `{ data }` from them — do not change this).
- Extend `src/lib/api.ts` rather than creating new fetch utilities.

## Error Handling

- `formatApiError(error, fallback?)` in `src/lib/utils.ts` extracts user-facing strings from Axios errors, checking `response.data.detail`, `.msg`, then full JSON, then `error.message`.
- `ErrorBox` and `MutationErrors` components render errors in the UI.

## Shared CRUD Hook

`src/hooks/useCrudManager.ts` encapsulates list/detail CRUD pages.

- Reuse it instead of duplicating CRUD state management.
- It handles queries, mutations, invalidation, and common UI state (form visibility, editing id, delete confirmation).

### Adding a New CRUD Page

1. Add API functions to `src/lib/api.ts`
2. Reuse `useCrudManager` for data fetching and mutations
3. Reuse existing table/form components from `src/components/`
4. Add route in `src/lib/routes.ts` and lazy-loaded page in `src/App.tsx`
5. Add Vitest tests for new logic; Playwright tests if user workflow changes

## User Roles and Routes

Three roles: `admin`, `referrer`, `family`.

- **`ProtectedRoute`** component wraps routes with a `roles` array. Unauthenticated users are redirected to `/login`; wrong-role users to `/dashboard`.
- Root `/` uses `DashboardRedirect` to send authenticated users to their role-specific dashboard.
- Route paths are centralized in `src/lib/routes.ts`. Always use `ROUTES` constants and `route` helpers rather than hardcoded strings.

## Structure

Only entries that encode conventions are listed here. The full directory tree is discoverable — these are the locations that matter because they carry rules.

- `src/components/` — Reusable UI components. Use **named exports**.
- `src/types/` — Shared TypeScript types. Import from here rather than redefining shapes.
- `src/lib/api.ts` — Axios instance and all API functions. Do not call Axios directly from page components.
- `src/lib/routes.ts` — Route constants and dynamic builders. Always use `ROUTES` constants rather than hardcoded strings.
- `src/hooks/useCrudManager.ts` — Shared CRUD hook. Reuse it instead of duplicating CRUD state management.
- Pages in `src/pages/` are **lazy-loaded** via `React.lazy()` with a `<Suspense>` spinner fallback.
- Test files: `*.test.ts` / `*.test.tsx` alongside source, or in `src/__tests__/`.

## Linting and Formatting

**Biome** (`@biomejs/biome`) handles linting and formatting. Config is in `biome.json`.

- Double quotes, semicolons, 140 char line width, organize imports
- Lint: `recommended` preset, see `biome.json` for overrides
- Run `npm run lint` to check, `npm run lint:fix` to auto-fix
- Biome formatting is authoritative. Do not manually reformat code against Biome's output.

## Definition of Done

Changes should:

- compile (`npm run typecheck`)
- pass lint with no errors or warnings (`npm run lint`)
- pass tests (`npm run test`)
- follow existing project patterns
- avoid introducing duplicate abstractions
