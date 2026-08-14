# Frontend — Agent Instructions

**No backward compatibility needed.** The app is not yet deployed.

## TypeScript

- Never use `any`. Use `unknown` and narrow, or import the correct type from `src/types/`.
- Explicitly type exported functions, hooks, and APIs. Infer local variable types when obvious.

## Server State

All remote data goes through React Query. `useState` is only for local UI state (form drafts, open menus, etc.). Never duplicate server data in component state.

## API Layer (`src/lib/api.ts`)

- All API calls live here. Do not call Axios directly from pages or components.
- Use the typed helpers (`apiGet`, `apiPost`, `apiPatch`, `apiPut`, `apiDelete`) — they auto-extract `response.data`.
- **Exception:** `loginRequest` returns the full `AxiosResponse` so `AuthContext` can destructure `{ data }`. Do not change this.
- Public endpoints (family browsing, donor registration) use the same Axios instance — no separate unauthenticated client.
- For create operations, wrap payloads with `normalizePayload()` from `src/lib/utils.ts` to convert empty strings to `null` on nullable fields.
- For update operations, use `normalizeUpdatePayload(formData, original)` to build minimal patch payloads that omit unchanged fields.

## Query Keys (`src/lib/queryKeys.ts`)

All query keys are defined here as `as const` arrays. Reference these exports instead of inline string arrays. This ensures mutations can invalidate the right caches.

## Authentication

- **Cookie-based auth** (HttpOnly cookies), not JWT in localStorage.
- On `401`, the Axios interceptor attempts a silent refresh via `POST /api/auth/refresh` with thundering-herd protection (single in-flight refresh, pending 401s retry afterward).
- If refresh fails, the interceptor dispatches `onFailedRefresh` — `AuthContext` clears user and navigates to `/login` (no hard redirect).
- `AuthContext.setUser(user)` is for endpoints that auto-log the user in (e.g. referrer/family self-registration via invite, donor self-registration). Call it after a successful registration to set the session without a page reload.
- `AuthContext` exposes role booleans (`isAdmin`, `isReferrer`, `isFamily`) and `isClaimCapable` (admin/referrer/purchaser/donor).

## React Query Rules

- Use the hook's `isLoading`/`isError`/`data` — no manual request flags.
- Mutations must invalidate affected queries after success. See `useCrudManager` for the pattern.
- **Cascade invalidation:** when a mutation affects multiple resources, invalidate all affected query keys (e.g. family delete also invalidates the people list).

## Shared Patterns

- **`useCrudManager`** (`src/hooks/useCrudManager.ts`) — encapsulates list/detail CRUD. Reuse it instead of duplicating CRUD state management.
- **`HierarchicalManage`** (`src/components/HierarchicalManage.tsx`) — wraps `useCrudManager` for parent-detail + child-CRUD pages (e.g. referrer → families → people). See `ReferrerFamilyDetail` for the pattern.
- **`useToast()`** — `toast.error()` / `toast.success()` / `toast.info()` for popup notifications.
- **`MutationErrors`** — auto-shows mutation errors as toasts. Use on forms that trigger mutations.
- **`ErrorBox`** — inline form validation only (not for API errors).
- **`formatApiError(error, fallback?)`** in `src/lib/utils.ts` — extracts user-facing strings from Axios errors.

## Routing

- Route paths are centralized in `src/lib/routes.ts`. Always use `ROUTES` constants and `route` helpers — never hardcode path strings.
- Pages are **lazy-loaded** via `React.lazy()` with a `<Suspense>` spinner fallback.
- `ProtectedRoute` wraps routes with a `roles` array. Unauthenticated users → `/login`; wrong role → `/dashboard`.
- `PublicRoute` wraps **auth-only** pages (login, registration, password reset). Authenticated users see "Already Logged In" instead of the form.
- **Truly public pages** (family browse, wish list) have no wrapper — they render for everyone, authenticated or not.
- Root `/` uses `DashboardRedirect` to send authenticated users to their role-specific dashboard.

## Styling

- Tailwind utility classes only. No CSS modules, styled-components, or arbitrary CSS files.
- Modify `src/index.css` only for global styles, Tailwind `@theme` changes, or app-wide behavior.
- Avoid inline styles except for dynamic values that cannot be expressed with Tailwind.
- Every text-like `<input>` and `<FormField>` must have an `autoComplete` attribute (default `"off"`, semantic values like `"email"` where appropriate). Omit on checkboxes, radios, and other non-text controls.

## Components

- Use **named exports** in `src/components/`.
- Reuse existing components before creating new ones.

## Testing

### What to test where

- **Vitest** — pure utilities, API layer, hooks, context, route guards, and components with non-trivial logic. Tests run in jsdom with no real network.
- **Playwright** (`e2e/`) — full user flows: login, CRUD, role-based access, CSV upload, password reset. Vitest does not replace Playwright.

### Conventions

- **Mock only external boundaries.** Mock Axios/API calls and browser APIs. Do not mock React, React Query, or component internals.
- **Use a real `QueryClient`** (created fresh per test with `retry: false`) when testing hooks or context. Don't mock React Query's hooks.
- **Pass mock API functions as options** to hooks rather than using `vi.mock` on imports — hooks accept API functions as parameters.
- **Use `@testing-library/user-event`** (`user.click()`, `user.type()`) over `fireEvent`.
- **Use `@testing-library/jest-dom`** matchers (`toBeInTheDocument()`, `toHaveValue()`).
- **Use explicit `cleanup()` in `afterEach`** for tests rendering components with `<Navigate>` or dialogs — RTL auto-cleanup doesn't fire reliably in this vitest config.
- **Wrap route components in `<MemoryRouter>`** rather than mocking `useNavigate`.
- **No snapshot testing.** Not useful for this app's component structure.
- **No coverage targets.** Cover logic, not line counts.
- Test setup (`src/test/setup.ts`) polyfills `localStorage` and `globalThis.window` for React 19 scheduler.

## Adding a New CRUD Page

1. Add types to `src/types/` (or extend existing type files)
2. Add API functions to `src/lib/api.ts`
3. Add query keys to `src/lib/queryKeys.ts`
4. Reuse `useCrudManager` (flat lists) or `HierarchicalManage` (parent + children)
5. Reuse existing table/form components from `src/components/`
6. Add route in `src/lib/routes.ts` and lazy-loaded page in `src/App.tsx`
7. Add Vitest tests for new logic; Playwright tests if user workflow changes

## Linting

**Biome** (`@biomejs/biome`) handles linting and formatting. Config in `biome.json`.

- Double quotes, semicolons, 140 char line width, organize imports
- Run `npm run lint` to check, `npm run lint:fix` to auto-fix
- Biome formatting is authoritative. Do not manually reformat code against Biome's output.

## Definition of Done

Changes should:

- compile (`npm run typecheck`)
- pass lint with no errors or warnings (`npm run lint`)
- pass tests (`npm run test`)
- follow existing project patterns
- avoid introducing duplicate abstractions
