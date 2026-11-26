import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import { auth } from "../lib/queryKeys";
import type { DonorWishSummary, WishCardFamily, WishCardPerson } from "../types";
import { buildWishCardsFromGroups } from "./WishCards";
import { WishCardsPage } from "./WishCardsPage";

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

const person = (over: Partial<WishCardPerson> = {}): WishCardPerson => ({
  display_id: "0-1-1",
  given_name: "Alice",
  role: "son",
  age: 8,
  wishes: [],
  ...over,
});

// Two family blocks. Person 1's wishes are deliberately stored fun-first:
// the endpoint sends each person's wishes in card order and the sheet must
// pass that order through untouched (no client-side re-sorting) — this
// proves the received order is what gets rendered. The second block has no
// family wish.
const mockGroups: WishCardFamily[] = [
  {
    display_id: "0-1",
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
        wishes: [
          wish({ id: 1, type: "fun", display_id: "0-1-1B", description: "A bicycle", size: null, color: "Red" }),
          wish({ id: 2, type: "practical", display_id: "0-1-1A", description: "A warm sweater", size: "M", color: "Blue" }),
        ],
      }),
    ],
  },
  {
    display_id: "0-2",
    family_wish: null,
    people: [
      person({
        display_id: "0-2-1",
        given_name: "Bob",
        role: "daughter",
        age: 20,
        wishes: [wish({ id: 3, type: "adult", display_id: "0-2-1X", description: "A gift card", size: null, color: null })],
      }),
    ],
  },
];

/* ------------------------------------------------------------------ */
/* buildWishCardsFromGroups — pure flattening helper                   */
/* ------------------------------------------------------------------ */

describe("buildWishCardsFromGroups", () => {
  it("keeps family block order, family card first in its block, and the received wish order", () => {
    const cards = buildWishCardsFromGroups(mockGroups);
    expect(cards.map((c) => c.key)).toEqual(["99", "1", "2", "3"]);
    expect(cards.map((c) => c.kind)).toEqual(["family", "person", "person", "person"]);
  });

  it("person cards carry the wish display id, role name, age, and wish type", () => {
    const practical = buildWishCardsFromGroups(mockGroups).find((c) => c.description === "A warm sweater");
    expect(practical).toMatchObject({
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
    const [familyCard] = buildWishCardsFromGroups(mockGroups).filter((c) => c.kind === "family");
    expect(familyCard).toMatchObject({
      display_id: "0-1-F",
      name: null,
      age: null,
      wish_type: null,
      description: "A warm winter for everyone.",
    });
  });

  it("omits the family card for blocks without an assigned family wish", () => {
    const cards = buildWishCardsFromGroups(mockGroups);
    // First block: family card + Alice's two cards — the second block starts at index 3
    const secondBlock = cards.slice(3);
    expect(secondBlock.map((c) => c.kind)).toEqual(["person"]);
  });

  it("omits the wish type label on adult cards", () => {
    const adultCard = buildWishCardsFromGroups(mockGroups).find((c) => c.description === "A gift card");
    expect(adultCard).toMatchObject({ kind: "person", age: 20, wish_type: null });
  });

  it("falls back to the owner's display id when a wish has none", () => {
    const groups: WishCardFamily[] = [
      { display_id: "0-3", family_wish: null, people: [person({ display_id: "0-3-1", wishes: [wish({ display_id: null })] })] },
    ];
    const cards = buildWishCardsFromGroups(groups);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.display_id).toBe("0-3-1");
  });

  it("handles an empty response", () => {
    expect(buildWishCardsFromGroups([])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Page rendering                                                      */
/* ------------------------------------------------------------------ */

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Renders the shared page (wired like the purchaser page) inside router +
    query + auth providers (logged out). */
const renderPage = (listFn: () => Promise<WishCardFamily[]>) => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(auth, null);
  return render(
    <MemoryRouter initialEntries={["/purchaser/wish-cards"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AuthProvider>
            <WishCardsPage listFn={listFn} queryKey={["testWishCards"]} backTo="/purchaser/assigned-gifts" backLabel="Assigned Gifts" />
          </AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

describe("WishCardsPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders one card per wish across both family blocks", async () => {
    renderPage(() => Promise.resolve(mockGroups));

    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(4);
    // Alice has two wishes — one card each
    expect(screen.getAllByRole("heading", { name: "Son Alice" })).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Daughter Bob" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Family Wish" })).toBeInTheDocument();
  });

  it("shows the wish display id on the card", async () => {
    renderPage(() => Promise.resolve(mockGroups));

    const description = await screen.findByText("A warm sweater");
    const card = description.closest("article");
    expect(card).toHaveTextContent("#0-1-1A");
    expect(card).toHaveTextContent("Age 8 · Practical");
  });

  it("links back to the assigned-gifts list and prints the sheet from the Print button", async () => {
    const user = userEvent.setup();
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    renderPage(() => Promise.resolve(mockGroups));

    const backLink = await screen.findByRole("link", { name: "← Assigned Gifts" });
    expect(backLink).toHaveAttribute("href", "/purchaser/assigned-gifts");

    await user.click(screen.getByRole("button", { name: "🖨️ Print" }));
    expect(printSpy).toHaveBeenCalledOnce();
  });

  it("shows the empty state when no wishes are assigned", async () => {
    renderPage(() => Promise.resolve([]));

    await screen.findByText("No wishes to print yet.");
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("shows the error state when the request fails", async () => {
    renderPage(() => Promise.reject(new Error("Network Error")));

    await screen.findByRole("heading", { name: "Unable to Load Wish Cards" });
    expect(screen.getByText("Network Error")).toBeInTheDocument();
  });
});
