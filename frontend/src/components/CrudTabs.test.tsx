import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrudTabs } from "./CrudTabs";

describe("CrudTabs", () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    viewTab: "active" as const,
    onChange: vi.fn(),
  };

  /* ── Rendering ──────────────────────────────────────────── */

  it("renders Active and Deleted tab buttons", () => {
    render(<CrudTabs {...defaultProps} />);

    expect(screen.getByRole("tab", { name: "Active" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Deleted" })).toBeInTheDocument();
  });

  it("renders a tablist container", () => {
    render(<CrudTabs {...defaultProps} />);

    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  /* ── aria-selected ──────────────────────────────────────── */

  it("marks active tab as aria-selected when viewTab is 'active'", () => {
    render(<CrudTabs {...defaultProps} viewTab="active" />);

    expect(screen.getByRole("tab", { name: "Active" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Deleted" })).toHaveAttribute("aria-selected", "false");
  });

  it("marks deleted tab as aria-selected when viewTab is 'deleted'", () => {
    render(<CrudTabs {...defaultProps} viewTab="deleted" />);

    expect(screen.getByRole("tab", { name: "Active" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Deleted" })).toHaveAttribute("aria-selected", "true");
  });

  /* ── Click handlers ─────────────────────────────────────── */

  it("calls onChange('deleted') when Deleted tab is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CrudTabs viewTab="active" onChange={onChange} />);

    await user.click(screen.getByRole("tab", { name: "Deleted" }));
    expect(onChange).toHaveBeenCalledWith("deleted");
  });

  it("calls onChange('active') when Active tab is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CrudTabs viewTab="deleted" onChange={onChange} />);

    await user.click(screen.getByRole("tab", { name: "Active" }));
    expect(onChange).toHaveBeenCalledWith("active");
  });

  it("does not call onChange when the already-selected tab is clicked again", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CrudTabs viewTab="active" onChange={onChange} />);

    await user.click(screen.getByRole("tab", { name: "Active" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
