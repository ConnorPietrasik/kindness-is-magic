import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalBadge } from "./ApprovalBadge";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ApprovalBadge", () => {
  it("renders 'approved' with green styling", () => {
    render(<ApprovalBadge status="approved" />);
    const badge = screen.getByText("approved");
    expect(badge).toHaveClass("bg-green-100", "text-green-700");
  });

  it("renders 'verified' with green styling", () => {
    render(<ApprovalBadge status="verified" />);
    const badge = screen.getByText("verified");
    expect(badge).toHaveClass("bg-green-100", "text-green-700");
  });

  it("renders 'pending' with amber styling", () => {
    render(<ApprovalBadge status="pending" />);
    const badge = screen.getByText("pending");
    expect(badge).toHaveClass("bg-amber-100", "text-amber-700");
  });

  it("renders 'rejected' with red styling", () => {
    render(<ApprovalBadge status="rejected" />);
    const badge = screen.getByText("rejected");
    expect(badge).toHaveClass("bg-red-100", "text-red-700");
  });
});
