import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonDetail } from "../types";
import { PersonForm } from "./PersonForm";

const mockPersonDetail: PersonDetail = {
  id: 1,
  family_id: 5,
  given_name: "Alice",
  title: null,
  age: 8,
  practical_wish: "A backpack",
  fun_wish: "A doll",
  note: null,
  is_deleted: false,
};

const familyMap: Record<number, string> = {
  1: "The Smiths",
  5: "The Johnsons",
  10: "The Joneses",
};

describe("PersonForm", () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    title: "Test Form",
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    familyMap,
    familyOptionsLoading: false,
  };

  /* ── Family selector (admin create only) ────────────────── */

  it("shows family dropdown on create mode", () => {
    render(<PersonForm {...defaultProps} title="Add Person" isEdit={false} initial={{}} />);

    expect(screen.getByLabelText("Family")).toBeInTheDocument();
    expect(screen.getByText("Select family…")).toBeInTheDocument();
  });

  it("does not show family dropdown on edit mode", () => {
    render(<PersonForm {...defaultProps} title="Edit Person" isEdit={true} initial={mockPersonDetail} />);

    expect(screen.queryByLabelText("Family")).not.toBeInTheDocument();
    expect(screen.queryByText("Select family…")).not.toBeInTheDocument();
  });

  /* ── is_deleted toggle ──────────────────────────────────── */

  it("does not show is_deleted toggle when showDeletedToggle is false", () => {
    render(<PersonForm {...defaultProps} title="Edit Person" isEdit={true} initial={mockPersonDetail} showDeletedToggle={false} />);

    expect(screen.queryByLabelText(/soft-deleted/i)).not.toBeInTheDocument();
  });

  it("does not show is_deleted toggle on create mode", () => {
    render(<PersonForm {...defaultProps} title="Add Person" isEdit={false} initial={{}} showDeletedToggle={true} />);

    expect(screen.queryByLabelText(/soft-deleted/i)).not.toBeInTheDocument();
  });

  it("shows unchecked is_deleted toggle for active person", () => {
    render(<PersonForm {...defaultProps} title="Edit Person" isEdit={true} initial={mockPersonDetail} showDeletedToggle={true} />);

    const checkbox = screen.getByLabelText("Soft-deleted");
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it("shows checked is_deleted toggle for deleted person", () => {
    render(
      <PersonForm
        {...defaultProps}
        title="Edit Person"
        isEdit={true}
        initial={{ ...mockPersonDetail, is_deleted: true }}
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
      <PersonForm
        {...defaultProps}
        title="Edit Person"
        isEdit={true}
        initial={mockPersonDetail}
        showDeletedToggle={true}
        onSubmit={onSubmit}
      />
    );

    const checkbox = screen.getByLabelText("Soft-deleted");
    await user.click(checkbox);

    await user.click(screen.getByText("Update"));

    // Confirm dialog should appear
    await waitFor(() => {
      expect(screen.getByText("Soft-delete this person?")).toBeInTheDocument();
    });

    // onSubmit should NOT have been called yet
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onSubmit with is_deleted=true after confirming soft-delete", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <PersonForm
        {...defaultProps}
        title="Edit Person"
        isEdit={true}
        initial={mockPersonDetail}
        showDeletedToggle={true}
        onSubmit={onSubmit}
      />
    );

    const checkbox = screen.getByLabelText("Soft-deleted");
    await user.click(checkbox);

    await user.click(screen.getByText("Update"));

    await waitFor(() => {
      expect(screen.getByText("Soft-delete this person?")).toBeInTheDocument();
    });

    // Confirm the dialog
    await user.click(screen.getByText("Yes, delete"));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ is_deleted: true }));
  });

  it("does not submit when cancelling soft-delete confirmation", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <PersonForm
        {...defaultProps}
        title="Edit Person"
        isEdit={true}
        initial={mockPersonDetail}
        showDeletedToggle={true}
        onSubmit={onSubmit}
      />
    );

    const checkbox = screen.getByLabelText("Soft-deleted");
    await user.click(checkbox);

    await user.click(screen.getByText("Update"));

    await waitFor(() => {
      expect(screen.getByText("Soft-delete this person?")).toBeInTheDocument();
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
      <PersonForm
        {...defaultProps}
        title="Edit Person"
        isEdit={true}
        initial={{ ...mockPersonDetail, is_deleted: true }}
        showDeletedToggle={true}
        onSubmit={onSubmit}
      />
    );

    const checkbox = screen.getByLabelText("Mark as deleted");
    await user.click(checkbox);

    await user.click(screen.getByText("Update"));

    // No confirmation dialog — restoring is safe
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ is_deleted: false }));
    expect(screen.queryByText("Soft-delete this person?")).not.toBeInTheDocument();
  });

  /* ── Form submission basics ─────────────────────────────── */

  it("calls onCancel when cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<PersonForm {...defaultProps} title="Edit Person" isEdit={true} initial={mockPersonDetail} onCancel={onCancel} />);

    await user.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows loading state on submit button", () => {
    render(<PersonForm {...defaultProps} title="Edit Person" isEdit={true} initial={mockPersonDetail} loading={true} />);

    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });

  it("renders all required fields on create", () => {
    render(<PersonForm {...defaultProps} title="Add Person" isEdit={false} initial={{}} />);

    expect(screen.getByLabelText("Given Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Age")).toBeInTheDocument();
    expect(screen.getByLabelText("Practical Wish")).toBeInTheDocument();
    expect(screen.getByLabelText("Fun Wish")).toBeInTheDocument();
  });
});
