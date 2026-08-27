import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { PageError } from "./PageError";

/** Builds an axios-style error with an optional response payload. */
function makeError(detail: unknown, message = "Request failed with status code 404") {
  const error = new Error(message) as Error & { response?: { data?: { detail?: unknown } } };
  error.response = { data: { detail } };
  return error;
}

const defaultProps = {
  heading: "Unable to Load Wish List",
  fallback: "This wish list doesn't exist or has been removed.",
} as const;

const renderPageError = (props: Partial<typeof defaultProps> & { error?: unknown; to?: string; linkLabel?: string } = {}) =>
  render(
    <MemoryRouter>
      <PageError error={makeError("Family not found")} {...defaultProps} {...props} />
    </MemoryRouter>
  );

describe("PageError", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the heading and the API error detail", () => {
    renderPageError();

    expect(screen.getByRole("heading", { name: "Unable to Load Wish List" })).toBeInTheDocument();
    expect(screen.getByText("Family not found")).toBeInTheDocument();
  });

  it("does not show the fallback when a detail is present", () => {
    renderPageError();

    expect(screen.queryByText(defaultProps.fallback)).not.toBeInTheDocument();
  });

  it("shows the error message for network errors without a response", () => {
    renderPageError({ error: new Error("Network Error") });

    expect(screen.getByText("Network Error")).toBeInTheDocument();
  });

  it("shows the fallback when there is no error at all", () => {
    renderPageError({ error: undefined });

    expect(screen.getByText(defaultProps.fallback)).toBeInTheDocument();
  });

  it("renders a back link when `to` is provided", () => {
    renderPageError({ to: "/families", linkLabel: "← Back to home" });

    expect(screen.getByRole("link", { name: "← Back to home" })).toHaveAttribute("href", "/families");
  });

  it("uses the default link label", () => {
    renderPageError({ to: "/families" });

    expect(screen.getByRole("link", { name: "← Back" })).toHaveAttribute("href", "/families");
  });

  it("renders no link without `to`", () => {
    renderPageError();

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
