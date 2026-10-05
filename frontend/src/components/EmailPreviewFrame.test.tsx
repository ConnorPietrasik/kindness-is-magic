import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmailPreviewFrame } from "./EmailPreviewFrame";

describe("EmailPreviewFrame", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the branded header, body content, and unsubscribe footer", () => {
    render(<EmailPreviewFrame>Body text</EmailPreviewFrame>);
    expect(screen.getByText("Kindness Is Magic")).toBeInTheDocument();
    expect(screen.getByText("Body text")).toBeInTheDocument();
    expect(screen.getByText(/click here to unsubscribe/)).toBeInTheDocument();
  });

  it("hides the meta line when `to` is not provided (even with a subject)", () => {
    render(
      <EmailPreviewFrame to={null} subject="A subject">
        Body
      </EmailPreviewFrame>
    );
    expect(screen.queryByText(/To: /)).not.toBeInTheDocument();
    expect(screen.queryByText(/Subject: /)).not.toBeInTheDocument();
  });

  it("shows To and Subject in a single text node when `to` is provided", () => {
    render(
      <EmailPreviewFrame to="locked@example.com" subject="The subject">
        Body
      </EmailPreviewFrame>
    );
    // Single text node — no separate element holding exactly the bare address
    expect(screen.queryByText("locked@example.com")).not.toBeInTheDocument();
    expect(screen.getByText("To: locked@example.com — Subject: The subject")).toBeInTheDocument();
  });

  it("shows only To when the subject is blank", () => {
    render(
      <EmailPreviewFrame to="a@example.com" subject="">
        Body
      </EmailPreviewFrame>
    );
    expect(screen.getByText("To: a@example.com")).toBeInTheDocument();
  });
});
