import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import AdminInviteCodes from "./AdminInviteCodes";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const emptyListResponse = { invites: [], total: 0, page: 1, page_size: 20, total_pages: 0 };

const wrap = (path: string) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AdminInviteCodes />
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("AdminInviteCodes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
  });

  it("keeps the generator closed by default", async () => {
    vi.spyOn(api, "adminListInvites").mockResolvedValue(emptyListResponse);

    wrap("/admin/invite-codes");

    await waitFor(() => {
      expect(screen.getByText("No invite codes found.")).toBeInTheDocument();
    });

    expect(screen.queryByText("Generate Invite Code")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Generate New" })).toBeInTheDocument();
  });

  it("opens the generator when navigated with ?generate=1", async () => {
    vi.spyOn(api, "adminListInvites").mockResolvedValue(emptyListResponse);

    wrap("/admin/invite-codes?generate=1");

    await waitFor(() => {
      expect(screen.getByText("Generate Invite Code")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Hide Generator" })).toBeInTheDocument();
  });

  it("opens the generator when ?generate=1 appears on an already-mounted page", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListInvites").mockResolvedValue(emptyListResponse);

    function NavControl() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("/admin/invite-codes?generate=1")}>
          Go with param
        </button>
      );
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={["/admin/invite-codes"]}>
        <QueryClientProvider client={queryClient}>
          <ToastContainer>
            <Routes>
              <Route path="/admin/invite-codes" element={<AdminInviteCodes />} />
            </Routes>
            <NavControl />
          </ToastContainer>
        </QueryClientProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No invite codes found.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Generate Invite Code")).not.toBeInTheDocument();

    // Search-only navigation keeps the same element instance mounted
    await user.click(screen.getByRole("button", { name: "Go with param" }));

    await waitFor(() => {
      expect(screen.getByText("Generate Invite Code")).toBeInTheDocument();
    });
  });
});
