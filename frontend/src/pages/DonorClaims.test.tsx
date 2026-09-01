import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
});
