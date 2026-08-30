import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import ForgotPassword from "./ForgotPassword";

const wrap = (ui: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <ToastContainer>{ui}</ToastContainer>
    </MemoryRouter>
  );

describe("ForgotPassword", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the confirmation screen after a successful request", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "forgotPasswordRequest").mockResolvedValue({});

    wrap(<ForgotPassword />);

    await user.type(screen.getByLabelText(/Email/), "alice@example.com");
    await user.click(screen.getByRole("button", { name: "Send Reset Link" }));

    expect(await screen.findByText("Check Your Email")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(api.forgotPasswordRequest).toHaveBeenCalledWith("alice@example.com");
  });

  it("shows the API error message when the request fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "forgotPasswordRequest").mockRejectedValue({
      response: { data: { detail: "No account with that email." } },
    });

    wrap(<ForgotPassword />);

    await user.type(screen.getByLabelText(/Email/), "nobody@example.com");
    await user.click(screen.getByRole("button", { name: "Send Reset Link" }));

    expect(await screen.findByText("No account with that email.")).toBeInTheDocument();
    // Still on the form
    expect(screen.getByRole("button", { name: "Send Reset Link" })).toBeInTheDocument();
  });
});
