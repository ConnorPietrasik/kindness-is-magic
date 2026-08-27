import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReferrerDetail, ReferrerPayload } from "../types";
import { ReferrerForm } from "./ReferrerForm";

const mockReferrerDetail: ReferrerDetail = {
  id: 1,
  name: "Jane Smith",
  family_limit: 5,
  phone_number: "555-123-4567",
  family_invite_code: "abc123",
  family_count: 2,
  approval_status: "approved",
  approved_by_admin_name: "Admin User",
  approved_at: "2025-01-01T00:00:00Z",
  created_at: "2025-01-01T00:00:00Z",
  deleted_at: null,
  invite_count: null,
};

describe("ReferrerForm", () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    title: "Test Form",
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
  };

  /* ── Rendering ──────────────────────────────────────────── */

  it("renders title when provided", () => {
    render(<ReferrerForm {...defaultProps} initial={{}} />);
    expect(screen.getByText("Test Form")).toBeInTheDocument();
  });

  it("does not render title when omitted", () => {
    render(<ReferrerForm {...defaultProps} title={undefined} initial={{}} />);
    expect(screen.queryByText("Test Form")).not.toBeInTheDocument();
  });

  it("renders Create button in create mode", () => {
    render(<ReferrerForm {...defaultProps} initial={{}} isEdit={false} />);
    expect(screen.getByText("Create")).toBeInTheDocument();
  });

  it("renders Update button in edit mode", () => {
    render(<ReferrerForm {...defaultProps} initial={mockReferrerDetail} isEdit={true} />);
    expect(screen.getByText("Update")).toBeInTheDocument();
  });

  it("renders Cancel button", () => {
    render(<ReferrerForm {...defaultProps} initial={{}} />);
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("wraps content in Card by default", () => {
    const { container } = render(<ReferrerForm {...defaultProps} initial={{}} />);
    // Card renders a <div> with rounded-xl bg-white shadow-sm
    expect(container.querySelector('div[class*="rounded-xl"][class*="bg-white"]')).toBeInTheDocument();
  });

  it("renders without Card wrapper when wrapper=false", () => {
    const { container } = render(<ReferrerForm {...defaultProps} initial={{}} wrapper={false} />);
    expect(container.querySelector('div[class*="rounded-xl"][class*="bg-white"]')).not.toBeInTheDocument();
  });

  /* ── Pre-filling ────────────────────────────────────────── */

  it("pre-fills fields from initial values", () => {
    render(<ReferrerForm {...defaultProps} initial={mockReferrerDetail} isEdit={true} />);

    expect(screen.getByLabelText("Name")).toHaveValue("Jane Smith");
    expect(screen.getByLabelText("Family Limit")).toHaveValue(5);
  });

  it("does not leak ReferrerDetail-only fields into form state", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<ReferrerForm {...defaultProps} initial={mockReferrerDetail} isEdit={true} onSubmit={onSubmit} />);

    // Submit without changes
    await user.type(screen.getByLabelText("Name"), "x");
    await user.click(screen.getByText("Update"));

    const payload = onSubmit.mock.calls[0]![0] as ReferrerPayload;
    // These fields exist on ReferrerDetail but NOT on ReferrerPayload
    expect("id" in payload).toBe(false);
    expect("approval_status" in payload).toBe(false);
    expect("family_invite_code" in payload).toBe(false);
    expect("family_count" in payload).toBe(false);
  });

  /* ── Submission ─────────────────────────────────────────── */

  it("calls onSubmit with form data when all fields are valid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ReferrerForm
        {...defaultProps}
        initial={{ name: "New Referrer", family_limit: 3, phone_number: "5559876543" }}
        isEdit={false}
        onSubmit={onSubmit}
      />
    );

    await user.click(screen.getByText("Create"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "New Referrer",
        family_limit: 3,
        phone_number: "5559876543",
      })
    );
  });

  it("calls onCancel when cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<ReferrerForm {...defaultProps} initial={mockReferrerDetail} onCancel={onCancel} />);

    await user.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows loading state on submit button", () => {
    render(<ReferrerForm {...defaultProps} initial={mockReferrerDetail} loading={true} />);
    expect(screen.getByText("Saving\u2026")).toBeInTheDocument();
  });

  /* ── Phone validation ───────────────────────────────────── */

  it("shows phone validation error when phone is empty on submit", () => {
    const onSubmit = vi.fn();
    const { container } = render(<ReferrerForm {...defaultProps} initial={{ name: "Test" }} onSubmit={onSubmit} />);

    fireEvent.submit(container.querySelector("form")!);

    expect(screen.getByText("Phone number is required")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows phone validation error when phone has too few digits", () => {
    const onSubmit = vi.fn();
    const { container } = render(<ReferrerForm {...defaultProps} initial={{ name: "Test", phone_number: "123" }} onSubmit={onSubmit} />);

    fireEvent.submit(container.querySelector("form")!);

    expect(screen.getByText("Phone number must contain 10 digits")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("clears phone error when user types into phone field", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { container } = render(<ReferrerForm {...defaultProps} initial={{ name: "Test" }} onSubmit={onSubmit} />);

    // Trigger error first
    fireEvent.submit(container.querySelector("form")!);
    expect(screen.getByText("Phone number is required")).toBeInTheDocument();

    // Type a valid number — error should clear
    await user.type(screen.getByLabelText("Phone Number"), "5559876543");
    expect(screen.queryByText("Phone number is required")).not.toBeInTheDocument();
  });

  it("submits successfully with valid phone number", () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <ReferrerForm {...defaultProps} initial={{ name: "Test", family_limit: 1, phone_number: "5559876543" }} onSubmit={onSubmit} />
    );

    fireEvent.submit(container.querySelector("form")!);

    expect(onSubmit).toHaveBeenCalled();
  });

  /* ── autoComplete attributes ────────────────────────────── */

  it("sets autoComplete=off on name input", () => {
    render(<ReferrerForm {...defaultProps} initial={{}} />);
    expect(screen.getByLabelText("Name")).toHaveAttribute("autocomplete", "off");
  });

  it("sets autoComplete=off on family limit input", () => {
    render(<ReferrerForm {...defaultProps} initial={{}} />);
    expect(screen.getByLabelText("Family Limit")).toHaveAttribute("autocomplete", "off");
  });
});
