import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import * as api from "../lib/api";
import { AdminEmailComposer } from "./AdminEmailComposer";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function wrap(props: Partial<React.ComponentProps<typeof AdminEmailComposer>> = {}) {
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ToastContainer>
        <AdminEmailComposer open onClose={onClose} {...props} />
      </ToastContainer>
    </QueryClientProvider>
  );
  return { onClose, ...utils };
}

async function fillAndSend(
  user: ReturnType<typeof userEvent.setup>,
  values: { recipient?: string; subject?: string; message?: string } = {}
) {
  const { recipient = "rec@example.com", subject = "Hi there", message = "Body text" } = values;
  await user.type(screen.getByLabelText("Recipient"), recipient);
  if (subject) await user.type(screen.getByLabelText("Subject (optional)"), subject);
  await user.type(screen.getByLabelText("Message"), message);
  await user.click(screen.getByRole("button", { name: "Send" }));
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("AdminEmailComposer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders nothing when closed", () => {
    wrap({ open: false });
    expect(screen.queryByText("Send email")).not.toBeInTheDocument();
  });

  it("prefills the recipient and shows the context label when provided", () => {
    wrap({ prefilledRecipient: "prefilled@example.com", contextLabel: "Family 2-1 — The Johnsons" });

    expect(screen.getByLabelText("Recipient")).toHaveValue("prefilled@example.com");
    expect(screen.getByText("Family 2-1 — The Johnsons")).toBeInTheDocument();
  });

  it("leaves the recipient blank without a prefill", () => {
    wrap();
    expect(screen.getByLabelText("Recipient")).toHaveValue("");
  });

  it("submits the trimmed recipient, subject, and message", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminSendCustomEmail").mockResolvedValue({ sent: true, reason: null });

    wrap();

    await fillAndSend(user, {
      recipient: "  Rec@Example.COM ",
      subject: "  Hi there  ",
      message: "Line one\n\nLine two",
    });

    // Recipient is trimmed client-side; case/lowercasing happens server-side
    await waitFor(() => {
      expect(api.adminSendCustomEmail).toHaveBeenCalledWith({
        recipient_email: "Rec@Example.COM",
        subject: "  Hi there  ",
        message: "Line one\n\nLine two",
      });
    });
  });

  it("sends a blank subject as-is (the api function converts it to null)", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminSendCustomEmail").mockResolvedValue({ sent: true, reason: null });

    wrap();

    await fillAndSend(user, { subject: "" });

    await waitFor(() => {
      expect(api.adminSendCustomEmail).toHaveBeenCalledWith({
        recipient_email: "rec@example.com",
        subject: "",
        message: "Body text",
      });
    });
  });

  it("success: shows a success toast and closes", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminSendCustomEmail").mockResolvedValue({ sent: true, reason: null });
    const { onClose } = wrap();

    await fillAndSend(user);

    await waitFor(() => {
      expect(screen.getByText("Email sent")).toBeInTheDocument();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("unsubscribed result: info toast explaining the skipped send, and closes", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminSendCustomEmail").mockResolvedValue({ sent: false, reason: "unsubscribed" });
    const { onClose } = wrap();

    await fillAndSend(user);

    await waitFor(() => {
      expect(screen.getByText(/Send skipped — the recipient has unsubscribed/)).toBeInTheDocument();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("request failure: error toast from the API error, dialog stays open", async () => {
    const user = userEvent.setup();
    const apiError = Object.assign(new Error("Unprocessable Entity"), {
      response: { status: 422, data: { detail: "message must not be blank" } },
    });
    vi.spyOn(api, "adminSendCustomEmail").mockRejectedValue(apiError);
    const { onClose } = wrap();

    await fillAndSend(user);

    await waitFor(() => {
      expect(screen.getByText("message must not be blank")).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
    // Still open — the admin can fix and retry
    expect(screen.getByLabelText("Recipient")).toBeInTheDocument();
  });

  it("disables Send until both recipient and message are present", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminSendCustomEmail").mockResolvedValue({ sent: true, reason: null });
    wrap();

    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();

    await user.type(screen.getByLabelText("Recipient"), "rec@example.com");
    expect(send).toBeDisabled();

    await user.type(screen.getByLabelText("Message"), "Body text");
    expect(send).toBeEnabled();
  });

  it("live preview shows the recipient meta line and message paragraphs", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminSendCustomEmail").mockResolvedValue({ sent: true, reason: null });
    wrap();

    await user.type(screen.getByLabelText("Recipient"), "rec@example.com");
    await user.type(screen.getByLabelText("Message"), "First paragraph\n\nSecond paragraph");

    // Default subject shown while the subject field is blank
    expect(screen.getByText("To: rec@example.com — Subject: A message from Kindness Is Magic ✨")).toBeInTheDocument();
    expect(screen.getByText("First paragraph")).toBeInTheDocument();
    expect(screen.getByText("Second paragraph")).toBeInTheDocument();
  });
});
