import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColumnToggle } from "./ColumnToggle";

afterEach(() => {
  localStorage.clear();
  window.dispatchEvent(new Event("resize"));
  cleanup();
});

describe("ColumnToggle", () => {
  it("opens popover on button click", async () => {
    const user = userEvent.setup();
    const { container } = render(<ColumnToggle resourceKey="adminReferrers" />);

    const button = container.querySelector("button[aria-label='Toggle columns']");
    expect(button).toBeInTheDocument();
    await user.click(button!);

    expect(screen.getByText("Columns")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Family Limit")).toBeInTheDocument();
  });

  it("stages checkbox changes without persisting to localStorage", async () => {
    const user = userEvent.setup();
    render(<ColumnToggle resourceKey="adminReferrers" />);

    const button = screen.getByLabelText("Toggle columns");
    await user.click(button);

    const phoneCheckbox = screen.getByLabelText("Phone");
    expect(phoneCheckbox).not.toBeChecked();

    await user.click(phoneCheckbox);
    expect(phoneCheckbox).toBeChecked();

    // Changes should NOT be persisted yet (no Apply clicked)
    expect(localStorage.getItem("kim:columns:adminReferrers")).not.toContain("phone_number");
  });

  it("persists changes to localStorage on Apply click", async () => {
    const user = userEvent.setup();
    render(<ColumnToggle resourceKey="adminReferrers" />);

    const button = screen.getByLabelText("Toggle columns");
    await user.click(button);

    const phoneCheckbox = screen.getByLabelText("Phone");
    await user.click(phoneCheckbox);

    const applyButton = screen.getByRole("button", { name: "Apply" });
    await user.click(applyButton);

    expect(screen.queryByText("Columns")).not.toBeInTheDocument();
    expect(localStorage.getItem("kim:columns:adminReferrers")).toContain("phone_number");
  });

  it("closes popover on Apply click", async () => {
    const user = userEvent.setup();
    render(<ColumnToggle resourceKey="adminReferrers" />);

    const button = screen.getByLabelText("Toggle columns");
    await user.click(button);
    expect(screen.getByText("Columns")).toBeInTheDocument();

    const applyButton = screen.getByRole("button", { name: "Apply" });
    await user.click(applyButton);

    expect(screen.queryByText("Columns")).not.toBeInTheDocument();
  });

  it("resets to defaults and closes popover on Reset click", async () => {
    const user = userEvent.setup();
    // Pre-set non-default columns
    localStorage.setItem("kim:columns:adminReferrers", JSON.stringify(["phone_number", "created_at"]));

    render(<ColumnToggle resourceKey="adminReferrers" />);

    const button = screen.getByLabelText("Toggle columns");
    await user.click(button);

    const resetButton = screen.getByRole("button", { name: "Reset" });
    await user.click(resetButton);

    expect(screen.queryByText("Columns")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("kim:columns:adminReferrers") ?? "[]")).toEqual(["name", "family_limit"]);
  });

  it("dispatches custom event on Apply so other hook instances sync", async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    window.addEventListener("kim:column-visibility-change", handler);

    render(<ColumnToggle resourceKey="adminReferrers" />);

    const button = screen.getByLabelText("Toggle columns");
    await user.click(button);

    const phoneCheckbox = screen.getByLabelText("Phone");
    await user.click(phoneCheckbox);

    const applyButton = screen.getByRole("button", { name: "Apply" });
    await user.click(applyButton);

    expect(handler).toHaveBeenCalledTimes(1);
    const callArg = handler.mock.calls[0]![0] as CustomEvent<{ resourceKey: string; columns: string[] }>;
    const detail = callArg.detail;
    expect(detail.resourceKey).toBe("adminReferrers");
    expect(detail.columns).toContain("phone_number");

    window.removeEventListener("kim:column-visibility-change", handler);
  });

  it("shows width buttons in the dropdown", async () => {
    const user = userEvent.setup();
    render(<ColumnToggle resourceKey="adminReferrers" />);

    const button = screen.getByLabelText("Toggle columns");
    await user.click(button);

    expect(screen.getByText("Width")).toBeInTheDocument();
    expect(screen.getByText("Fit")).toBeInTheDocument();
    expect(screen.getByText("Compact")).toBeInTheDocument();
    expect(screen.getByText("Wide")).toBeInTheDocument();
    expect(screen.getByText("Full")).toBeInTheDocument();
  });

  it("stages width change and applies on Apply click", async () => {
    const user = userEvent.setup();
    render(<ColumnToggle resourceKey="adminReferrers" />);

    const button = screen.getByLabelText("Toggle columns");
    await user.click(button);

    // Select "Wide" width
    const wideButton = screen.getByText("Wide");
    await user.click(wideButton);

    // Width should NOT be persisted yet
    expect(localStorage.getItem("kim:tableWidth:adminReferrers")).not.toBe("wide");

    const applyButton = screen.getByRole("button", { name: "Apply" });
    await user.click(applyButton);

    expect(localStorage.getItem("kim:tableWidth:adminReferrers")).toBe("wide");
  });

  it("dispatches width change event on Apply", async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    window.addEventListener("kim:table-width-change", handler);

    render(<ColumnToggle resourceKey="adminReferrers" />);

    const button = screen.getByLabelText("Toggle columns");
    await user.click(button);

    const fitButton = screen.getByText("Fit");
    await user.click(fitButton);

    const applyButton = screen.getByRole("button", { name: "Apply" });
    await user.click(applyButton);

    expect(handler).toHaveBeenCalledTimes(1);
    const callArg = handler.mock.calls[0]![0] as CustomEvent<{ resourceKey: string; mode: string }>;
    expect(callArg.detail.resourceKey).toBe("adminReferrers");
    expect(callArg.detail.mode).toBe("fit");

    window.removeEventListener("kim:table-width-change", handler);
  });
});
