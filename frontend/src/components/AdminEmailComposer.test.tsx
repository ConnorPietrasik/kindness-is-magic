import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import { MIN_PANEL_WIDTH, PARKED_PANEL_WIDTH } from "../hooks/useResizablePanel";
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

describe("AdminEmailComposer drawer behavior", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    localStorage.clear();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = wrap();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via the close button", async () => {
    const user = userEvent.setup();
    const { onClose } = wrap();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("yields Escape to a popup stacked on top (e.g. a confirm dialog)", async () => {
    const user = userEvent.setup();
    const { onClose } = wrap();
    const popup = render(<div role="alertdialog">Delete person?</div>);

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    // Once the popup is gone, Escape closes the drawer again
    popup.unmount();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a read-only context block under the title when provided", () => {
    wrap({ context: <p>Family wishes</p> });
    expect(screen.getByText("Family wishes")).toBeInTheDocument();
  });

  it("omits the context block when none is provided", () => {
    wrap();
    expect(screen.queryByText("Family wishes")).not.toBeInTheDocument();
  });

  // jsdom's default viewport is 1024px wide (at the lg breakpoint, so the
  // px width applies).
  function dragToWidth(px: number) {
    const handle = screen.getByRole("slider", { name: "Resize panel" });
    fireEvent.pointerDown(handle);
    fireEvent.pointerMove(window, { clientX: 1024 - px });
    fireEvent.pointerUp(window);
  }

  it("dragging the left edge resizes the drawer and persists the width", () => {
    wrap();
    const panel = screen.getByRole("dialog");
    // The default width is applied explicitly (single source of truth in the hook)
    expect(panel).toHaveStyle({ width: "520px" });

    dragToWidth(700);

    expect(panel).toHaveStyle({ width: "700px" });
    expect(localStorage.getItem("kim:emailComposerWidth")).toBe("700");
  });

  it("switches the form to two columns once the panel is wide enough", () => {
    wrap();
    const form = screen.getByRole("dialog").querySelector("form")!;
    expect(form).not.toHaveClass("grid-cols-2");

    dragToWidth(700);

    expect(form).toHaveClass("grid-cols-2");
  });

  it("double-clicking the handle resets to the default width", () => {
    wrap();
    const panel = screen.getByRole("dialog");

    dragToWidth(700);
    expect(panel).toHaveStyle({ width: "700px" });

    fireEvent.doubleClick(screen.getByRole("slider", { name: "Resize panel" }));

    expect(panel).toHaveStyle({ width: "520px" });
    expect(localStorage.getItem("kim:emailComposerWidth")).toBeNull();
  });

  it("arrow keys nudge the width when the handle is focused", () => {
    wrap();
    const panel = screen.getByRole("dialog");

    fireEvent.keyDown(screen.getByRole("slider", { name: "Resize panel" }), { key: "ArrowRight" });

    expect(panel).toHaveStyle({ width: `${520 + 16}px` });
  });

  /* ── Parking ──────────────────────────────────────────── */

  // Widen to 700 in its own drag, then park with a second gesture — so the
  // park keeps a non-default width to restore.
  function parkDrag() {
    const handle = screen.getByRole("slider", { name: "Resize panel" });
    fireEvent.pointerDown(handle);
    fireEvent.pointerMove(window, { clientX: 1024 - 700 });
    fireEvent.pointerUp(window, { clientX: 1024 - 700 });
    const armedX = 1024 - (MIN_PANEL_WIDTH - 24);
    fireEvent.pointerDown(handle);
    fireEvent.pointerMove(window, { clientX: armedX });
    fireEvent.pointerUp(window, { clientX: armedX });
  }

  it("hints while dragging past the min, then parks into the rail on release", () => {
    wrap();
    const panel = screen.getByRole("dialog");
    const handle = screen.getByRole("slider", { name: "Resize panel" });

    // Widen to 700 first, so the park gesture keeps a non-default width
    fireEvent.pointerDown(handle);
    fireEvent.pointerMove(window, { clientX: 1024 - 700 });
    fireEvent.pointerUp(window, { clientX: 1024 - 700 });

    fireEvent.pointerDown(handle);
    fireEvent.pointerMove(window, { clientX: 1024 - (MIN_PANEL_WIDTH - 8) }); // past the edge, inside the grace
    expect(screen.queryByText("Release to park")).not.toBeInTheDocument();

    fireEvent.pointerMove(window, { clientX: 1024 - (MIN_PANEL_WIDTH - 24) }); // armed
    expect(screen.getByText("Release to park")).toBeInTheDocument();
    expect(panel).toHaveStyle({ width: `${MIN_PANEL_WIDTH}px` }); // clamped while armed

    fireEvent.pointerUp(window, { clientX: 1024 - (MIN_PANEL_WIDTH - 24) });
    expect(panel).toHaveStyle({ width: `${PARKED_PANEL_WIDTH}px` });
    expect(screen.queryByText("Release to park")).not.toBeInTheDocument();
    // Focus moved to the handle so an arrow key restores immediately
    expect(handle).toHaveFocus();
    // The rail offers restore (its label) and close
    expect(screen.getByText("Send email")).toBeInTheDocument();
    // …and restoring brings back the pre-gesture width
    fireEvent.doubleClick(handle);
    expect(panel).toHaveStyle({ width: "700px" });
  });

  it("double-clicking the rail restores the pre-park width", () => {
    wrap();
    parkDrag();
    expect(screen.getByRole("dialog")).toHaveStyle({ width: `${PARKED_PANEL_WIDTH}px` });

    fireEvent.doubleClick(screen.getByRole("slider", { name: "Resize panel" }));
    expect(screen.getByRole("dialog")).toHaveStyle({ width: "700px" });
  });

  it("clicking the rail body restores the panel", async () => {
    const user = userEvent.setup();
    wrap();
    parkDrag();

    await user.click(screen.getByText("Send email"));
    expect(screen.getByRole("dialog")).toHaveStyle({ width: "700px" });
  });

  it("pulling the edge from the rail opens the panel following the pointer", () => {
    wrap();
    parkDrag();

    const handle = screen.getByRole("slider", { name: "Resize panel" });
    fireEvent.pointerDown(handle);
    fireEvent.pointerMove(window, { clientX: 1024 - 200 });
    fireEvent.pointerMove(window, { clientX: 1024 - 500 });
    fireEvent.pointerUp(window, { clientX: 1024 - 500 });

    expect(screen.getByRole("dialog")).toHaveStyle({ width: "500px" });
  });

  it("keeps the draft across park and restore", async () => {
    const user = userEvent.setup();
    wrap();

    await user.type(screen.getByLabelText("Message"), "Half finished");
    parkDrag();
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();

    fireEvent.doubleClick(screen.getByRole("slider", { name: "Resize panel" }));
    expect(screen.getByLabelText("Message")).toHaveValue("Half finished");
  });

  it("parks via the header button and closes from the rail", async () => {
    const user = userEvent.setup();
    const { onClose } = wrap();

    await user.click(screen.getByRole("button", { name: "Park panel" }));
    expect(screen.getByRole("dialog")).toHaveStyle({ width: `${PARKED_PANEL_WIDTH}px` });
    // Focus moved to the handle so a keyboard user can restore with an arrow key
    expect(screen.getByRole("slider", { name: "Resize panel" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("arrow keys restore the panel when focused on the rail", () => {
    wrap();
    parkDrag();

    fireEvent.keyDown(screen.getByRole("slider", { name: "Resize panel" }), { key: "ArrowRight" });
    expect(screen.getByRole("dialog")).toHaveStyle({ width: "700px" });
  });
});

describe("AdminEmailComposer with recipient options", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  const options = [
    { email: "alice@example.com", label: "Family contact" },
    { email: "ray@example.com", label: "Referrer" },
  ];

  it("renders a recipient select with the prefill selected, no free-text field", () => {
    wrap({ prefilledRecipient: "ray@example.com", recipientOptions: options });

    expect(screen.getByLabelText("Recipient")).toHaveValue("ray@example.com");
    expect(screen.getByRole("option", { name: "Family contact — alice@example.com" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Referrer — ray@example.com" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Other…" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Recipient email")).not.toBeInTheDocument();
  });

  it("prefill that matches no option lands in the Other free-text field", () => {
    wrap({ prefilledRecipient: "stranger@example.com", recipientOptions: options });

    expect(screen.getByLabelText("Recipient")).toHaveValue("other");
    expect(screen.getByLabelText("Recipient email")).toHaveValue("stranger@example.com");
  });

  it("switching the select to another known recipient sends to it", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminSendCustomEmail").mockResolvedValue({ sent: true, reason: null });
    wrap({ prefilledRecipient: "alice@example.com", recipientOptions: options });

    await user.selectOptions(screen.getByLabelText("Recipient"), "ray@example.com");
    await user.type(screen.getByLabelText("Message"), "Body text");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(api.adminSendCustomEmail).toHaveBeenCalledWith(expect.objectContaining({ recipient_email: "ray@example.com" }));
    });
  });

  it("selecting Other… reveals the free-text field and sends to it", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "adminSendCustomEmail").mockResolvedValue({ sent: true, reason: null });
    wrap({ prefilledRecipient: "alice@example.com", recipientOptions: options });

    await user.selectOptions(screen.getByLabelText("Recipient"), "other");
    await user.type(screen.getByLabelText("Recipient email"), "newperson@example.com");
    await user.type(screen.getByLabelText("Message"), "Body text");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(api.adminSendCustomEmail).toHaveBeenCalledWith(expect.objectContaining({ recipient_email: "newperson@example.com" }));
    });
  });

  it("disables Send until the Other free-text field is filled", async () => {
    const user = userEvent.setup();
    wrap({ prefilledRecipient: "alice@example.com", recipientOptions: options });

    await user.selectOptions(screen.getByLabelText("Recipient"), "other");

    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();

    await user.type(screen.getByLabelText("Recipient email"), "newperson@example.com");
    expect(send).toBeDisabled();

    await user.type(screen.getByLabelText("Message"), "Body text");
    expect(send).toBeEnabled();
  });
});
