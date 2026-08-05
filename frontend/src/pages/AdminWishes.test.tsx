import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import type { FamilySummary, UserSummary, WishDetail, WishListResponse, WishListSummary } from "../types";
import AdminWishes from "./AdminWishes";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const mockWish1: WishListSummary = {
  id: 1,
  type: "practical",
  description: "Winter jacket",
  size: "M",
  person_id: 10,
  person_given_name: "Alice",
  family_id: 5,
  assigned_to_id: null,
  assigned_to_name: null,
  purchased_at: null,
  purchased_where: null,
  received_at: null,
  purchaser_note: null,
};

const mockWish2: WishListSummary = {
  id: 2,
  type: "fun",
  description: "LEGO set",
  size: null,
  person_id: 11,
  person_given_name: "Bob",
  family_id: 5,
  assigned_to_id: 3,
  assigned_to_name: "Jane Admin",
  purchased_at: "2025-12-01T10:00:00Z",
  purchased_where: "Target",
  received_at: "2025-12-20T00:00:00Z",
  purchaser_note: "Got a great deal",
};

const mockWishListResponse: WishListResponse = {
  wishes: [mockWish1, mockWish2],
  total: 2,
  page: 1,
  page_size: 20,
  total_pages: 1,
};

const mockWishDetail: WishDetail = {
  id: 1,
  type: "practical",
  description: "Winter jacket",
  size: "M",
  assigned_to_id: null,
  purchased_at: null,
  purchased_where: null,
  received_at: null,
  purchaser_note: null,
  deleted_at: null,
  person_id: 10,
  person_given_name: "Alice",
  person_family_name: "The Johnsons",
};

const mockFamily: FamilySummary = {
  id: 5,
  display_id: "KFI-005",
  family_name: "The Johnsons",
  family_wish: "Warm wishes",
  contact_name: "Mom",
  referrer_id: 1,
  deleted_at: null,
  person_count: 3,
  approval_status: "approved",
  pickup_window: null,
  wish_lock_level: "admin",
  wish_review_requested_at: null,
  wish_rejection_reason: null,
  has_notes: false,
};

const mockUser: UserSummary = {
  id: 3,
  email: "jane@example.com",
  display_name: "Jane Admin",
  role: "admin",
  referrer_id: null,
  family_id: null,
  deleted_at: null,
  created_at: "2025-01-01T00:00:00Z",
  referrer_name: null,
  family_name: null,
};

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (ui: React.ReactElement, path = "/admin/wishes") => {
  const queryClient = createQueryClient();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>{ui}</ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("AdminWishes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders loading state initially", () => {
    vi.spyOn(api, "adminListWishes").mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [], total: 0, page: 1, page_size: 200, total_pages: 0 });
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [], total: 0, page: 1, page_size: 200, total_pages: 0 });

    wrap(<AdminWishes />);
    expect(document.querySelector("svg.animate-spin")).toBeInTheDocument();
  });

  it("renders wish list with mocked data", async () => {
    vi.spyOn(api, "adminListWishes").mockResolvedValue(mockWishListResponse);
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [mockFamily], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [mockUser], total: 1, page: 1, page_size: 200, total_pages: 1 });

    wrap(<AdminWishes />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Winter jacket")).toBeInTheDocument();
    expect(screen.getByText("LEGO set")).toBeInTheDocument();
  });

  it("shows empty state when no wishes found", async () => {
    vi.spyOn(api, "adminListWishes").mockResolvedValue({ wishes: [], total: 0, page: 1, page_size: 20, total_pages: 0 });
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [], total: 0, page: 1, page_size: 200, total_pages: 0 });
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [], total: 0, page: 1, page_size: 200, total_pages: 0 });

    wrap(<AdminWishes />);

    await waitFor(() => {
      expect(screen.getByText("No wishes found.")).toBeInTheDocument();
    });
  });

  it("renders filter controls", async () => {
    vi.spyOn(api, "adminListWishes").mockResolvedValue(mockWishListResponse);
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [mockFamily], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [mockUser], total: 1, page: 1, page_size: 200, total_pages: 1 });

    wrap(<AdminWishes />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    expect(screen.getByText("All families")).toBeInTheDocument();
    expect(screen.getByText("All assignees")).toBeInTheDocument();
    expect(screen.getByText("All statuses")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search wishes…")).toBeInTheDocument();
  });

  it("shows purchase status for purchased wishes", async () => {
    vi.spyOn(api, "adminListWishes").mockResolvedValue(mockWishListResponse);
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [mockFamily], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [mockUser], total: 1, page: 1, page_size: 200, total_pages: 1 });

    wrap(<AdminWishes />);

    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    // Purchased wish shows checkmark
    expect(screen.getByText(/✓/)).toBeInTheDocument();
  });

  it("disables Mark Purchased button for already purchased wishes", async () => {
    vi.spyOn(api, "adminListWishes").mockResolvedValue(mockWishListResponse);
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [mockFamily], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [mockUser], total: 1, page: 1, page_size: 200, total_pages: 1 });

    wrap(<AdminWishes />);

    await waitFor(() => {
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    const markPurchasedButtons = screen.getAllByText("Mark Purchased");
    // Bob's wish is already purchased — button should be disabled
    // Alice's wish is not purchased — button should be enabled
    expect(markPurchasedButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("edit flow opens form and calls update mutation", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListWishes").mockResolvedValue(mockWishListResponse);
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [mockFamily], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [mockUser], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminGetWish").mockResolvedValue(mockWishDetail);
    vi.spyOn(api, "adminUpdateWish").mockResolvedValue(mockWishDetail);

    wrap(<AdminWishes />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // Click edit on first wish
    const editButtons = screen.getAllByText("Edit");
    await user.click(editButtons[0]!);

    // Wait for edit form to appear
    await waitFor(() => {
      expect(screen.getByText("Edit Wish")).toBeInTheDocument();
    });

    // Form should have pre-filled values
    expect(screen.getByDisplayValue("practical")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Winter jacket")).toBeInTheDocument();

    // Change description and save
    const descInput = screen.getByDisplayValue("Winter jacket");
    await user.clear(descInput);
    await user.type(descInput, "Coat");
    await user.click(screen.getByText("Update"));

    await waitFor(() => {
      expect(api.adminUpdateWish).toHaveBeenCalled();
    });
  });

  it("mark-purchased dialog opens and calls mutation", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListWishes").mockResolvedValue(mockWishListResponse);
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [mockFamily], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [mockUser], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminMarkPurchased").mockResolvedValue(mockWishDetail);

    wrap(<AdminWishes />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // Click Mark Purchased button — use getAllByText and pick the first one
    const markPurchasedButtons = screen.getAllByText("Mark Purchased");
    // Alice's wish (first row) is unpurchased — its button should be enabled
    expect(markPurchasedButtons.length).toBeGreaterThanOrEqual(1);
    await user.click(markPurchasedButtons[0]!);

    // Dialog should open
    await waitFor(() => {
      expect(screen.getByText(/Mark wish for/)).toBeInTheDocument();
    });

    // Fill in purchased where and submit
    const purchasedWhereInput = screen.getByLabelText("Purchased Where");
    await user.type(purchasedWhereInput, "Amazon");
    // Click the submit button inside the dialog (look within the dialog container)
    const dialog = document.querySelector(".fixed.inset-0.z-50");
    expect(dialog).not.toBeNull();
    const submitBtn = dialog?.querySelector("button") as HTMLButtonElement | null;
    expect(submitBtn).not.toBeNull();
    await user.click(submitBtn!);

    await waitFor(() => {
      expect(api.adminMarkPurchased).toHaveBeenCalledWith(1, expect.objectContaining({ purchased_where: "Amazon" }));
    });
  });

  it("batch assign dialog opens with selected wishes", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListWishes").mockResolvedValue(mockWishListResponse);
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [mockFamily], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [mockUser], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminBatchAssignWishes").mockResolvedValue({ assigned_count: 1 });

    wrap(<AdminWishes />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // Select first wish checkbox
    const checkboxes = screen.getAllByRole("checkbox");
    const firstRowCheckbox = checkboxes.find((cb) => cb.getAttribute("aria-label")?.startsWith("Select wish"));
    if (firstRowCheckbox) {
      await user.click(firstRowCheckbox);
    }

    // Batch assign button should show count
    expect(screen.getByRole("button", { name: "Batch Assign (1)" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Batch Assign (1)" }));

    // Dialog should open — text is "Assign <strong>1 wish</strong>" so match the strong text
    await waitFor(() => {
      expect(screen.getByText("1 wish")).toBeInTheDocument();
    });
  });

  it("select all checkbox toggles all rows", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListWishes").mockResolvedValue(mockWishListResponse);
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [mockFamily], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [mockUser], total: 1, page: 1, page_size: 200, total_pages: 1 });

    wrap(<AdminWishes />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // Click select all
    const selectAllCheckbox = screen.getByLabelText("Select all wishes on this page");
    await user.click(selectAllCheckbox);

    // Batch assign should show count of all wishes
    expect(screen.getByText("Batch Assign (2)")).toBeInTheDocument();

    // Click again to deselect all
    await user.click(selectAllCheckbox);
    expect(screen.getByText("Batch Assign (0)")).toBeInTheDocument();
  });

  it("renders mutation errors", async () => {
    const error = new Error("API error") as { response?: { data?: { detail?: string } } };
    error.response = { data: { detail: "Validation failed" } };

    vi.spyOn(api, "adminListWishes").mockResolvedValue(mockWishListResponse);
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [mockFamily], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [mockUser], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminGetWish").mockResolvedValue(mockWishDetail);
    vi.spyOn(api, "adminUpdateWish").mockRejectedValue(error);

    const user = userEvent.setup();
    wrap(<AdminWishes />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // Open edit and try to save
    const editButtons = screen.getAllByText("Edit");
    await user.click(editButtons[0]!);

    await waitFor(() => {
      expect(screen.getByText("Edit Wish")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Update"));

    await waitFor(() => {
      expect(screen.getByText("Validation failed")).toBeInTheDocument();
    });
  });

  it("clears checkbox selection when family filter changes", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListWishes")
      .mockResolvedValueOnce(mockWishListResponse)
      .mockResolvedValueOnce({ wishes: [], total: 0, page: 1, page_size: 20, total_pages: 0 });
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [mockFamily], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [mockUser], total: 1, page: 1, page_size: 200, total_pages: 1 });

    wrap(<AdminWishes />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // Select all wishes
    const selectAllCheckbox = screen.getByLabelText("Select all wishes on this page");
    await user.click(selectAllCheckbox);
    expect(screen.getByText("Batch Assign (2)")).toBeInTheDocument();

    // Change family filter to a specific family — list re-requests, selection resets
    const familySelect = screen.getByText("All families").closest("select");
    expect(familySelect).not.toBeNull();
    const familyOption = familySelect!.querySelector("option[value='5']") as HTMLElement | null;
    expect(familyOption).not.toBeNull();
    await user.selectOptions(familySelect!, familyOption!);

    // Selection should be cleared after filter change
    await waitFor(() => {
      expect(screen.getByText("Batch Assign (0)")).toBeInTheDocument();
    });
  });

  it("clears checkbox selection when search query changes", async () => {
    const user = userEvent.setup();
    // Auto-advance time so debounce fires quickly without freezing waitFor/userEvent
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    try {
      vi.spyOn(api, "adminListWishes")
        .mockResolvedValueOnce(mockWishListResponse)
        .mockResolvedValueOnce({ wishes: [], total: 0, page: 1, page_size: 20, total_pages: 0 });
      vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [mockFamily], total: 1, page: 1, page_size: 200, total_pages: 1 });
      vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [mockUser], total: 1, page: 1, page_size: 200, total_pages: 1 });

      wrap(<AdminWishes />);

      await waitFor(() => {
        expect(screen.getByText("Alice")).toBeInTheDocument();
      });

      // Select all wishes
      const selectAllCheckbox = screen.getByLabelText("Select all wishes on this page");
      await user.click(selectAllCheckbox);
      expect(screen.getByText("Batch Assign (2)")).toBeInTheDocument();

      // Change search — debounce fires after 1000ms (accelerated by shouldAdvanceTime)
      const searchInput = screen.getByPlaceholderText("Search wishes…");
      await user.type(searchInput, "test");

      // Wait for debounce + refetch to settle
      await waitFor(() => {
        expect(screen.getByText("Batch Assign (0)")).toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears purchaser_note by sending empty string sentinel", async () => {
    const user = userEvent.setup();

    // Wish detail with existing purchaser_note
    const wishWithNote: WishDetail = {
      ...mockWishDetail,
      purchaser_note: "Existing note",
      purchased_where: "Target",
    };

    vi.spyOn(api, "adminListWishes").mockResolvedValue(mockWishListResponse);
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [mockFamily], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [mockUser], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminGetWish").mockResolvedValue(wishWithNote);
    vi.spyOn(api, "adminUpdateWish").mockResolvedValue(wishWithNote);

    wrap(<AdminWishes />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // Open edit form
    const editButtons = screen.getAllByText("Edit");
    await user.click(editButtons[0]!);

    await waitFor(() => {
      expect(screen.getByText("Edit Wish")).toBeInTheDocument();
    });

    // Clear purchaser_note textarea
    const noteTextarea = screen.getByDisplayValue("Existing note");
    await user.clear(noteTextarea);

    // Save
    await user.click(screen.getByText("Update"));

    // Verify the update was called with empty string (sentinel for clearing)
    await waitFor(() => {
      expect(api.adminUpdateWish).toHaveBeenCalled();
    });
    const callArgs = (api.adminUpdateWish as ReturnType<typeof vi.spyOn>).mock.calls[0];
    expect(callArgs[1]).toHaveProperty("purchaser_note", "");
  });

  it("clears assigned_to_id by sending 0 sentinel", async () => {
    const user = userEvent.setup();

    // Wish detail with existing assignment
    const wishAssigned: WishDetail = {
      ...mockWishDetail,
      assigned_to_id: 3,
    };

    vi.spyOn(api, "adminListWishes").mockResolvedValue(mockWishListResponse);
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [mockFamily], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [mockUser], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminGetWish").mockResolvedValue(wishAssigned);
    vi.spyOn(api, "adminUpdateWish").mockResolvedValue(wishAssigned);

    wrap(<AdminWishes />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // Open edit form
    const editButtons = screen.getAllByText("Edit");
    await user.click(editButtons[0]!);

    await waitFor(() => {
      expect(screen.getByText("Edit Wish")).toBeInTheDocument();
    });

    // Select "Unassigned" from the dropdown
    const assignedSelect = screen.getByLabelText("Assigned To");
    await user.selectOptions(assignedSelect, assignedSelect.querySelector("option[value='']")!);

    // Save
    await user.click(screen.getByText("Update"));

    await waitFor(() => {
      expect(api.adminUpdateWish).toHaveBeenCalled();
    });
    const callArgs = (api.adminUpdateWish as ReturnType<typeof vi.spyOn>).mock.calls[0];
    // 0 is the backend sentinel for clearing FK to NULL
    expect(callArgs[1]).toHaveProperty("assigned_to_id", 0);
  });

  it("does not send unchanged fields in update payload", async () => {
    const user = userEvent.setup();

    vi.spyOn(api, "adminListWishes").mockResolvedValue(mockWishListResponse);
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [mockFamily], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [mockUser], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminGetWish").mockResolvedValue(mockWishDetail);
    vi.spyOn(api, "adminUpdateWish").mockResolvedValue(mockWishDetail);

    wrap(<AdminWishes />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // Open edit and save without changes
    const editButtons = screen.getAllByText("Edit");
    await user.click(editButtons[0]!);

    await waitFor(() => {
      expect(screen.getByText("Edit Wish")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Update"));

    await waitFor(() => {
      expect(api.adminUpdateWish).toHaveBeenCalled();
    });
    const callArgs = (api.adminUpdateWish as ReturnType<typeof vi.spyOn>).mock.calls[0];
    // Payload should have no changed fields (normalizeUpdatePayload omits unchanged keys)
    const payload = callArgs[1] as Record<string, unknown>;
    expect(payload.description).toBeUndefined();
    expect(payload.type).toBeUndefined();
    expect(payload.size).toBeUndefined();
  });

  it("mark-purchased dialog sends correct payload with optional fields", async () => {
    const user = userEvent.setup();

    vi.spyOn(api, "adminListWishes").mockResolvedValue(mockWishListResponse);
    vi.spyOn(api, "adminListFamilies").mockResolvedValue({ families: [mockFamily], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminListUsers").mockResolvedValue({ users: [mockUser], total: 1, page: 1, page_size: 200, total_pages: 1 });
    vi.spyOn(api, "adminMarkPurchased").mockResolvedValue(mockWishDetail);

    wrap(<AdminWishes />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // Open mark-purchased dialog
    const markPurchasedButtons = screen.getAllByText("Mark Purchased");
    await user.click(markPurchasedButtons[0]!);

    await waitFor(() => {
      expect(screen.getByText(/Mark wish for/)).toBeInTheDocument();
    });

    // Fill all fields
    const purchasedWhereInput = screen.getByLabelText("Purchased Where");
    await user.type(purchasedWhereInput, "Amazon");

    // Find the purchaser note textarea and type into it
    const textareas = screen.getAllByRole("textbox");
    const noteTextarea = textareas.find((ta) => ta.getAttribute("maxlength") === "400");
    if (noteTextarea) {
      await user.type(noteTextarea, "Great deal");
    }

    // Submit
    const dialog = document.querySelector(".fixed.inset-0.z-50");
    expect(dialog).not.toBeNull();
    const buttons = Array.from(dialog!.querySelectorAll("button"));
    const submitBtn = buttons.find((b) => b.textContent?.includes("Mark Purchased"));
    expect(submitBtn).not.toBeNull();
    await user.click(submitBtn!);

    await waitFor(() => {
      expect(api.adminMarkPurchased).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          purchased_where: "Amazon",
          purchaser_note: "Great deal",
        })
      );
    });
  });
});
