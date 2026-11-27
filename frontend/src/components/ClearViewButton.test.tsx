import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClearViewButton } from "./ClearViewButton";

afterEach(() => {
  cleanup();
});

describe("ClearViewButton", () => {
  it("renders nothing while the view is at defaults", () => {
    const { container } = render(<ClearViewButton isNonDefault={false} onClear={() => {}} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders a 'Clear filters' button when the view is non-default", () => {
    render(<ClearViewButton isNonDefault={true} onClear={() => {}} />);

    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("calls onClear when clicked", async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    render(<ClearViewButton isNonDefault={true} onClear={onClear} />);

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
