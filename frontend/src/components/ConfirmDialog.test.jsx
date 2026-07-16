import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  afterEach(() => {
    cleanup();
  });
  const defaultProps = {
    open: true,
    title: 'Delete this item?',
    description: 'This action cannot be undone.',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  /* ── Visibility ─────────────────────────────────────────── */

  it('returns null when open is false', () => {
    const { container } = render(
      <ConfirmDialog {...defaultProps} open={false} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders overlay when open is true', () => {
    render(<ConfirmDialog {...defaultProps} />);

    expect(screen.getByText('Delete this item?')).toBeInTheDocument();
  });

  /* ── Content rendering ──────────────────────────────────── */

  it('renders title', () => {
    render(<ConfirmDialog {...defaultProps} />);

    expect(screen.getByText('Delete this item?')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<ConfirmDialog {...defaultProps} />);

    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
  });

  it('renders title without description when description is omitted', () => {
    render(
      <ConfirmDialog
        {...defaultProps}
        description=""
      />,
    );

    expect(screen.getByText('Delete this item?')).toBeInTheDocument();
  });

  /* ── Confirm action ─────────────────────────────────────── */

  it('calls onConfirm when confirm button is clicked', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog {...defaultProps} />);

    await user.click(screen.getByText('Yes, delete'));
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  /* ── Cancel action ──────────────────────────────────────── */

  it('calls onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog {...defaultProps} />);

    await user.click(screen.getByText('Cancel'));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  /* ── Loading state ──────────────────────────────────────── */

  it('shows loading text on confirm button when loading', () => {
    render(<ConfirmDialog {...defaultProps} loading={true} />);

    expect(screen.getByText('Deleting…')).toBeInTheDocument();
    expect(screen.queryByText('Yes, delete')).not.toBeInTheDocument();
  });

  it('disables confirm button when loading', () => {
    render(<ConfirmDialog {...defaultProps} loading={true} />);

    const confirmButton = screen.getByText('Deleting…').closest('button');
    expect(confirmButton).toBeDisabled();
  });

  it('shows loading spinner SVG when loading', () => {
    render(<ConfirmDialog {...defaultProps} loading={true} />);

    expect(document.querySelector('svg.animate-spin')).toBeInTheDocument();
  });

  it('does not show loading state when loading is false', () => {
    render(<ConfirmDialog {...defaultProps} loading={false} />);

    expect(screen.getByText('Yes, delete')).toBeInTheDocument();
    expect(screen.queryByText('Deleting…')).not.toBeInTheDocument();
  });
});
