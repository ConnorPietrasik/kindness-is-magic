import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PackingSlipItem } from "../types";
import { PackingSlipsView } from "./PackingSlips";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const mockFamily: PackingSlipItem = {
  id: 5,
  display_id: "2-1",
  family_wish: "A weekend trip",
  people: [
    {
      display_id: "1",
      given_name: "Alice",
      role: "daughter",
      note: null,
      age: 10,
      wishes: [
        {
          id: 1,
          display_id: "1A",
          type: "practical",
          description: "Coat",
          size: "S",
          color: "Blue",
          assigned_to_id: null,
          purchased_at: null,
          purchased_where: null,
          received_at: null,
          purchaser_note: null,
          deleted_at: null,
        },
        {
          id: 2,
          display_id: "1B",
          type: "fun",
          description: "LEGO",
          size: null,
          color: null,
          assigned_to_id: null,
          purchased_at: null,
          purchased_where: null,
          received_at: null,
          purchaser_note: null,
          deleted_at: null,
        },
        {
          id: 3,
          display_id: "1B",
          type: "fun",
          description: "Deleted toy",
          size: null,
          color: null,
          assigned_to_id: null,
          purchased_at: null,
          purchased_where: null,
          received_at: null,
          purchaser_note: null,
          deleted_at: "2025-11-01T00:00:00Z",
        },
      ],
    },
    {
      display_id: "2",
      given_name: "Bob",
      role: "son",
      note: null,
      age: 7,
      wishes: [
        {
          id: 4,
          display_id: "2X",
          type: "adult",
          description: "Jacket",
          size: null,
          color: null,
          assigned_to_id: null,
          purchased_at: null,
          purchased_where: null,
          received_at: null,
          purchaser_note: null,
          deleted_at: null,
        },
      ],
    },
  ],
};

const mockFamilyNoFun: PackingSlipItem = {
  id: 6,
  display_id: "2-2",
  family_wish: "Groceries",
  people: [
    {
      display_id: "1",
      given_name: "Carol",
      role: "mother",
      note: null,
      age: 30,
      wishes: [
        {
          id: 5,
          display_id: "1A",
          type: "practical",
          description: "Rice",
          size: null,
          color: null,
          assigned_to_id: null,
          purchased_at: null,
          purchased_where: null,
          received_at: null,
          purchaser_note: null,
          deleted_at: null,
        },
      ],
    },
  ],
};

function renderView(props: { data?: PackingSlipItem[] | undefined; isError?: boolean; error?: unknown; emptyMessage?: string }) {
  return render(
    <PackingSlipsView
      data={"data" in props ? props.data : []}
      isError={props.isError ?? false}
      error={props.error ?? null}
      emptyMessage={props.emptyMessage ?? "No families are fully approved yet."}
    />
  );
}

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("PackingSlipsView", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the API error detail when the query failed", () => {
    renderView({
      isError: true,
      error: { response: { data: { detail: "Server exploded" } } },
    });
    expect(screen.getByText("Server exploded")).toBeInTheDocument();
  });

  it("shows the empty state with the page-specific message", () => {
    renderView({ data: [], emptyMessage: "None of the selected families are ready for packing." });
    expect(screen.getByText("No packing slips found.")).toBeInTheDocument();
    expect(screen.getByText("None of the selected families are ready for packing.")).toBeInTheDocument();
  });

  it("renders one card per family with person rows and wish text", async () => {
    renderView({ data: [mockFamily] });

    expect(screen.getByText("2-1")).toBeInTheDocument();
    expect(screen.getByText("A weekend trip")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    // Practical wish renders with size/color in parentheses
    expect(screen.getByText("Coat (S, Blue)")).toBeInTheDocument();
    expect(screen.getByText("Jacket")).toBeInTheDocument();
    // Each wish carries its scoped display_id (person position + type letter)
    expect(screen.getByText("1A")).toBeInTheDocument();
    expect(screen.getByText("1B")).toBeInTheDocument();
    expect(screen.getByText("2X")).toBeInTheDocument();
  });

  it("only shows the Fun column when at least one active fun wish exists", () => {
    const withFun = renderView({ data: [mockFamily] });
    expect(withFun.getByText("Fun")).toBeInTheDocument();
    // Deleted fun wishes are ignored — the active one still shows
    expect(withFun.getByText("LEGO")).toBeInTheDocument();
    expect(withFun.queryByText("Deleted toy")).not.toBeInTheDocument();
    cleanup();

    const withoutFun = renderView({ data: [mockFamilyNoFun] });
    expect(withoutFun.queryByText("Fun")).not.toBeInTheDocument();
  });

  it("shows a placeholder for families with no people", () => {
    renderView({
      data: [{ id: 9, display_id: "3-9", family_wish: "", people: [] }],
    });
    expect(screen.getByText("No family members.")).toBeInTheDocument();
  });

  it("falls back to the error box when data is missing without an error flag", () => {
    // The pages guard loading with PageSpinner; `!data` reaching the view
    // means the fetch produced nothing — show the fallback, not a blank page.
    renderView({ data: undefined });
    expect(screen.getByText(/Unable to load packing slips/)).toBeInTheDocument();
  });
});
