import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FormField } from "./FormField";

describe("FormField", () => {
  /* ── Label rendering ────────────────────────────────────── */

  it("renders label with correct text and htmlFor", () => {
    render(<FormField label="Email" htmlFor="email" fieldProps={{ name: "email" }} />);

    const label = screen.getByLabelText("Email");
    expect(label).toHaveAttribute("id", "email");
    expect(screen.getByText("Email")).toBeInTheDocument();
  });

  it("auto-generates id when htmlFor is not provided", () => {
    const { container } = render(<FormField label="Name" fieldProps={{ name: "name" }} />);

    const input = container.querySelector("input");
    expect(input).toHaveAttribute("id");
    expect(input!.id).toBeTruthy();
    // Label should reference the auto-generated id
    const label = container.querySelector("label");
    expect(label).toHaveAttribute("for", input!.id);
  });

  it("uses explicit htmlFor when provided", () => {
    const { container } = render(<FormField label="Name" htmlFor="my-name" fieldProps={{ name: "name" }} />);

    const input = container.querySelector("input");
    expect(input).toHaveAttribute("id", "my-name");
  });

  it("hides label when label prop is falsy", () => {
    const { container } = render(<FormField fieldProps={{ name: "hidden" }} />);

    expect(container.querySelector("label")).not.toBeInTheDocument();
  });

  /* ── Element type (as prop) ─────────────────────────────── */

  it('renders input by default with type="text"', () => {
    const { container } = render(<FormField label="Text" fieldProps={{ name: "text" }} />);

    const input = container.querySelector("input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "text");
  });

  it('renders select when as="select"', () => {
    render(
      <FormField label="Choose" as="select" fieldProps={{ name: "choice" }}>
        <option value="a">A</option>
        <option value="b">B</option>
      </FormField>
    );

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it('renders textarea when as="textarea"', () => {
    const { container } = render(<FormField label="Notes" as="textarea" fieldProps={{ name: "notes" }} />);

    expect(container.querySelector("textarea")).toBeInTheDocument();
  });

  it("does not apply type attribute to select", () => {
    const { container } = render(
      <FormField label="Choose" as="select" type="text" fieldProps={{ name: "choice" }}>
        <option value="a">A</option>
      </FormField>
    );

    const select = container.querySelector("select");
    expect(select).not.toHaveAttribute("type");
  });

  it("does not apply type attribute to textarea", () => {
    const { container } = render(<FormField label="Notes" as="textarea" type="text" fieldProps={{ name: "notes" }} />);

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toHaveAttribute("type");
  });

  /* ── Custom type ────────────────────────────────────────── */

  it("renders input with custom type", () => {
    const { container } = render(<FormField label="Email" type="email" fieldProps={{ name: "email" }} />);

    expect(container.querySelector("input")).toHaveAttribute("type", "email");
  });

  /* ── fieldProps passthrough ─────────────────────────────── */

  it("passes through fieldProps to the input element", async () => {
    render(<FormField label="Username" htmlFor="username" fieldProps={{ name: "username", placeholder: "Enter name", required: true }} />);

    const input = screen.getByLabelText("Username");
    expect(input).toHaveAttribute("name", "username");
    expect(input).toHaveAttribute("placeholder", "Enter name");
    expect(input).toHaveAttribute("required");
  });

  it("supports controlled input behavior", async () => {
    const user = userEvent.setup();
    render(<FormField label="Value" htmlFor="val" fieldProps={{ name: "val", value: "hello", onChange: () => {} }} />);

    const input = screen.getByLabelText("Value");
    expect(input).toHaveValue("hello");

    await user.type(input, " world");
    // Value is controlled so it stays 'hello' (onChange is a no-op)
    expect(input).toHaveValue("hello");
  });

  /* ── className handling ─────────────────────────────────── */

  it("applies extra className from fieldProps alongside base classes", () => {
    const { container } = render(<FormField label="Styled" fieldProps={{ name: "styled", className: "my-custom-class" }} />);

    const input = container.querySelector("input");
    expect((input as Element).className).toContain("my-custom-class");
    // Base classes should still be present
    expect((input as Element).className).toContain("rounded-lg");
  });

  it("applies wrapper className", () => {
    const { container } = render(<FormField label="Wrapped" className="wrapper-class" fieldProps={{ name: "wrapped" }} />);

    expect(container.firstChild).toHaveAttribute("class", "wrapper-class");
  });
});
