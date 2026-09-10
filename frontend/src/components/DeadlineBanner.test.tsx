import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BannerDeadline } from "../lib/deadlines";
import { DeadlineBanner } from "./DeadlineBanner";

const UPCOMING: BannerDeadline = { label: "Gift drop-off", dueDate: "2026-12-15", status: "upcoming" };
const PAST: BannerDeadline = { label: "Gift drop-off", dueDate: "2025-12-15", status: "past" };

describe("DeadlineBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when result is null", () => {
    const { container } = render(<DeadlineBanner result={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows '<label> due <date>' for an upcoming deadline", () => {
    render(<DeadlineBanner result={UPCOMING} />);

    expect(screen.getByText("Dec 15, 2026")).toBeInTheDocument();
    expect(screen.getByText(/due/)).toBeInTheDocument();
    expect(screen.queryByText(/deadline was/)).not.toBeInTheDocument();
    // Upcoming tone
    expect(screen.getByText("Gift drop-off").closest("div")).toHaveClass("bg-blue-50");
  });

  it("shows '<label> deadline was <date>' for a past deadline", () => {
    render(<DeadlineBanner result={PAST} />);

    expect(screen.getByText("Dec 15, 2025")).toBeInTheDocument();
    expect(screen.getByText(/deadline was/)).toBeInTheDocument();
    expect(screen.queryByText(/^due/)).not.toBeInTheDocument();
    // Past tone
    expect(screen.getByText("Gift drop-off").closest("div")).toHaveClass("bg-gray-50");
  });

  it("renders the extra line when provided", () => {
    render(<DeadlineBanner result={UPCOMING} extra="3 families waiting in the queue" />);
    expect(screen.getByText("3 families waiting in the queue")).toBeInTheDocument();
  });
});
