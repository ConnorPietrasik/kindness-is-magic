import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PhoneInput } from "./PhoneInput";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PhoneInput", () => {
  it("renders the input with label", () => {
    const onChange = vi.fn();
    render(<PhoneInput value="" onChange={onChange} />);
    expect(screen.getByLabelText("Phone Number")).toBeInTheDocument();
  });

  it("displays raw digits as-is when fewer than 4", () => {
    const onChange = vi.fn();
    render(<PhoneInput value="55" onChange={onChange} />);
    expect(screen.getByLabelText("Phone Number")).toHaveValue("55");
  });

  it("formats 4-6 digits as NNN-NNN", () => {
    const onChange = vi.fn();
    render(<PhoneInput value="555123" onChange={onChange} />);
    expect(screen.getByLabelText("Phone Number")).toHaveValue("555-123");
  });

  it("formats 7-9 digits as NNN-NNN-NNN", () => {
    const onChange = vi.fn();
    render(<PhoneInput value="555123456" onChange={onChange} />);
    expect(screen.getByLabelText("Phone Number")).toHaveValue("555-123-456");
  });

  it("formats 10 digits as NNN-NNN-NNNN", () => {
    const onChange = vi.fn();
    render(<PhoneInput value="5551234567" onChange={onChange} />);
    expect(screen.getByLabelText("Phone Number")).toHaveValue("555-123-4567");
  });

  it("formats more than 10 digits (country code prefix)", () => {
    const onChange = vi.fn();
    render(<PhoneInput value="15551234567" onChange={onChange} />);
    expect(screen.getByLabelText("Phone Number")).toHaveValue("155-512-3456");
  });

  it("strips non-digit characters from display value", () => {
    const onChange = vi.fn();
    render(<PhoneInput value="(555) 123-4567" onChange={onChange} />);
    expect(screen.getByLabelText("Phone Number")).toHaveValue("555-123-4567");
  });

  it("shows the helper text about 10 digits required", () => {
    const onChange = vi.fn();
    render(<PhoneInput value="" onChange={onChange} />);
    expect(screen.getByText("10 digits required. Dashes are added automatically.")).toBeInTheDocument();
  });

  it("shows error when provided", () => {
    const onChange = vi.fn();
    render(<PhoneInput value="" onChange={onChange} error="Phone number is required" />);
    expect(screen.getByText("Phone number is required")).toBeInTheDocument();
  });

  it("renders with inputMode numeric for mobile keyboards", () => {
    const onChange = vi.fn();
    render(<PhoneInput value="" onChange={onChange} />);
    expect(screen.getByLabelText("Phone Number")).toHaveAttribute("inputMode", "numeric");
  });

  it("renders with autoComplete tel", () => {
    const onChange = vi.fn();
    render(<PhoneInput value="" onChange={onChange} />);
    expect(screen.getByLabelText("Phone Number")).toHaveAttribute("autoComplete", "tel");
  });
});
