# Kindness Is Magic — Frontend Context Overview

> Read this file to quickly get up to speed on the frontend codebase.

## High-Level Summary

The frontend is a **React SPA** (single-page app) built with **Vite + React 18**. It provides a browser UI for three user roles — **Admin**, **Referrer**, and **Family** — to manage the Kindness Is Magic charity platform (referrers, families, people/wishes).

All styling is **inline `styles` objects** (no CSS framework, no CSS files, no Tailwind). Forms use controlled inputs with `useState`. Data fetching and mutations use **React Query** (`@tanstack/react-query`). Auth state is managed via a custom `AuthContext` backed by React Query. API calls use **Axios** with cookie-based auth (`withCredentials: true`) and an automatic token-refresh interceptor.

## Project Structure

```
frontend/
├── index.html
├── package.json
├── vite.config.js            # Vite config, /api proxy → backend:8000
├── Dockerfile
└── src/
    ├── main.jsx              # Entry: QueryClientProvider → BrowserRouter → AuthProvider → App
    ├── App.jsx               # Router: role-based redirects, all route definitions
    ├── context/
    │   └── AuthContext.jsx   # Global auth state (user, login, logout, checkAuth)
    ├── lib/
    │   └── api.js            # Axios instance + all API helper functions
    ├── components/
    │   └── ProtectedRoute.jsx # Route guard: checks auth + role membership
    └── pages/
        ├── Login.jsx                  # Public: email/password sign-in
        ├── Register.jsx               # Admin-only: create new referrer/family users
        ├── ForgotPassword.jsx         # Public: request password reset
        ├── ResetPassword.jsx          # Public: /reset-password/:token
        ├── Dashboard.jsx              # Shared: role-aware hub + change password
        ├── AdminReferrers.jsx         # Admin: CRUD referrers
        ├── AdminFamilies.jsx          # Admin: CRUD families (with referrer dropdown)
        ├── AdminPeople.jsx            # Admin: CRUD people (with family dropdown)
        ├── CsvUpload.jsx              # Admin: CSV bulk import with template preview
        ├── ReferrerDashboard.jsx      # Referrer: self profile + family list CRUD
        ├── ReferrerFamilyDetail.jsx   # Referrer: view/edit one family + its people CRUD
        ├── FamilyDashboard.jsx        # Family: self profile view/edit + link to people
        └── FamilyPeople.jsx           # Family: list/create/edit/delete own people
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Build | Vite 5.x with `@vitejs/plugin-react` |
| Framework | React 18.2 (functional components, hooks) |
| Router | react-router-dom 6.x (BrowserRouter, Routes, Navigate) |
| Data Fetching | @tanstack/react-query 5.x (useQuery, useMutation) |
| HTTP Client | axios 1.6 (withCredentials, response interceptor) |
| Styling | Inline style objects (no CSS files, no framework) |
| Auth | HttpOnly cookies set by backend; Axios sends with every request |

## Configuration

**Vite dev server** (`vite.config.js`):
- Runs on `host: true`, port `3000`
- Proxies `/api/*` → `http://backend:8000` (for Docker Compose dev)
- `withCredentials: true` on the Axios instance so cookies are sent across origins

**React Query** (`main.jsx`):
- Default `retry: 1`, `staleTime: 5 minutes`
- Auth query uses `staleTime: Infinity`, `refetchOnWindowFocus: false`, `retry: false`

## Architecture

### Authentication Flow

1. User logs in via `POST /api/auth/login` → backend sets `access_token` + `refresh_token` as HttpOnly cookies
2. Axios `withCredentials: true` sends cookies on every request
3. On 401, Axios interceptor calls `POST /api/auth/refresh` (deduplicated via promise queue)
4. If refresh succeeds, the original 401 request is retried automatically
5. If refresh fails, the error propagates up; `AuthContext` sets `user = null`, routes to `/login`
6. `AuthContext` fetches `GET /api/auth/me` on mount to restore session from cookies
7. `DashboardRedirect` at `/` sends users to their role-specific dashboard after login

### Routing and Roles

| Path | Role Guard | Page |
|------|-----------|------|
| `/login` | public | Login |
| `/forgot-password` | public | ForgotPassword |
| `/reset-password/:token` | public | ResetPassword |
| `/` | — | DashboardRedirect (→ role dashboard or `/login`) |
| `/dashboard` | admin, referrer, family | Dashboard (role-aware hub) |
| `/register` | admin | Register (create new users) |
| `/admin/referrers` | admin | AdminReferrers |
| `/admin/families` | admin | AdminFamilies |
| `/admin/people` | admin | AdminPeople |
| `/admin/csv-upload` | admin | CsvUpload |
| `/referrer/dashboard` | referrer | ReferrerDashboard |
| `/referrer/families/:id` | referrer | ReferrerFamilyDetail |
| `/family/dashboard` | family | FamilyDashboard |
| `/family/people` | family | FamilyPeople |

`ProtectedRoute` renders a spinner while auth is loading, redirects to `/login` if unauthenticated, or to `/dashboard` if wrong role.

### Data Flow Pattern (used consistently across all CRUD pages)

Each list/CUD page follows this pattern:

1. **List query**: `useQuery` with a key like `['adminReferrers']`
2. **Detail query** (for editing): `useQuery` with `enabled: !!editingId`, key like `['adminReferrerDetail', editingId]`
3. **Mutations**: `useMutation` for create, update, delete — each invalidates the list key on success
4. **UI state**: `showForm` boolean toggles create form; `editingId` toggles edit form; `deleteConfirm` shows delete modal
5. **Form sub-component**: Extracted inline in the same file, receives `initial`, `onSubmit`, `onCancel`, `loading` props
6. **Error display**: Arrays of mutations are mapped at the bottom to show any errors

### API Layer (`lib/api.js`)

- Single Axios instance with `baseURL: ''`, `withCredentials: true`
- Token-refresh interceptor deduplicates concurrent refresh attempts
- Named export functions for every API endpoint, organized by domain section (auth, admin referrers/families/people/csv, referrer self-service, family self-service, shared people)
- Default export is the raw `api` instance for direct use

### Styling Conventions

All pages share a consistent visual language via inline styles:
- **Purple gradient header**: `linear-gradient(135deg, #4c1d95, #6d28d9)`
- **Purple gradient buttons**: `linear-gradient(135deg, #6366f1, #8b5cf6)`
- **Card containers**: white background, `borderRadius: 12`, subtle `boxShadow`
- **Tables**: light gray borders, uppercase headers with `letterSpacing`
- **Error boxes**: `#fef2f2` background, `#dc2626` text, rounded
- **Spinner**: inline SVG with `@keyframes spin` CSS injection
- **Escape helper**: `esc()` function for XSS-safe rendering of user content

## Page Details

### Auth Pages

- **Login**: Email + password form. On success, navigates to `location.state?.from?.pathname || '/dashboard'`. Links to `/forgot-password`.
- **Register** (admin only): Creates referrer or family users. Form adapts fields based on selected role (referrer_id vs family_id).
- **ForgotPassword**: Email input → shows success message with dev note about checking backend logs.
- **ResetPassword**: `/reset-password/:token` — new password + confirm, auto-redirects to `/login` after 3s on success.

### Dashboard (Shared Hub)

- Shows user email, role badge (color-coded: admin=red, referrer=blue, family=green), referrer/family IDs if applicable
- Role-specific navigation cards grid:
  - **Admin**: Register Users, Manage Referrers, Families, People, CSV Import
  - **Referrer**: My Families
  - **Family**: My Family
- Inline `ChangePasswordSection` with old/new/confirm password fields

### Admin Pages (pattern: list table + create/edit form + delete modal)

- **AdminReferrers**: CRUD referrers (name, family_limit, phone). Delete reassigns families to orphan.
- **AdminFamilies**: CRUD families. Fetches referrers for dropdown display. Create form has referrer dropdown (or raw ID if no referrers exist).
- **AdminPeople**: CRUD people. Fetches families for dropdown display. Create form has family dropdown (or raw ID if no families exist).
- **CsvUpload**: Drag-and-drop or file picker. Shows/hides CSV template fetched from backend. Displays import results (summary stats per entity type + per-row detail table).

### Referrer Pages

- **ReferrerDashboard**: Shows referrer self-profile (editable name, phone, family_limit). Lists own families in a table with Edit/Delete/Manage actions. Add family button hidden when at family_limit. "Manage" links to `/referrer/families/:id`.
- **ReferrerFamilyDetail**: Shows one family's info (editable). Lists family's people with create/edit/delete. Uses shared `/api/people/{id}` for individual person operations.

### Family Pages

- **FamilyDashboard**: Shows family self-profile (editable: family_name, family_wish, contact_name, bio, address, phone, person_count read-only). Link card to "Manage People".
- **FamilyPeople**: Lists own people in a table. Create/edit/delete people. Uses shared `/api/people/{id}` for individual operations.

## Known Patterns / Gotchas

1. **No CSS files** — everything is inline styles. Adding a CSS framework would be a significant refactor.
2. **Forms use a synthetic event pattern** — `onSubmit` receives `{ preventDefault: () => {}, data: form }` instead of a real form event. This is a workaround to pass form data from child components.
3. **No global layout/Sidebar** — each page renders its own `<header>` with "Kindness is Magic" title and a `← Dashboard` or `← [back]` link.
4. **Duplicate code across CRUD pages** — AdminReferrers, AdminFamilies, AdminPeople, ReferrerDashboard, ReferrerFamilyDetail, and FamilyPeople all share nearly identical table/edit/delete patterns. No shared table or form components exist yet.
5. **`esc()` helper** is defined independently in multiple files (XSS escape for rendering). Should be extracted to a shared utility.
6. **PageSpinner and InlineSpinner** are duplicated across files. Should be shared components.
7. **No loading skeletons** — all pages show either a full-page spinner or render immediately.
8. **No error boundaries** — unhandled React errors would crash the whole app.
9. **`vite.config.js` proxy** targets `http://backend:8000` (Docker service name). Local dev outside Docker may need `http://localhost:8000`.
10. **No build output in repo** — `.next` / `dist` / `node_modules` are gitignored. Run `npm run build` to produce production assets.

## Running the Frontend

```bash
# Development
npm install
npm run dev        # → http://localhost:3000 (proxies /api to backend:8000)

# Production build
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```
