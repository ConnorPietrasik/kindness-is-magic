import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColumnHeader } from "./ColumnHeader";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ColumnHeader", () => {
  const baseProps = {
    label: "Purchased",
    field: "purchased_at",
    searchKind: "date" as const,
    sortField: "",
    columnSearch: {},
    onSort: vi.fn(),
    onSearchChange: vi.fn(),
  };

  it("collapses empty date inputs to the calendar icon and expands them when a value is set", () => {
    const { rerender } = render(<ColumnHeader {...baseProps} />);

    const from = screen.getByLabelText("Purchased from");
    const to = screen.getByLabelText("Purchased to");

    // Empty → icon-only (the date-empty class hides the placeholder text)
    expect(from).toHaveClass("date-empty");
    expect(from).not.toHaveClass("w-full");
    expect(to).toHaveClass("date-empty");
    expect(to).not.toHaveClass("w-full");

    // A picked day expands that box to show the date
    rerender(<ColumnHeader {...baseProps} columnSearch={{ purchased_at_from: "2026-01-15" }} />);

    expect(from).toHaveValue("2026-01-15");
    expect(from).toHaveClass("w-full");
    expect(from).not.toHaveClass("date-empty");
    // The other box stays collapsed
    expect(to).toHaveClass("date-empty");
  });
});
