import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";
import type { FamilyClaimSummary } from "../types";
import DonorClaims from "./DonorClaims";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const familyBase = {
  id: 5,
  display_id: "2-1",
  bio: "A family that loves board games",
  person_count: 3,
  min_age: 5,
  max_age: 12,
};

const mockActiveClaim: FamilyClaimSummary = {
  id: 1,
  family: familyBase,
  commitment_type: "gifts",
  payment_status: "paid",
  notes: null,
  created_at: "2025-11-01T00:00:00Z",
  fulfilled_at: null,
  paid_at: null,
  payment_expires_at: null,
  zeffy_payment_id: null,
  includes_groceries: false,
};

const mockFulfilledClaim: FamilyClaimSummary = {
  id: 2,
  family: { ...familyBase, id: 6, display_id: "2-2" },
  commitment_type: "cash",
  payment_status: "paid",
  notes: null,
  created_at: "2025-10-01T00:00:00Z",
  fulfilled_at: "2025-11-15T00:00:00Z",
  paid_at: "2025-11-10T00:00:00Z",
  payment_expires_at: null,
  zeffy_payment_id: null,
  includes_groceries: true,
};

const mockPendingCashClaim: FamilyClaimSummary = {
  id: 3,
  family: { ...familyBase, id: 7, display_id: "2-3" },
  commitment_type: "cash",
  payment_status: "pending",
  notes: null,
  created_at: "2025-12-01T00:00:00Z",
  fulfilled_at: null,
  paid_at: null,
  // Deliberately in the future relative to the test run
  payment_expires_at: "2099-12-04T00:00:00Z",
  zeffy_payment_id: null,
  includes_groceries: true,
};

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (ui: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={["/donor/claims"]}>
      <QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>
    </MemoryRouter>
  );

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("DonorClaims", () => {
  beforeEach(() => {
    vi.spyOn(api, "listDeadlines").mockResolvedValue({ deadlines: [] });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("renders claims with status and commitment badges", async () => {
    vi.spyOn(api, "donorListClaims").mockResolvedValue([mockActiveClaim, mockFulfilledClaim]);

    wrap(<DonorClaims />);

    await waitFor(() => {
      expect(screen.getByText("2-1")).toBeInTheDocument();
    });

    expect(screen.getByText("2-2")).toBeInTheDocument();
    // Both badges render
    expect(screen.getAllByText("active").length).toBe(1);
    expect(screen.getAllByText("fulfilled").length).toBe(1);
    expect(screen.getAllByText("gifts").length).toBe(1);
    expect(screen.getAllByText("cash").length).toBe(1);
  });

  it("shows the awaiting-payment state, expiry, cart CTA and reassurance note for pending cash", async () => {
    vi.spyOn(api, "donorListClaims").mockResolvedValue([mockPendingCashClaim]);

    wrap(<DonorClaims />);

    await waitFor(() => {
      expect(screen.getByText("2-3")).toBeInTheDocument();
    });

    expect(screen.getByText("Awaiting payment")).toBeInTheDocument();
    expect(screen.getByText(/Pay by/)).toBeInTheDocument();
    // The cart CTA links to the donor cart
    expect(screen.getByRole("link", { name: "Go to checkout" })).toHaveAttribute("href", "/donor/cart");
    // Settled reassurance copy while a cash claim is unpaid
    expect(screen.getByText("If your payment doesn't match automatically, an admin will review it within a day.")).toBeInTheDocument();
  });

  it("shows the paid date and groceries on a paid cash claim (no awaiting-payment state)", async () => {
    vi.spyOn(api, "donorListClaims").mockResolvedValue([mockFulfilledClaim]);

    wrap(<DonorClaims />);

    await waitFor(() => {
      expect(screen.getByText("2-2")).toBeInTheDocument();
    });

    expect(screen.getByText(/Paid/)).toBeInTheDocument();
    expect(screen.getByText(/incl\. groceries/)).toBeInTheDocument();
    expect(screen.queryByText("Awaiting payment")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Go to checkout" })).not.toBeInTheDocument();
  });

  it("hides the reassurance note when no claim awaits payment", async () => {
    vi.spyOn(api, "donorListClaims").mockResolvedValue([mockActiveClaim]);

    wrap(<DonorClaims />);

    await waitFor(() => {
      expect(screen.getByText("2-1")).toBeInTheDocument();
    });

    expect(screen.queryByText("If your payment doesn't match automatically")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no claims", async () => {
    vi.spyOn(api, "donorListClaims").mockResolvedValue([]);

    wrap(<DonorClaims />);

    expect(await screen.findByText("You haven't sponsored any families yet.")).toBeInTheDocument();
  });

  it("passes the fulfilled filter to the API when a status is selected", async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(api, "donorListClaims").mockResolvedValue([mockFulfilledClaim]);

    wrap(<DonorClaims />);

    await waitFor(() => {
      expect(screen.getByText("2-2")).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Sponsorship status filter"), "fulfilled");

    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith({ fulfilled: true });
    });

    await user.selectOptions(screen.getByLabelText("Sponsorship status filter"), "active");

    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith({ fulfilled: false });
    });
  });

  it("shows the error state when the query fails", async () => {
    vi.spyOn(api, "donorListClaims").mockRejectedValue(new Error("boom"));

    wrap(<DonorClaims />);

    expect(await screen.findByText("Unable to Load Sponsorships")).toBeInTheDocument();
  });

  describe("column order", () => {
    const headerOrder = () => screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());

    it("renders columns in the user's custom order from localStorage", async () => {
      localStorage.setItem("kim:columnOrder:donorClaims", JSON.stringify(["created", "family", "status", "commitment"]));
      vi.spyOn(api, "donorListClaims").mockResolvedValue([mockActiveClaim]);

      wrap(<DonorClaims />);
      await screen.findByText("2-1");

      expect(headerOrder()).toEqual(["Created", "Family", "Status", "Commitment", "Actions"]);
    });

    it("drag reorders columns, persists to localStorage, and reset restores the default", async () => {
      const user = userEvent.setup();
      vi.spyOn(api, "donorListClaims").mockResolvedValue([mockActiveClaim]);

      wrap(<DonorClaims />);
      await screen.findByText("2-1");
      expect(headerOrder()).toEqual(["Family", "Status", "Commitment", "Created", "Actions"]);

      const created = screen.getByRole("columnheader", { name: "Created" });
      const family = screen.getByRole("columnheader", { name: "Family" });
      family.getBoundingClientRect = () =>
        ({ left: 0, width: 200, top: 0, bottom: 0, right: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

      // jsdom drag events carry no clientX; the component treats that as
      // the left edge, so the column drops before the target.
      fireEvent.dragStart(created, { dataTransfer: {} });
      fireEvent.dragOver(family, { dataTransfer: {} });
      fireEvent.drop(family, { dataTransfer: {} });

      expect(headerOrder()).toEqual(["Created", "Family", "Status", "Commitment", "Actions"]);
      expect(JSON.parse(localStorage.getItem("kim:columnOrder:donorClaims")!)).toEqual(["created", "family", "status", "commitment"]);

      // Reset-order button appears once the order is customized
      expect(screen.getByRole("button", { name: "Reset order" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Reset order" }));

      expect(headerOrder()).toEqual(["Family", "Status", "Commitment", "Created", "Actions"]);
      expect(JSON.parse(localStorage.getItem("kim:columnOrder:donorClaims")!)).toEqual(["family", "status", "commitment", "created"]);
    });
  });
});
