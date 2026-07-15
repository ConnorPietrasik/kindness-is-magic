# Frontend — Agent Instructions

## Stack

- **React 18** with **JSX** (`.jsx` files, currently not TypeScript)
- **Vite 5** as the build tool
- **Tailwind CSS v4** via `@tailwindcss/vite` plugin
- **React Query** (`@tanstack/react-query`) for server state
- **Axios** for HTTP requests
- **React Router v6** for client-side routing

## Scripts

```bash
npm run dev       # Start dev server (port 3000, proxies /api to backend:8000)
npm run build     # Production build → dist/
npm run preview   # Preview production build locally
```

There is **no** `typecheck` or `lint` script — the project uses plain JavaScript, not TypeScript, and has no ESLint config.

## Frontend Rules

- Use React Query for server state rather than custom fetching or component-level state.
- Keep API calls in `src/lib/api.js`; do not call Axios directly from page components.
- Prefer reusing components from `src/components/` and `useCrudManager` over duplicating patterns.

## Structure

- `src/main.jsx` — Entry point. Providers stacked: `QueryClientProvider` → `BrowserRouter` → `AuthProvider` → `App`. QueryClient defaults: `retry: 1`, `staleTime: 5min`.
- `src/App.jsx` — Router definition. All pages are **lazy-loaded** via `React.lazy()` and wrapped in `<Suspense>` with a spinner fallback.
- `src/index.css` — Global styles: Tailwind `@theme` custom colors, base resets, focus outlines, select styling, print styles, mobile touch targets.
- `src/pages/` — Route-level page components (Login, Dashboard, AdminFamilies, etc.)
- `src/components/` — Reusable UI components (Button, Card, Table, FormField, etc.). Use **named exports**, not default exports.
- `src/components/defaults.js` — Default empty form shapes for Person, Family, and Referrer entities.
- `src/context/AuthContext.jsx` — Auth state backed by React Query `useQuery` (not `useState`). Provides `user`, `isLoading`, `login`, `logout`, `checkAuth`, and derived `isAdmin`/`isReferrer`/`isFamily` booleans.
- `src/lib/api.js` — Axios instance and all API functions, grouped by domain (auth, admin, referrer, family, shared).
- `src/lib/routes.js` — Route constants (`ROUTES` object) and dynamic route builders (`route` object).
- `src/lib/utils.js` — Shared utilities: `humanize()` and `formatApiError()`.
- `src/hooks/useCrudManager.js` — Shared CRUD hook for list/detail forms (see below).

## API Proxy

Vite dev server proxies `/api` → `http://backend:8000` (see `vite.config.js`). In production the backend sits behind the same origin.

## Authentication

- **Cookie-based auth** (HttpOnly cookies), **not** JWT in localStorage.
- Axios `withCredentials: true` sends cookies with every request.
- On `401`, the Axios interceptor attempts a silent refresh via `POST /api/auth/refresh` with thundering-herd protection (single in-flight refresh, pending 401s retry afterward).
- If refresh fails, the interceptor rejects — `AuthContext` sets `user=null` and React Router navigates to `/login` (no hard redirect).

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

## API Layer

- Keep API calls in `src/lib/api.js`; do not call Axios directly from page components.
- Functions are grouped by domain: auth, admin, referrer, family, shared.
- Functions return `response.data`, not raw Axios response objects.

## Error Handling

- `formatApiError(error, fallback?)` in `src/lib/utils.js` extracts user-facing strings from Axios errors, checking `response.data.detail`, `.msg`, then full JSON, then `error.message`.
- `ErrorBox` and `MutationErrors` components render errors in the UI.

## Shared CRUD Hook

`src/hooks/useCrudManager.js` encapsulates list/detail CRUD pages.

- Reuse it instead of duplicating CRUD state management.
- It handles queries, mutations, invalidation, and common UI state (form visibility, editing id, delete confirmation).
