import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "../lib/utils";
import { MarkPurchasedDialog, type MarkPurchasedDialogWish } from "./MarkPurchasedDialog";

const baseWish: MarkPurchasedDialogWish = {
  person_given_name: "Alice",
  purchased_at: null,
  purchased_where: null,
  purchaser_note: null,
  received_at: null,
};

const defaultProps = {
  open: true,
  wish: baseWish,
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
  loading: false,
};

function submitViaDialog(user: ReturnType<typeof userEvent.setup>) {
  const dialog = within(screen.getByRole("dialog"));
  return user.click(dialog.getByRole("button", { name: "Mark Purchased" }));
}

describe("MarkPurchasedDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("returns null when open is false", () => {
    const { container } = render(<MarkPurchasedDialog {...defaultProps} open={false} />);

    expect(container.firstChild).toBeNull();
  });

  it("shows the person's name in the title", () => {
    render(<MarkPurchasedDialog {...defaultProps} />);

    expect(screen.getByText("Alice", { selector: "strong" })).toBeInTheDocument();
  });

  it("defaults the purchased date/time to now for an unpurchased wish", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const before = Date.now();
    render(<MarkPurchasedDialog {...defaultProps} onSubmit={onSubmit} />);

    await submitViaDialog(user);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]![0];
    // Default is the current date/time (captured when the wish loaded),
    // truncated to the second
    const submitted = new Date(payload.purchased_at).getTime();
    expect(submitted).toBeGreaterThanOrEqual(before - 1000);
    expect(submitted).toBeLessThanOrEqual(Date.now());
    // Picker shows that same instant in local time
    expect(screen.getByLabelText("Purchased")).toHaveValue(toDatetimeLocalValue(payload.purchased_at));
    expect(payload.purchased_where).toBeNull();
    expect(payload.purchaser_note).toBe("");
    expect(payload.received_at).toBe("");
  });

  it("prefills the purchased date/time from the wish when already purchased", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<MarkPurchasedDialog {...defaultProps} wish={{ ...baseWish, purchased_at: "2026-02-10T08:00:00Z" }} onSubmit={onSubmit} />);

    expect(screen.getByLabelText("Purchased")).toHaveValue(toDatetimeLocalValue("2026-02-10T08:00:00Z"));

    await submitViaDialog(user);

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ purchased_at: "2026-02-10T08:00:00Z" }));
  });

  it("submits an edited purchased date/time", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<MarkPurchasedDialog {...defaultProps} onSubmit={onSubmit} />);

    const purchasedInput = screen.getByLabelText("Purchased");
    await user.clear(purchasedInput);
    await user.type(purchasedInput, "2026-02-25T09:30");

    await submitViaDialog(user);

    // Local input value converted to the same instant in UTC
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ purchased_at: fromDatetimeLocalValue("2026-02-25T09:30") }));
  });

  it('submits "" purchased_at when the field is cleared', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<MarkPurchasedDialog {...defaultProps} onSubmit={onSubmit} />);

    await user.clear(screen.getByLabelText("Purchased"));

    await submitViaDialog(user);

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ purchased_at: "" }));
  });

  it("submits null purchased_where when left empty", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<MarkPurchasedDialog {...defaultProps} onSubmit={onSubmit} />);

    await submitViaDialog(user);

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ purchased_where: null }));
  });

  it("shows a spinner and cancel while the wish is still loading", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<MarkPurchasedDialog {...defaultProps} wish={null} onCancel={onCancel} />);

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Purchased")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows the fetch error with Try again and Close instead of the form", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onRetry = vi.fn();
    render(
      <MarkPurchasedDialog
        {...defaultProps}
        wish={null}
        error={{ response: { data: { detail: "Wish not found" } } }}
        onRetry={onRetry}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText("Wish not found")).toBeInTheDocument();
    expect(screen.queryByLabelText("Purchased")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
