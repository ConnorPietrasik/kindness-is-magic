import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";
import type { DeliverySlipItem } from "../types";
import AdminDeliverySlips from "./AdminDeliverySlips";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const mockSlip: DeliverySlipItem = {
  id: 1,
  display_id: "3",
  family_name: "The Johnsons",
  address: "123 Main St",
  contact_name: "Alice Johnson",
  phone_number: "555-0100",
};

const mockDeliveryUser = { id: 7, display_name: "Dan Delivery" };

/** Renders the current search string so tests can assert on URL updates. */
function UrlProbe() {
  const location = useLocation();
  return <div data-testid="url-probe">{location.search}</div>;
}

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (ui: React.ReactElement, path = "/admin/delivery-slips") => {
  const queryClient = createQueryClient();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        {ui}
        <UrlProbe />
      </QueryClientProvider>
    </MemoryRouter>
  );
};

const urlProbe = () => screen.getByTestId("url-probe").textContent ?? "";

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("AdminDeliverySlips", () => {
  beforeEach(() => {
    vi.spyOn(api, "adminGetUsersDropdown").mockResolvedValue([mockDeliveryUser]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders loading state initially", () => {
    vi.spyOn(api, "adminGetDeliverySlips").mockReturnValue(new Promise(() => {})); // never resolves

    wrap(<AdminDeliverySlips />);
    expect(document.querySelector("svg.animate-spin")).toBeInTheDocument();
  });

  it("renders family data on the slip card", async () => {
    vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([mockSlip]);

    wrap(<AdminDeliverySlips />);

    await waitFor(() => {
      expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    });

    expect(screen.getByText("123 Main St")).toBeInTheDocument();
    expect(screen.getByText("Alice Johnson")).toBeInTheDocument();
    expect(screen.getByText("555-0100")).toBeInTheDocument();
  });

  it("shows the default empty message with no query params", async () => {
    vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([]);

    wrap(<AdminDeliverySlips />);

    expect(await screen.findByText("No delivery slips found.")).toBeInTheDocument();
    expect(screen.getByText("No verified families yet.")).toBeInTheDocument();
  });

  it("adapts the empty message to the assigned scope", async () => {
    vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([]);

    wrap(<AdminDeliverySlips />, "/admin/delivery-slips?scope=assigned");

    expect(await screen.findByText("No delivery slips found.")).toBeInTheDocument();
    expect(screen.getByText("No verified families have a delivery person yet.")).toBeInTheDocument();
  });

  it("adapts the empty message to the unassigned scope", async () => {
    vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([]);

    wrap(<AdminDeliverySlips />, "/admin/delivery-slips?scope=unassigned");

    expect(await screen.findByText("No delivery slips found.")).toBeInTheDocument();
    expect(screen.getByText("No verified families without a delivery person yet.")).toBeInTheDocument();
  });

  it("adapts the empty message to a specific delivery person", async () => {
    vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([]);

    wrap(<AdminDeliverySlips />, "/admin/delivery-slips?scope=assigned&delivery_user_id=7");

    expect(await screen.findByText("No delivery slips found.")).toBeInTheDocument();
    expect(screen.getByText("No verified families are assigned to this delivery person yet.")).toBeInTheDocument();
  });

  it("prompts for a person without fetching when specific scope is set but no person is picked", async () => {
    const spy = vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([mockSlip]);

    wrap(<AdminDeliverySlips />, "/admin/delivery-slips?scope=assigned&delivery_user_id=");

    expect(await screen.findByText("No delivery slips found.")).toBeInTheDocument();
    expect(screen.getByText("Choose a delivery person to see their slips.")).toBeInTheDocument();
    // The unfiltered assigned list must not be shown as a fallback
    expect(spy).not.toHaveBeenCalled();
  });

  it("adapts the empty message when family_ids is present", async () => {
    vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([]);

    wrap(<AdminDeliverySlips />, "/admin/delivery-slips?family_ids=3");

    expect(await screen.findByText("No delivery slips found.")).toBeInTheDocument();
    expect(screen.getByText("None of the selected families are verified yet.")).toBeInTheDocument();
  });

  it("shows error state with API detail on failure", async () => {
    const error = new Error("Request failed with status code 400") as Error & { response?: { data?: { detail?: string } } };
    error.response = { data: { detail: "Invalid scope parameter" } };
    vi.spyOn(api, "adminGetDeliverySlips").mockRejectedValue(error);

    wrap(<AdminDeliverySlips />);

    await waitFor(() => {
      expect(screen.getByText("Invalid scope parameter")).toBeInTheDocument();
    });
  });

  it("print button calls window.print()", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([mockSlip]);
    const mockPrint = vi.spyOn(window, "print").mockImplementation(() => {});

    wrap(<AdminDeliverySlips />);

    await waitFor(() => {
      expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "🖨️ Print" }));
    expect(mockPrint).toHaveBeenCalledTimes(1);
  });

  it("passes family_ids to the API when URL has query params (no scope)", async () => {
    const spy = vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([mockSlip]);

    wrap(<AdminDeliverySlips />, "/admin/delivery-slips?family_ids=3,7");

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ familyIds: [3, 7] });
    });
  });

  it("calls the API with the default scope when no query params", async () => {
    const spy = vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([mockSlip]);

    wrap(<AdminDeliverySlips />);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ scope: "all" });
    });
  });

  it("falls back to the all scope for an invalid scope param", async () => {
    const spy = vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([mockSlip]);

    wrap(<AdminDeliverySlips />, "/admin/delivery-slips?scope=bogus");

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ scope: "all" });
    });
  });

  it("offers everyone / assigned (to anyone) / assigned (to specific person) / unassigned", async () => {
    vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([mockSlip]);

    wrap(<AdminDeliverySlips />);

    await screen.findByText("The Johnsons"); // loading done, scope bar rendered

    const scopeSelect = screen.getByRole("combobox", { name: "Scope" });
    expect(scopeSelect).toHaveTextContent("Everyone");
    expect(scopeSelect).toHaveTextContent("Assigned (to anyone)");
    expect(scopeSelect).toHaveTextContent("Assigned (to specific person)");
    expect(scopeSelect).toHaveTextContent("Unassigned");
  });

  it("selecting a scope updates the URL and calls the API with it", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([mockSlip]);

    wrap(<AdminDeliverySlips />);

    await screen.findByText("The Johnsons"); // loading done, scope bar rendered
    expect(spy).toHaveBeenCalledTimes(1);

    await user.selectOptions(screen.getByRole("combobox", { name: "Scope" }), "unassigned");

    expect(urlProbe()).toBe("?scope=unassigned");
    await waitFor(() => {
      expect(spy).toHaveBeenLastCalledWith({ scope: "unassigned" });
    });
  });

  it("selecting 'specific person' reveals the person select, withholds the list, then filters by delivery_user_id", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([mockSlip]);

    wrap(<AdminDeliverySlips />);

    await screen.findByText("The Johnsons"); // loading done, scope bar rendered
    expect(spy).toHaveBeenCalledTimes(1);

    // Person select is hidden until "specific" is chosen
    expect(screen.queryByRole("combobox", { name: "Delivery person" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Scope" }), "specific");
    // Empty delivery_user_id marks "specific" mode until a person is picked
    expect(urlProbe()).toBe("?scope=assigned&delivery_user_id=");
    // List is withheld — no fetch of the unfiltered assigned population
    expect(screen.queryByText("The Johnsons")).not.toBeInTheDocument();
    expect(screen.getByText("Choose a delivery person to see their slips.")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);

    const personSelect = await screen.findByRole("combobox", { name: "Delivery person" });
    expect(personSelect).toHaveTextContent("Dan Delivery");

    await user.selectOptions(personSelect, "7");
    expect(urlProbe()).toBe("?scope=assigned&delivery_user_id=7");
    await waitFor(() => {
      expect(spy).toHaveBeenLastCalledWith({ scope: "assigned", deliveryUserId: 7 });
    });
  });

  it("picking a new scope clears the delivery_user_id param", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([mockSlip]);

    wrap(<AdminDeliverySlips />, "/admin/delivery-slips?scope=assigned&delivery_user_id=7");

    await screen.findByText("The Johnsons"); // loading done, scope bar rendered
    expect(spy).toHaveBeenCalledWith({ scope: "assigned", deliveryUserId: 7 });

    // The scope select reflects "specific" while a person is selected
    expect(screen.getByRole("combobox", { name: "Scope" })).toHaveValue("specific");

    await user.selectOptions(screen.getByRole("combobox", { name: "Scope" }), "unassigned");
    expect(urlProbe()).toBe("?scope=unassigned");
    await waitFor(() => {
      expect(spy).toHaveBeenLastCalledWith({ scope: "unassigned" });
    });
  });

  it("clearing the person select drops delivery_user_id and falls back to assigned", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([mockSlip]);

    wrap(<AdminDeliverySlips />, "/admin/delivery-slips?scope=assigned&delivery_user_id=7");

    const personSelect = await screen.findByRole("combobox", { name: "Delivery person" });
    expect(personSelect).toHaveValue("7");

    await user.selectOptions(personSelect, "");
    expect(urlProbe()).toBe("?scope=assigned");
    await waitFor(() => {
      expect(spy).toHaveBeenLastCalledWith({ scope: "assigned" });
    });
  });

  it("changing scope while family_ids is present clears family_ids and applies the scope", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, "adminGetDeliverySlips").mockResolvedValue([mockSlip]);

    wrap(<AdminDeliverySlips />, "/admin/delivery-slips?family_ids=3,7");

    await screen.findByText("The Johnsons"); // loading done, scope bar rendered
    expect(spy).toHaveBeenCalledWith({ familyIds: [3, 7] });

    // Row-action view: scope select shows its default
    expect(screen.getByRole("combobox", { name: "Scope" })).toHaveValue("all");

    await user.selectOptions(screen.getByRole("combobox", { name: "Scope" }), "assigned");
    expect(urlProbe()).toBe("?scope=assigned");
    await waitFor(() => {
      expect(spy).toHaveBeenLastCalledWith({ scope: "assigned" });
    });
  });
});
