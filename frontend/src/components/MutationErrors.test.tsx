import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import { MutationErrors } from "./MutationErrors";

function makeMock(error?: unknown) {
  return { error: error ?? null };
}

function renderWithToasts(ui: React.ReactElement) {
  return render(<ToastContainer>{ui}</ToastContainer>);
}

describe("MutationErrors", () => {
  /* ── No errors ──────────────────────────────────────────── */

  it("renders nothing when no mutations have errors", () => {
    const mutations = [makeMock(), makeMock()];

    renderWithToasts(<MutationErrors mutations={mutations} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders nothing when mutations array is empty", () => {
    renderWithToasts(<MutationErrors mutations={[]} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /* ── Single error ───────────────────────────────────────── */

  it("shows a toast for a mutation with an error", () => {
    const mutations = [makeMock({ message: "Network error" })];

    renderWithToasts(<MutationErrors mutations={mutations} />);

    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("uses default fallback when error has no extractable message", () => {
    const mutations = [makeMock({})];

    renderWithToasts(<MutationErrors mutations={mutations} />);

    expect(screen.getByText("Request failed.")).toBeInTheDocument();
  });

  /* ── Multiple errors ────────────────────────────────────── */

  it("shows toasts for multiple mutations with errors", () => {
    const mutations = [
      makeMock({ response: { data: { detail: "Create failed" } } }),
      makeMock({ response: { data: { detail: "Delete failed" } } }),
    ];

    renderWithToasts(<MutationErrors mutations={mutations} />);

    expect(screen.getByText("Create failed")).toBeInTheDocument();
    expect(screen.getByText("Delete failed")).toBeInTheDocument();
  });

  it("skips mutations without errors when some have errors", () => {
    const mutations = [
      makeMock({ response: { data: { detail: "First error" } } }),
      makeMock(),
      makeMock({ response: { data: { detail: "Third error" } } }),
    ];

    renderWithToasts(<MutationErrors mutations={mutations} />);

    expect(screen.getByText("First error")).toBeInTheDocument();
    expect(screen.getByText("Third error")).toBeInTheDocument();
  });

  /* ── Custom fallback ────────────────────────────────────── */

  it("uses custom fallback message", () => {
    const mutations = [makeMock({})];

    renderWithToasts(<MutationErrors mutations={mutations} fallback="Custom fallback message" />);

    expect(screen.getByText("Custom fallback message")).toBeInTheDocument();
  });

  /* ── Error formatting via formatApiError ────────────────── */

  it("formats Axios error with detail field", () => {
    const mutations = [makeMock({ response: { data: { detail: "Validation error: email required" } } })];

    renderWithToasts(<MutationErrors mutations={mutations} />);

    expect(screen.getByText("Validation error: email required")).toBeInTheDocument();
  });

  it("formats Axios error with msg field", () => {
    const mutations = [makeMock({ response: { data: { msg: "Could not log in" } } })];

    renderWithToasts(<MutationErrors mutations={mutations} />);

    expect(screen.getByText("Could not log in")).toBeInTheDocument();
  });

  it("formats plain error with message property", () => {
    const mutations = [makeMock(new Error("Something broke"))];

    renderWithToasts(<MutationErrors mutations={mutations} />);

    expect(screen.getByText("Something broke")).toBeInTheDocument();
  });
});
