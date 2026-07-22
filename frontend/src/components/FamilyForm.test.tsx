import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FamilyDetail } from "../types";
import { FamilyForm } from "./FamilyForm";

const mockFamilyDetail: FamilyDetail = {
  id: 1,
  referrer_id: 2,
  family_name: "The Smiths",
  bio: null,
  address: null,
  phone_number: null,
  family_wish: "A warm blanket",
  contact_name: "Mom Smith",
  deleted_at: null,
  person_count: 3,
  approval_status: "approved",
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
});
