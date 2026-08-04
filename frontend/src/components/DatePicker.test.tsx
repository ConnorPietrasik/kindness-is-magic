import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatePicker } from "./DatePicker";

// Freeze timezone so datetime conversion is deterministic across environments
beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2025-06-15T12:00:00Z") });
});

/** Helper: find the datetime-local input within a container. */
function getPickerInput(container: HTMLElement) {
  return container.querySelector('input[type="datetime-local"]') as HTMLInputElement | null;
}

describe("DatePicker", () => {
  it("renders with a label", () => {
    render(<DatePicker label="Pickup Window" value={null} onChange={() => {}} />);
    expect(screen.getByLabelText("Pickup Window")).toBeInTheDocument();
  });

  it("renders with an optional label suffix", () => {
    render(<DatePicker label="Received At" isOptional value={null} onChange={() => {}} />);
    expect(screen.getByText(/Received At/)).toBeInTheDocument();
    expect(screen.getByText(/\(optional\)/)).toBeInTheDocument();
  });

  it("renders without a label when not provided", () => {
    const { container } = render(<DatePicker value={null} onChange={() => {}} />);
    expect(getPickerInput(container)).toBeInTheDocument();
    expect(container.querySelector("label")).toBeNull();
  });

  it("converts ISO UTC value to local datetime-local format", () => {
    const onChange = vi.fn();
    const { container } = render(<DatePicker label="Pickup" value="2025-03-20T16:00:00Z" onChange={onChange} />);

    const input = getPickerInput(container);
    expect(input).not.toBeNull();
    // Value should be in datetime-local format (YYYY-MM-DDTHH:MM) in local time
    expect(input!.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("shows empty input for null value", () => {
    const { container } = render(<DatePicker label="Pickup" value={null} onChange={() => {}} />);
    expect(getPickerInput(container)!.value).toBe("");
  });

  it("shows empty input for undefined value", () => {
    const { container } = render(<DatePicker label="Pickup" value={undefined} onChange={() => {}} />);
    expect(getPickerInput(container)!.value).toBe("");
  });

  it("calls onChange with converted ISO value on change event", () => {
    const onChange = vi.fn();
    const { container } = render(<DatePicker label="Pickup" value={null} onChange={onChange} />);

    const input = getPickerInput(container)!;
    fireEvent.change(input, { target: { value: "2025-07-04T09:30" } });

    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/));
  });

  it("calls onChange with empty string when cleared", () => {
    const onChange = vi.fn();
    const { container } = render(<DatePicker label="Pickup" value="2025-03-20T16:00:00Z" onChange={onChange} />);

    const input = getPickerInput(container)!;
    fireEvent.change(input, { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("shows error message when provided", () => {
    render(<DatePicker label="Pickup" value={null} onChange={() => {}} error="Date is required" />);
    expect(screen.getByText("Date is required")).toBeInTheDocument();
  });

  it("renders as disabled when disabled prop is true", () => {
    const { container } = render(<DatePicker label="Pickup" value={null} onChange={() => {}} disabled />);
    expect(getPickerInput(container)!).toBeDisabled();
  });
});
