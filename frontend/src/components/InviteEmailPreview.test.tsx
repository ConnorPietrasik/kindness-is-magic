import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InviteEmailPreview, type InviteEmailPreviewProps } from "./InviteEmailPreview";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function renderPreview(overrides: Partial<InviteEmailPreviewProps> = {}) {
  return render(<InviteEmailPreview message="" familyLimit={5} email={null} inviterName={null} {...overrides} />);
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("InviteEmailPreview", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the default prose when the message is blank", () => {
    const { container } = renderPreview();
    const text = container.textContent ?? "";
    expect(text).toContain("You're invited to help make a difference with");
    expect(text).toContain("We'd love your help connecting");
    expect(text).toContain("you'll be able to connect up to");
    expect(text).toContain("Thank you for being part of something wonderful");
  });

  it("uses the named greeting when inviterName is set", () => {
    const { container } = renderPreview({ inviterName: "Jane Admin" });
    const text = container.textContent ?? "";
    expect(text).toContain("You've been invited by Jane Admin to help make a difference with");
    expect(screen.queryByText(/You're invited to help make a difference/)).not.toBeInTheDocument();
  });

  it("uses the generic greeting when inviterName is null", () => {
    const { container } = renderPreview({ inviterName: null });
    const text = container.textContent ?? "";
    expect(text).toContain("You're invited to help make a difference with");
    expect(text).not.toContain("You've been invited by");
  });

  it("replaces the default prose with a custom message", () => {
    const { container } = renderPreview({ message: "Welcome to the magic!" });
    const text = container.textContent ?? "";
    expect(text).toContain("Welcome to the magic!");
    expect(text).not.toContain("We'd love your help connecting");
    expect(text).not.toContain("you'll be able to connect up to");
    expect(text).not.toContain("Thank you for being part of something wonderful");
  });

  it("splits custom-message paragraphs on blank lines", () => {
    const { container } = renderPreview({ message: "First paragraph\n\nSecond paragraph" });
    const paragraphs = Array.from(container.querySelectorAll("p")).map((p) => p.textContent);
    expect(paragraphs).toContain("First paragraph");
    expect(paragraphs).toContain("Second paragraph");
  });

  it("keeps single newlines as line breaks within a paragraph", () => {
    const { container } = renderPreview({ message: "Timeline:\n- Monday: intro call\n- Tuesday: visit" });
    const para = Array.from(container.querySelectorAll("p")).find((p) => p.textContent?.startsWith("Timeline:"));
    expect(para).toBeDefined();
    expect(para!.innerHTML).toBe("Timeline:<br>- Monday: intro call<br>- Tuesday: visit");
  });

  it("normalizes Windows line endings before splitting paragraphs", () => {
    const { container } = renderPreview({ message: "Line one\r\n\r\nLine two" });
    const paragraphs = Array.from(container.querySelectorAll("p")).map((p) => p.textContent);
    expect(paragraphs).toContain("Line one");
    expect(paragraphs).toContain("Line two");
  });

  it("always shows the KRI-XXXXXX placeholder code", () => {
    const { rerender } = renderPreview({ message: "Custom" });
    expect(screen.getByText("KRI-XXXXXX")).toBeInTheDocument();
    rerender(<InviteEmailPreview message="" familyLimit={5} email={null} inviterName={null} />);
    expect(screen.getByText("KRI-XXXXXX")).toBeInTheDocument();
  });

  it("shows the locked-email note only when an email is set", () => {
    const { container, rerender } = renderPreview({ email: "locked@example.com" });
    expect(container.textContent).toContain("This invite is locked to");
    expect(screen.getByText("locked@example.com")).toBeInTheDocument();

    rerender(<InviteEmailPreview message="" familyLimit={5} email={null} inviterName={null} />);
    expect(container.textContent).not.toContain("This invite is locked to");
  });

  it("shows the 7-day expiry line in both modes", () => {
    const { container, rerender } = renderPreview({ message: "Custom" });
    expect(container.textContent).toContain("This invite expires on 7 days from now.");
    rerender(<InviteEmailPreview message="" familyLimit={5} email={null} inviterName={null} />);
    expect(container.textContent).toContain("This invite expires on 7 days from now.");
  });

  it("uses the singular family word for a limit of 1", () => {
    const { container } = renderPreview({ familyLimit: 1 });
    const text = container.textContent ?? "";
    expect(text).toContain("connecting family in need");
    expect(text).toContain("connect up to 1 family");
    expect(text).not.toContain("families");
  });

  it("uses the plural family word for limits above 1", () => {
    const { container } = renderPreview({ familyLimit: 5 });
    const text = container.textContent ?? "";
    expect(text).toContain("connecting families in need");
    expect(text).toContain("connect up to 5 families");
  });

  it("omits the limit line and pluralizes the intro when the limit is empty", () => {
    const { container } = renderPreview({ familyLimit: null });
    const text = container.textContent ?? "";
    expect(text).not.toContain("you'll be able to connect up to");
    expect(text).toContain("connecting families in need");
  });
});
