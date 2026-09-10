import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { deadlines } from "../lib/queryKeys";
import type { Deadline } from "../types";
import AdminDeadlines from "./AdminDeadlines";

/* ------------------------------------------------------------------ */
/* Fixtures & helpers                                                  */
/* ------------------------------------------------------------------ */

function makeDeadline(overrides: Partial<Deadline> = {}): Deadline {
  return {
    id: 1,
    type: "family_info",
    label: "Family information",
    due_date: "2026-12-15",
    mode: "display",
    created_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/**
 * Keeps the global public `deadlines` query active next to the page, so its
 * invalidation (refetch) is observable from the delete test.
 */
function PublicDeadlinesProbe() {
  useQuery({ queryKey: deadlines, queryFn: api.listDeadlines });
  return null;
}

function renderPage(rows: Deadline[] = []) {
  vi.spyOn(api, "adminListDeadlines").mockResolvedValue({ deadlines: rows });
  vi.spyOn(api, "listDeadlines").mockResolvedValue({ deadlines: rows });

  const queryClient = createQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <ToastContainer>
        <MemoryRouter initialEntries={["/admin/deadlines"]}>
          <PublicDeadlinesProbe />
          <AdminDeadlines />
        </MemoryRouter>
      </ToastContainer>
    </QueryClientProvider>
  );
  return queryClient;
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("AdminDeadlines", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the rows with type badge, status, and an empty state when none", async () => {
    renderPage();
    expect(await screen.findByText("No deadlines yet. Add one above.")).toBeInTheDocument();

    cleanup();
    renderPage([
      makeDeadline({ id: 1, type: "family_info", due_date: "2099-12-15" }),
      makeDeadline({ id: 2, type: "referrer_review", due_date: "2000-12-15" }),
      makeDeadline({ id: 3, type: "gift_dropoff", due_date: null }),
    ]);
    expect(await screen.findByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("Past due")).toBeInTheDocument();
    expect(screen.getByText("Undated")).toBeInTheDocument();
    // One type badge per row (span — the create form's type option shares the text)
    expect(screen.getByText("Family information", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Referrer review", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Gift drop-off", { selector: "span" })).toBeInTheDocument();
  });

  it("create form pre-fills the label when the type changes", async () => {
    const user = userEvent.setup();
    renderPage();

    // Default type (family_info) pre-fills its default label
    const labelInput = await screen.findByLabelText("Label");
    expect(labelInput).toHaveValue("Family information");

    await user.selectOptions(screen.getByLabelText("Type"), "gift_dropoff");
    expect(labelInput).toHaveValue("Gift drop-off");
    // The enforced hint follows the selected type
    expect(screen.getByText(/Enforced blocks new gift claims/)).toBeInTheDocument();
  });

  it("create sends the right POST (type, label, date-only due date, mode)", async () => {
    const user = userEvent.setup();
    const createSpy = vi.spyOn(api, "adminCreateDeadline").mockResolvedValue(makeDeadline({ id: 9 }));

    renderPage();
    await screen.findByLabelText("Label");

    await user.selectOptions(screen.getByLabelText("Type"), "gift_dropoff");
    // The picker always produces a full local value (date + time)
    const picker = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    await user.type(picker, "2026-12-15T00:00");
    await user.selectOptions(screen.getByLabelText("Mode"), "enforced");

    await user.click(screen.getByRole("button", { name: "Add deadline" }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith({
        type: "gift_dropoff",
        label: "Gift drop-off",
        due_date: "2026-12-15",
        mode: "enforced",
      });
    });
  });

  it("row save sends the right PATCH with only changed fields", async () => {
    const user = userEvent.setup();
    const updateSpy = vi.spyOn(api, "adminUpdateDeadline").mockResolvedValue(makeDeadline({ label: "Updated label", mode: "enforced" }));

    renderPage([makeDeadline()]);
    // Save starts disabled — nothing changed yet
    expect(await screen.findByRole("button", { name: "Save" })).toBeDisabled();

    const labelInput = screen.getByLabelText("Label for deadline 1");
    await user.clear(labelInput);
    await user.type(labelInput, "Updated label");
    await user.selectOptions(screen.getByLabelText("Mode for deadline 1"), "enforced");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      // due_date untouched → omitted from the payload
      expect(updateSpy).toHaveBeenCalledWith(1, { label: "Updated label", mode: "enforced" });
    });
  });

  it('clearing the due date sends ""', async () => {
    const user = userEvent.setup();
    const updateSpy = vi.spyOn(api, "adminUpdateDeadline").mockResolvedValue(makeDeadline({ due_date: null }));

    renderPage([makeDeadline({ due_date: "2026-12-15" })]);
    const dateInput = await screen.findByLabelText("Due date for deadline 1");

    await user.clear(dateInput);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(1, { due_date: "" });
    });
  });

  it("delete removes the row and invalidates both deadlines queries", async () => {
    const user = userEvent.setup();
    const deleteSpy = vi.spyOn(api, "adminDeleteDeadline").mockResolvedValue(undefined);

    renderPage([makeDeadline()]);
    await screen.findByText("Scheduled");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    // The confirm dialog names the row's label
    expect(screen.getByText(/Delete the "Family information" deadline\?/)).toBeInTheDocument();

    // The refetch after invalidation sees the row gone
    vi.mocked(api.adminListDeadlines).mockResolvedValue({ deadlines: [] });
    await user.click(screen.getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith(1);
    });

    // The admin list refetched and now shows the empty state
    await waitFor(() => {
      expect(screen.getByText("No deadlines yet. Add one above.")).toBeInTheDocument();
    });
    expect(vi.mocked(api.adminListDeadlines)).toHaveBeenCalledTimes(2);
    // The global public query (the banners' data) refetched too
    await waitFor(() => {
      expect(vi.mocked(api.listDeadlines)).toHaveBeenCalledTimes(2);
    });
  });
});
