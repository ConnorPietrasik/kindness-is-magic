import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorBox } from "./ErrorBox";

describe("ErrorBox", () => {
  /* ── Error variant (default) ────────────────────────────── */

  it("renders message with error variant by default", () => {
    render(<ErrorBox message="Something went wrong" />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("applies error styling classes by default", () => {
    const { container } = render(<ErrorBox message="Error" />);

    const box = container.firstChild;
    expect(box).toHaveAttribute("class");
    expect((box as Element).className).toContain("bg-red-50");
    expect((box as Element).className).toContain("text-red-700");
    expect((box as Element).className).toContain("border-red-200");
  });

  /* ── Success variant ────────────────────────────────────── */

  it("renders message with success variant", () => {
    render(<ErrorBox variant="success" message="Saved successfully" />);

    expect(screen.getByText("Saved successfully")).toBeInTheDocument();
  });

  it("applies success styling classes", () => {
    const { container } = render(<ErrorBox variant="success" message="Saved" />);

    const box = container.firstChild;
    expect((box as Element).className).toContain("bg-green-50");
    expect((box as Element).className).toContain("text-green-700");
    expect((box as Element).className).toContain("border-green-200");
  });

  /* ── Info variant ───────────────────────────────────────── */

  it("renders message with info variant", () => {
    render(<ErrorBox variant="info" message="Here is some info" />);

    expect(screen.getByText("Here is some info")).toBeInTheDocument();
  });

  it("applies info styling classes", () => {
    const { container } = render(<ErrorBox variant="info" message="Info" />);

    const box = container.firstChild;
    expect((box as Element).className).toContain("bg-sky-50");
    expect((box as Element).className).toContain("text-sky-700");
    expect((box as Element).className).toContain("border-sky-200");
  });

  /* ── Unknown variant fallback ───────────────────────────── */

  it("falls back to error styling for unknown variant", () => {
    const { container } = render(<ErrorBox variant={"warning" as "error" | "success" | "info"} message="Warning" />);

    const box = container.firstChild;
    expect((box as Element).className).toContain("bg-red-50");
    expect((box as Element).className).toContain("text-red-700");
  });

  /* ── Extra className ────────────────────────────────────── */

  it("applies extra className alongside base classes", () => {
    const { container } = render(<ErrorBox message="Error" className="my-custom-class" />);

    const box = container.firstChild;
    expect((box as Element).className).toContain("my-custom-class");
    expect((box as Element).className).toContain("rounded-lg");
  });
});
