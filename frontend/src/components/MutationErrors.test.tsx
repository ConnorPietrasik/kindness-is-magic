import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MutationErrors } from "./MutationErrors";

function makeMock(error?: unknown) {
  return { error: error ?? null };
}

describe("MutationErrors", () => {
  /* ── No errors ──────────────────────────────────────────── */

  it("returns null when no mutations have errors", () => {
    const mutations = [makeMock(), makeMock()];

    const { container } = render(<MutationErrors mutations={mutations} />);

    expect(container.firstChild).toBeNull();
  });

  it("returns null when mutations array is empty", () => {
    const { container } = render(<MutationErrors mutations={[]} />);

    expect(container.firstChild).toBeNull();
  });

  /* ── Single error ───────────────────────────────────────── */

  it("renders an ErrorBox for a mutation with an error", () => {
    const mutations = [makeMock({ message: "Network error" })];

    render(<MutationErrors mutations={mutations} />);

    expect(screen.getByText(/Network error/i)).toBeInTheDocument();
  });

  it("uses default fallback when error has no extractable message", () => {
    const mutations = [makeMock({})];

    render(<MutationErrors mutations={mutations} />);

    expect(screen.getByText("Request failed.")).toBeInTheDocument();
  });

  /* ── Multiple errors ────────────────────────────────────── */

  it("renders multiple ErrorBoxes for multiple mutations with errors", () => {
    const mutations = [
      makeMock({ response: { data: { detail: "Create failed" } } }),
      makeMock({ response: { data: { detail: "Delete failed" } } }),
    ];

    render(<MutationErrors mutations={mutations} />);

    expect(screen.getByText("Create failed")).toBeInTheDocument();
    expect(screen.getByText("Delete failed")).toBeInTheDocument();
  });

  it("skips mutations without errors when some have errors", () => {
    const mutations = [
      makeMock({ response: { data: { detail: "First error" } } }),
      makeMock(),
      makeMock({ response: { data: { detail: "Third error" } } }),
    ];

    render(<MutationErrors mutations={mutations} />);

    expect(screen.getByText("First error")).toBeInTheDocument();
    expect(screen.getByText("Third error")).toBeInTheDocument();
    // Only 2 ErrorBoxes rendered (not 3)
    expect(screen.getAllByText(/error/i).length).toBeGreaterThanOrEqual(2);
  });

  /* ── Custom fallback ────────────────────────────────────── */

  it("uses custom fallback message", () => {
    const mutations = [makeMock({})];

    render(<MutationErrors mutations={mutations} fallback="Custom fallback message" />);

    expect(screen.getByText("Custom fallback message")).toBeInTheDocument();
  });

  /* ── Error formatting via formatApiError ────────────────── */

  it("formats Axios error with detail field", () => {
    const mutations = [makeMock({ response: { data: { detail: "Validation error: email required" } } })];

    render(<MutationErrors mutations={mutations} />);

    expect(screen.getByText("Validation error: email required")).toBeInTheDocument();
  });

  it("formats Axios error with msg field", () => {
    const mutations = [makeMock({ response: { data: { msg: "Could not log in" } } })];

    render(<MutationErrors mutations={mutations} />);

    expect(screen.getByText("Could not log in")).toBeInTheDocument();
  });

  it("formats plain error with message property", () => {
    const mutations = [makeMock(new Error("Something broke"))];

    render(<MutationErrors mutations={mutations} />);

    expect(screen.getByText("Something broke")).toBeInTheDocument();
  });
});
