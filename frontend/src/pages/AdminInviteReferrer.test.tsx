import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";
import type { ReferrerInviteResponse } from "../types";
import AdminInviteReferrer from "./AdminInviteReferrer";

const mockInvite: ReferrerInviteResponse = {
  code: "KMG-A7X9P2",
  family_limit: 10,
  expires_at: "2025-01-15T12:00:00Z",
  created_at: "2025-01-14T12:00:00Z",
};

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("AdminInviteReferrer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders the form with family limit field", () => {
    wrap(<AdminInviteReferrer />);
    expect(screen.getByLabelText("Family Limit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Invite Code" })).toBeInTheDocument();
  });

  it("shows validation error for family limit over 999", async () => {
    const user = userEvent.setup();
    const { container } = wrap(<AdminInviteReferrer />);

    await user.type(screen.getByLabelText("Family Limit"), "1000");
    fireEvent.submit(container.querySelector("form")!);

    expect(screen.getByText("Family limit must be between 1 and 999.")).toBeInTheDocument();
  });

  it("calls createReferrerInvite and displays the invite on success", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "createReferrerInvite").mockResolvedValue(mockInvite);
    const { container } = wrap(<AdminInviteReferrer />);

    await user.type(screen.getByLabelText("Family Limit"), "10");
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => {
      expect(screen.getByText("KMG-A7X9P2")).toBeInTheDocument();
    });

    expect(api.createReferrerInvite).toHaveBeenCalledWith({ family_limit: 10 });
    expect(screen.getByText("Invite Code Generated")).toBeInTheDocument();
  });

  it("shows error message when API call fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "createReferrerInvite").mockRejectedValue({
      response: { data: { detail: "Server error" } },
    });
    const { container } = wrap(<AdminInviteReferrer />);

    await user.type(screen.getByLabelText("Family Limit"), "5");
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });
  });

  it("shows loading state on submit button", async () => {
    const user = userEvent.setup();
    let resolve: () => void;
    vi.spyOn(api, "createReferrerInvite").mockReturnValue(
      new Promise((res) => {
        resolve = () => res(mockInvite);
      })
    );
    const { container } = wrap(<AdminInviteReferrer />);

    await user.type(screen.getByLabelText("Family Limit"), "10");
    fireEvent.submit(container.querySelector("form")!);

    expect(screen.getByText("Generating…")).toBeInTheDocument();

    resolve!();
  });

  it("shows a link back to dashboard", () => {
    wrap(<AdminInviteReferrer />);
    expect(screen.getByText("← Back to dashboard")).toBeInTheDocument();
  });
});
