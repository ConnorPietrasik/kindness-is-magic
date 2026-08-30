import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import * as api from "../lib/api";
import type { DeliveryFamilySummary } from "../types";
import DeliveryDashboard from "./DeliveryDashboard";

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

const mockFamily: DeliveryFamilySummary = {
  id: 5,
  display_id: "2-1",
  family_name: "The Johnsons",
  address: "123 Main St",
  phone_number: "555-0100",
  contact_name: "Alice Johnson",
  person_count: 3,
};

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (ui: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={["/delivery/dashboard"]}>
      <QueryClientProvider client={createQueryClient()}>
        <AuthProvider>{ui}</AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("DeliveryDashboard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("welcomes the delivery user and lists assigned families", async () => {
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(mockDeliveryUser);
    vi.spyOn(api, "deliveryListFamilies").mockResolvedValue([mockFamily]);

    wrap(<DeliveryDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Welcome, Dan Delivery!")).toBeInTheDocument();
    });

    // The count is in a nested <strong> — match the full paragraph text
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "You are assigned to 1 family.")).toBeInTheDocument();
    expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    expect(screen.getByText("Alice Johnson")).toBeInTheDocument();
    expect(screen.getByText("3 people")).toBeInTheDocument();
  });

  it("shows the empty state when no families are assigned", async () => {
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue(mockDeliveryUser);
    vi.spyOn(api, "deliveryListFamilies").mockResolvedValue([]);

    wrap(<DeliveryDashboard />);

    expect(await screen.findByText("No families assigned yet. Contact an admin to get started.")).toBeInTheDocument();
  });
});
