import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import ResetPassword from "./ResetPassword";

const wrap = (ui: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={["/reset-password/abc-token"]}>
      <Routes>
        <Route path="/reset-password/:token" element={<ToastContainer>{ui}</ToastContainer>} />
      </Routes>
    </MemoryRouter>
  );

describe("ResetPassword", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("rejects mismatched passwords without calling the API", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, "resetPasswordRequest").mockResolvedValue({});

    wrap(<ResetPassword />);

    await user.type(screen.getByLabelText(/New Password/), "password123");
    await user.type(screen.getByLabelText(/Confirm Password/), "different456");
    await user.click(screen.getByRole("button", { name: "Set Password" }));

    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("shows the success screen and passes the route token", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(api, "resetPasswordRequest").mockResolvedValue({});

    wrap(<ResetPassword />);

    await user.type(screen.getByLabelText(/New Password/), "password123");
    await user.type(screen.getByLabelText(/Confirm Password/), "password123");
    await user.click(screen.getByRole("button", { name: "Set Password" }));

    expect(await screen.findByText(/Password Set!/)).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith("abc-token", "password123");
  });

  it("shows the API error detail when the token is invalid", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "resetPasswordRequest").mockRejectedValue({
      response: { data: { detail: "Token expired." } },
    });

    wrap(<ResetPassword />);

    await user.type(screen.getByLabelText(/New Password/), "password123");
    await user.type(screen.getByLabelText(/Confirm Password/), "password123");
    await user.click(screen.getByRole("button", { name: "Set Password" }));

    expect(await screen.findByText("Token expired.")).toBeInTheDocument();
  });
});
