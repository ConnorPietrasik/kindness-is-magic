import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("submits the selected wish ids with the entered location", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<BatchMarkPurchasedDialog {...defaultProps} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Purchased Where"), "Amazon");
    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Mark Purchased" }));

    expect(onSubmit).toHaveBeenCalledWith({ wish_ids: [1, 2], purchased_where: "Amazon", received_at: "" });
  });

  it("submits null purchased_where when left empty", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<BatchMarkPurchasedDialog {...defaultProps} onSubmit={onSubmit} />);

    const dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Mark Purchased" }));

    expect(onSubmit).toHaveBeenCalledWith({ wish_ids: [1, 2], purchased_where: null, received_at: "" });
  });
});
