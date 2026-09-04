import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  notes: null,
  created_at: "2025-11-01T00:00:00Z",
  fulfilled_at: null,
};

const mockFulfilledClaim: FamilyClaimSummary = {
  id: 2,
  family: { ...familyBase, id: 6, display_id: "2-2" },
  commitment_type: "cash",
  notes: null,
  created_at: "2025-10-01T00:00:00Z",
  fulfilled_at: "2025-11-15T00:00:00Z",
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
