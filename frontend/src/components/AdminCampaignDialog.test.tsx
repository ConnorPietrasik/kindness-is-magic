import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { AdminCampaignDialog, parseManualEmails } from "./AdminCampaignDialog";

describe("parseManualEmails", () => {
  it("splits on newlines", () => {
    expect(parseManualEmails("a@example.com\nb@example.com\nc@example.com")).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
  });

  it("splits on commas and semicolons", () => {
    expect(parseManualEmails("a@example.com, b@example.com; c@example.com")).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
  });

  it("trims, lowercases, and dedupes case-insensitively", () => {
    expect(parseManualEmails("  A@Example.com \n a@example.com ,B@Example.com")).toEqual(["a@example.com", "b@example.com"]);
  });

  it("drops empties (extra separators, blank lines, leading/trailing commas)", () => {
    expect(parseManualEmails("\n,\n a@example.com ,,  \n")).toEqual(["a@example.com"]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseManualEmails("")).toEqual([]);
    expect(parseManualEmails("   \n  , \n")).toEqual([]);
  });
});

describe("AdminCampaignDialog preview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("shows a non-blocking note when the preview fails (e.g. an invalid address)", async () => {
    vi.spyOn(api, "adminPreviewEmailCampaign").mockRejectedValue(new Error("422"));
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AdminCampaignDialog open onClose={vi.fn()} />
        </ToastContainer>
      </QueryClientProvider>
    );

    await user.type(screen.getByLabelText("Extra email addresses (optional)"), "not-an-email");
    await user.type(screen.getByLabelText("Message"), "Body");

    // The failed preview (a 422 on the invalid address) never blocks create.
    await screen.findByText(/Preview unavailable/, {}, { timeout: 5000 });
    expect(screen.getByRole("button", { name: "Create campaign" })).toBeEnabled();
  });

  it("shows the total plus the per-role/manual breakdown once the preview resolves", async () => {
    vi.spyOn(api, "adminPreviewEmailCampaign").mockResolvedValue({ total: 5, by_role: { donor: 2, admin: 3 }, manual: 0 });
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AdminCampaignDialog open onClose={vi.fn()} />
        </ToastContainer>
      </QueryClientProvider>
    );

    await user.click(screen.getByRole("checkbox", { name: "Donors" }));
    await user.click(screen.getByRole("checkbox", { name: "Admins" }));

    // The preview fires after the 500ms debounce.
    await screen.findByText(/Will send to/, {}, { timeout: 2000 });
    expect(screen.getByText(/2 donors, 3 admins/)).toBeInTheDocument();
  });
});

describe("AdminCampaignDialog Escape", () => {
  afterEach(() => {
    cleanup();
  });

  it("closes on Escape even when focus is outside the dialog", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastContainer>
          <AdminCampaignDialog open onClose={onClose} />
        </ToastContainer>
      </QueryClientProvider>
    );

    // userEvent keys from document.activeElement (the body — outside the
    // dialog). A bubbling backdrop-only handler would miss this; the
    // window-level listener must catch it.
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
