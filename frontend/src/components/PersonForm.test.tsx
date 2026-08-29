import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonDetail } from "../types";
import { PERSON_ROLES, personRoleLabel } from "../types";
import { PersonForm } from "./PersonForm";

const mockChildPerson: PersonDetail = {
  id: 1,
  family_id: 5,
  display_id: "1",
  given_name: "Alice",
  role: "son",
  age: 8,
  note: null,
  created_at: "2025-01-01T00:00:00Z",
  deleted_at: null,
  wishes: [
    {
      id: 1,
      type: "practical",
      description: "A backpack",
      size: "M",
      assigned_to_id: null,
      purchased_at: null,
      purchased_where: null,
      received_at: null,
      purchaser_note: null,
      deleted_at: null,
    },
    {
      id: 2,
      type: "fun",
      description: "A doll",
      size: null,
      assigned_to_id: null,
      purchased_at: null,
      purchased_where: null,
      received_at: null,
      purchaser_note: null,
      deleted_at: null,
    },
  ],
};

const mockAdultPerson: PersonDetail = {
  id: 2,
  family_id: 5,
  display_id: "2",
  given_name: "Bob",
  role: "daughter",
  age: 25,
  note: null,
  created_at: "2025-01-01T00:00:00Z",
  deleted_at: null,
  wishes: [
    {
      id: 3,
      type: "adult",
      description: "A coffee maker",
      size: null,
      assigned_to_id: null,
      purchased_at: null,
      purchased_where: null,
      received_at: null,
      purchaser_note: null,
      deleted_at: null,
    },
  ],
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
    render(<PersonForm {...defaultProps} title="Edit Person" isEdit={true} initial={mockChildPerson} />);

    expect(screen.queryByLabelText("Family")).not.toBeInTheDocument();
    expect(screen.queryByText("Select family…")).not.toBeInTheDocument();
  });

  /* ── Form submission basics ─────────────────────────────── */

  it("calls onCancel when cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<PersonForm {...defaultProps} title="Edit Person" isEdit={true} initial={mockChildPerson} onCancel={onCancel} />);

    await user.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows loading state on submit button", () => {
    render(<PersonForm {...defaultProps} title="Edit Person" isEdit={true} initial={mockChildPerson} loading={true} />);

    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });

  /* ── Age-based conditional rendering ────────────────────── */

  /* ── Role (required dropdown) ─────────────────────── */

  it("shows role dropdown with all options, required, and help text", () => {
    render(<PersonForm {...defaultProps} title="Add Person" isEdit={false} initial={{}} />);

    const roleSelect = screen.getByLabelText("Role");
    expect(roleSelect).toBeRequired();
    expect(screen.getByText("Select role…")).toBeInTheDocument();
    for (const role of PERSON_ROLES) {
      expect(screen.getByRole("option", { name: personRoleLabel(role) })).toHaveValue(role);
    }
    expect(screen.getByText("To help with choosing gifts; choose whichever is closest")).toBeInTheDocument();
  });

  it("populates role from existing person on edit", () => {
    render(<PersonForm {...defaultProps} title="Edit Person" isEdit={true} initial={mockChildPerson} />);

    expect(screen.getByLabelText("Role")).toHaveValue("son");
  });

  it("keeps user input when the same person refetches (new initial object identity)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PersonForm {...defaultProps} title="Edit Person" isEdit={true} initial={mockChildPerson} />);
    await user.type(screen.getByLabelText("Given Name"), "X");

    // A background refetch delivers a new object for the same person id
    rerender(<PersonForm {...defaultProps} title="Edit Person" isEdit={true} initial={{ ...mockChildPerson }} />);

    expect(screen.getByLabelText("Given Name")).toHaveValue("AliceX");
  });

  it("repopulates the form when the edited person changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PersonForm {...defaultProps} title="Edit Person" isEdit={true} initial={mockChildPerson} />);
    await user.type(screen.getByLabelText("Given Name"), "X");

    rerender(<PersonForm {...defaultProps} title="Edit Person" isEdit={true} initial={mockAdultPerson} />);

    expect(screen.getByLabelText("Given Name")).toHaveValue("Bob");
    expect(screen.getByLabelText("Role")).toHaveValue("daughter");
  });

  it("hides wish fields and shows hint when age is not entered", () => {
    render(<PersonForm {...defaultProps} title="Add Person" isEdit={false} initial={{}} />);

    expect(screen.getByText("Enter the person's age above to see wish fields.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Practical Wish")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fun Wish")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Wish")).not.toBeInTheDocument();
  });

  it("renders Practical Wish and Fun Wish fields for children (age < 18)", () => {
    render(<PersonForm {...defaultProps} title="Add Person" isEdit={false} initial={{ age: 8 }} />);

    expect(screen.getByLabelText("Practical Wish")).toBeInTheDocument();
    expect(screen.getByLabelText("Fun Wish")).toBeInTheDocument();
    expect(screen.getByLabelText("Size")).toBeInTheDocument();
  });

  it("renders single Wish field for adults (age >= 18)", () => {
    render(<PersonForm {...defaultProps} title="Add Person" isEdit={false} initial={{ age: 25 }} />);

    expect(screen.getByLabelText("Wish")).toBeInTheDocument();
    expect(screen.queryByLabelText("Practical Wish")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fun Wish")).not.toBeInTheDocument();
  });

  it("hides Fun Wish when age changes from child to adult", async () => {
    const user = userEvent.setup();
    render(<PersonForm {...defaultProps} title="Add Person" isEdit={false} initial={{ age: 8 }} />);

    expect(screen.getByLabelText("Fun Wish")).toBeInTheDocument();

    const ageInput = screen.getByLabelText("Age");
    await user.clear(ageInput);
    await user.type(ageInput, "20");

    expect(screen.queryByLabelText("Fun Wish")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Wish")).toBeInTheDocument();
  });

  it("shows Fun Wish when age changes from adult to child", async () => {
    const user = userEvent.setup();
    render(<PersonForm {...defaultProps} title="Add Person" isEdit={false} initial={{ age: 25 }} />);

    expect(screen.queryByLabelText("Fun Wish")).not.toBeInTheDocument();

    const ageInput = screen.getByLabelText("Age");
    await user.clear(ageInput);
    await user.type(ageInput, "10");

    expect(screen.getByLabelText("Fun Wish")).toBeInTheDocument();
    expect(screen.getByLabelText("Practical Wish")).toBeInTheDocument();
  });

  /* ── Edit mode — populates from existing wishes ─────────── */

  it("populates form fields from child wishes on edit", () => {
    render(<PersonForm {...defaultProps} title="Edit Person" isEdit={true} initial={mockChildPerson} />);

    expect(screen.getByLabelText("Practical Wish")).toHaveValue("A backpack");
    expect(screen.getByLabelText("Size")).toHaveValue("M");
    expect(screen.getByLabelText("Fun Wish")).toHaveValue("A doll");
  });

  it("populates form fields from adult wish on edit", () => {
    render(<PersonForm {...defaultProps} title="Edit Person" isEdit={true} initial={mockAdultPerson} />);

    expect(screen.getByLabelText("Wish")).toHaveValue("A coffee maker");
    expect(screen.queryByLabelText("Fun Wish")).not.toBeInTheDocument();
  });

  /* ── Form submission ────────────────────────────────────── */

  it("submits wishes array for a child", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<PersonForm title="Add Person" isEdit={false} initial={{ age: 8 }} onSubmit={onSubmit} onCancel={() => {}} />);

    await user.selectOptions(screen.getByLabelText("Role"), "son");
    await user.type(screen.getByLabelText("Given Name"), "Charlie");
    await user.type(screen.getByLabelText("Practical Wish"), "Bike");
    await user.type(screen.getByLabelText("Size"), "S");
    await user.type(screen.getByLabelText("Fun Wish"), "Lego set");
    await user.click(screen.getByText("Create"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        given_name: "Charlie",
        role: "son",
        age: 8,
        wishes: [
          { type: "practical", description: "Bike", size: "S" },
          { type: "fun", description: "Lego set", size: null },
        ],
      })
    );
  });

  it("submits wishes array for an adult", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<PersonForm title="Add Person" isEdit={false} initial={{ age: 30 }} onSubmit={onSubmit} onCancel={() => {}} />);

    await user.selectOptions(screen.getByLabelText("Role"), "mother");
    await user.type(screen.getByLabelText("Given Name"), "Diana");
    await user.type(screen.getByLabelText("Wish"), "Headphones");
    await user.type(screen.getByLabelText("Size"), "0");
    await user.click(screen.getByText("Create"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        given_name: "Diana",
        role: "mother",
        age: 30,
        wishes: [{ type: "adult", description: "Headphones", size: null }],
      })
    );
  });

  it("includes family_id in payload when set", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<PersonForm {...defaultProps} title="Add Person" isEdit={false} initial={{ age: 8 }} onSubmit={onSubmit} />);

    await user.selectOptions(screen.getByLabelText("Family"), "5");
    await user.selectOptions(screen.getByLabelText("Role"), "daughter");
    await user.type(screen.getByLabelText("Given Name"), "Eve");
    await user.type(screen.getByLabelText("Practical Wish"), "Book");
    await user.type(screen.getByLabelText("Size"), "0");
    await user.type(screen.getByLabelText("Fun Wish"), "Puzzle");
    await user.click(screen.getByText("Create"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        family_id: 5,
        given_name: "Eve",
        role: "daughter",
        wishes: [
          expect.objectContaining({ type: "practical", description: "Book" }),
          expect.objectContaining({ type: "fun", description: "Puzzle" }),
        ],
      })
    );
  });
});
