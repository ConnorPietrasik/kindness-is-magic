import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import * as api from "../lib/api";
import type { PackingSlipItem } from "../types";
import DeliveryPackingSlips from "./DeliveryPackingSlips";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const mockDeliveryUser = {
  id: 9,
  email: "dan@example.com",
  role: "delivery" as const,
  display_name: "Dan Delivery",
  referrer_id: null,
  family_id: null,
  created_at: "2025-01-01T00:00:00Z",
};

const mockFamily: PackingSlipItem = {
  id: 5,
  display_id: "2-1",
  family_wish: "A weekend trip",
  people: [
    {
      display_id: "2-1-1",
      given_name: "Alice",
      role: "daughter",
      note: null,
      age: 10,
      wishes: [
        {
          id: 1,
          type: "practical",
          description: "Coat",
          size: "S",
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

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (ui: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={["/delivery/packing-slips"]}>
      <QueryClientProvider client={createQueryClient()}>
        <AuthProvider>{ui}</AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("DeliveryPackingSlips", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a slip per assigned family with the print button", async () => {
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(mockDeliveryUser);
    vi.spyOn(api, "deliveryGetPackingSlips").mockResolvedValue([mockFamily]);

    wrap(<DeliveryPackingSlips />);

    await waitFor(() => {
      expect(screen.getByText("2-1")).toBeInTheDocument();
    });

    expect(screen.getByText("A weekend trip")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Coat (S)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Print/ })).toBeInTheDocument();
  });

  it("shows the delivery-specific empty state", async () => {
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(mockDeliveryUser);
    vi.spyOn(api, "deliveryGetPackingSlips").mockResolvedValue([]);

    wrap(<DeliveryPackingSlips />);

    expect(await screen.findByText("No packing slips found.")).toBeInTheDocument();
    expect(screen.getByText("No families are assigned to you yet.")).toBeInTheDocument();
  });
});
