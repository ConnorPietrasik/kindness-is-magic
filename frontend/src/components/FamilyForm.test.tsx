import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FamilyDetail } from "../types";
import { FamilyForm } from "./FamilyForm";

const mockFamilyDetail: FamilyDetail = {
  id: 1,
  referrer_id: 2,
  referrer_name: "Jane Smith",
  display_id: "2-1",
  family_name: "The Smiths",
  bio: null,
  address: null,
  phone_number: "555-123-4567",
  family_wish: "A warm blanket",
  contact_name: "Mom Smith",
  deleted_at: null,
  person_count: 3,
  approval_status: "approved",
  pickup_window: "2025-02-15T14:30:00+00:00",
  wish_lock_level: "family",
  wish_review_requested_at: null,
  wish_rejection_reason: null,
};

const referrerMap: Record<number, string> = {
  1: "John Doe",
  2: "Jane Smith",
  3: "Bob Wilson",
};

describe("FamilyForm", () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    title: "Test Form",
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    referrerMap,
    referrerOptionsLoading: false,
  };

  /* ── Referrer selector on edit ──────────────────────────── */

  it("shows referrer dropdown on create mode", () => {
    render(<FamilyForm {...defaultProps} title="Add Family" isEdit={false} initial={{}} />);

    expect(screen.getByLabelText("Referrer")).toBeInTheDocument();
    expect(screen.getByText("Select referrer…")).toBeInTheDocument();
  });

  it("shows referrer dropdown on edit mode with current referrer selected", () => {
    render(<FamilyForm {...defaultProps} title="Edit Family" isEdit={true} initial={mockFamilyDetail} />);

    const select = screen.getByLabelText("Referrer") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe("2"); // Jane Smith (ID 2) is the current referrer
  });

  it("includes referrer_id in submit payload when changed on edit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<FamilyForm {...defaultProps} title="Edit Family" isEdit={true} initial={mockFamilyDetail} onSubmit={onSubmit} />);

    const select = screen.getByLabelText("Referrer") as HTMLSelectElement;
    await user.selectOptions(select, "3");

    await user.click(screen.getByText("Update"));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ referrer_id: 3 }));
  });

  it("shows 'Unassign referrer' option on edit mode", () => {
    render(<FamilyForm {...defaultProps} title="Edit Family" isEdit={true} initial={mockFamilyDetail} />);

    expect(screen.getByText("Unassign referrer")).toBeInTheDocument();
  });

  it("selects 'Unassign referrer' when referrer_id is null", () => {
    render(<FamilyForm {...defaultProps} title="Edit Family" isEdit={true} initial={{ ...mockFamilyDetail, referrer_id: null }} />);

    const select = screen.getByLabelText("Referrer") as HTMLSelectElement;
    expect(select.value).toBe("0");
  });

  it("sends referrer_id=0 when unassigning referrer", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<FamilyForm {...defaultProps} title="Edit Family" isEdit={true} initial={mockFamilyDetail} onSubmit={onSubmit} />);

    const select = screen.getByLabelText("Referrer") as HTMLSelectElement;
    await user.selectOptions(select, "0");

    await user.click(screen.getByText("Update"));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ referrer_id: 0 }));
  });

  it("does not show 'Select referrer…' placeholder on edit", () => {
    render(<FamilyForm {...defaultProps} title="Edit Family" isEdit={true} initial={mockFamilyDetail} />);

    expect(screen.queryByText("Select referrer…")).not.toBeInTheDocument();
  });

  /* ── Form submission basics ─────────────────────────────── */

  it("calls onSubmit with form data on create", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<FamilyForm {...defaultProps} title="Add Family" isEdit={false} initial={{}} onSubmit={onSubmit} />);

    // Fill required fields
    await user.selectOptions(screen.getByLabelText("Referrer"), "1");
    await user.type(screen.getByLabelText("Family Name"), "The Joneses");
    await user.type(screen.getByLabelText("Family Wish"), "A computer");
    await user.type(screen.getByLabelText("Contact Name"), "Dad Jones");
    await user.type(screen.getByLabelText("Phone Number"), "5551234567");

    await user.click(screen.getByText("Create"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        family_name: "The Joneses",
        family_wish: "A computer",
        contact_name: "Dad Jones",
        referrer_id: 1,
      })
    );
  });

  it("calls onCancel when cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<FamilyForm {...defaultProps} title="Edit Family" isEdit={true} initial={mockFamilyDetail} onCancel={onCancel} />);

    await user.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows loading state on submit button", () => {
    render(<FamilyForm {...defaultProps} title="Edit Family" isEdit={true} initial={mockFamilyDetail} loading={true} />);

    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });

  /* ── Pickup Window (admin only) ─────────────────────────── */

  it("shows pickup window field in admin context", () => {
    render(<FamilyForm {...defaultProps} title="Edit Family" isEdit={true} initial={mockFamilyDetail} />);

    expect(screen.getByText("Pickup Window")).toBeInTheDocument();
    const datetimeInputs = document.querySelectorAll('input[type="datetime-local"]');
    expect(datetimeInputs.length).toBe(1);
  });

  it("does not show pickup window field without referrerMap", () => {
    render(<FamilyForm title="Edit Family Profile" isEdit={true} initial={mockFamilyDetail} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByText("Pickup Window")).not.toBeInTheDocument();
  });

  it("sends pickup_window in submit payload", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<FamilyForm {...defaultProps} title="Add Family" isEdit={false} initial={{}} onSubmit={onSubmit} />);

    // Fill required fields
    await user.selectOptions(screen.getByLabelText("Referrer"), "1");
    await user.type(screen.getByLabelText("Family Name"), "The Joneses");
    await user.type(screen.getByLabelText("Family Wish"), "A computer");
    await user.type(screen.getByLabelText("Contact Name"), "Dad Jones");
    await user.type(screen.getByLabelText("Phone Number"), "5551234567");

    // Set pickup window (find by type since OptionalLabel uses <span>, not <label>)
    const pickupInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(pickupInput).toBeTruthy();
    await user.type(pickupInput!, "2025-03-20T10:00");

    await user.click(screen.getByText("Create"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        // datetime-local value is converted back to ISO UTC on submit (no milliseconds)
        pickup_window: expect.stringMatching(/^2025-03-20T\d{2}:\d{2}:\d{2}Z$/),
      })
    );
  });

  it("pre-fills pickup window on edit and preserves value when unchanged", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<FamilyForm {...defaultProps} title="Edit Family" isEdit={true} initial={mockFamilyDetail} onSubmit={onSubmit} />);

    // Verify the datetime-local input is pre-filled
    const pickupInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(pickupInput).toBeTruthy();
    // Value should be in YYYY-MM-DDTHH:MM format (local timezone)
    expect(pickupInput!.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

    // Change only the family name, leave pickup window untouched
    const nameInput = screen.getByLabelText("Family Name") as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, "The Updateds");

    await user.click(screen.getByText("Update"));

    // When the datetime-local input is not touched, the form preserves
    // the original API value. normalizeUpdatePayload (tested in utils.test.ts)
    // handles the same-instant comparison to omit unchanged datetime fields.
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        family_name: "The Updateds",
        pickup_window: mockFamilyDetail.pickup_window,
      })
    );
  });
});
