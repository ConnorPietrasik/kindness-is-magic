import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  afterEach(() => {
    cleanup();
    defaultProps.onConfirm.mockClear();
    defaultProps.onCancel.mockClear();
  });
  const defaultProps = {
    open: true,
    title: "Delete this item?",
    description: "This action cannot be undone.",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  /* ── Visibility ─────────────────────────────────────────── */

  it("returns null when open is false", () => {
    const { container } = render(<ConfirmDialog {...defaultProps} open={false} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders overlay when open is true", () => {
    render(<ConfirmDialog {...defaultProps} />);

    expect(screen.getByText("Delete this item?")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  /* ── Content rendering ──────────────────────────────────── */

  it("renders title", () => {
    render(<ConfirmDialog {...defaultProps} />);

    expect(screen.getByText("Delete this item?")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(<ConfirmDialog {...defaultProps} />);

    expect(screen.getByText("This action cannot be undone.")).toBeInTheDocument();
  });

  it("renders title without description when description is omitted", () => {
    render(<ConfirmDialog {...defaultProps} description="" />);

    expect(screen.getByText("Delete this item?")).toBeInTheDocument();
  });

  /* ── Confirm action ─────────────────────────────────────── */

  it("calls onConfirm when confirm button is clicked", async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog {...defaultProps} />);

    await user.click(screen.getByText("Yes, delete"));
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  /* ── Cancel action ──────────────────────────────────────── */

  it("calls onCancel when cancel button is clicked", async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog {...defaultProps} />);

    await user.click(screen.getByText("Cancel"));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  /* ── Escape ─────────────────────────────────────────────── */

  it("cancels on Escape", async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog {...defaultProps} />);

    await user.keyboard("{Escape}");
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape while closed", async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog {...defaultProps} open={false} />);

    await user.keyboard("{Escape}");
    expect(defaultProps.onCancel).not.toHaveBeenCalled();
  });

  it("with two stacked dialogs, Escape closes only the topmost", async () => {
    const user = userEvent.setup();
    const bottomCancel = vi.fn();
    const topCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} title="Bottom dialog?" onCancel={bottomCancel} />);
    const top = render(<ConfirmDialog {...defaultProps} title="Top dialog?" onCancel={topCancel} />);

    await user.keyboard("{Escape}");
    expect(topCancel).toHaveBeenCalledTimes(1);
    expect(bottomCancel).not.toHaveBeenCalled();

    // Simulate the parent closing the top dialog — Escape then reaches the bottom one
    top.unmount();
    await user.keyboard("{Escape}");
    expect(bottomCancel).toHaveBeenCalledTimes(1);
  });

  it("a bottom dialog re-rendered with a fresh handler keeps its stack position", async () => {
    const user = userEvent.setup();
    const bottomCancel = vi.fn();
    const bottomCancelFresh = vi.fn();
    const bottom = render(<ConfirmDialog {...defaultProps} title="Bottom dialog?" onCancel={bottomCancel} />);
    const topCancel = vi.fn();
    const top = render(<ConfirmDialog {...defaultProps} title="Top dialog?" onCancel={topCancel} />);

    // A parent re-render passes a fresh (inline) handler — the stack order must not change
    bottom.rerender(<ConfirmDialog {...defaultProps} title="Bottom dialog?" onCancel={bottomCancelFresh} />);

    await user.keyboard("{Escape}");
    expect(topCancel).toHaveBeenCalledTimes(1);
    expect(bottomCancel).not.toHaveBeenCalled();
    expect(bottomCancelFresh).not.toHaveBeenCalled();

    // When the top closes, Escape reaches the bottom — via its latest handler
    top.unmount();
    await user.keyboard("{Escape}");
    expect(bottomCancelFresh).toHaveBeenCalledTimes(1);
    expect(bottomCancel).not.toHaveBeenCalled();
  });

  /* ── Loading state ──────────────────────────────────────── */

  it("shows loading text on confirm button when loading", () => {
    render(<ConfirmDialog {...defaultProps} loading={true} />);

    expect(screen.getByText("Deleting…")).toBeInTheDocument();
    expect(screen.queryByText("Yes, delete")).not.toBeInTheDocument();
  });

  it("disables confirm button when loading", () => {
    render(<ConfirmDialog {...defaultProps} loading={true} />);

    const confirmButton = screen.getByText("Deleting…").closest("button");
    expect(confirmButton).toBeDisabled();
  });

  it("shows loading spinner SVG when loading", () => {
    render(<ConfirmDialog {...defaultProps} loading={true} />);

    expect(document.querySelector("svg.animate-spin")).toBeInTheDocument();
  });

  it("does not show loading state when loading is false", () => {
    render(<ConfirmDialog {...defaultProps} loading={false} />);

    expect(screen.getByText("Yes, delete")).toBeInTheDocument();
    expect(screen.queryByText("Deleting…")).not.toBeInTheDocument();
  });
});
