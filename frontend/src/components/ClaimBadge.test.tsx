import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { ClaimBadge } from "./ClaimBadge";

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("ClaimBadge", () => {
  afterEach(() => cleanup());

  it("renders status and commitment type", () => {
    wrap(<ClaimBadge status="active" commitmentType="monthly" />);

    expect(screen.getByText("active — monthly")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders the donor name when provided", () => {
    wrap(<ClaimBadge status="active" commitmentType="monthly" donorName="Donor Dan" />);

    expect(screen.getByText("active — monthly")).toBeInTheDocument();
    expect(screen.getByText("(Donor Dan)")).toBeInTheDocument();
  });

  it("links to the claim detail page when a claim id exists", () => {
    wrap(<ClaimBadge status="active" commitmentType="full" donorName="Donor Dan" claimId={5} />);

    const link = screen.getByRole("link", { name: /active — full/ });
    expect(link).toHaveAttribute("href", "/donor/claims/5");
    expect(link).toHaveTextContent("(Donor Dan)");
  });

  it("uses the fulfilled style for fulfilled claims", () => {
    wrap(<ClaimBadge status="fulfilled" commitmentType="full" />);

    expect(screen.getByText("fulfilled — full")).toHaveClass("bg-gray-100", "text-gray-600");
  });

  it("uses the active style for active claims", () => {
    wrap(<ClaimBadge status="active" commitmentType="full" />);

    expect(screen.getByText("active — full")).toHaveClass("bg-emerald-100", "text-emerald-800");
  });

  it("falls back to the default style for unknown statuses", () => {
    wrap(<ClaimBadge status="weird" commitmentType="full" />);

    expect(screen.getByText("weird — full")).toHaveClass("bg-blue-100", "text-blue-800");
  });
});
