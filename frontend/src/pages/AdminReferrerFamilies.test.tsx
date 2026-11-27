import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { auth } from "../lib/queryKeys";
import { headerUser } from "../test/fixtures";
import type { FamilyDetail, ReferrerDetail } from "../types";
import AdminReferrerFamilies from "./AdminReferrerFamilies";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const mockReferrer: ReferrerDetail = {
  id: 2,
  name: "Referrer Ray",
  family_limit: 10,
  phone_number: "555-0100",
  pickup_window: null,
  family_invite_code: "RAY-1234",
  family_count: 1,
  approval_status: "approved",
  approved_by_admin_name: "Admin",
  approved_at: "2025-01-02T00:00:00Z",
  created_at: "2025-01-01T00:00:00Z",
  deleted_at: null,
  invite_count: null,
  email: "ray@example.com",
};

const mockFamily: FamilyDetail = {
  id: 5,
  referrer_id: 2,
  referrer_name: "Referrer Ray",
  delivery_user_id: null,
  delivery_user_name: null,
  display_id: "2-1",
  family_name: "The Johnsons",
  bio: "Board game fans",
  address: "123 Main St",
  phone_number: "555-0100",
  contact_name: "Alice Johnson",
  deleted_at: null,
  person_count: 3,
  verification_status: "verified",
  wish_lock_level: "family",
  wish_review_requested_at: null,
  wish_rejection_reason: null,
  referrer_notes: null,
  contact_email: "alice@example.com",
  claim_status: null,
  claim_commitment_type: null,
  claim_donor_name: null,
  claim_id: null,
};

function renderPage() {
  vi.spyOn(api, "adminGetReferrer").mockResolvedValue(mockReferrer);
  vi.spyOn(api, "adminListReferrerFamilies").mockResolvedValue({
    families: [mockFamily],
    total: 1,
    page: 1,
    page_size: 50,
    total_pages: 1,
  });
  vi.spyOn(api, "adminGetUsersDropdown").mockResolvedValue([]);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(auth, headerUser);
  return render(
    <MemoryRouter initialEntries={["/admin/referrers/2/families"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AuthProvider>
            <Routes>
              <Route path="/admin/referrers/:id/families" element={<AdminReferrerFamilies />} />
            </Routes>
          </AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("AdminReferrerFamilies", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("renders the referrer card and the scoped families table", async () => {
    renderPage();

    expect(screen.getByText("Referrer & Families")).toBeInTheDocument();

    // Referrer card loads async (name appears in the card and the scoped table)
    expect((await screen.findAllByText("Referrer Ray")).length).toBeGreaterThan(0);
    // Family count badge on the card
    expect(await screen.findByText("1 family")).toBeInTheDocument();

    // Families table row
    expect(await screen.findByText("The Johnsons")).toBeInTheDocument();
  });

  it("header Send email opens the composer prefilled with the referrer email", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("The Johnsons");
    await user.click(screen.getByRole("button", { name: "Send email" }));

    // Dialog heading (the header button keeps the same label)
    expect(await screen.findByRole("heading", { name: "Send email" })).toBeInTheDocument();
    expect(screen.getByText("Referrer 2 — Referrer Ray")).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient")).toHaveValue("ray@example.com");
  });

  it("row Send email opens the composer prefilled with the family contact email", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("The Johnsons");
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Send email" }));

    // Dialog heading (the header button keeps the same label)
    expect(await screen.findByRole("heading", { name: "Send email" })).toBeInTheDocument();
    expect(screen.getByText("Family 2-1 — The Johnsons")).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient")).toHaveValue("alice@example.com");
  });

  describe("persisted view state", () => {
    it("hydrates page and tab from storage (scoped to the referrer)", async () => {
      vi.spyOn(api, "adminListDeletedFamilies").mockResolvedValue({ families: [], total: 0, page: 1, page_size: 50, total_pages: 0 });
      localStorage.setItem("kim:listView:adminReferrerFamilies:2:page", JSON.stringify({ page: 2, pageSize: 50 }));
      localStorage.setItem("kim:listView:adminReferrerFamilies:2:tab", JSON.stringify("deleted"));

      renderPage();

      // Wait for the (hydrated) deleted tab to render — the query resolves first
      await screen.findByRole("tab", { name: "Deleted" });
      expect(screen.getByRole("tab", { name: "Deleted" })).toHaveAttribute("aria-selected", "true");
      expect(api.adminListDeletedFamilies).toHaveBeenCalledWith(expect.objectContaining({ page: 2, page_size: 50 }));
      expect(vi.mocked(api.adminListReferrerFamilies)).not.toHaveBeenCalled();
      // Non-default view → the clear affordance is visible
      expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
    });

    it("does not hydrate another referrer's saved view", async () => {
      vi.spyOn(api, "adminListDeletedFamilies").mockResolvedValue({ families: [], total: 0, page: 1, page_size: 20, total_pages: 0 });
      // Saved under a different referrer id — must be ignored on /admin/referrers/2/families
      localStorage.setItem("kim:listView:adminReferrerFamilies:99:page", JSON.stringify({ page: 2, pageSize: 50 }));
      localStorage.setItem("kim:listView:adminReferrerFamilies:99:tab", JSON.stringify("deleted"));

      renderPage();

      await screen.findByRole("tab", { name: "Active" });
      expect(screen.getByRole("tab", { name: "Active" })).toHaveAttribute("aria-selected", "true");
      expect(vi.mocked(api.adminListReferrerFamilies)).toHaveBeenCalledWith(2, expect.objectContaining({ page: 1, page_size: 20 }));
      expect(api.adminListDeletedFamilies).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    });

    it("Clear filters resets the saved view", async () => {
      const user = userEvent.setup();
      vi.spyOn(api, "adminListDeletedFamilies").mockResolvedValue({ families: [], total: 0, page: 1, page_size: 50, total_pages: 0 });
      localStorage.setItem("kim:listView:adminReferrerFamilies:2:page", JSON.stringify({ page: 2, pageSize: 50 }));
      localStorage.setItem("kim:listView:adminReferrerFamilies:2:tab", JSON.stringify("deleted"));

      renderPage();
      await screen.findByRole("tab", { name: "Deleted" });

      await user.click(screen.getByRole("button", { name: "Clear filters" }));

      expect(JSON.parse(localStorage.getItem("kim:listView:adminReferrerFamilies:2:tab")!)).toBe("active");
      expect(JSON.parse(localStorage.getItem("kim:listView:adminReferrerFamilies:2:page")!)).toEqual({ page: 1, pageSize: 20 });
      expect(screen.getByRole("tab", { name: "Active" })).toHaveAttribute("aria-selected", "true");
      await waitFor(() => {
        expect(api.adminListReferrerFamilies).toHaveBeenCalledWith(2, expect.objectContaining({ page: 1, page_size: 20 }));
      });
      expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    });

    it("clamps a stale persisted page to the last page", async () => {
      localStorage.setItem("kim:listView:adminReferrerFamilies:2:page", JSON.stringify({ page: 99, pageSize: 20 }));
      // Mock the list (3 pages of 20) before rendering, so the stale page 99
      // is the only thing out of range when the first response lands.
      vi.spyOn(api, "adminGetReferrer").mockResolvedValue(mockReferrer);
      vi.spyOn(api, "adminGetUsersDropdown").mockResolvedValue([]);
      vi.spyOn(api, "adminListReferrerFamilies").mockResolvedValue({
        families: [mockFamily],
        total: 48,
        page: 1,
        page_size: 20,
        total_pages: 3,
      });
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      queryClient.setQueryData(auth, headerUser);
      render(
        <MemoryRouter initialEntries={["/admin/referrers/2/families"]}>
          <QueryClientProvider client={queryClient}>
            <ToastContainer>
              <AuthProvider>
                <Routes>
                  <Route path="/admin/referrers/:id/families" element={<AdminReferrerFamilies />} />
                </Routes>
              </AuthProvider>
            </ToastContainer>
          </QueryClientProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(api.adminListReferrerFamilies).toHaveBeenCalledWith(2, expect.objectContaining({ page: 99, page_size: 20 }));
      });
      await waitFor(() => {
        expect(api.adminListReferrerFamilies).toHaveBeenCalledWith(2, expect.objectContaining({ page: 3, page_size: 20 }));
      });
    });

    it("re-hydrates the target referrer's view when the route param changes (no remount)", async () => {
      vi.spyOn(api, "adminGetReferrer").mockResolvedValue(mockReferrer);
      vi.spyOn(api, "adminGetUsersDropdown").mockResolvedValue([]);
      vi.spyOn(api, "adminListReferrerFamilies").mockResolvedValue({
        families: [mockFamily],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      });
      vi.spyOn(api, "adminListDeletedFamilies").mockResolvedValue({ families: [], total: 0, page: 1, page_size: 20, total_pages: 0 });
      // Referrer 3 has its own saved view (the deleted tab)
      localStorage.setItem("kim:listView:adminReferrerFamilies:3:tab", JSON.stringify("deleted"));

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      queryClient.setQueryData(auth, headerUser);
      const user = userEvent.setup();
      render(
        <MemoryRouter initialEntries={["/admin/referrers/2/families"]}>
          <QueryClientProvider client={queryClient}>
            <ToastContainer>
              <AuthProvider>
                <Link to="/admin/referrers/3/families">to-referrer-3</Link>
                <Routes>
                  <Route path="/admin/referrers/:id/families" element={<AdminReferrerFamilies />} />
                </Routes>
              </AuthProvider>
            </ToastContainer>
          </QueryClientProvider>
        </MemoryRouter>
      );

      // Referrer 2's page shows its own (default) view
      await screen.findByRole("tab", { name: "Active" });
      expect(screen.getByRole("tab", { name: "Active" })).toHaveAttribute("aria-selected", "true");

      // Navigate to referrer 3 within the same router — same route element,
      // so the inner key must force the remount that re-reads storage
      await user.click(screen.getByRole("link", { name: "to-referrer-3" }));

      // Referrer 3's saved view is re-hydrated from its own slot…
      await screen.findByRole("tab", { name: "Deleted" });
      expect(screen.getByRole("tab", { name: "Deleted" })).toHaveAttribute("aria-selected", "true");
      // …and the navigation did not clobber the saved tab with referrer 2's
      expect(JSON.parse(localStorage.getItem("kim:listView:adminReferrerFamilies:3:tab")!)).toBe("deleted");
    });
  });
});
