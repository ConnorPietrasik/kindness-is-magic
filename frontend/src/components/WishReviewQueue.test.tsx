import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import type { FamilyDetail, FamilyReviewQueueItem } from "../types";
import { WishReviewQueue } from "./WishReviewQueue";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const mockItem: FamilyReviewQueueItem = {
  id: 7,
  display_id: "3-1",
  family_name: "The Johnsons",
  contact_name: "Alice Johnson",
  referrer_id: 2,
  referrer_name: "Referrer Ray",
  person_count: 3,
  wish_review_requested_at: "2025-12-01T10:00:00Z",
  wish_rejection_reason: null,
};

const mockDetail = {} as FamilyDetail;

const baseConfig = {
  queryKey: ["testReviewQueue"] as const,
  listFn: vi.fn(),
  approveFn: vi.fn(),
  rejectFn: vi.fn(),
  approveInvalidate: [["testReviewQueue"], ["testWishes"]] as (readonly string[])[],
  rejectInvalidate: [["testReviewQueue"]] as (readonly string[])[],
  approveMessage: "Approved OK",
  rejectMessage: "Rejected OK",
  title: "Test Queue",
  emptyMessage: "Nothing to review.",
  showReferrerColumn: true,
  viewRoute: (id: number) => `/admin/families/${id}/people`,
  rejectPlaceholder: "e.g. Wishes need more specificity...",
  rejectAudienceLabel: "Provide a reason the referrer can see:",
};

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderQueue(config: Partial<typeof baseConfig>) {
  const queryClient = createQueryClient();
  return render(
    <MemoryRouter initialEntries={["/queue"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <WishReviewQueue {...baseConfig} {...config} />
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("WishReviewQueue", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the empty state when the queue is empty", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    baseConfig.listFn.mockResolvedValue([]);
    baseConfig.approveFn.mockResolvedValue(mockDetail);
    baseConfig.rejectFn.mockResolvedValue(mockDetail);

    renderQueue({});

    await waitFor(() => {
      expect(screen.getByText("Nothing to review.")).toBeInTheDocument();
    });
  });

  it("renders one row per family with the configured columns", async () => {
    baseConfig.listFn.mockResolvedValue([mockItem]);
    baseConfig.approveFn.mockResolvedValue(mockDetail);
    baseConfig.rejectFn.mockResolvedValue(mockDetail);

    renderQueue({});

    await waitFor(() => {
      expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    });

    expect(screen.getByText("Alice Johnson")).toBeInTheDocument();
    expect(screen.getByText("Referrer Ray")).toBeInTheDocument();
    // Person-count badge (a span — the "3" in display_id "3-1" is a Link segment)
    expect(screen.getByText("3", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute("href", "/admin/families/7/people");
  });

  it("hides the referrer column when showReferrerColumn is false", async () => {
    baseConfig.listFn.mockResolvedValue([mockItem]);
    baseConfig.approveFn.mockResolvedValue(mockDetail);
    baseConfig.rejectFn.mockResolvedValue(mockDetail);

    renderQueue({ showReferrerColumn: false });

    await waitFor(() => {
      expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    });

    expect(screen.queryByText("Referrer Ray")).not.toBeInTheDocument();
    expect(screen.queryByText("Referrer")).not.toBeInTheDocument();
  });

  it("approves a family and shows the configured success toast", async () => {
    const user = userEvent.setup();
    baseConfig.listFn.mockResolvedValue([mockItem]);
    baseConfig.approveFn.mockResolvedValue(mockDetail);
    baseConfig.rejectFn.mockResolvedValue(mockDetail);

    renderQueue({});

    const approve = await screen.findByRole("button", { name: "Approve" });
    await user.click(approve);

    await waitFor(() => {
      expect(baseConfig.approveFn).toHaveBeenCalledWith(7);
    });
    expect(await screen.findByText("Approved OK")).toBeInTheDocument();
  });

  it("rejects via the reason modal and passes the reason to the API", async () => {
    const user = userEvent.setup();
    baseConfig.listFn.mockResolvedValue([mockItem]);
    baseConfig.approveFn.mockResolvedValue(mockDetail);
    baseConfig.rejectFn.mockResolvedValue(mockDetail);

    renderQueue({});

    const reject = await screen.findByRole("button", { name: "Reject" });
    await user.click(reject);

    // Modal prompt (family name is in a nested <strong>, so match the full text)
    const modal = await screen.findByText((_, el) => el?.tagName === "P" && el.textContent === "Reject wishes for The Johnsons?");
    expect(modal).toBeInTheDocument();
    expect(screen.getByText("Provide a reason the referrer can see:")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Rejection reason"), "Too vague");

    // Both the row action and the modal confirm are labeled "Reject" — the modal's is last in the DOM
    const rejectButtons = screen.getAllByRole("button", { name: "Reject" });
    const confirmReject = rejectButtons[rejectButtons.length - 1];
    if (!confirmReject) throw new Error("reject confirm not found");
    await user.click(confirmReject);

    await waitFor(() => {
      expect(baseConfig.rejectFn).toHaveBeenCalledWith(7, "Too vague");
    });
    expect(await screen.findByText("Rejected OK")).toBeInTheDocument();
  });

  it("disables reject confirm until a reason is typed", async () => {
    const user = userEvent.setup();
    baseConfig.listFn.mockResolvedValue([mockItem]);
    baseConfig.approveFn.mockResolvedValue(mockDetail);
    baseConfig.rejectFn.mockResolvedValue(mockDetail);

    renderQueue({});

    await user.click(await screen.findByRole("button", { name: "Reject" }));

    // The modal's confirm button (also "Reject") is last in the DOM
    const rejectButtons = await screen.findAllByRole("button", { name: "Reject" });
    const confirmReject = rejectButtons[rejectButtons.length - 1];
    if (!confirmReject) throw new Error("reject confirm not found");
    expect(confirmReject).toBeDisabled();
  });
});
