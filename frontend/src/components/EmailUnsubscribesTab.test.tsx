import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { formatDateTime } from "../lib/utils";
import type { EmailPreferenceListResponse, EmailPreferenceSummary } from "../types";
import { EmailUnsubscribesTab } from "./EmailUnsubscribesTab";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const emptyListResponse: EmailPreferenceListResponse = { preferences: [], total: 0, page: 1, page_size: 50, total_pages: 0 };

const wrap = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastContainer>
        <EmailUnsubscribesTab />
      </ToastContainer>
    </QueryClientProvider>
  );
};

function makePref(overrides: Partial<EmailPreferenceSummary>): EmailPreferenceSummary {
  return {
    email: "alice@example.com",
    unsubscribed_at: "2025-06-01T12:00:00Z",
    ...overrides,
  };
}

const listWith = (...prefs: EmailPreferenceSummary[]): EmailPreferenceListResponse => ({
  preferences: prefs,
  total: prefs.length,
  page: 1,
  page_size: 50,
  total_pages: 1,
});

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("EmailUnsubscribesTab", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
  });

  it("renders one row per email with the unsubscribe date and a re-subscribe action", async () => {
    vi.spyOn(api, "adminListEmailUnsubscribes").mockResolvedValue(
      listWith(
        makePref({ email: "alice@example.com", unsubscribed_at: "2025-06-01T12:00:00Z" }),
        makePref({ email: "bob@example.com", unsubscribed_at: "2025-06-15T08:30:00Z" })
      )
    );

    wrap();

    const aliceRow = (await screen.findByText("alice@example.com")).closest("tr")!;
    expect(aliceRow).toHaveTextContent(formatDateTime("2025-06-01T12:00:00Z"));
    expect(within(aliceRow).getByRole("button", { name: "Re-subscribe" })).toBeInTheDocument();

    const bobRow = screen.getByText("bob@example.com").closest("tr")!;
    expect(bobRow).toHaveTextContent(formatDateTime("2025-06-15T08:30:00Z"));
  });

  it("shows the empty state when no emails match", async () => {
    vi.spyOn(api, "adminListEmailUnsubscribes").mockResolvedValue(emptyListResponse);

    wrap();

    await waitFor(() => {
      expect(screen.getByText("No unsubscribed emails.")).toBeInTheDocument();
    });
  });

  it("passes the debounced search to the API", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    try {
      const listSpy = vi
        .spyOn(api, "adminListEmailUnsubscribes")
        .mockResolvedValueOnce(emptyListResponse)
        .mockResolvedValue(emptyListResponse);

      wrap();

      await waitFor(() => {
        expect(listSpy).toHaveBeenCalledTimes(1);
      });
      // No "id" in columns — this resource is keyed by email and the backend
      // whitelist would 400 on it (and the mutation needs no id either).
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ search: undefined, columns: ["email", "unsubscribed_at"] }));

      await user.type(screen.getByLabelText("Search by email"), "test");
      await waitFor(() => {
        expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ search: "test", page: 1 }));
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-subscribe: confirm calls the API, toasts, and the row disappears", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListEmailUnsubscribes")
      .mockResolvedValueOnce(listWith(makePref({})))
      .mockResolvedValue(emptyListResponse);
    const resubscribeSpy = vi.spyOn(api, "adminResubscribeEmail").mockResolvedValue(undefined);

    wrap();

    const row = (await screen.findByText("alice@example.com")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Re-subscribe" }));

    // Confirmation dialog names the recipient
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("alice@example.com");

    await user.click(within(dialog).getByRole("button", { name: "Re-subscribe" }));

    expect(resubscribeSpy).toHaveBeenCalledTimes(1);
    expect(resubscribeSpy).toHaveBeenCalledWith("alice@example.com");

    // Success toast, dialog closed, list refetched → empty state
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Re-subscribed alice@example.com");
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("No unsubscribed emails.")).toBeInTheDocument();
    });
  });

  it("re-subscribe: cancel closes the dialog without calling the API", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListEmailUnsubscribes").mockResolvedValue(listWith(makePref({})));
    const resubscribeSpy = vi.spyOn(api, "adminResubscribeEmail").mockResolvedValue(undefined);

    wrap();

    const row = (await screen.findByText("alice@example.com")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Re-subscribe" }));

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(resubscribeSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // The row is still there
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });
});
