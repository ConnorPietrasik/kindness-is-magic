import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

  it("is list-only: the generator now lives on the referrers page", async () => {
    vi.spyOn(api, "adminListInvites").mockResolvedValue(emptyListResponse);

    wrap("/admin/invite-codes");

    await waitFor(() => {
      expect(screen.getByText("No invite codes found.")).toBeInTheDocument();
    });

    expect(screen.queryByText("Generate Invite Code")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Generate new" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide generator" })).not.toBeInTheDocument();
  });
});
