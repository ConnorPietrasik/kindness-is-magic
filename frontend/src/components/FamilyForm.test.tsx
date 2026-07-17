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
  deleted_at: null,
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

  /* ── deleted_at toggle ──────────────────────────────────── */

  it("does not show deleted_at toggle when showDeletedToggle is false", () => {
    render(<FamilyForm {...defaultProps} title="Edit Family" isEdit={true} initial={mockFamilyDetail} showDeletedToggle={false} />);

    expect(screen.queryByLabelText(/soft-deleted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mark as deleted/i)).not.toBeInTheDocument();
  });

  it("does not show deleted_at toggle on create mode", () => {
    render(<FamilyForm {...defaultProps} title="Add Family" isEdit={false} initial={{}} showDeletedToggle={true} />);

    expect(screen.queryByLabelText(/soft-deleted/i)).not.toBeInTheDocument();
  });

  it("shows unchecked deleted_at toggle for active family", () => {
    render(<FamilyForm {...defaultProps} title="Edit Family" isEdit={true} initial={mockFamilyDetail} showDeletedToggle={true} />);

    const checkbox = screen.getByLabelText("Soft-deleted");
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it("shows checked deleted_at toggle for deleted family", () => {
    render(
      <FamilyForm
        {...defaultProps}
        title="Edit Family"
        isEdit={true}
        initial={{ ...mockFamilyDetail, deleted_at: "2025-01-01T00:00:00Z" }}
        showDeletedToggle={true}
      />
    );

    const checkbox = screen.getByLabelText("Mark as deleted");
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toBeChecked();
  });

  /* ── deleted_at confirmation dialog ─────────────────────── */

  it("shows confirmation dialog when toggling deleted_at and submitting", async () => {
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

  it("calls onSubmit with deleted_at set after confirming soft-delete", async () => {
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

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: expect.any(String) }));
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

  it("submits without confirmation when unchecking deleted_at (restore)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <FamilyForm
        {...defaultProps}
        title="Edit Family"
        isEdit={true}
        initial={{ ...mockFamilyDetail, deleted_at: "2025-01-01T00:00:00Z" }}
        showDeletedToggle={true}
        onSubmit={onSubmit}
      />
    );

    const checkbox = screen.getByLabelText("Mark as deleted");
    await user.click(checkbox);

    await user.click(screen.getByText("Update"));

    // No confirmation dialog — restoring is safe
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: null }));
    expect(screen.queryByText("Soft-delete this family?")).not.toBeInTheDocument();
  });

  it("submits without confirmation for normal updates (no deleted_at change)", async () => {
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
