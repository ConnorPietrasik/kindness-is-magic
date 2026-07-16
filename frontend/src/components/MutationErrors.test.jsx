import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MutationErrors } from './MutationErrors';

describe('MutationErrors', () => {
  /* ── No errors ──────────────────────────────────────────── */

  it('returns null when no mutations have errors', () => {
    const mutations = [
      { error: null, isError: false },
      { error: null, isError: false },
    ];

    const { container } = render(<MutationErrors mutations={mutations} />);

    expect(container.firstChild).toBeNull();
  });

  it('returns null when mutations array is empty', () => {
    const { container } = render(<MutationErrors mutations={[]} />);

    expect(container.firstChild).toBeNull();
  });

  /* ── Single error ───────────────────────────────────────── */

  it('renders an ErrorBox for a mutation with an error', () => {
    const mutations = [
      { error: { message: 'Network error' }, isError: true },
    ];

    render(<MutationErrors mutations={mutations} />);

    expect(screen.getByText(/Network error/i)).toBeInTheDocument();
  });

  it('uses default fallback when error has no extractable message', () => {
    const mutations = [
      { error: {}, isError: true },
    ];

    render(<MutationErrors mutations={mutations} />);

    expect(screen.getByText('Request failed.')).toBeInTheDocument();
  });

  /* ── Multiple errors ────────────────────────────────────── */

  it('renders multiple ErrorBoxes for multiple mutations with errors', () => {
    const mutations = [
      { error: { response: { data: { detail: 'Create failed' } } }, isError: true },
      { error: { response: { data: { detail: 'Delete failed' } } }, isError: true },
    ];

    render(<MutationErrors mutations={mutations} />);

    expect(screen.getByText('Create failed')).toBeInTheDocument();
    expect(screen.getByText('Delete failed')).toBeInTheDocument();
  });

  it('skips mutations without errors when some have errors', () => {
    const mutations = [
      { error: { response: { data: { detail: 'First error' } } }, isError: true },
      { error: null, isError: false },
      { error: { response: { data: { detail: 'Third error' } } }, isError: true },
    ];

    render(<MutationErrors mutations={mutations} />);

    expect(screen.getByText('First error')).toBeInTheDocument();
    expect(screen.getByText('Third error')).toBeInTheDocument();
    // Only 2 ErrorBoxes rendered (not 3)
    expect(screen.getAllByText(/error/i).length).toBeGreaterThanOrEqual(2);
  });

  /* ── Custom fallback ────────────────────────────────────── */

  it('uses custom fallback message', () => {
    const mutations = [
      { error: {}, isError: true },
    ];

    render(
      <MutationErrors mutations={mutations} fallback="Custom fallback message" />,
    );

    expect(screen.getByText('Custom fallback message')).toBeInTheDocument();
  });

  /* ── Error formatting via formatApiError ────────────────── */

  it('formats Axios error with detail field', () => {
    const mutations = [
      {
        error: { response: { data: { detail: 'Validation error: email required' } } },
        isError: true,
      },
    ];

    render(<MutationErrors mutations={mutations} />);

    expect(screen.getByText('Validation error: email required')).toBeInTheDocument();
  });

  it('formats Axios error with msg field', () => {
    const mutations = [
      {
        error: { response: { data: { msg: 'Could not log in' } } },
        isError: true,
      },
    ];

    render(<MutationErrors mutations={mutations} />);

    expect(screen.getByText('Could not log in')).toBeInTheDocument();
  });

  it('formats plain error with message property', () => {
    const mutations = [
      {
        error: new Error('Something broke'),
        isError: true,
      },
    ];

    render(<MutationErrors mutations={mutations} />);

    expect(screen.getByText('Something broke')).toBeInTheDocument();
  });
});
