import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import * as api from "../lib/api";
import { auth } from "../lib/queryKeys";
import type { DonorWishSummary, FamilyWishListResponse, PersonWishItem } from "../types";
import FamilyWishCards, { buildWishCards } from "./FamilyWishCards";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const wish = (over: Partial<DonorWishSummary> = {}): DonorWishSummary => ({
  id: 1,
  display_id: null,
  type: "practical",
  description: "A warm sweater",
  size: "M",
  color: "Blue",
  ...over,
});

const person = (over: Partial<PersonWishItem> = {}): PersonWishItem => ({
  display_id: "0-1-1",
  given_name: "Alice",
  role: "son",
  age: 8,
  note: null,
  wishes: [],
  ...over,
});

// Person 1's wishes are deliberately stored fun-first to cover reordering.
const mockWishList: FamilyWishListResponse = {
  display_id: "0-1",
  bio: null,
  family_wish: wish({
    id: 99,
    type: "family",
    display_id: "0-1-F",
    description: "A warm winter for everyone.",
    size: null,
    color: null,
  }),
  people: [
    person({
      display_id: "0-1-1",
      given_name: "Alice",
      role: "son",
      age: 8,
      wishes: [
        wish({ id: 1, type: "fun", display_id: "0-1-1B", description: "A bicycle", size: null, color: "Red" }),
        wish({ id: 2, type: "practical", display_id: "0-1-1A", description: "A warm sweater", size: "M", color: "Blue" }),
      ],
    }),
    person({
      display_id: "0-1-2",
      given_name: "Bob",
      role: "daughter",
      age: 20,
      wishes: [wish({ id: 3, type: "adult", display_id: "0-1-2X", description: "A gift card", size: null, color: null })],
    }),
  ],
  claimed_by_current_user: false,
  claim_status: null,
  claim_id: null,
};

/* ------------------------------------------------------------------ */
/* buildWishCards — pure flattening helper                             */
/* ------------------------------------------------------------------ */

describe("buildWishCards", () => {
  it("emits one card per wish in practical → fun → adult order, family card last", () => {
    const cards = buildWishCards(mockWishList);
    expect(cards.map((c) => c.key)).toEqual(["2", "1", "3", "family"]);
  });

  it("person cards carry the wish display id, role name, age, and wish type", () => {
    const [first] = buildWishCards(mockWishList);
    expect(first).toMatchObject({
      kind: "person",
      display_id: "0-1-1A",
      name: "Son Alice",
      age: 8,
      wish_type: "Practical",
      description: "A warm sweater",
      size: "M",
      color: "Blue",
    });
  });

  it("the family card uses the family wish display id and omits name, age, and wish type", () => {
    const [familyCard] = buildWishCards(mockWishList).filter((c) => c.kind === "family");
    expect(familyCard).toMatchObject({
      display_id: "0-1-F",
      name: null,
      age: null,
      wish_type: null,
      description: "A warm winter for everyone.",
    });
  });

  it("omits the family card when the family has no family wish", () => {
    const cards = buildWishCards({ ...mockWishList, family_wish: null });
    expect(cards.map((c) => c.kind)).toEqual(["person", "person", "person"]);
  });

  it("handles a family with no people (family-wish card only)", () => {
    const cards = buildWishCards({ ...mockWishList, people: [] });
    expect(cards.map((c) => c.kind)).toEqual(["family"]);
  });

  it("handles a family with no wishes at all", () => {
    const cards = buildWishCards({ ...mockWishList, family_wish: null, people: [] });
    expect(cards).toEqual([]);
  });

  it("omits the wish type label on adult cards", () => {
    const adultCard = buildWishCards(mockWishList).find((c) => c.description === "A gift card");
    expect(adultCard).toMatchObject({ kind: "person", age: 20, wish_type: null });
  });

  it("falls back to the owner's display id when a wish has none", () => {
    const cards = buildWishCards({
      ...mockWishList,
      family_wish: null,
      people: [person({ wishes: [wish({ display_id: null })] })],
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.display_id).toBe("0-1-1");
  });
});

/* ------------------------------------------------------------------ */
/* Page rendering                                                      */
/* ------------------------------------------------------------------ */

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Renders the page inside router + query + auth providers (logged out). */
const wrap = () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(auth, null);
  return render(
    <MemoryRouter initialEntries={["/families/1/wish-cards"]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Routes>
            <Route path="/families/:id/wish-cards" element={<FamilyWishCards />} />
          </Routes>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

describe("FamilyWishCards page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders one card per wish plus the family card", async () => {
    vi.spyOn(api, "getFamilyWishList").mockResolvedValue(mockWishList);

    wrap();

    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(4);
    // One card per wish — Alice (two wishes) appears on two cards
    expect(screen.getAllByRole("heading", { name: "Son Alice" })).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Daughter Bob" })).toBeInTheDocument();
    // Family card content
    expect(screen.getByRole("heading", { name: "Family Wish" })).toBeInTheDocument();
  });

  it("shows the wish display id, name, age, wish type, and size/color on person cards", async () => {
    vi.spyOn(api, "getFamilyWishList").mockResolvedValue(mockWishList);

    wrap();

    // One card per wish — Alice has two cards; locate hers by the unique description.
    const description = await screen.findByText("A warm sweater");
    const card = description.closest("article");
    expect(card).toHaveTextContent("Son Alice");
    expect(card).toHaveTextContent("#0-1-1A");
    expect(card).toHaveTextContent("Age 8 · Practical");
    expect(card).toHaveTextContent("Size: M");
    expect(card).toHaveTextContent("Color: Blue");
  });

  it("omits size, color, and the wish type label on the adult card", async () => {
    vi.spyOn(api, "getFamilyWishList").mockResolvedValue(mockWishList);

    wrap();

    const heading = await screen.findByRole("heading", { name: "Daughter Bob" });
    const card = heading.closest("article");
    expect(card).toHaveTextContent("A gift card");
    expect(card).toHaveTextContent("Age 20");
    expect(card).not.toHaveTextContent("Size:");
    expect(card).not.toHaveTextContent("Color:");
    expect(card).not.toHaveTextContent("Adult");
  });

  it("omits name and age on the family card", async () => {
    vi.spyOn(api, "getFamilyWishList").mockResolvedValue(mockWishList);

    wrap();

    const heading = await screen.findByRole("heading", { name: "Family Wish" });
    const card = heading.closest("article");
    expect(card).toHaveTextContent("#0-1-F");
    expect(card).toHaveTextContent("A warm winter for everyone.");
    expect(card).not.toHaveTextContent("Age");
    expect(card).not.toHaveTextContent("Son Alice");
    expect(card).not.toHaveTextContent("Daughter Bob");
  });

  it("shows the empty state when the family has no wishes", async () => {
    vi.spyOn(api, "getFamilyWishList").mockResolvedValue({ ...mockWishList, family_wish: null, people: [] });

    wrap();

    await screen.findByText("No wishes to print yet.");
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("links back to the wish list and prints the sheet from the Print button", async () => {
    const user = userEvent.setup();
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    vi.spyOn(api, "getFamilyWishList").mockResolvedValue(mockWishList);

    wrap();

    const backLink = await screen.findByRole("link", { name: "← Back to wish list" });
    expect(backLink).toHaveAttribute("href", "/families/1/wish-list");

    await user.click(screen.getByRole("button", { name: "Print" }));
    expect(printSpy).toHaveBeenCalledOnce();
  });

  it("shows the error state when the request fails", async () => {
    vi.spyOn(api, "getFamilyWishList").mockRejectedValue(new Error("Network Error"));

    wrap();

    await screen.findByRole("heading", { name: "Unable to Load Wish Cards" });
    expect(screen.getByText("Network Error")).toBeInTheDocument();
  });
});
