# Frontend — Agent Instructions

## Stack

- **React 18** with **JSX** (`.jsx` files, currently not TypeScript)
- **Vite 5** as the build tool
- **Tailwind CSS v4** via `@tailwindcss/vite` plugin
- **React Query** (`@tanstack/react-query`) for server state
- **Axios** for HTTP requests
- **React Router v6** for client-side routing
- **Vitest** + **@testing-library/react** + **@testing-library/jest-dom** + **@testing-library/user-event** for unit/component tests

## Frontend Rules

- Use React Query for server state rather than custom fetching or component-level state.
- Keep API calls in `src/lib/api.js`; do not call Axios directly from page components.
- Prefer reusing components from `src/components/` and `useCrudManager` over duplicating patterns.
- Use Tailwind utility classes for styling. Do not add component-specific CSS files. Modify `src/index.css` only for global styles, Tailwind `@theme` changes, or application-wide behavior. Avoid inline styles except for dynamic values that cannot be expressed with Tailwind.

## React Query Rules

- Do not duplicate server state into `useState`. Let React Query own the data.
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

Vite dev server proxies `/api` → `http://backend:8000` (see `vite.config.js`). In production the backend sits behind the same origin. All API calls use relative paths — never hardcode absolute backend URLs in application code.

## Authentication

- **Cookie-based auth** (HttpOnly cookies), **not** JWT in localStorage.
- Axios `withCredentials: true` sends cookies with every request.
- On `401`, the Axios interceptor attempts a silent refresh via `POST /api/auth/refresh` with thundering-herd protection (single in-flight refresh, pending 401s retry afterward).
- If refresh fails, the interceptor rejects — `AuthContext` sets `user=null` and React Router navigates to `/login` (no hard redirect).

## API Layer

- Functions are grouped by domain: auth, admin, referrer, family, shared.
- Functions return `response.data`, not raw Axios response objects. **Exception:** `loginRequest` and `registerRequest` return the full axios response (AuthContext destructures `{ data }` from them — do not change this).
- Extend `src/lib/api.js` rather than creating new fetch utilities.

## Error Handling

- `formatApiError(error, fallback?)` in `src/lib/utils.js` extracts user-facing strings from Axios errors, checking `response.data.detail`, `.msg`, then full JSON, then `error.message`.
- `ErrorBox` and `MutationErrors` components render errors in the UI.

## Shared CRUD Hook

`src/hooks/useCrudManager.js` encapsulates list/detail CRUD pages.

- Reuse it instead of duplicating CRUD state management.
- It handles queries, mutations, invalidation, and common UI state (form visibility, editing id, delete confirmation).

## User Roles and Routes

Three roles: `admin`, `referrer`, `family`.

- **`ProtectedRoute`** component wraps routes with a `roles` array. Unauthenticated users are redirected to `/login`; wrong-role users to `/dashboard`.
- Root `/` uses `DashboardRedirect` to send authenticated users to their role-specific dashboard.
- Route paths are centralised in `ROUTES` (e.g. `ROUTES.ADMIN_FAMILIES`). Dynamic paths use the `route` builder (e.g. `route.referrerFamilyDetail(id)`).

### Route map

| Role     | Routes                                                                 |
|----------|------------------------------------------------------------------------|
| Public   | `/login`, `/forgot-password`, `/reset-password/:token`                 |
| All      | `/dashboard`                                                           |
| Admin    | `/register`, `/admin/referrers`, `/admin/families`, `/admin/people`, `/admin/csv-upload` |
| Referrer | `/referrer/dashboard`, `/referrer/families/:id`                        |
| Family   | `/family/dashboard`, `/family/people`                                  |

## Structure

- `src/main.jsx` — Entry point. Providers stacked: `QueryClientProvider` → `BrowserRouter` → `AuthProvider` → `App`. QueryClient defaults: `retry: 1`, `staleTime: 5min`.
- `src/App.jsx` — Router. All pages are **lazy-loaded** via `React.lazy()` with `<Suspense>` spinner fallback. New pages should follow this pattern.
- `src/components/` — Reusable UI components. Use **named exports**, not default exports.
- `src/lib/api.js` — Axios instance and all API functions. See [API Layer](#api-layer).
- `src/lib/routes.js` — Route constants (`ROUTES`) and dynamic builders (`route`).
- `src/lib/utils.js` — `humanize()` and `formatApiError()`.
- `src/lib/csv.js` — Client-side CSV parsing and validation.
- `src/hooks/useCrudManager.js` — Shared CRUD hook. See [Shared CRUD Hook](#shared-crud-hook).
- `src/context/AuthContext.jsx` — Auth state via React Query. See [Authentication](#authentication).
- Test files: `*.test.js` / `*.test.jsx` alongside source, or in `src/__tests__/`.

## Scripts

```bash
npm run dev           # Start dev server (port 3000, proxies /api to backend:8000)
npm run build         # Production build → dist/
npm run preview       # Preview production build locally
npm run test          # Run Vitest test suite
npm run test:coverage # Run tests with coverage (requires @vitest/coverage-v8)
```

There is **no** `typecheck` or `lint` script — the project uses plain JavaScript, not TypeScript, and has no ESLint config.
