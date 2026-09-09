import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeliverySlipItem } from "../types";
import { DeliverySlipsView } from "./DeliverySlips";

/* ------------------------------------------------------------------ */
// Fixtures
/* ------------------------------------------------------------------ */

const makeSlip = (overrides: Partial<DeliverySlipItem> = {}): DeliverySlipItem => ({
  id: 5,
  display_id: "3",
  family_name: "The Johnsons",
  address: "123 Main St",
  contact_name: "Alice Johnson",
  phone_number: "555-0100",
  ...overrides,
});

const renderView = (props: Partial<Parameters<typeof DeliverySlipsView>[0]> = {}) =>
  render(<DeliverySlipsView data={undefined} isError={false} error={null} emptyMessage="No verified families yet." {...props} />);

/* ------------------------------------------------------------------ */
// Tests
/* ------------------------------------------------------------------ */

describe("DeliverySlipsView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  // The width probe reads offsetWidth of the hidden measurement box, which
  // is always 0 in jsdom — mock it to simulate card content of a given width.
  const mockMeasuredWidth = (width: number) => vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(width);

  const gridStyle = (container: HTMLElement) => container.querySelector(".delivery-slip-list")?.getAttribute("style") ?? "";

  it("uses three columns for narrow cards", () => {
    mockMeasuredWidth(100);
    const { container } = renderView({ data: [makeSlip()] });

    expect(gridStyle(container)).toContain("repeat(3, minmax(0, max-content))");
  });

  it("drops to two columns when the longest card is too wide for three", () => {
    mockMeasuredWidth(300);
    const { container } = renderView({ data: [makeSlip()] });

    expect(gridStyle(container)).toContain("repeat(2, minmax(0, max-content))");
  });

  it("drops to one column when the longest card is too wide for two", () => {
    mockMeasuredWidth(500);
    const { container } = renderView({ data: [makeSlip()] });

    expect(gridStyle(container)).toContain("repeat(1, minmax(0, max-content))");
  });

  it("removes the width probe after measuring (no duplicated text in the DOM)", () => {
    mockMeasuredWidth(100);
    renderView({ data: [makeSlip()] });

    expect(document.querySelector(".delivery-slip-measure")).not.toBeInTheDocument();
    expect(screen.getAllByText("The Johnsons")).toHaveLength(1);
  });

  it("renders display ID, family, address, contact, and phone", () => {
    renderView({ data: [makeSlip()] });

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    expect(screen.getByText("123 Main St")).toBeInTheDocument();
    expect(screen.getByText("Alice Johnson")).toBeInTheDocument();
    expect(screen.getByText("555-0100")).toBeInTheDocument();
  });

  it("renders multiple slips", () => {
    renderView({
      data: [
        makeSlip(),
        makeSlip({
          id: 6,
          display_id: "4",
          family_name: "The Smiths",
          address: "456 Oak Ave",
          contact_name: "Bob Smith",
          phone_number: "555-0200",
        }),
      ],
    });

    expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    expect(screen.getByText("The Smiths")).toBeInTheDocument();
  });

  it("omits the phone line when phone_number is empty", () => {
    renderView({ data: [makeSlip({ phone_number: "" })] });

    expect(screen.getByText("The Johnsons")).toBeInTheDocument();
    expect(screen.queryByText("Phone:")).not.toBeInTheDocument();
  });

  it("shows the empty state with the provided message", () => {
    renderView({ data: [], emptyMessage: "No verified families without a delivery person yet." });

    expect(screen.getByText("No delivery slips found.")).toBeInTheDocument();
    expect(screen.getByText("No verified families without a delivery person yet.")).toBeInTheDocument();
  });

  it("shows the error state with API detail on failure", () => {
    const error = new Error("Request failed with status code 400") as Error & { response?: { data?: { detail?: string } } };
    error.response = { data: { detail: "Invalid scope parameter" } };
    renderView({ isError: true, error });

    expect(screen.getByText("Invalid scope parameter")).toBeInTheDocument();
  });

  it("shows the fallback message when the error has no detail", () => {
    renderView({ isError: true, error: new Error("Network Error") });

    expect(screen.getByText("Network Error")).toBeInTheDocument();
  });

  it("shows the fallback message when there is no error object", () => {
    renderView({ isError: true });

    expect(screen.getByText("Unable to load delivery slips. Please try again.")).toBeInTheDocument();
  });
});
