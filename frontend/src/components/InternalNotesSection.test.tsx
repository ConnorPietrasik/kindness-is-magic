import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InternalNotesSection } from "./InternalNotesSection";

describe("InternalNotesSection", () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    initialNotes: null as string | null,
    onSave: vi.fn(),
    isSaving: false,
  };

  it("shows the section header", () => {
    render(<InternalNotesSection {...defaultProps} />);

    expect(screen.getByText("📝 Internal Notes")).toBeInTheDocument();
  });

  it("does not show 'Set' badge when notes are null", () => {
    render(<InternalNotesSection {...defaultProps} initialNotes={null} />);

    expect(screen.queryByText("Set")).not.toBeInTheDocument();
  });

  it("does not show 'Set' badge when notes are empty string", () => {
    render(<InternalNotesSection {...defaultProps} initialNotes="" />);

    expect(screen.queryByText("Set")).not.toBeInTheDocument();
  });

  it("shows 'Set' badge when notes exist", () => {
    render(<InternalNotesSection {...defaultProps} initialNotes="Some notes" />);

    expect(screen.getByText("Set")).toBeInTheDocument();
  });

  it("shows privacy hint when collapsed", () => {
    render(<InternalNotesSection {...defaultProps} />);

    expect(screen.getByText("Visible only to you and admins")).toBeInTheDocument();
  });

  it("expands on click and shows textarea", async () => {
    const user = userEvent.setup();
    render(<InternalNotesSection {...defaultProps} />);

    const toggle = screen.getByText("📝 Internal Notes").closest("button");
    expect(toggle).toBeTruthy();
    await user.click(toggle!);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Add internal notes…")).toBeInTheDocument();
    });
  });

  it("pre-fills textarea with existing notes", async () => {
    const user = userEvent.setup();
    render(<InternalNotesSection {...defaultProps} initialNotes="Existing note text" />);

    const toggle = screen.getByText("📝 Internal Notes").closest("button");
    await user.click(toggle!);

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText("Add internal notes…") as HTMLTextAreaElement;
      expect(textarea.value).toBe("Existing note text");
    });
  });

  it("shows character counter", async () => {
    const user = userEvent.setup();
    render(<InternalNotesSection {...defaultProps} initialNotes="Hello" />);

    const toggle = screen.getByText("📝 Internal Notes").closest("button");
    await user.click(toggle!);

    await waitFor(() => {
      expect(screen.getByText("5/1000")).toBeInTheDocument();
    });
  });

  it("calls onSave with notes on save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<InternalNotesSection {...defaultProps} onSave={onSave} />);

    // Expand
    const toggle = screen.getByText("📝 Internal Notes").closest("button");
    await user.click(toggle!);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Add internal notes…")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText("Add internal notes…") as HTMLTextAreaElement;
    await user.type(textarea, "New note");
    await user.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("New note");
    });
  });

  it("calls onSave with empty string when notes are cleared", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<InternalNotesSection {...defaultProps} initialNotes="Existing" onSave={onSave} />);

    // Expand
    const toggle = screen.getByText("📝 Internal Notes").closest("button");
    await user.click(toggle!);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Add internal notes…")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText("Add internal notes…") as HTMLTextAreaElement;
    await user.clear(textarea);
    await user.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith("");
    });
  });

  it("shows loading state on save button", async () => {
    const user = userEvent.setup();
    render(<InternalNotesSection {...defaultProps} isSaving={true} />);

    const toggle = screen.getByText("📝 Internal Notes").closest("button");
    await user.click(toggle!);

    await waitFor(() => {
      expect(screen.getByText("Saving…")).toBeInTheDocument();
    });
  });
});
