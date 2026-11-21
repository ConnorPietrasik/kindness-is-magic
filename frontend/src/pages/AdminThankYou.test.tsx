import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { auth } from "../lib/queryKeys";
import { headerUser } from "../test/fixtures";
import type { ThankYouDonor, ThankYouDonorsResponse } from "../types";
import AdminThankYou from "./AdminThankYou";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const makeQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrap = (queryClient: QueryClient = makeQueryClient()) => {
  queryClient.setQueryData(auth, headerUser);
  return render(
    <MemoryRouter initialEntries={["/admin/thank-you"]}>
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AuthProvider>
            <AdminThankYou />
          </AuthProvider>
        </ToastContainer>
      </QueryClientProvider>
    </MemoryRouter>
  );
};

function makeDonor(overrides: Partial<ThankYouDonor> = {}): ThankYouDonor {
  return {
    email: "alice@example.com",
    display_name: "Alice Example",
    source: "claims",
    claim_count: 1,
    claim_family_names: ["The Example Family"],
    latest_fulfilled_at: "2025-12-01T00:00:00Z",
    general_payment_count: 0,
    general_total_cents: 0,
    latest_donation_at: null,
    thanked_at: null,
    thanked_by_name: null,
    ...overrides,
  };
}

const listWith = (...donors: ThankYouDonor[]): ThankYouDonorsResponse => ({
  donors,
  total: donors.length,
  page: 1,
  page_size: 50,
  total_pages: donors.length > 0 ? 1 : 0,
});

const emptyList: ThankYouDonorsResponse = { donors: [], total: 0, page: 1, page_size: 50, total_pages: 0 };

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("AdminThankYou", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
  });

  it("renders rows with source chips, summaries, and the right thanked action", async () => {
    vi.spyOn(api, "adminListThankYouDonors").mockResolvedValue(
      listWith(
        makeDonor(),
        makeDonor({
          email: "bob@example.com",
          display_name: "Bob General",
          source: "general",
          claim_count: 0,
          claim_family_names: [],
          latest_fulfilled_at: null,
          general_payment_count: 2,
          general_total_cents: 12_500,
          latest_donation_at: "2025-12-10T00:00:00Z",
          thanked_at: "2025-12-11T00:00:00Z",
          thanked_by_name: "Admin",
        })
      )
    );

    wrap();

    const aliceRow = (await screen.findByText("alice@example.com")).closest("tr")!;
    expect(aliceRow).toHaveTextContent("Alice Example");
    expect(aliceRow).toHaveTextContent("Sponsorship");
    expect(aliceRow).not.toHaveTextContent("General");
    expect(aliceRow).toHaveTextContent("1 fulfilled");
    expect(aliceRow).toHaveTextContent("The Example Family");
    expect(aliceRow).toHaveTextContent("Not thanked");
    expect(within(aliceRow).getByRole("button", { name: "Mark thanked" })).toBeInTheDocument();

    const bobRow = screen.getByText("bob@example.com").closest("tr")!;
    expect(bobRow).toHaveTextContent("General");
    expect(bobRow).toHaveTextContent("$125");
    expect(bobRow).toHaveTextContent("Thanked");
    expect(within(bobRow).getByRole("button", { name: "Mark unthanked" })).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", async () => {
    vi.spyOn(api, "adminListThankYouDonors").mockResolvedValue(emptyList);

    wrap();

    await waitFor(() => {
      expect(screen.getByText("No donors to thank yet.")).toBeInTheDocument();
    });
  });

  it("the thanked filter maps to the thanked param", async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(api, "adminListThankYouDonors").mockResolvedValue(emptyList);

    wrap();

    let filter = await screen.findByRole("combobox", { name: "Thanked filter" });
    expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ thanked: undefined }));

    await user.selectOptions(filter, "thanked");
    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ thanked: true }));
    });
    // The new query flips the page through its spinner (the select unmounts),
    // so wait for the settled page and re-acquire the select node
    await screen.findByText("No donors to thank yet.");

    filter = await screen.findByRole("combobox", { name: "Thanked filter" });
    await user.selectOptions(filter, "unthanked");
    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ thanked: false }));
    });
  });

  it("the source filter maps to the source param", async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(api, "adminListThankYouDonors").mockResolvedValue(emptyList);

    wrap();

    const filter = await screen.findByRole("combobox", { name: "Source filter" });
    await user.selectOptions(filter, "general");
    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ source: "general" }));
    });
  });

  it("draft email opens the composer pre-filled with the personalized draft", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListThankYouDonors").mockResolvedValue(listWith(makeDonor()));

    wrap();

    const row = (await screen.findByText("alice@example.com")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Draft email" }));

    const dialog = await screen.findByRole("dialog", { name: "Send email" });
    // Recipient + pre-filled subject/body from the draft builder
    expect(within(dialog).getByLabelText("Recipient")).toHaveValue("alice@example.com");
    expect(within(dialog).getByLabelText("Subject (optional)")).toHaveValue("Thank you, Alice, for your sponsorship");
    const messageValue = (within(dialog).getByLabelText("Message") as HTMLTextAreaElement).value;
    expect(messageValue).toContain("The family has received all their gifts");
    // Family names are PII: they stay out of the donor-facing draft (the
    // admin's context block in the same dialog may still show them)
    expect(messageValue).not.toContain("The Example Family");
    // The donor's reference block (singular for one sponsorship)
    expect(dialog).toHaveTextContent("Sponsorship (1):");
  });

  it("a successful send auto-marks the donor thanked", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListThankYouDonors").mockResolvedValue(listWith(makeDonor()));
    vi.spyOn(api, "adminSendCustomEmail").mockResolvedValue({ sent: true, reason: null });
    const markSpy = vi
      .spyOn(api, "adminMarkDonorThanked")
      .mockResolvedValue({ email: "alice@example.com", thanked_at: "2025-12-12T00:00:00Z" });

    wrap();

    const row = (await screen.findByText("alice@example.com")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Draft email" }));

    const dialog = await screen.findByRole("dialog", { name: "Send email" });
    await user.click(within(dialog).getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(markSpy).toHaveBeenCalledTimes(1);
    });
    expect(markSpy).toHaveBeenCalledWith("alice@example.com");
  });

  it("a skipped send (unsubscribed) does not mark the donor thanked", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListThankYouDonors").mockResolvedValue(listWith(makeDonor()));
    vi.spyOn(api, "adminSendCustomEmail").mockResolvedValue({ sent: false, reason: "unsubscribed" });
    const markSpy = vi.spyOn(api, "adminMarkDonorThanked").mockResolvedValue({ email: "alice@example.com", thanked_at: null });

    wrap();

    const row = (await screen.findByText("alice@example.com")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Draft email" }));

    const dialog = await screen.findByRole("dialog", { name: "Send email" });
    await user.click(within(dialog).getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Send skipped");
    });
    expect(markSpy).not.toHaveBeenCalled();
  });

  it("mark thanked calls the API, toasts, and refetches the list", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListThankYouDonors")
      .mockResolvedValueOnce(listWith(makeDonor()))
      .mockResolvedValue(listWith(makeDonor({ thanked_at: "2025-12-12T00:00:00Z", thanked_by_name: "Admin" })));
    const markSpy = vi
      .spyOn(api, "adminMarkDonorThanked")
      .mockResolvedValue({ email: "alice@example.com", thanked_at: "2025-12-12T00:00:00Z" });

    wrap();

    const row = (await screen.findByText("alice@example.com")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Mark thanked" }));

    expect(markSpy).toHaveBeenCalledTimes(1);
    expect(markSpy).toHaveBeenCalledWith("alice@example.com");
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Marked as thanked");
    });
    await waitFor(() => {
      expect(screen.getByText("alice@example.com").closest("tr")).toHaveTextContent("Thanked");
    });
  });

  it("mark unthanked calls the API for a thanked row", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminListThankYouDonors").mockResolvedValue(
      listWith(makeDonor({ thanked_at: "2025-12-12T00:00:00Z", thanked_by_name: "Admin" }))
    );
    const unmarkSpy = vi.spyOn(api, "adminUnmarkDonorThanked").mockResolvedValue({ email: "alice@example.com", thanked_at: null });

    wrap();

    const row = (await screen.findByText("alice@example.com")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Mark unthanked" }));

    expect(unmarkSpy).toHaveBeenCalledTimes(1);
    expect(unmarkSpy).toHaveBeenCalledWith("alice@example.com");
  });

  it("clicking a column header cycles sort (asc → desc → clear) and passes the sort param", async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(api, "adminListThankYouDonors").mockResolvedValue(listWith(makeDonor()));

    wrap();

    let header = await screen.findByRole("button", { name: "Sort by Sponsorships" });
    await user.click(header);
    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "claim_count" }));
    });

    // Each sort change refetches through the page spinner (the header
    // unmounts), so re-acquire the settled header before the next click
    header = await screen.findByRole("button", { name: "Sort by Sponsorships" });
    await user.click(header);
    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "-claim_count" }));
    });

    header = await screen.findByRole("button", { name: "Sort by Sponsorships" });
    await user.click(header);
    await waitFor(() => {
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ sort: undefined }));
    });
  });

  it("passes the debounced search to the API", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    try {
      const listSpy = vi.spyOn(api, "adminListThankYouDonors").mockResolvedValueOnce(emptyList).mockResolvedValue(emptyList);

      wrap();

      await waitFor(() => {
        expect(listSpy).toHaveBeenCalledTimes(1);
      });
      expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ search: undefined, page: 1 }));

      await user.type(screen.getByLabelText("Search by email, name, or family"), "test");
      await waitFor(() => {
        expect(listSpy).toHaveBeenLastCalledWith(expect.objectContaining({ search: "test", page: 1 }));
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
