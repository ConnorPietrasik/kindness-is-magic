import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InfoRow } from "./InfoRow";

describe("InfoRow", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders label and value", () => {
    render(<InfoRow label="Family Name" value="The Johnsons" />);
    expect(screen.getByText("Family Name")).toBeInTheDocument();
    expect(screen.getByText("The Johnsons")).toBeInTheDocument();
  });

  it("renders an em dash for null and undefined values", () => {
    const { rerender } = render(<InfoRow label="Bio" value={null} />);
    expect(screen.getByText("\u2014")).toBeInTheDocument();

    rerender(<InfoRow label="Bio" value={undefined} />);
    expect(screen.getByText("\u2014")).toBeInTheDocument();
  });

  it("does not truncate by default", () => {
    render(<InfoRow label="Address" value="A long address that would otherwise be clamped" />);
    const value = screen.getByText("A long address that would otherwise be clamped");
    expect(value.classList.contains("max-w-[60%]")).toBe(false);
    expect(value.classList.contains("text-right")).toBe(false);
  });

  it("clamps long values when truncate is set", () => {
    render(<InfoRow label="Address" value="x" truncate />);
    const value = screen.getByText("x");
    expect(value.classList.contains("max-w-[60%]")).toBe(true);
    expect(value.classList.contains("text-right")).toBe(true);
  });

  it("keeps the bottom border unless isLast is set", () => {
    const { rerender } = render(<InfoRow label="A" value="1" />);
    const row = screen.getByText("A").parentElement;
    expect(row).toHaveClass("border-b");

    rerender(<InfoRow label="A" value="1" isLast />);
    expect(screen.getByText("A").parentElement).not.toHaveClass("border-b");
  });

  it("accepts ReactNode values (e.g. badges)", () => {
    render(
      <InfoRow
        label="Status"
        value={
          <span className="rounded-full bg-blue-100" data-testid="badge">
            active
          </span>
        }
      />
    );
    expect(screen.getByTestId("badge")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });
});
