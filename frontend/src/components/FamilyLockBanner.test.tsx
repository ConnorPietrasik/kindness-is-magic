import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FamilyLockBanner } from "./FamilyLockBanner";

describe("FamilyLockBanner", () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    lockLevel: "family" as const,
    requestedAt: null,
    rejectionReason: null,
    onRequestReview: vi.fn(),
    onCancelReview: vi.fn(),
    requestMutPending: false,
    cancelMutPending: false,
  };

  /* ── Editable state (family, no request, no rejection) ──── */

  it("shows 'add everyone, then click DONE' message in editable state", () => {
    render(<FamilyLockBanner {...defaultProps} />);

    expect(screen.getByText("Add everyone in your family, then click DONE.")).toBeInTheDocument();
  });

  it("shows help text explaining that changes are locked after approval", () => {
    render(<FamilyLockBanner {...defaultProps} />);

    expect(
      screen.getByText(/Click DONE when you are finished adding people and wishes. This sends everything to your referrer\./)
    ).toBeInTheDocument();
    expect(screen.getByText(/After your referrer approves it, you will no longer be able to make changes\./)).toBeInTheDocument();
  });

  it("shows 'DONE' button in editable state", () => {
    render(<FamilyLockBanner {...defaultProps} />);

    expect(screen.getByRole("button", { name: "DONE" })).toBeInTheDocument();
  });

  it("opens confirmation dialog when DONE is clicked", async () => {
    const user = userEvent.setup();
    render(<FamilyLockBanner {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "DONE" }));
    expect(screen.getByText("Send your information to your referrer?")).toBeInTheDocument();
  });

  it("calls onRequestReview after confirming", async () => {
    const user = userEvent.setup();
    render(<FamilyLockBanner {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "DONE" }));
    await user.click(screen.getByRole("button", { name: "Yes, I am done" }));

    expect(defaultProps.onRequestReview).toHaveBeenCalledTimes(1);
  });

  it("closes confirmation dialog when cancelled", async () => {
    const user = userEvent.setup();
    render(<FamilyLockBanner {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "DONE" }));
    expect(screen.getByText("Send your information to your referrer?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText("Send your information to your referrer?")).not.toBeInTheDocument();
    });
  });

  /* ── Rejected by referrer (family, no request, has rejection) */

  it("shows rejection reason when rejected by referrer", () => {
    render(<FamilyLockBanner {...defaultProps} lockLevel="family" requestedAt={null} rejectionReason="Please add more details" />);

    expect(screen.getByText("Please add more details")).toBeInTheDocument();
    expect(screen.getByText("Your referrer sent this back for revisions:")).toBeInTheDocument();
  });

  it("shows 'DONE' button after referrer rejection", () => {
    render(<FamilyLockBanner {...defaultProps} lockLevel="family" requestedAt={null} rejectionReason="Needs revision" />);

    expect(screen.getByRole("button", { name: "DONE" })).toBeInTheDocument();
  });

  it("shows re-send confirmation title after referrer rejection", async () => {
    const user = userEvent.setup();
    render(<FamilyLockBanner {...defaultProps} lockLevel="family" requestedAt={null} rejectionReason="Needs revision" />);

    await user.click(screen.getByRole("button", { name: "DONE" }));
    expect(screen.getByText("Send your changes to your referrer?")).toBeInTheDocument();
  });

  /* ── Awaiting referrer review (family + requested) ──────── */

  it("shows 'Awaiting referrer review' when review is requested", () => {
    render(<FamilyLockBanner {...defaultProps} lockLevel="family" requestedAt="2025-01-01T00:00:00Z" rejectionReason={null} />);

    expect(screen.getByText("Awaiting referrer review")).toBeInTheDocument();
  });

  it("shows 'Cancel Request' button when awaiting review", () => {
    render(<FamilyLockBanner {...defaultProps} lockLevel="family" requestedAt="2025-01-01T00:00:00Z" rejectionReason={null} />);

    expect(screen.getByRole("button", { name: "Cancel Request" })).toBeInTheDocument();
  });

  it("calls onCancelReview when Cancel Request is clicked", async () => {
    const user = userEvent.setup();
    render(<FamilyLockBanner {...defaultProps} lockLevel="family" requestedAt="2025-01-01T00:00:00Z" rejectionReason={null} />);

    await user.click(screen.getByRole("button", { name: "Cancel Request" }));
    expect(defaultProps.onCancelReview).toHaveBeenCalledTimes(1);
  });

  it("does not show 'DONE' button when awaiting review", () => {
    render(<FamilyLockBanner {...defaultProps} lockLevel="family" requestedAt="2025-01-01T00:00:00Z" rejectionReason={null} />);

    expect(screen.queryByRole("button", { name: "DONE" })).not.toBeInTheDocument();
  });

  /* ── Rejected by admin (referrer + rejection) ───────────── */

  it("shows admin rejection reason", () => {
    render(<FamilyLockBanner {...defaultProps} lockLevel="referrer" requestedAt={null} rejectionReason="Wishes too vague" />);

    expect(screen.getByText("Wishes too vague")).toBeInTheDocument();
    expect(screen.getByText("Your admin sent this back for revisions:")).toBeInTheDocument();
  });

  it("shows 'Contact your referrer' guidance for admin rejection", () => {
    render(<FamilyLockBanner {...defaultProps} lockLevel="referrer" requestedAt={null} rejectionReason="Wishes too vague" />);

    expect(screen.getByText("Contact your referrer to make changes.")).toBeInTheDocument();
  });

  it("does not show any action buttons for admin rejection", () => {
    render(<FamilyLockBanner {...defaultProps} lockLevel="referrer" requestedAt={null} rejectionReason="Wishes too vague" />);

    expect(screen.queryByRole("button", { name: "DONE" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel Request" })).not.toBeInTheDocument();
  });

  /* ── Referrer reviewed (referrer, no rejection) ─────────── */

  it("shows locked message when referrer reviewed", () => {
    render(<FamilyLockBanner {...defaultProps} lockLevel="referrer" requestedAt={null} rejectionReason={null} />);

    expect(screen.getByText("Your family profile has been reviewed by your referrer and is now locked.")).toBeInTheDocument();
  });

  /* ── Admin approved ─────────────────────────────────────── */

  it("shows fully approved message when admin approved", () => {
    render(<FamilyLockBanner {...defaultProps} lockLevel="admin" requestedAt={null} rejectionReason={null} />);

    expect(screen.getByText("Your family profile is fully approved and visible to donors. ✨")).toBeInTheDocument();
  });

  /* ── Loading states ─────────────────────────────────────── */

  it("shows loading text on request button when pending", () => {
    render(<FamilyLockBanner {...defaultProps} requestMutPending={true} />);

    expect(screen.getByText("Sending…")).toBeInTheDocument();
  });

  it("shows loading text on cancel button when pending", () => {
    render(<FamilyLockBanner {...defaultProps} lockLevel="family" requestedAt="2025-01-01T00:00:00Z" cancelMutPending={true} />);

    expect(screen.getByText("Cancelling…")).toBeInTheDocument();
  });
});
