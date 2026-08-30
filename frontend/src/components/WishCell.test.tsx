import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WishSummary } from "../types";
import { WishCellAdult, WishCellType, wishText } from "./WishCell";

function makeWish(overrides: Partial<WishSummary> = {}): WishSummary {
  return {
    id: 1,
    display_id: null,
    type: "adult",
    description: "Sweater",
    size: "M",
    color: null,
    assigned_to_id: null,
    purchased_at: null,
    purchased_where: null,
    received_at: null,
    purchaser_note: null,
    deleted_at: null,
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("wishText", () => {
  it("joins size and color when both present", () => {
    expect(wishText({ description: "Sweater", size: "M", color: "Blue" })).toBe("Sweater (M, Blue)");
  });

  it("shows size only when color is null", () => {
    expect(wishText({ description: "Sweater", size: "M", color: null })).toBe("Sweater (M)");
  });

  it("shows color only when size is null", () => {
    expect(wishText({ description: "Sweater", size: null, color: "Blue" })).toBe("Sweater (Blue)");
  });

  it("omits parentheses when both are null", () => {
    expect(wishText({ description: "Gift Card", size: null, color: null })).toBe("Gift Card");
  });
});

describe("WishCellAdult", () => {
  it("renders the adult wish with size and color in parentheses", () => {
    render(<WishCellAdult wishes={[makeWish({ type: "adult", description: "Sweater", size: "M", color: "Blue" })]} />);
    expect(screen.getByText("Sweater (M, Blue)")).toBeInTheDocument();
  });

  it("renders the adult wish with size in parentheses", () => {
    render(<WishCellAdult wishes={[makeWish({ type: "adult", description: "Sweater", size: "M" })]} />);
    expect(screen.getByText("Sweater (M)")).toBeInTheDocument();
  });

  it("renders the adult wish without size when null", () => {
    render(<WishCellAdult wishes={[makeWish({ type: "adult", description: "Gift Card", size: null })]} />);
    expect(screen.getByText("Gift Card")).toBeInTheDocument();
  });

  it("renders '—' when no adult wish is found", () => {
    render(<WishCellAdult wishes={[]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("ignores deleted wishes", () => {
    render(<WishCellAdult wishes={[makeWish({ type: "adult", description: "Old", deleted_at: "2025-01-01T00:00:00Z" })]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("ignores non-adult wishes", () => {
    render(
      <WishCellAdult wishes={[makeWish({ type: "fun", description: "Toy" }), makeWish({ type: "practical", description: "Socks" })]} />
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("picks the adult wish among mixed types", () => {
    render(
      <WishCellAdult
        wishes={[
          makeWish({ type: "fun", description: "Toy" }),
          makeWish({ type: "adult", description: "Wine", size: "750ml" }),
          makeWish({ type: "practical", description: "Socks" }),
        ]}
      />
    );
    expect(screen.getByText("Wine (750ml)")).toBeInTheDocument();
  });

  it("renders a td with colSpan=2", () => {
    const { container } = render(<WishCellAdult wishes={[makeWish({ type: "adult" })]} />);
    const td = container.querySelector("td");
    expect(td).toHaveAttribute("colSpan", "2");
  });
});

describe("WishCellType", () => {
  it("renders the wish for matching type with size", () => {
    render(<WishCellType wishes={[makeWish({ type: "fun", description: "Board Game", size: null })]} type="fun" />);
    expect(screen.getByText("Board Game")).toBeInTheDocument();
  });

  it("renders the wish for matching type with size in parens", () => {
    render(<WishCellType wishes={[makeWish({ type: "practical", description: "Socks", size: "L" })]} type="practical" />);
    expect(screen.getByText("Socks (L)")).toBeInTheDocument();
  });

  it("renders '—' when no matching wish type is found", () => {
    render(<WishCellType wishes={[makeWish({ type: "fun" })]} type="practical" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("ignores deleted wishes of the matching type", () => {
    render(<WishCellType wishes={[makeWish({ type: "fun", description: "Old Toy", deleted_at: "2025-01-01T00:00:00Z" })]} type="fun" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("picks the active wish when deleted and active of same type exist", () => {
    render(
      <WishCellType
        wishes={[
          makeWish({ type: "fun", id: 1, description: "Old Toy", deleted_at: "2025-01-01T00:00:00Z" }),
          makeWish({ type: "fun", id: 2, description: "New Toy", size: null }),
        ]}
        type="fun"
      />
    );
    expect(screen.getByText("New Toy")).toBeInTheDocument();
  });

  it("renders a td without colSpan for type cell", () => {
    const { container } = render(<WishCellType wishes={[makeWish({ type: "fun" })]} type="fun" />);
    const td = container.querySelector("td");
    expect(td).not.toHaveAttribute("colSpan");
  });
});
