# Frontend Context Overview — Kindness is Magic

## Stack & Tooling

| Layer           | Technology                              |
|-----------------|-----------------------------------------|
| Framework       | React 18 (JSX, function components)     |
| Router          | react-router-dom v6 (BrowserRouter)     |
| Data fetching   | @tanstack/react-query v5                |
| HTTP client     | axios (withCredentials: true, cookies)  |
| Styling         | Tailwind CSS v4 + Vite plugin           |
| Bundler         | Vite 5                                  |
| Auth            | Cookie-based (HttpOnly), no JWT in JS   |

**Dev server**: `npm run dev` on port 3000, proxies `/api` → `http://backend:8000`.
**Build**: `npm run build` → `dist/`.

---

## Project Structure

```
frontend/
  Dockerfile
  index.html
  vite.config.js              # React + Tailwind plugins, /api proxy
  package.json
  src/
    main.jsx                  # Root: QueryClientProvider > BrowserRouter > AuthProvider > App
    App.jsx                   # Router definition (all routes)
    index.css                 # Tailwind v4 @theme, global base styles
    context/
      AuthContext.jsx         # Global auth state (React Query backed)
    lib/
      api.js                  # Axios instance + all API request functions
      utils.js                # esc() (XSS-safe), humanize()
    components/               # Shared UI components (all Tailwind, memo'd)
      Button.jsx              # Variants: primary, secondary, ghost, danger. Supports loading.
      Card.jsx                # White rounded container with shadow
      ErrorBox.jsx            # Variants: error, success, info
      FormField.jsx           # Label + input/select/textarea wrapper
      HeaderBar.jsx           # Purple gradient top bar + LogoutButton, BackLink
      ProtectedRoute.jsx      # Role-gated route wrapper
      Spinner.jsx             # Spinner (sm/md/lg), PageSpinner, InlineSpinner
      Table.jsx               # Table, TableHead, TableBody, Th, Tr, Td
    pages/                    # Route pages
      Login.jsx
      Register.jsx
      ForgotPassword.jsx
      ResetPassword.jsx
      Dashboard.jsx
      AdminReferrers.jsx      # ← inline styles (not Tailwind)
      AdminFamilies.jsx       # ← inline styles (not Tailwind)
      AdminPeople.jsx         # ← inline styles (not Tailwind)
      CsvUpload.jsx           # ← inline styles (not Tailwind)
      ReferrerDashboard.jsx   # ← Tailwind
      ReferrerFamilyDetail.jsx # ← Tailwind
      FamilyDashboard.jsx     # ← Tailwind
      FamilyPeople.jsx        # ← Tailwind
```

---

## Auth Flow

- **Cookies**: `withCredentials: true` on axios; backend sets HttpOnly cookies.
- **AuthContext** (`src/context/AuthContext.jsx`):
  - `useQuery` on `/api/auth/me` at mount → populates `user` (or `null` if 401).
  - `login(email, password)` → POST `/api/auth/login`, sets query data directly.
  - `logout()` → POST `/api/auth/logout`, clears query data.
  - `checkAuth()` → invalidates the auth query.
  - `user` shape: `{ id, email, role, referrer_id, family_id, is_active }`
  - `staleTime: Infinity`, `retry: false` (401 = logged out).
- **Token refresh**: axios response interceptor catches 401s, calls `POST /api/auth/refresh`, retries the original request. Coordinating promise avoids thundering herd. If refresh fails, rejects so AuthContext sets user=null.
- **ProtectedRoute**: Shows `PageSpinner` while loading. Redirects unauthenticated to `/login`. Redirects wrong-role users to `/dashboard`.

---

## Routes (App.jsx)

### Public
| Path                  | Component         |
|-----------------------|-------------------|
| `/login`              | Login             |
| `/forgot-password`    | ForgotPassword    |
| `/reset-password/:token` | ResetPassword  |

### Authenticated (all roles)
| Path           | Component   |
|----------------|-------------|
| `/dashboard`   | Dashboard   |

### Admin-only
| Path               | Component      |
|--------------------|----------------|
| `/register`        | Register       |
| `/admin/referrers` | AdminReferrers |
| `/admin/families`  | AdminFamilies  |
| `/admin/people`    | AdminPeople    |
| `/admin/csv-upload`| CsvUpload      |

### Referrer self-service
| Path                      | Component            |
|---------------------------|----------------------|
| `/referrer/dashboard`     | ReferrerDashboard    |
| `/referrer/families/:id`  | ReferrerFamilyDetail |

### Family self-service
| Path                  | Component      |
|-----------------------|----------------|
| `/family/dashboard`   | FamilyDashboard|
| `/family/people`      | FamilyPeople   |

### Catch-all
| Path    | Behavior                                   |
|---------|--------------------------------------------|
| `/`     | DashboardRedirect → routes by user?.role   |
| `*`     | Navigate to `/`                            |

**DashboardRedirect** logic:
- `admin` → `/dashboard`
- `referrer` → `/referrer/dashboard`
- `family` → `/family/dashboard`
- no user → `/login`

---

## Roles

Three roles: `admin`, `referrer`, `family`.

| Role     | What they can do                                              |
|----------|---------------------------------------------------------------|
| admin    | Everything: register users, CRUD referrers/families/people, CSV import |
| referrer | Manage own profile, CRUD own families, CRUD people within families |
| family   | View/edit own family profile, CRUD own people                |

---

## API Layer (`lib/api.js`)

Single Axios instance, all functions are plain (no React hooks). Grouped by domain:

### Auth
- `fetchCurrentUser()`, `loginRequest()`, `logoutRequest()`, `registerRequest()`, `forgotPasswordRequest()`, `resetPasswordRequest()`, `changePasswordRequest()`

### Admin
- Referrers: `adminListReferrers`, `adminGetReferrer(id)`, `adminCreateReferrer(data)`, `adminUpdateReferrer(id, data)`, `adminDeleteReferrer(id)`
- Families: `adminListFamilies`, `adminGetFamily(id)`, `adminCreateFamily(data)`, `adminUpdateFamily(id, data)`, `adminDeleteFamily(id)`
- People: `adminListPeople`, `adminGetPerson(id)`, `adminCreatePerson(data)`, `adminUpdatePerson(id, data)`, `adminDeletePerson(id)`, `adminListFamilyPeople(fid)`
- CSV: `adminGetCsvSample()`, `adminImportCsv(fileOrText)` — accepts File or string

### Referrer self-service
- `getReferrerMe()`, `patchReferrerMe(data)`
- `listReferrerFamilies()`, `getReferrerFamily(id)`, `createReferrerFamily(data)`, `updateReferrerFamily(id, data)`, `deleteReferrerFamily(id)`
- `listReferrerFamilyPeople(fid)`, `createReferrerFamilyPerson(fid, data)`

### Family self-service
- `getFamilyMe()`, `patchFamilyMe(data)`
- `listFamilyPeople()`, `createFamilyPerson(data)`

### Shared person endpoints (multi-role)
- `getPerson(id)`, `updatePerson(id, data)`, `deletePerson(id)`

---

## Shared Components (all Tailwind + `React.memo`)

### `Button`
- Variants: `primary` (gradient), `secondary` (white+border), `ghost` (white on purple), `danger` (red)
- Props: `variant`, `loading` (shows spinner icon), `className`, standard button props

### `Card`
- White rounded box, `p-6`, shadow-sm

### `FormField`
- `label` + `input`/`select`/`textarea` (controlled via `as` prop)
- Props: `label`, `htmlFor`, `type`, `as`, `fieldProps` (spread onto input)
- Consistent focus ring styling

### `ErrorBox`
- Variants: `error` (red), `success` (green), `info` (sky blue)

### `HeaderBar`
- Purple gradient bar (`from-brand-dark to-brand-light`), 56px height
- Props: `title` (centered), `left` (e.g. BackLink), `right` (e.g. LogoutButton)

### `Spinner` / `PageSpinner` / `InlineSpinner`
- SVG animated spinner, sizes: sm (20px), md (32px), lg (48px)

### `Table` family
- `Table` (overflow-x wrapper), `TableHead`, `TableBody`, `Th`, `Tr` (forwardRef), `Td`

### `ProtectedRoute`
- Renders children if authed + role matches; otherwise redirects

---

## Page Details

### Auth Pages (Login, Register, ForgotPassword, ResetPassword)
- All use centered card layout on gradient background
- `Register` is admin-only, supports referrer/family roles with FK fields
- `ForgotPassword` shows "check your email" state + dev note about backend logs
- `ResetPassword` auto-redirects to `/login` after 3s on success

### Dashboard (all roles)
- Shows user email, role badge, referrer_id / family_id
- Navigation cards grid — different cards per role:
  - **Admin**: Register Users, Manage Referrers, Manage Families, Manage People, CSV Import
  - **Referrer**: My Families
  - **Family**: My Family
- Change password section (inline form)

### Admin CRUD Pages (AdminReferrers, AdminFamilies, AdminPeople, CsvUpload)
**⚠️ NOTE: These pages use inline `styles` objects instead of Tailwind classes.** They were written before the shared component library and are stylistically inconsistent with the rest of the frontend.
- Pattern: list table + inline create/edit form + delete confirmation modal
- Form data synced via `useEffect` on `initial` prop change
- Custom `PageSpinner`/`InlineSpinner`/`esc()` duplicated inline (not using shared components)
- AdminReferrers: CRUD referrers (name, family_limit, phone_number)
- AdminFamilies: CRUD families with referrer dropdown, fields: referrer_id, family_name, family_wish, contact_name, bio, address, phone_number
- AdminPeople: CRUD people with family dropdown, fields: family_id, given_name, age, title, practical_wish, fun_wish, note
- CsvUpload: Drag-and-drop CSV upload, template preview, per-row results table

### Referrer Dashboard
- Tailwind + shared components ✅
- Edit own profile (name, phone), view family count/limit
- CRUD families (limited by family_limit), table with person_count
- "Manage" link per family → `/referrer/families/:id`

### Referrer Family Detail
- Tailwind + shared components ✅
- View/edit family info card
- CRUD people within the family (table + forms)

### Family Dashboard
- Tailwind + shared components ✅
- View/edit family profile (family_name, family_wish, contact_name, bio, address, phone_number)
- Quick nav card → Manage People

### Family People
- Tailwind + shared components ✅
- CRUD people for the current family (list, create, edit, delete with confirmation)

---

## Tailwind Theme (`index.css`)

Custom colors defined in `@theme`:
- `--color-brand-dark: #4c1d95`
- `--color-brand-light: #6d28d9`
- `--color-btn-start: #6366f1`
- `--color-btn-end: #8b5cf6`
- `--color-page-start: #667eea`
- `--color-page-end: #764ba2`
- Font: Inter, system-ui fallbacks

Global: `box-sizing: border-box`, smooth scroll, focus-visible outlines, custom select arrow, mobile 44px touch targets, print styles (hide header/buttons).

---

## React Query Configuration (main.jsx)

- `retry: 1` (default)
- `staleTime: 5 minutes` (default)
- Auth query: `staleTime: Infinity`, `retry: false`, `refetchOnWindowFocus: false`

Query key conventions:
- Auth: `['auth']`
- Admin referrers: `['adminReferrers']`, detail: `['adminReferrerDetail', id]`
- Admin families: `['adminFamilies']`, detail: `['adminFamilyDetail', id]`
- Admin people: `['adminPeople']`, detail: `['adminPersonDetail', id]`
- Referrer me: `['referrerMe']`
- Referrer families: `['referrerFamilies']`
- Referrer family: `['referrerFamily', id]`
- Referrer family people: `['referrerFamilyPeople', id]`
- Family me: `['familyMe']`
- Family people: `['familyPeople']`
- Person detail: `['personDetail', id]`

---

## Known Inconsistencies / Debt

1. **Admin pages use inline styles** — AdminReferrers, AdminFamilies, AdminPeople, CsvUpload all define a `const styles` object with raw JS styles. They should be migrated to Tailwind + shared components (HeaderBar, Card, Button, Table, FormField, ErrorBox, Spinner) for consistency.

2. **Duplicated utilities** — `esc()` is defined locally in AdminReferrers, AdminFamilies, AdminPeople, CsvUpload, and several self-service pages instead of importing from `lib/utils.js`.

3. **Duplicated spinners** — Admin pages define their own `PageSpinner`/`InlineSpinner` instead of using `components/Spinner.jsx`.

4. **No pagination** — All list endpoints return full datasets; no frontend pagination or infinite scroll.

5. **No optimistic updates** — All mutations rely on `invalidateQueries` (refetch) rather than optimistic cache updates.

6. **Form pattern inconsistency** — Auth pages use inline inputs; self-service pages use `FormField`; admin pages use raw inputs with inline styles. The "submit as custom event" pattern (`onSubmit({ preventDefault, data: form })`) is used in self-service and admin pages but not auth pages.

---

## Entity Models (Frontend perspective)

### Referrer
- `id`, `name` (max 60), `family_limit` (1-999), `phone_number` (max 20)

### Family
- `id`, `referrer_id` (FK or null for orphan), `family_name` (max 40), `family_wish` (max 400), `contact_name` (max 40), `bio` (optional), `address` (optional, max 200), `phone_number` (optional, max 20), `person_count`

### Person
- `id`, `family_id` (FK), `given_name` (max 40), `age` (0-200), `title` (optional, max 40), `practical_wish` (max 400), `fun_wish` (max 400), `note` (optional, max 400)

### User
- `id`, `email`, `password`, `role` (admin/referrer/family), `referrer_id` (FK for referrer role), `family_id` (FK for family role), `is_active`
