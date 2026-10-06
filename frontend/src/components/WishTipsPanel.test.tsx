import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { WishTipsPanel } from "./WishTipsPanel";

const WISH_TIPS_CLOSED_KEY = "wish-tips-closed";
const TIP_TEXT = /Every item has a \$50 price limit\./;
const TOGGLE_NAME = /How to write a great wish/;

const renderPanel = () =>
  render(
    <MemoryRouter>
      <WishTipsPanel />
    </MemoryRouter>
  );

describe("WishTipsPanel", () => {
  afterEach(() => {
    cleanup();
    localStorage.removeItem(WISH_TIPS_CLOSED_KEY);
  });

  it("is open by default and shows the tips digest and guide link", () => {
    renderPanel();

    expect(screen.getByText(TIP_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the full wish list guide" })).toBeInTheDocument();
  });

  it("closes after the toggle and writes the localStorage flag", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: TOGGLE_NAME }));

    expect(screen.queryByText(TIP_TEXT)).not.toBeInTheDocument();
    expect(localStorage.getItem(WISH_TIPS_CLOSED_KEY)).toBe("1");
  });

  it("stays closed on a fresh mount when the flag is set", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: TOGGLE_NAME }));

    // Simulate a later visit: a fresh component mount in the same browser
    cleanup();
    renderPanel();

    expect(screen.queryByText(TIP_TEXT)).not.toBeInTheDocument();
  });

  it("opens when re-toggled and clears the flag", async () => {
    const user = userEvent.setup();
    localStorage.setItem(WISH_TIPS_CLOSED_KEY, "1");
    renderPanel();

    expect(screen.queryByText(TIP_TEXT)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: TOGGLE_NAME }));

    expect(screen.getByText(TIP_TEXT)).toBeInTheDocument();
    expect(localStorage.getItem(WISH_TIPS_CLOSED_KEY)).toBeNull();
  });
});
