import { cleanup, render, screen } from "@testing-library/react";
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
  deleted_at: null,
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
