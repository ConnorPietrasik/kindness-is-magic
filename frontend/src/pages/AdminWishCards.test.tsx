import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminWishCards, { buildBlankCards } from "./AdminWishCards";

/* ------------------------------------------------------------------ */
/* buildBlankCards — pure count → card-list builder                    */
/* ------------------------------------------------------------------ */

describe("buildBlankCards", () => {
  it("emits person cards first, then family cards, with sequential keys", () => {
    expect(buildBlankCards(2, 3)).toEqual([
      { key: "person-0", kind: "person" },
      { key: "person-1", kind: "person" },
      { key: "family-0", kind: "family" },
      { key: "family-1", kind: "family" },
      { key: "family-2", kind: "family" },
    ]);
  });

  it("returns [] when both counts are 0", () => {
    expect(buildBlankCards(0, 0)).toEqual([]);
  });

  it("clamps negative and NaN counts to 0 (each input independently)", () => {
    expect(buildBlankCards(-3, NaN)).toEqual([]);
    expect(buildBlankCards(NaN, -1)).toEqual([]);
    expect(buildBlankCards(-3, 2).map((c) => c.kind)).toEqual(["family", "family"]);
  });

  it("clamps counts above 24 to 24", () => {
    expect(buildBlankCards(25, 99)).toHaveLength(48);
    expect(buildBlankCards(24, 0)).toHaveLength(24);
  });

  it("truncates fractional counts", () => {
    expect(buildBlankCards(2.9, 1.5)).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ */
/* Page rendering                                                      */
/* ------------------------------------------------------------------ */

/** The page is static — no auth or Query providers needed, just a router. */
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/admin/wish-cards"]}>
      <Routes>
        <Route path="/admin/wish-cards" element={<AdminWishCards />} />
      </Routes>
    </MemoryRouter>
  );

describe("AdminWishCards page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders 3 person cards and 1 family card by default (family last)", () => {
    renderPage();

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(4);
    expect(cards[0]).not.toHaveClass("wish-card--family");
    expect(cards[1]).not.toHaveClass("wish-card--family");
    expect(cards[2]).not.toHaveClass("wish-card--family");
    expect(cards[3]).toHaveClass("wish-card--family");
  });

  it("person cards show the field labels and the printed # ID line", () => {
    renderPage();

    // 3 person cards carry the person label set; all 4 cards have #, Wish, Size, Color
    expect(screen.getAllByText("Name:")).toHaveLength(3);
    expect(screen.getAllByText("Age:")).toHaveLength(3);
    expect(screen.getAllByText("Wish type:")).toHaveLength(3);
    expect(screen.getAllByText("Wish:")).toHaveLength(4);
    expect(screen.getAllByText("Size:")).toHaveLength(4);
    expect(screen.getAllByText("Color:")).toHaveLength(4);
    expect(screen.getAllByText("#")).toHaveLength(4);
  });

  it("the family card has the Family Wish heading and none of the person labels", () => {
    renderPage();

    const heading = screen.getByRole("heading", { name: "Family Wish" });
    const card = heading.closest("article");
    expect(card).toHaveClass("wish-card--family");
    expect(card).toHaveTextContent("#");
    expect(card).toHaveTextContent("Wish:");
    expect(card).toHaveTextContent("Size:");
    expect(card).toHaveTextContent("Color:");
    expect(card).not.toHaveTextContent("Name:");
    expect(card).not.toHaveTextContent("Age:");
    expect(card).not.toHaveTextContent("Wish type:");
  });

  it("re-renders the card counts when a count input changes", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.clear(screen.getByLabelText("Person cards"));
    await user.type(screen.getByLabelText("Person cards"), "1");
    expect(screen.getAllByRole("article")).toHaveLength(2);

    // An emptied input counts as 0
    await user.clear(screen.getByLabelText("Family cards"));
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });

  it("shows the empty state when both counts are 0", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.clear(screen.getByLabelText("Person cards"));
    await user.clear(screen.getByLabelText("Family cards"));

    expect(screen.getByText("No cards to print — set the counts above.")).toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("prints the sheet from the Print button", async () => {
    const user = userEvent.setup();
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    renderPage();

    await user.click(screen.getByRole("button", { name: "🖨️ Print" }));
    expect(printSpy).toHaveBeenCalledOnce();
  });

  it("links back to the dashboard", () => {
    renderPage();

    expect(screen.getByRole("link", { name: "← Dashboard" })).toHaveAttribute("href", "/dashboard");
  });
});
