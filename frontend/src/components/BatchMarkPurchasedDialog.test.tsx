import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "../lib/utils";
import { BatchMarkPurchasedDialog } from "./BatchMarkPurchasedDialog";

const defaultProps = {
  open: true,
  wishIds: [1, 2],
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
  loading: false,
};

describe("BatchMarkPurchasedDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("returns null when open is false", () => {
    const { container } = render(<BatchMarkPurchasedDialog {...defaultProps} open={false} />);

    expect(container.firstChild).toBeNull();
  });

  it("shows the selected count in the title", () => {
    render(<BatchMarkPurchasedDialog {...defaultProps} />);

    expect(screen.getByText("2 wishes", { selector: "strong" })).toBeInTheDocument();
  });

  it("shows the singular title for one wish", () => {
    render(<BatchMarkPurchasedDialog {...defaultProps} wishIds={[1]} />);

    expect(screen.getByText("1 wish", { selector: "strong" })).toBeInTheDocument();
  });

  it("defaults the purchased date/time to now and submits it", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const before = Date.now();
    render(<BatchMarkPurchasedDialog {...defaultProps} onSubmit={onSubmit} />);

    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Mark Purchased" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0]![0];
    // Default is the current date/time (captured when the dialog opened),
    // truncated to the second
    const submitted = new Date(payload.purchased_at).getTime();
    expect(submitted).toBeGreaterThanOrEqual(before - 1000);
    expect(submitted).toBeLessThanOrEqual(Date.now());
    // Picker shows that same instant in local time
    expect(screen.getByLabelText("Purchased")).toHaveValue(toDatetimeLocalValue(payload.purchased_at));
    expect(payload.purchased_where).toBeNull();
    expect(payload.received_at).toBe("");
  });

  it("submits an edited purchased date/time", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<BatchMarkPurchasedDialog {...defaultProps} onSubmit={onSubmit} />);

    const purchasedInput = screen.getByLabelText("Purchased");
    await user.clear(purchasedInput);
    await user.type(purchasedInput, "2026-02-25T09:30");

    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Mark Purchased" }));

    // Local input value converted to the same instant in UTC
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ purchased_at: fromDatetimeLocalValue("2026-02-25T09:30") }));
  });

  it('submits "" purchased_at when the field is cleared', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<BatchMarkPurchasedDialog {...defaultProps} onSubmit={onSubmit} />);

    await user.clear(screen.getByLabelText("Purchased"));

    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Mark Purchased" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ purchased_at: "" }));
  });

  it("submits the selected wish ids with the entered location", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<BatchMarkPurchasedDialog {...defaultProps} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Purchased Where"), "Amazon");
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Mark Purchased" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ wish_ids: [1, 2], purchased_where: "Amazon", received_at: "", purchased_at: expect.any(String) })
    );
  });

  it("submits null purchased_where when left empty", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<BatchMarkPurchasedDialog {...defaultProps} onSubmit={onSubmit} />);

    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Mark Purchased" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ wish_ids: [1, 2], purchased_where: null, received_at: "", purchased_at: expect.any(String) })
    );
  });
});
