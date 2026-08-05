import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { referrerFamilyDetail, referrerFamilyPeople } from "../lib/queryKeys";
import type { FamilyDetail } from "../types";
import ReferrerFamilyDetail from "./ReferrerFamilyDetail";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFamily: FamilyDetail = {
  id: 1,
  referrer_id: 2,
  referrer_name: "Jane Smith",
  display_id: "2-1",
  family_name: "The Smiths",
  bio: "A lovely family",
  address: "123 Main St",
  phone_number: "555-123-4567",
  family_wish: "A warm blanket",
  contact_name: "Mom Smith",
  deleted_at: null,
  person_count: 3,
  approval_status: "approved",
  pickup_window: null,
  wish_lock_level: "family",
  wish_review_requested_at: null,
  wish_rejection_reason: null,
  referrer_notes: "Called twice, prefers email",
};

const mockFamilyNoNotes: FamilyDetail = {
  ...mockFamily,
  referrer_notes: null,
};

const mockFamilyAdminLocked: FamilyDetail = {
  ...mockFamily,
  wish_lock_level: "admin",
};

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastContainer>
        <MemoryRouter initialEntries={["/referrer/families/1"]}>
          <Routes>
            <Route path="/referrer/families/:id" element={children} />
          </Routes>
        </MemoryRouter>
      </ToastContainer>
    </QueryClientProvider>
  );
}

function renderPage(family: FamilyDetail) {
  const qc = createQueryClient();

  // Pre-set query data so the component renders immediately
  qc.setQueryData(referrerFamilyDetail(String(family.id)), family);
  qc.setQueryData(referrerFamilyPeople(String(family.id)), { people: [], total: 0, page: 1, page_size: 20, total_pages: 1 });

  vi.spyOn(api, "getReferrerFamily").mockResolvedValue(family);
  vi.spyOn(api, "listReferrerFamilyPeople").mockResolvedValue({ people: [], total: 0, page: 1, page_size: 20, total_pages: 1 });
  vi.spyOn(api, "updateReferrerFamily").mockResolvedValue(family);
  vi.spyOn(api, "referrerApproveWishes").mockResolvedValue(family);

  render(<ReferrerFamilyDetail />, { wrapper: wrap(qc) });

  return qc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReferrerFamilyDetail — Internal Notes", () => {
  beforeEach(() => {
    vi.spyOn(api, "getReferrerFamily").mockClear();
    vi.spyOn(api, "listReferrerFamilyPeople").mockClear();
    vi.spyOn(api, "updateReferrerFamily").mockClear();
    vi.spyOn(api, "referrerApproveWishes").mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows Internal Notes section in family detail", async () => {
    renderPage(mockFamily);

    await waitFor(() => {
      expect(screen.getByText("📝 Internal Notes")).toBeInTheDocument();
    });
  });

  it("shows 'Set' badge when notes exist", async () => {
    renderPage(mockFamily);

    await waitFor(() => {
      expect(screen.getByText("Set")).toBeInTheDocument();
    });
  });

  it("does not show 'Set' badge when notes are null", async () => {
    renderPage(mockFamilyNoNotes);

    await waitFor(() => {
      expect(screen.getByText("📝 Internal Notes")).toBeInTheDocument();
    });
    expect(screen.queryByText("Set")).not.toBeInTheDocument();
  });

  it("shows privacy hint when collapsed", async () => {
    renderPage(mockFamily);

    await waitFor(() => {
      expect(screen.getByText("Visible only to you and admins")).toBeInTheDocument();
    });
  });

  it("expands notes section on click", async () => {
    const user = userEvent.setup();
    renderPage(mockFamily);

    const toggle = screen.getByText("📝 Internal Notes").closest("button");
    expect(toggle).toBeTruthy();
    await user.click(toggle!);

    // After expanding, textarea should be visible
    await waitFor(() => {
      const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
      const notesTextarea = textareas.find((t) => t.value === mockFamily.referrer_notes);
      expect(notesTextarea).toBeTruthy();
    });
  });

  it("shows character counter in expanded state", async () => {
    const user = userEvent.setup();
    renderPage(mockFamily);

    const toggle = screen.getByText("📝 Internal Notes").closest("button");
    await user.click(toggle!);

    await waitFor(() => {
      expect(screen.getByText(new RegExp(`${mockFamily.referrer_notes!.length}/1000`))).toBeInTheDocument();
    });
  });

  it("calls updateReferrerFamily with referrer_notes on save", async () => {
    const user = userEvent.setup();
    renderPage(mockFamilyNoNotes);

    // Expand notes section
    const toggle = screen.getByText("📝 Internal Notes").closest("button");
    await user.click(toggle!);

    // Wait for textarea to appear and type in it
    await waitFor(() => {
      const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
      const notesTextarea = textareas.find((t) => t.placeholder === "Add internal notes…");
      expect(notesTextarea).toBeTruthy();
    });

    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    const notesTextarea = textareas.find((t) => t.placeholder === "Add internal notes…")!;
    await user.type(notesTextarea, "Test note");

    await user.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(api.updateReferrerFamily).toHaveBeenCalledWith(1, { referrer_notes: "Test note" });
    });
  });

  it("notes section is present even when family is admin-locked", async () => {
    renderPage(mockFamilyAdminLocked);

    await waitFor(() => {
      expect(screen.getByText("📝 Internal Notes")).toBeInTheDocument();
    });
    // The "Visible only to you and admins" hint should be visible
    expect(screen.getByText("Visible only to you and admins")).toBeInTheDocument();
  });
});
