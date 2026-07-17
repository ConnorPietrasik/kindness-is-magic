import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  is_deleted: false,
  person_count: 3,
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

  it("does not show 'Select referrer…' placeholder on edit", () => {
    render(<FamilyForm {...defaultProps} title="Edit Family" isEdit={true} initial={mockFamilyDetail} />);

    expect(screen.queryByText("Select referrer…")).not.toBeInTheDocument();
  });

  /* ── is_deleted toggle ──────────────────────────────────── */

  it("does not show is_deleted toggle when showDeletedToggle is false", () => {
    render(<FamilyForm {...defaultProps} title="Edit Family" isEdit={true} initial={mockFamilyDetail} showDeletedToggle={false} />);

    expect(screen.queryByLabelText(/soft-deleted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mark as deleted/i)).not.toBeInTheDocument();
  });

  it("does not show is_deleted toggle on create mode", () => {
    render(<FamilyForm {...defaultProps} title="Add Family" isEdit={false} initial={{}} showDeletedToggle={true} />);

    expect(screen.queryByLabelText(/soft-deleted/i)).not.toBeInTheDocument();
  });

  it("shows unchecked is_deleted toggle for active family", () => {
    render(<FamilyForm {...defaultProps} title="Edit Family" isEdit={true} initial={mockFamilyDetail} showDeletedToggle={true} />);

    const checkbox = screen.getByLabelText("Soft-deleted");
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it("shows checked is_deleted toggle for deleted family", () => {
    render(
      <FamilyForm
        {...defaultProps}
        title="Edit Family"
        isEdit={true}
        initial={{ ...mockFamilyDetail, is_deleted: true }}
        showDeletedToggle={true}
      />
    );

    const checkbox = screen.getByLabelText("Mark as deleted");
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toBeChecked();
  });

  /* ── is_deleted confirmation dialog ─────────────────────── */

  it("shows confirmation dialog when toggling is_deleted to true and submitting", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <FamilyForm
        {...defaultProps}
        title="Edit Family"
        isEdit={true}
        initial={mockFamilyDetail}
        showDeletedToggle={true}
        onSubmit={onSubmit}
      />
    );

    const checkbox = screen.getByLabelText("Soft-deleted");
    await user.click(checkbox);

    await user.click(screen.getByText("Update"));

    // Confirm dialog should appear
    await waitFor(() => {
      expect(screen.getByText("Soft-delete this family?")).toBeInTheDocument();
    });

    // onSubmit should NOT have been called yet
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onSubmit with is_deleted=true after confirming soft-delete", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <FamilyForm
        {...defaultProps}
        title="Edit Family"
        isEdit={true}
        initial={mockFamilyDetail}
        showDeletedToggle={true}
        onSubmit={onSubmit}
      />
    );

    const checkbox = screen.getByLabelText("Soft-deleted");
    await user.click(checkbox);

    await user.click(screen.getByText("Update"));

    await waitFor(() => {
      expect(screen.getByText("Soft-delete this family?")).toBeInTheDocument();
    });

    // Confirm the dialog
    await user.click(screen.getByText("Yes, delete"));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ is_deleted: true }));
  });

  it("does not submit when cancelling soft-delete confirmation", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <FamilyForm
        {...defaultProps}
        title="Edit Family"
        isEdit={true}
        initial={mockFamilyDetail}
        showDeletedToggle={true}
        onSubmit={onSubmit}
      />
    );

    const checkbox = screen.getByLabelText("Soft-deleted");
    await user.click(checkbox);

    await user.click(screen.getByText("Update"));

    await waitFor(() => {
      expect(screen.getByText("Soft-delete this family?")).toBeInTheDocument();
    });

    // Cancel the dialog — target the Cancel button inside the modal overlay
    const overlay = document.querySelector("div.fixed.inset-0");
    const cancelButtons = overlay?.querySelectorAll("button");
    const dialogCancel = Array.from(cancelButtons ?? []).find((b) => b.textContent === "Cancel");
    await user.click(dialogCancel!);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits without confirmation when unchecking is_deleted (restore)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <FamilyForm
        {...defaultProps}
        title="Edit Family"
        isEdit={true}
        initial={{ ...mockFamilyDetail, is_deleted: true }}
        showDeletedToggle={true}
        onSubmit={onSubmit}
      />
    );

    const checkbox = screen.getByLabelText("Mark as deleted");
    await user.click(checkbox);

    await user.click(screen.getByText("Update"));

    // No confirmation dialog — restoring is safe
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ is_deleted: false }));
    expect(screen.queryByText("Soft-delete this family?")).not.toBeInTheDocument();
  });

  it("submits without confirmation for normal updates (no is_deleted change)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <FamilyForm
        {...defaultProps}
        title="Edit Family"
        isEdit={true}
        initial={mockFamilyDetail}
        showDeletedToggle={true}
        onSubmit={onSubmit}
      />
    );

    // Change family name
    const nameInput = screen.getByLabelText("Family Name");
    await user.clear(nameInput);
    await user.type(nameInput, "The Joneses");

    await user.click(screen.getByText("Update"));

    expect(onSubmit).toHaveBeenCalled();
    expect(screen.queryByText("Soft-delete this family?")).not.toBeInTheDocument();
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
