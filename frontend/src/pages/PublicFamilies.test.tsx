import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";
import type { PublicFamilySummary } from "../types";
import PublicFamilies from "./PublicFamilies";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const mockFamilies: PublicFamilySummary[] = [
  {
    id: 1,
    display_id: "0-1",
    bio: "A family of four looking forward to a warm holiday season.",
    person_count: 4,
    min_age: 5,
    max_age: 14,
    claimed_by_current_user: false,
  },
  {
    id: 2,
    display_id: "0-2",
    bio: null,
    person_count: 2,
    min_age: 30,
    max_age: 35,
    claimed_by_current_user: false,
  },
  {
    id: 3,
    display_id: "0-3",
    bio: "Single parent with one child.",
    person_count: 2,
    min_age: 8,
    max_age: 8,
    claimed_by_current_user: false,
  },
];

const mockResponse = {
  families: mockFamilies,
  total: 3,
  page: 1,
  page_size: 12,
  total_pages: 1,
};

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (ui: React.ReactElement, path = "/families") => {
  const queryClient = createQueryClient();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>
  );
};

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("PublicFamilies", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders loading state initially", () => {
    vi.spyOn(api, "listPublicFamilies").mockReturnValue(new Promise(() => {})); // never resolves

    wrap(<PublicFamilies />);
    expect(document.querySelector("svg.animate-spin")).toBeInTheDocument();
  });

  it("renders family cards with display IDs", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />);

    await waitFor(() => {
      expect(screen.getByText("0-1")).toBeInTheDocument();
      expect(screen.getByText("0-2")).toBeInTheDocument();
      expect(screen.getByText("0-3")).toBeInTheDocument();
    });
  });

  it("renders bio text when present", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />);

    await waitFor(() => {
      expect(screen.getByText("A family of four looking forward to a warm holiday season.")).toBeInTheDocument();
      expect(screen.getByText("Single parent with one child.")).toBeInTheDocument();
    });
  });

  it("skips bio section when bio is null", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />);

    await waitFor(() => {
      expect(screen.getByText("0-2")).toBeInTheDocument();
    });

    // 0-2 has null bio — should show member count and age
    const twoMemberCards = screen.getAllByText("2 members");
    expect(twoMemberCards.length).toBeGreaterThan(0);
  });

  it("renders member counts with correct singular/plural", async () => {
    const singleMember: PublicFamilySummary = {
      id: 1,
      display_id: "0-1",
      bio: "A family of one.",
      person_count: 1,
      min_age: 5,
      max_age: 14,
      claimed_by_current_user: false,
    };
    const singleMemberResponse = {
      ...mockResponse,
      families: [singleMember],
    };
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(singleMemberResponse);

    wrap(<PublicFamilies />);

    await waitFor(() => {
      expect(screen.getByText("1 member")).toBeInTheDocument();
    });
  });

  it("renders age range correctly", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />);

    await waitFor(() => {
      // Range: "Ages 5–14"
      expect(screen.getByText("Ages 5–14")).toBeInTheDocument();
      // Single age (min === max): "Ages 8"
      expect(screen.getByText("Ages 8")).toBeInTheDocument();
    });
  });

  it("cards link to wish-list pages", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    const wishListPaths: string[] = [];
    const queryClient = createQueryClient();
    render(
      <MemoryRouter initialEntries={["/families"]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/families" element={<PublicFamilies />} />
            <Route path="/families/:id/wish-list" element={<div data-testid="wish-list-page">Wish List</div>} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("0-1")).toBeInTheDocument();
    });

    // Cards are <Link> elements — check hrefs
    const links = screen.getAllByRole("link", { name: /0-1/i });
    expect(links.length).toBeGreaterThan(0);
    // The card link should navigate to the wish list
    const cardLinks = document.querySelectorAll('a[href^="/families/"]');
    cardLinks.forEach((link) => {
      wishListPaths.push(link.getAttribute("href") || "");
    });
    expect(wishListPaths).toContain("/families/1/wish-list");
    expect(wishListPaths).toContain("/families/2/wish-list");
    expect(wishListPaths).toContain("/families/3/wish-list");
  });

  it("renders filter inputs", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />);

    await waitFor(() => {
      expect(screen.getByLabelText("Min Members")).toBeInTheDocument();
      expect(screen.getByLabelText("Max Members")).toBeInTheDocument();
      expect(screen.getByLabelText("Min Age")).toBeInTheDocument();
      expect(screen.getByLabelText("Max Age")).toBeInTheDocument();
    });
  });

  it("renders sort button", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Sort:/i })).toBeInTheDocument();
    });
  });

  it("shows empty state when no families", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue({
      families: [],
      total: 0,
      page: 1,
      page_size: 12,
      total_pages: 0,
    });

    wrap(<PublicFamilies />);

    await waitFor(() => {
      expect(screen.getByText("No families available yet.")).toBeInTheDocument();
    });
  });

  it("shows error state on API failure", async () => {
    vi.spyOn(api, "listPublicFamilies").mockRejectedValue(new Error("API error"));

    wrap(<PublicFamilies />);

    await waitFor(() => {
      expect(screen.getByText("Unable to Load Families")).toBeInTheDocument();
    });
  });

  it("renders pagination when multiple pages exist", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue({
      ...mockResponse,
      total: 30,
      total_pages: 3,
    });

    wrap(<PublicFamilies />);

    await waitFor(() => {
      expect(screen.getByText("0-1")).toBeInTheDocument();
    });

    // Pagination should show page buttons
    expect(screen.getByLabelText("Page 1")).toBeInTheDocument();
  });

  it("clicking sort button cycles sort options", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sort: Default" })).toBeInTheDocument();
    });

    // Click to cycle to first sort option
    const sortBtn = screen.getByRole("button", { name: "Sort: Default" });
    await user.click(sortBtn);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sort: Family Size ↑" })).toBeInTheDocument();
    });
  });
});
