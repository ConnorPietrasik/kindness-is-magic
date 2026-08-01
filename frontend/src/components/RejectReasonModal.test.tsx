import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RejectReasonModal } from "./RejectReasonModal";

describe("RejectReasonModal", () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    open: true,
    familyName: "The Smiths",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    loading: false,
  };

  /* ── Visibility ─────────────────────────────────────────── */

  it("returns null when open is false", () => {
    const { container } = render(<RejectReasonModal {...defaultProps} open={false} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders overlay when open is true", () => {
    render(<RejectReasonModal {...defaultProps} />);

    expect(screen.getByText(/Reject wishes for/)).toBeInTheDocument();
  });

  /* ── Content rendering ──────────────────────────────────── */

  it("renders family name in bold", () => {
    render(<RejectReasonModal {...defaultProps} />);

    expect(screen.getByText("The Smiths", { selector: "strong" })).toBeInTheDocument();
  });

  it("renders default audience label", () => {
    render(<RejectReasonModal {...defaultProps} />);

    expect(screen.getByText("Provide a reason the recipient can see:")).toBeInTheDocument();
  });

  it("renders custom audience label when provided", () => {
    render(<RejectReasonModal {...defaultProps} audienceLabel="Tell the family why:" />);

    expect(screen.getByText("Tell the family why:")).toBeInTheDocument();
  });

  it("renders default placeholder", () => {
    render(<RejectReasonModal {...defaultProps} />);

    expect(screen.getByPlaceholderText("e.g. Please add more details...")).toBeInTheDocument();
  });

  it("renders custom placeholder when provided", () => {
    render(<RejectReasonModal {...defaultProps} placeholder="e.g. Be specific..." />);

    expect(screen.getByPlaceholderText("e.g. Be specific...")).toBeInTheDocument();
  });

  /* ── Reason input ───────────────────────────────────────── */

  it("allows typing a reason", async () => {
    const user = userEvent.setup();
    render(<RejectReasonModal {...defaultProps} />);

    const textarea = screen.getByPlaceholderText("e.g. Please add more details...");
    await user.type(textarea, "Needs more detail");

    expect(textarea).toHaveValue("Needs more detail");
  });

  it("shows character count", () => {
    render(<RejectReasonModal {...defaultProps} />);

    expect(screen.getByText("0/400")).toBeInTheDocument();
  });

  it("updates character count as user types", async () => {
    const user = userEvent.setup();
    render(<RejectReasonModal {...defaultProps} />);

    const textarea = screen.getByPlaceholderText("e.g. Please add more details...");
    await user.type(textarea, "abc");

    expect(screen.getByText("3/400")).toBeInTheDocument();
  });

  /* ── Reject button ──────────────────────────────────────── */

  it("disables reject button when reason is empty", () => {
    render(<RejectReasonModal {...defaultProps} />);

    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  });

  it("disables reject button when reason is whitespace only", async () => {
    const user = userEvent.setup();
    render(<RejectReasonModal {...defaultProps} />);

    const textarea = screen.getByPlaceholderText("e.g. Please add more details...");
    await user.type(textarea, "   ");

    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  });

  it("enables reject button when reason has content", async () => {
    const user = userEvent.setup();
    render(<RejectReasonModal {...defaultProps} />);

    const textarea = screen.getByPlaceholderText("e.g. Please add more details...");
    await user.type(textarea, "Valid reason");

    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
  });

  it("calls onConfirm with the reason when reject is clicked", async () => {
    const user = userEvent.setup();
    render(<RejectReasonModal {...defaultProps} />);

    const textarea = screen.getByPlaceholderText("e.g. Please add more details...");
    await user.type(textarea, "Needs more detail");
    await user.click(screen.getByRole("button", { name: "Reject" }));

    expect(defaultProps.onConfirm).toHaveBeenCalledWith("Needs more detail");
  });

  /* ── Cancel action ──────────────────────────────────────── */

  it("calls onCancel when cancel button is clicked", async () => {
    const user = userEvent.setup();
    render(<RejectReasonModal {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  /* ── Loading state ──────────────────────────────────────── */

  it("shows loading text on reject button when loading", () => {
    render(<RejectReasonModal {...defaultProps} loading={true} />);

    expect(screen.getByText("Rejecting…")).toBeInTheDocument();
  });

  it("disables reject button when loading", () => {
    render(<RejectReasonModal {...defaultProps} loading={true} />);

    expect(screen.getByRole("button", { name: "Rejecting…" })).toBeDisabled();
  });

  /* ── State reset on open ────────────────────────────────── */

  it("resets reason when modal reopens after being closed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RejectReasonModal {...defaultProps} />);

    // Type a reason
    const textarea = screen.getByPlaceholderText("e.g. Please add more details...");
    await user.type(textarea, "First reason");
    expect(textarea).toHaveValue("First reason");

    // Close and reopen
    rerender(<RejectReasonModal {...defaultProps} open={false} />);
    rerender(<RejectReasonModal {...defaultProps} open={true} />);

    // Reason should be reset
    expect(screen.getByPlaceholderText("e.g. Please add more details...")).toHaveValue("");
  });

  it("resets reason when familyName changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RejectReasonModal {...defaultProps} />);

    // Type a reason
    const textarea = screen.getByPlaceholderText("e.g. Please add more details...");
    await user.type(textarea, "First reason");
    expect(textarea).toHaveValue("First reason");

    // Reopen for different family (same open=true, different familyName)
    rerender(<RejectReasonModal {...defaultProps} familyName="The Joneses" open={false} />);
    rerender(<RejectReasonModal {...defaultProps} familyName="The Joneses" open={true} />);

    expect(screen.getByText("The Joneses", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Please add more details...")).toHaveValue("");
  });
});
