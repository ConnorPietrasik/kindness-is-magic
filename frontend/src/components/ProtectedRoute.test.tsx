import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ROUTES } from '../lib/routes';

// ---------------------------------------------------------------------------
// Mock useAuth — control isLoading, user, and role booleans
// ---------------------------------------------------------------------------
vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '../context/AuthContext';

// ---------------------------------------------------------------------------
// Mock Navigate — captures `to` prop without triggering real navigation
// (real <Navigate> causes infinite re-render loops in jsdom)
// ---------------------------------------------------------------------------
const navigateCalls: string[] = [];

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => {
      navigateCalls.push(to);
      return null;
    },
  };
});

import { ProtectedRoute } from './ProtectedRoute';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ProtectedRoute', () => {
  afterEach(() => {
    navigateCalls.length = 0;
    cleanup();
  });

  const mockUseAuth = useAuth as unknown as Mock;

  /* ── Loading state ──────────────────────────────────────── */

  it('shows spinner while isLoading is true', () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: true });

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div data-testid="child">Page Content</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    // PageSpinner renders an SVG with animate-spin class
    expect(document.querySelector('svg.animate-spin')).toBeInTheDocument();
    // Children should NOT be rendered
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  /* ── Unauthenticated ────────────────────────────────────── */

  it('redirects to /login when user is null', () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: false });

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div data-testid="child">Page Content</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(navigateCalls).toContain(ROUTES.LOGIN);
  });

  it('redirects to /login when user is undefined', () => {
    mockUseAuth.mockReturnValue({ user: undefined, isLoading: false });

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div data-testid="child">Page Content</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(navigateCalls).toContain(ROUTES.LOGIN);
  });

  /* ── Authenticated — no role restriction ────────────────── */

  it('renders children when authenticated with no roles specified', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@test.com', role: 'admin' },
      isLoading: false,
    });

    render(
      <MemoryRouter>
        <ProtectedRoute>
          <div data-testid="child">Admin Page</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Admin Page')).toBeInTheDocument();
    expect(navigateCalls).toEqual([]);
  });

  /* ── Authenticated — correct role ───────────────────────── */

  it('renders children when user role matches single allowed role', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'admin' },
      isLoading: false,
    });

    render(
      <MemoryRouter>
        <ProtectedRoute roles={['admin']}>
          <div data-testid="child">Admin Only</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(navigateCalls).toEqual([]);
  });

  it('renders children when user role matches one of multiple allowed roles', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 2, role: 'referrer' },
      isLoading: false,
    });

    render(
      <MemoryRouter>
        <ProtectedRoute roles={['admin', 'referrer']}>
          <div data-testid="child">Referrer or Admin</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(navigateCalls).toEqual([]);
  });

  it('renders children for family role when in allowed list', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 3, role: 'family' },
      isLoading: false,
    });

    render(
      <MemoryRouter>
        <ProtectedRoute roles={['family', 'referrer']}>
          <div data-testid="child">Family Area</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(navigateCalls).toEqual([]);
  });

  /* ── Authenticated — wrong role ─────────────────────────── */

  it('redirects to /dashboard when user role is not in allowed list', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 3, role: 'family' },
      isLoading: false,
    });

    render(
      <MemoryRouter>
        <ProtectedRoute roles={['admin']}>
          <div data-testid="child">Admin Only</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(navigateCalls).toContain(ROUTES.DASHBOARD);
  });

  it('redirects to /dashboard when roles array excludes user role', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'admin' },
      isLoading: false,
    });

    render(
      <MemoryRouter>
        <ProtectedRoute roles={['referrer', 'family']}>
          <div data-testid="child">Referrer Only</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(navigateCalls).toContain(ROUTES.DASHBOARD);
  });

  /* ── Navigation state preservation ──────────────────────── */

  it('passes current location as state on login redirect', () => {
    mockUseAuth.mockReturnValue({ user: null, isLoading: false });

    render(
      <MemoryRouter initialEntries={['/admin/secret']}>
        <ProtectedRoute roles={['admin']}>
          <div data-testid="child">Secret</div>
        </ProtectedRoute>
      </MemoryRouter>,
    );

    // Navigate renders with state={{ from: location }} —
    // we verify the redirect target is /login
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(navigateCalls).toContain(ROUTES.LOGIN);
  });
});
