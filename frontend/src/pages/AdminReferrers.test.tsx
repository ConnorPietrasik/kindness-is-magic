import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { ReferrerDetail, ReferrerListResponse } from "../types";
import AdminReferrers from "./AdminReferrers";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeReferrer(overrides: Partial<ReferrerDetail>): ReferrerDetail {
  return {
    id: 0,
    name: "Some Referrer",
    family_limit: 1,
    phone_number: "",
    family_invite_code: "CODE1",
    family_count: 0,
    approval_status: "approved",
    approved_by_admin_name: null,
    approved_at: null,
    created_at: "2025-01-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

const mockReferrer1 = makeReferrer({
  id: 1,
  name: "Hope Referrer",
  family_limit: 5,
  family_count: 2,
  phone_number: "5551234567",
  family_invite_code: "HOPE1",
  approval_status: "pending",
});

const mockReferrer2 = makeReferrer({
  id: 2,
  name: "Approved Ref",
  family_limit: 3,
  family_count: 3,
  family_invite_code: "APPR1",
  approval_status: "approved",
  approved_by_admin_name: "Admin A",
  approved_at: "2025-01-05T00:00:00Z",
});

const mockDeletedReferrer = makeReferrer({
  id: 3,
  name: "Gone Ref",
  family_invite_code: "GONE1",
  deleted_at: "2025-02-01T00:00:00Z",
});

const mockListResponse: ReferrerListResponse = {
  referrers: [mockReferrer1, mockReferrer2],
  total: 2,
  page: 1,
  page_size: 20,
  total_pages: 1,
};

const mockDeletedResponse: ReferrerListResponse = { referrers: [mockDeletedReferrer], total: 1, page: 1, page_size: 20, total_pages: 1 };

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (ui: React.ReactElement) => {
  const queryClient = createQueryClient();
  return render(
    <MemoryRouter initialEntries={["/admin/referrers"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>{ui}</ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

function mockListApis() {
  vi.spyOn(api, "adminListReferrers").mockResolvedValue(mockListResponse);
  vi.spyOn(api, "adminListDeletedReferrers").mockResolvedValue(mockDeletedResponse);
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("AdminReferrers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
  });

  it("renders loading state initially", () => {
    vi.spyOn(api, "adminListReferrers").mockReturnValue(new Promise(() => {}));

    wrap(<AdminReferrers />);
    expect(document.querySelector("svg.animate-spin")).toBeInTheDocument();
  });

  it("renders referrer list with family counts", async () => {
    mockListApis();

    wrap(<AdminReferrers />);

    await waitFor(() => {
      expect(screen.getByText("Hope Referrer")).toBeInTheDocument();
    });

    expect(screen.getByText("Approved Ref")).toBeInTheDocument();
    // Family Limit column renders "count / limit"
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
  });

  it("shows empty state when no referrers", async () => {
    vi.spyOn(api, "adminListReferrers").mockResolvedValue({ referrers: [], total: 0, page: 1, page_size: 20, total_pages: 0 });

    wrap(<AdminReferrers />);

    await waitFor(() => {
      expect(screen.getByText("No referrers yet.")).toBeInTheDocument();
    });
  });

  it("shows approve/reject buttons only for pending referrers", async () => {
    mockListApis();

    wrap(<AdminReferrers />);

    await waitFor(() => {
      expect(screen.getByText("Hope Referrer")).toBeInTheDocument();
    });

    // The Approval column is hidden by default, so each pending referrer has
    // exactly one Approve and one Reject button (in the actions area).
    expect(screen.getAllByText("Approve")).toHaveLength(1);
    expect(screen.getAllByText("Reject")).toHaveLength(1);
  });

  it("approve flow confirms and calls API", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminApproveReferrer").mockResolvedValue(makeReferrer({ ...mockReferrer1, approval_status: "approved" }));

    wrap(<AdminReferrers />);

    await waitFor(() => {
      expect(screen.getByText("Hope Referrer")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.getByText(/Approve this referrer\?/)).toBeInTheDocument();
    });
    expect(api.adminApproveReferrer).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Yes, approve" }));

    await waitFor(() => {
      expect(api.adminApproveReferrer).toHaveBeenCalledWith(1, expect.anything());
    });
  });

  it("reject flow confirms and calls API", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminRejectReferrer").mockResolvedValue(makeReferrer({ ...mockReferrer1, approval_status: "rejected" }));

    wrap(<AdminReferrers />);

    await waitFor(() => {
      expect(screen.getByText("Hope Referrer")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(screen.getByText(/Reject this referrer\?/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Yes, reject" }));

    await waitFor(() => {
      expect(api.adminRejectReferrer).toHaveBeenCalledWith(1, expect.anything());
    });
  });

  it("delete flow confirms and calls API", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminDeleteReferrer").mockResolvedValue(undefined);

    wrap(<AdminReferrers />);

    await waitFor(() => {
      expect(screen.getByText("Hope Referrer")).toBeInTheDocument();
    });

    const triggers = screen.getAllByRole("button", { name: "More actions" });
    await user.click(triggers[0]!);
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByText(/Delete referrer/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => {
      expect(api.adminDeleteReferrer).toHaveBeenCalledWith(1, expect.anything());
    });
    await waitFor(() => {
      expect(screen.getByText("Referrer deleted")).toBeInTheDocument();
    });
  });

  it("deleted tab restores referrers", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminRestoreReferrer").mockResolvedValue(makeReferrer({ ...mockDeletedReferrer, deleted_at: null }));

    wrap(<AdminReferrers />);

    await waitFor(() => {
      expect(screen.getByText("Hope Referrer")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: "Deleted" }));

    await waitFor(() => {
      expect(api.adminListDeletedReferrers).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText("Gone Ref")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(screen.getByText(/Restore referrer/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Yes, restore" }));

    await waitFor(() => {
      expect(api.adminRestoreReferrer).toHaveBeenCalledWith(3, expect.anything());
    });
    await waitFor(() => {
      expect(screen.getByText("Referrer restored")).toBeInTheDocument();
    });
  });

  it("approval status filter refetches with the selected status", async () => {
    const user = userEvent.setup();
    mockListApis();

    wrap(<AdminReferrers />);

    await waitFor(() => {
      expect(screen.getByText("Hope Referrer")).toBeInTheDocument();
    });

    const filterSelect = screen.getByLabelText("Approval status filter");
    await user.selectOptions(filterSelect, "pending");

    await waitFor(() => {
      expect(api.adminListReferrers).toHaveBeenLastCalledWith(expect.objectContaining({ approval_status: "pending" }));
    });
  });

  it("debounces search before refetching", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    try {
      mockListApis();

      wrap(<AdminReferrers />);

      await waitFor(() => {
        expect(screen.getByText("Hope Referrer")).toBeInTheDocument();
      });

      await user.type(screen.getByPlaceholderText("Search by name…"), "hope");

      await waitFor(() => {
        expect(api.adminListReferrers).toHaveBeenLastCalledWith(expect.objectContaining({ search: "hope" }));
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("create referrer flow calls API with form values", async () => {
    const user = userEvent.setup();
    mockListApis();
    vi.spyOn(api, "adminCreateReferrer").mockImplementation((data: Parameters<typeof api.adminCreateReferrer>[0]) =>
      Promise.resolve(makeReferrer({ ...mockReferrer1, ...data, id: 9 }))
    );

    wrap(<AdminReferrers />);

    await waitFor(() => {
      expect(screen.getByText("Hope Referrer")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "+ Add Referrer" }));

    await waitFor(() => {
      expect(screen.getByText("Add Referrer")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Name"), "New Hope");
    await user.type(screen.getByPlaceholderText("555-123-4567"), "5559876543");

    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(api.adminCreateReferrer).toHaveBeenCalledWith(
        {
          name: "New Hope",
          phone_number: "5559876543",
          family_limit: 1,
        },
        expect.anything()
      );
    });
    await waitFor(() => {
      expect(screen.getByText("Referrer created")).toBeInTheDocument();
    });
  });
});
