import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";
import type { PackingSlipItem } from "../types";
import AdminPackingSlips from "./AdminPackingSlips";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const mockFamily: PackingSlipItem = {
  id: 1,
  display_id: "KFI-001",
  family_wish: "A magical holiday season",
  people: [
    {
      display_id: "1-1",
      given_name: "Alex",
      role: "son",
      age: 8,
      note: "Allergic to peanuts",
      wishes: [
        {
          id: 1,
          type: "practical",
          description: "Winter jacket",
          size: "8-10",
          assigned_to_id: null,
          purchased_at: null,
          purchased_where: null,
          received_at: null,
          purchaser_note: null,
          deleted_at: null,
        },
        {
          id: 2,
          type: "fun",
          description: "LEGO set",
          size: null,
          assigned_to_id: null,
          purchased_at: null,
          purchased_where: null,
          received_at: null,
          purchaser_note: null,
          deleted_at: null,
        },
      ],
    },
    {
      display_id: "1-2",
      given_name: "Sam",
      role: "mother",
      age: 42,
      note: null,
      wishes: [
        {
          id: 3,
          type: "adult",
          description: "Coffee gift card",
          size: null,
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

const wrap = (ui: React.ReactElement, path = "/admin/packing-slips") => {
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

describe("AdminPackingSlips", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders loading state initially", () => {
    vi.spyOn(api, "adminGetPackingSlips").mockReturnValue(new Promise(() => {})); // never resolves

    wrap(<AdminPackingSlips />);
    expect(document.querySelector("svg.animate-spin")).toBeInTheDocument();
  });

  it("renders family data in compact table", async () => {
    vi.spyOn(api, "adminGetPackingSlips").mockResolvedValue([mockFamily]);

    wrap(<AdminPackingSlips />);

    await waitFor(() => {
      expect(screen.getByText("KFI-001")).toBeInTheDocument();
    });

    // Family wish shown inline
    expect(screen.getByText("A magical holiday season")).toBeInTheDocument();

    // People rendered in table
    expect(screen.getByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();

    // Wishes inline with sizes
    expect(screen.getByText("Winter jacket (8-10)")).toBeInTheDocument();
    expect(screen.getByText("LEGO set")).toBeInTheDocument();
    expect(screen.getByText("Coffee gift card")).toBeInTheDocument();
  });

  it("does not render person notes", async () => {
    vi.spyOn(api, "adminGetPackingSlips").mockResolvedValue([mockFamily]);

    wrap(<AdminPackingSlips />);

    await waitFor(() => {
      expect(screen.getByText("KFI-001")).toBeInTheDocument();
    });

    // Note should NOT be visible
    expect(screen.queryByText("Allergic to peanuts")).not.toBeInTheDocument();
  });

  it("shows empty state when no families found", async () => {
    vi.spyOn(api, "adminGetPackingSlips").mockResolvedValue([]);

    wrap(<AdminPackingSlips />);

    await waitFor(() => {
      expect(screen.getByText("No packing slips found.")).toBeInTheDocument();
    });

    expect(screen.getByText("No families are fully approved yet.")).toBeInTheDocument();
  });

  it("shows filtered empty message when family_ids param is present", async () => {
    vi.spyOn(api, "adminGetPackingSlips").mockResolvedValue([]);

    wrap(<AdminPackingSlips />, "/admin/packing-slips?family_ids=5");

    await waitFor(() => {
      expect(screen.getByText("No packing slips found.")).toBeInTheDocument();
    });

    expect(screen.getByText("None of the selected families are ready for packing.")).toBeInTheDocument();
  });

  it("shows error state with API detail on failure", async () => {
    const error = new Error("Request failed with status code 500") as Error & { response?: { data?: { detail?: string } } };
    error.response = { data: { detail: "An internal database error occurred" } };
    vi.spyOn(api, "adminGetPackingSlips").mockRejectedValue(error);

    wrap(<AdminPackingSlips />);

    await waitFor(() => {
      expect(screen.getByText("An internal database error occurred")).toBeInTheDocument();
    });
  });

  it("shows the fallback message when the error has no detail", async () => {
    vi.spyOn(api, "adminGetPackingSlips").mockRejectedValue(new Error("Network Error"));

    wrap(<AdminPackingSlips />);

    await waitFor(() => {
      expect(screen.getByText("Network Error")).toBeInTheDocument();
    });
  });

  it("print button calls window.print()", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminGetPackingSlips").mockResolvedValue([mockFamily]);
    const mockPrint = vi.spyOn(window, "print").mockImplementation(() => {});

    wrap(<AdminPackingSlips />);

    await waitFor(() => {
      expect(screen.getByText("KFI-001")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "🖨️ Print" }));
    expect(mockPrint).toHaveBeenCalledTimes(1);
  });

  it("passes family_ids to API when URL has query params", async () => {
    const spy = vi.spyOn(api, "adminGetPackingSlips").mockResolvedValue([mockFamily]);

    wrap(<AdminPackingSlips />, "/admin/packing-slips?family_ids=3,7");

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith([3, 7]);
    });
  });

  it("calls API without family_ids when no query params", async () => {
    const spy = vi.spyOn(api, "adminGetPackingSlips").mockResolvedValue([mockFamily]);

    wrap(<AdminPackingSlips />);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(undefined);
    });
  });

  it("hides Fun column when no one has a fun wish", async () => {
    const familyNoFun: PackingSlipItem = {
      id: 5,
      display_id: "KFI-005",
      family_wish: "Keep it simple",
      people: [
        {
          display_id: "5-1",
          given_name: "Jordan",
          role: "father",
          age: 30,
          note: null,
          wishes: [
            {
              id: 10,
              type: "adult",
              description: "Socks",
              size: "L",
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

    vi.spyOn(api, "adminGetPackingSlips").mockResolvedValue([familyNoFun]);

    wrap(<AdminPackingSlips />);

    await waitFor(() => {
      expect(screen.getByText("KFI-005")).toBeInTheDocument();
    });

    // Fun column header should not be present
    expect(screen.queryByRole("columnheader", { name: "Fun" })).not.toBeInTheDocument();
  });

  it("handles person with no wishes", async () => {
    const familyWithEmptyWishes: PackingSlipItem = {
      id: 2,
      display_id: "KFI-002",
      family_wish: "Warm wishes",
      people: [
        {
          display_id: "2-1",
          given_name: "Jordan",
          role: "son",
          age: 5,
          note: null,
          wishes: [],
        },
      ],
    };

    vi.spyOn(api, "adminGetPackingSlips").mockResolvedValue([familyWithEmptyWishes]);

    wrap(<AdminPackingSlips />);

    await waitFor(() => {
      expect(screen.getByText("KFI-002")).toBeInTheDocument();
    });

    expect(screen.getByText("Jordan")).toBeInTheDocument();
    // Dash placeholder for empty wishes
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("handles family with no people", async () => {
    const familyWithNoPeople: PackingSlipItem = {
      id: 3,
      display_id: "KFI-003",
      family_wish: "Something nice",
      people: [],
    };

    vi.spyOn(api, "adminGetPackingSlips").mockResolvedValue([familyWithNoPeople]);

    wrap(<AdminPackingSlips />);

    await waitFor(() => {
      expect(screen.getByText("KFI-003")).toBeInTheDocument();
    });

    expect(screen.getByText("No family members.")).toBeInTheDocument();
  });
});
