import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { DONATE_URL } from "../lib/links";
import { auth } from "../lib/queryKeys";
import type { FamilyClaimSummary, PublicFamilySummary, User } from "../types";
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
    claim_status: null,
  },
  {
    id: 2,
    display_id: "0-2",
    bio: null,
    person_count: 2,
    min_age: 30,
    max_age: 35,
    claim_status: null,
  },
  {
    id: 3,
    display_id: "0-3",
    bio: "Single parent with one child.",
    person_count: 2,
    min_age: 8,
    max_age: 8,
    claim_status: null,
  },
];

const mockDonorClaims: FamilyClaimSummary[] = [
  {
    id: 100,
    family: { id: 20, display_id: "3-1", bio: "The board-game family.", person_count: 4, min_age: 5, max_age: 12, deleted: false },
    commitment_type: "gifts",
    payment_status: "paid",
    notes: null,
    created_at: "2025-11-01T00:00:00Z",
    fulfilled_at: null,
    paid_at: null,
    payment_expires_at: null,
    zeffy_payment_id: null,
    includes_groceries: false,
  },
  {
    id: 101,
    family: { id: 21, display_id: "3-2", bio: null, person_count: 2, min_age: 3, max_age: 8, deleted: false },
    commitment_type: "cash",
    payment_status: "pending",
    notes: null,
    created_at: "2025-11-02T00:00:00Z",
    fulfilled_at: null,
    paid_at: null,
    payment_expires_at: "2025-11-05T00:00:00Z",
    zeffy_payment_id: null,
    includes_groceries: true,
  },
  {
    id: 102,
    family: { id: 22, display_id: "3-3", bio: null, person_count: 3, min_age: 10, max_age: 15, deleted: false },
    commitment_type: "gifts",
    payment_status: "paid",
    notes: null,
    created_at: "2025-10-01T00:00:00Z",
    fulfilled_at: "2025-11-20T00:00:00Z",
    paid_at: null,
    payment_expires_at: null,
    zeffy_payment_id: null,
    includes_groceries: false,
  },
];

const mockResponse = {
  families: mockFamilies,
  total: 3,
  page: 1,
  page_size: 12,
  total_pages: 1,
  fulfilled_count: 0,
};

const mockUser: User = {
  id: 7,
  email: "donor@example.com",
  role: "donor",
  display_name: "Donor",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-14T12:00:00Z",
};

const mockAdmin: User = {
  id: 1,
  email: "admin@example.com",
  role: "admin",
  display_name: "Admin",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-14T12:00:00Z",
};

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/**
 * Renders the page inside router + query + auth providers.
 * Pre-seeds the auth query cache (staleTime: Infinity) so no /api/auth/me
 * request is made and the auth state is deterministic per test.
 */
const wrap = (ui: React.ReactElement, path = "/families", user: User | null = null) => {
  const queryClient = createQueryClient();
  queryClient.setQueryData(auth, user);
  // The "Sponsored by me" section is enabled for claim-capable users — keep
  // it empty by default so existing tests don't see it (unless a test already
  // spied on the API to supply its own claims).
  if (user && user.role !== "family" && !vi.isMockFunction(api.donorListClaims)) {
    vi.spyOn(api, "donorListClaims").mockResolvedValue([]);
  }
  // The gift drop-off deadline banner queries the public deadline rows — keep
  // them empty by default so existing tests don't see a banner (unless a test
  // spied on the API to supply its own rows).
  if (!vi.isMockFunction(api.listDeadlines)) {
    vi.spyOn(api, "listDeadlines").mockResolvedValue({ deadlines: [] });
  }
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AuthProvider>{ui}</AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
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
    localStorage.clear();
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
      claim_status: null,
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
    // Renders without wrap() — keep the banner's public deadlines query hermetic
    vi.spyOn(api, "listDeadlines").mockResolvedValue({ deadlines: [] });

    const wishListPaths: string[] = [];
    const queryClient = createQueryClient();
    queryClient.setQueryData(auth, null);
    render(
      <MemoryRouter initialEntries={["/families"]}>
        <QueryClientProvider client={queryClient}>
          <ToastContainer>
            <AuthProvider>
              <Routes>
                <Route path="/families" element={<PublicFamilies />} />
                <Route path="/families/:id/wish-list" element={<div data-testid="wish-list-page">Wish List</div>} />
              </Routes>
            </AuthProvider>
          </ToastContainer>
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
      expect(screen.getByLabelText("Min Family Members")).toBeInTheDocument();
      expect(screen.getByLabelText("Max Family Members")).toBeInTheDocument();
    });
  });

  it("renders sort button", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Sort:/i })).toBeInTheDocument();
    });
  });

  /* Show-claimed toggle (include_claimed) */

  it("hides the show-sponsored checkbox from anonymous visitors", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />);

    await waitFor(() => expect(screen.getByText("0-1")).toBeInTheDocument());
    expect(screen.queryByLabelText("Show sponsored families")).not.toBeInTheDocument();
  });

  it("hides the show-sponsored checkbox from non-admin logged-in users", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />, "/families", mockUser);

    await waitFor(() => expect(screen.getByText("0-1")).toBeInTheDocument());
    expect(screen.queryByLabelText("Show sponsored families")).not.toBeInTheDocument();
  });

  it("shows the show-sponsored checkbox to admins, unchecked by default", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />, "/families", mockAdmin);

    const checkbox = (await screen.findByLabelText("Show sponsored families")) as HTMLInputElement;
    expect(checkbox).not.toBeChecked();
  });

  it("toggling show-sponsored as admin refetches with include_claimed=true", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />, "/families", mockAdmin);

    const checkbox = (await screen.findByLabelText("Show sponsored families")) as HTMLInputElement;
    await user.click(checkbox);

    // Debounced 300ms — wait for the refetch with the new param
    await waitFor(
      () => {
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ include_claimed: true }));
      },
      { timeout: 2000 }
    );
  });

  it("does not apply a stored show-claimed value for non-admins", async () => {
    const spy = vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    // An admin's saved view in this browser must not reveal claimed families
    // to a non-admin session — the stored value stays inert.
    localStorage.setItem("kim:listView:publicFamilies:filters", JSON.stringify({ showSponsored: true }));
    wrap(<PublicFamilies />, "/families", mockUser);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const params = spy.mock.calls[0]?.[0];
    expect(params?.include_claimed).toBeUndefined();
    expect(screen.queryByLabelText("Show sponsored families")).not.toBeInTheDocument();
    // The inert stored value must not light up the clear affordance either
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("restores the show-sponsored checkbox from storage for admins", async () => {
    const spy = vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    localStorage.setItem("kim:listView:publicFamilies:filters", JSON.stringify({ showSponsored: true }));
    wrap(<PublicFamilies />, "/families", mockAdmin);

    const checkbox = (await screen.findByLabelText("Show sponsored families")) as HTMLInputElement;
    expect(checkbox).toBeChecked();
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ include_claimed: true })));
  });

  /* Claim-status chips on revealed (include_claimed) cards */

  it("renders claim chips from the three-state claim_status on revealed families", async () => {
    const revealed: PublicFamilySummary[] = [
      { id: 4, display_id: "0-4", bio: null, person_count: 3, min_age: 5, max_age: 10, claim_status: "active" },
      { id: 5, display_id: "0-5", bio: null, person_count: 2, min_age: 4, max_age: 9, claim_status: "pending" },
      { id: 6, display_id: "0-6", bio: null, person_count: 1, min_age: 60, max_age: null, claim_status: "fulfilled" },
    ];
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue({ ...mockResponse, families: revealed });

    wrap(<PublicFamilies />);

    await waitFor(() => {
      expect(screen.getByText("0-4")).toBeInTheDocument();
    });
    // Green Sponsored for active
    const sponsoredChip = screen.getByText("Sponsored");
    expect(sponsoredChip).toHaveClass("bg-emerald-100", "text-emerald-800");
    // Amber Awaiting payment for pending
    const pendingChip = screen.getByText("Awaiting payment");
    expect(pendingChip).toHaveClass("bg-amber-100", "text-amber-800");
    // Grey Fulfilled
    const fulfilledChip = screen.getByText("Fulfilled");
    expect(fulfilledChip).toHaveClass("bg-slate-200", "text-slate-600");
  });

  it("renders no chip for unclaimed families", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />);

    await waitFor(() => expect(screen.getByText("0-1")).toBeInTheDocument());
    expect(screen.queryByText("Sponsored")).not.toBeInTheDocument();
    expect(screen.queryByText("Awaiting payment")).not.toBeInTheDocument();
    expect(screen.queryByText("Fulfilled")).not.toBeInTheDocument();
  });

  /* Gift drop-off deadline banner */

  it("shows the gift_dropoff deadline banner when a row is configured", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);
    vi.spyOn(api, "listDeadlines").mockResolvedValue({
      deadlines: [
        {
          id: 1,
          type: "gift_dropoff",
          label: "Gift drop-off",
          due_date: "2099-12-15",
          mode: "display",
          created_at: "2025-01-01T00:00:00Z",
        },
      ],
    });

    wrap(<PublicFamilies />);

    // The banner text is split across spans (label, "due", date)
    await screen.findByText("Gift drop-off");
    expect(screen.getByText("Dec 15, 2099")).toBeInTheDocument();
    // The row is in the future → upcoming wording ("due", not "deadline was")
    expect(screen.getByText("due", { exact: true })).toBeInTheDocument();
  });

  it("hides the deadline banner when no deadline row is configured", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />);

    await waitFor(() => expect(screen.getByText("0-1")).toBeInTheDocument());
    expect(screen.queryByTestId("deadline-banner")).not.toBeInTheDocument();
  });

  /* "Sponsored by me" section (claim-capable users) */

  it("shows the Sponsored by me section with per-claim chips for claim-capable users", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);
    vi.spyOn(api, "donorListClaims").mockResolvedValue(mockDonorClaims);

    wrap(<PublicFamilies />, "/families", mockUser);

    expect(await screen.findByText("Sponsored by me")).toBeInTheDocument();
    // One card per claim
    expect(screen.getByText("3-1")).toBeInTheDocument();
    expect(screen.getByText("3-2")).toBeInTheDocument();
    expect(screen.getByText("3-3")).toBeInTheDocument();
    // Chips: active gifts → Sponsored, pending cash → Awaiting payment, fulfilled → Fulfilled
    expect(screen.getByText("Sponsored")).toBeInTheDocument();
    expect(screen.getByText("Awaiting payment")).toBeInTheDocument();
    expect(screen.getByText("Fulfilled")).toBeInTheDocument();
    // Pending-cash card gets the cart CTA
    expect(screen.getByRole("button", { name: /Go to cart/ })).toBeInTheDocument();
  });

  it("hides the Sponsored by me section when the user has no claims", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);
    vi.spyOn(api, "donorListClaims").mockResolvedValue([]);

    wrap(<PublicFamilies />, "/families", mockUser);

    await waitFor(() => expect(screen.getByText("0-1")).toBeInTheDocument());
    expect(screen.queryByText("Sponsored by me")).not.toBeInTheDocument();
  });

  it("does not query donor claims for anonymous visitors", async () => {
    const spy = vi.spyOn(api, "donorListClaims");
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />);

    await waitFor(() => expect(screen.getByText("0-1")).toBeInTheDocument());
    expect(spy).not.toHaveBeenCalled();
  });

  it("dedupes the user's claimed families out of the revealed grid", async () => {
    // The revealed grid contains family 20 (also in the user's claims)
    const revealed: PublicFamilySummary[] = [
      {
        id: 20,
        display_id: "3-1",
        bio: "The board-game family.",
        person_count: 4,
        min_age: 5,
        max_age: 12,
        claim_status: "active",
      },
      { id: 30, display_id: "4-1", bio: null, person_count: 2, min_age: 1, max_age: 6, claim_status: null },
    ];
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue({ ...mockResponse, families: revealed });
    vi.spyOn(api, "donorListClaims").mockResolvedValue(mockDonorClaims);

    localStorage.setItem("kim:listView:publicFamilies:filters", JSON.stringify({ showSponsored: true }));
    wrap(<PublicFamilies />, "/families", mockAdmin);

    await waitFor(() => expect(screen.getByText("Sponsored by me")).toBeInTheDocument());
    // Family 3-1 appears in the section but not twice (grid copy deduped out)
    expect(screen.getAllByText("3-1").length).toBe(1);
    // Other revealed families still render
    expect(screen.getByText("4-1")).toBeInTheDocument();
  });

  /* How-to-help note (gift + cash sponsorships + standard donate link) */

  it("notes the three ways to help and links to the standard donate page", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />);

    await waitFor(() => expect(screen.getByText("0-1")).toBeInTheDocument());

    const note = screen.getByRole("region", { name: "Three ways to help" });
    expect(within(note).getByText(/browse below and sponsor a family/)).toBeInTheDocument();
    expect(within(note).getByText(/\$500 that our volunteers use to buy the family's gifts/)).toBeInTheDocument();
    expect(within(note).getByText(/goes 100% to gifts/i)).toBeInTheDocument();

    // The donate link is the shared standard donate URL, opening in a new tab
    const donateLink = within(note).getByRole("link", { name: "Make a general donation" });
    expect(donateLink).toHaveAttribute("href", DONATE_URL);
    expect(donateLink).toHaveAttribute("target", "_blank");
    expect(donateLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  /* Fully-sponsored milestone banner */

  it("shows the milestone banner at 5+ fulfilled families", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue({ ...mockResponse, fulfilled_count: 7 });

    wrap(<PublicFamilies />);

    expect(await screen.findByText(/7 families fully sponsored so far/)).toBeInTheDocument();
  });

  it("hides the milestone banner below 5 fulfilled families", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue({ ...mockResponse, fulfilled_count: 4 });

    wrap(<PublicFamilies />);

    await waitFor(() => expect(screen.getByText("0-1")).toBeInTheDocument());
    expect(screen.queryByText(/families fully sponsored so far/)).not.toBeInTheDocument();
  });

  it("shows empty state when no families", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue({
      families: [],
      total: 0,
      page: 1,
      page_size: 12,
      total_pages: 0,
      fulfilled_count: 0,
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

  it("header shows sign in link when logged out", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    });
    // Centre title links back to the brochure from other public pages
    expect(screen.getByRole("link", { name: "Kindness is Magic" })).toHaveAttribute("href", "/home");
  });

  it("header links to the role home and shows sign out button when logged in", async () => {
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />, "/families", mockUser);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    });
    // The centre title links to the signed-in user's role home
    expect(screen.getByRole("link", { name: "Kindness is Magic" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("clicking sign out logs out and navigates to login", async () => {
    const event = userEvent.setup();
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);
    // Renders without wrap() — keep the banner's public deadlines query hermetic
    vi.spyOn(api, "listDeadlines").mockResolvedValue({ deadlines: [] });
    // The donor is claim-capable, so the page also queries their claims
    vi.spyOn(api, "donorListClaims").mockResolvedValue([]);
    const logoutSpy = vi.spyOn(api, "logoutRequest").mockResolvedValue(undefined);

    const queryClient = createQueryClient();
    queryClient.setQueryData(auth, mockUser);
    render(
      <MemoryRouter initialEntries={["/families"]}>
        <QueryClientProvider client={queryClient}>
          <ToastContainer>
            <AuthProvider>
              <Routes>
                <Route path="/families" element={<PublicFamilies />} />
                <Route path="/login" element={<div data-testid="login-page">Login page</div>} />
              </Routes>
            </AuthProvider>
          </ToastContainer>
        </QueryClientProvider>
      </MemoryRouter>
    );

    const signOutButton = await screen.findByRole("button", { name: "Sign out" });
    await event.click(signOutButton);

    await waitFor(() => {
      expect(screen.getByTestId("login-page")).toBeInTheDocument();
    });
    expect(logoutSpy).toHaveBeenCalledOnce();
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

  /* Persisted view state */

  it("hydrates page, sort, and member-count filters from storage", async () => {
    // total 30 at 12/page → the saved page 3 is valid (no clamp refetch mid-test)
    const spy = vi.spyOn(api, "listPublicFamilies").mockResolvedValue({ ...mockResponse, total: 30, total_pages: 3 });

    localStorage.setItem("kim:listView:publicFamilies:page", JSON.stringify({ page: 3, pageSize: 12 }));
    localStorage.setItem("kim:listView:publicFamilies:filters", JSON.stringify({ minPersonCount: "2", sort: "-min_age" }));

    wrap(<PublicFamilies />);

    // The hydrated view drives the list request
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ page: 3, min_person_count: 2, sort: "-min_age" }));
    });
    await screen.findByText("0-1");
    expect(screen.getByRole("button", { name: "Sort: Youngest ↓" })).toBeInTheDocument();
  });

  it("persists filter edits to storage and Clear filters resets the view", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

    wrap(<PublicFamilies />);
    await waitFor(() => expect(screen.getByText("0-1")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Min Family Members"), "3");
    expect(JSON.parse(localStorage.getItem("kim:listView:publicFamilies:filters")!)).toEqual(
      expect.objectContaining({ minPersonCount: "3" })
    );

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    const filters = JSON.parse(localStorage.getItem("kim:listView:publicFamilies:filters")!);
    expect(filters).toEqual({ minPersonCount: "", maxPersonCount: "", sort: null, showSponsored: false });
    expect(JSON.parse(localStorage.getItem("kim:listView:publicFamilies:page")!)).toEqual({ page: 1, pageSize: 12 });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument());
  });

  it("drops invalid stored numeric filters (a below-min/negative/NaN value would 422 the request)", async () => {
    const spy = vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);
    // "0" is below the endpoint's minimum (counts are >= 1 here, unlike the
    // admin pages) and must be dropped like any other 422-worthy value.
    localStorage.setItem("kim:listView:publicFamilies:filters", JSON.stringify({ minPersonCount: "0", maxPersonCount: "-1" }));

    wrap(<PublicFamilies />);

    // Wait for the list to load (the filter bar only renders once the
    // spinner is gone), then check the sanitized view.
    await waitFor(() => {
      expect(screen.getByLabelText("Min Family Members")).toBeInTheDocument();
    });
    const params = spy.mock.calls[0]?.[0];
    expect(params?.min_person_count).toBeUndefined();
    expect(params?.max_person_count).toBeUndefined();
    // type="number" inputs resolve to null when empty (jest-dom)
    expect(screen.getByLabelText("Min Family Members")).toHaveValue(null);
    expect(screen.getByLabelText("Max Family Members")).toHaveValue(null);
  });

  it("does not send a live-typed below-minimum member count (the endpoint requires >= 1)", async () => {
    const user = userEvent.setup();
    // Auto-advance time so the 300ms debounce fires quickly
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    try {
      const spy = vi.spyOn(api, "listPublicFamilies").mockResolvedValue(mockResponse);

      wrap(<PublicFamilies />);
      await waitFor(() => expect(screen.getByText("0-1")).toBeInTheDocument());

      const minInput = screen.getByLabelText("Min Family Members");
      // "0" is typeable into the number input (min only constrains the
      // stepper) — the old code would have sent min_person_count=0 and
      // 422'd the request.
      await user.type(minInput, "0");
      // …then a valid value so a debounced refetch actually fires (an
      // unchanged query key wouldn't re-invoke the API).
      await user.clear(minInput);
      await user.type(minInput, "2");

      await waitFor(() => {
        expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ min_person_count: 2 }));
      });
      // No call ever carried 0 or another below-minimum count
      for (const call of spy.mock.calls) {
        const minCount = call[0]?.min_person_count;
        if (minCount !== undefined) expect(minCount).toBeGreaterThanOrEqual(1);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
