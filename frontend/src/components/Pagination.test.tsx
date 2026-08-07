import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Pagination } from "./Pagination";

// The generatePageRange function is not exported, so we test it indirectly
// through the rendered page buttons. We also test the pure logic separately
// by re-implementing the expected outputs.

// ---------------------------------------------------------------------------
// generatePageRange — pure logic (tested via rendered output)
// ---------------------------------------------------------------------------

/**
 * Expected page ranges for various page/totalPages combinations.
 * These encode the ellipsis algorithm that Pagination relies on.
 */
const rangeCases: Array<{ page: number; totalPages: number; expected: (number | "…")[] }> = [
  // Edge: 0 or 1 pages → empty (component returns null)
  { page: 1, totalPages: 0, expected: [] },
  { page: 1, totalPages: 1, expected: [] },

  // Small total: show all pages (≤ 7)
  { page: 1, totalPages: 5, expected: [1, 2, 3, 4, 5] },
  { page: 3, totalPages: 7, expected: [1, 2, 3, 4, 5, 6, 7] },

  // Near the start: 1 2 3 4 … last
  { page: 1, totalPages: 10, expected: [1, 2, 3, 4, "…", 10] },
  { page: 2, totalPages: 10, expected: [1, 2, 3, 4, "…", 10] },
  { page: 3, totalPages: 10, expected: [1, 2, 3, 4, "…", 10] },

  // In the middle: 1 … page-1 page page+1 … last
  { page: 4, totalPages: 10, expected: [1, "…", 3, 4, 5, "…", 10] },
  { page: 5, totalPages: 10, expected: [1, "…", 4, 5, 6, "…", 10] },
  { page: 10, totalPages: 20, expected: [1, "…", 9, 10, 11, "…", 20] },

  // Near the end: 1 … last-3 last-2 last-1 last
  { page: 8, totalPages: 10, expected: [1, "…", 7, 8, 9, 10] },
  { page: 9, totalPages: 10, expected: [1, "…", 7, 8, 9, 10] },
  { page: 10, totalPages: 10, expected: [1, "…", 7, 8, 9, 10] },

  // Large total, page at extremes
  { page: 1, totalPages: 50, expected: [1, 2, 3, 4, "…", 50] },
  { page: 50, totalPages: 50, expected: [1, "…", 47, 48, 49, 50] },
  { page: 25, totalPages: 50, expected: [1, "…", 24, 25, 26, "…", 50] },
];

describe("Pagination — page range generation", () => {
  afterEach(() => cleanup());

  for (const { page, totalPages, expected } of rangeCases) {
    it(`page=${page}, totalPages=${totalPages} → ${JSON.stringify(expected)}`, () => {
      const onPageChange = vi.fn();
      render(<Pagination page={page} totalPages={totalPages} total={totalPages * 10} pageSize={10} onPageChange={onPageChange} />);

      if (expected.length === 0) {
        // Component returns null for totalPages <= 1
        expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
        return;
      }

      // Count expected ellipses and page numbers separately
      const ellipsisCount = expected.filter((item) => item === "…").length;
      const pageNumbers = expected.filter((item): item is number => item !== "…");

      // Verify ellipsis count (queryAllByText returns [] when none found)
      const ellipsisElements = screen.queryAllByText("…");
      expect(ellipsisElements).toHaveLength(ellipsisCount);

      // Verify each page number button exists
      for (const num of pageNumbers) {
        expect(screen.getByLabelText(`Page ${num}`)).toBeInTheDocument();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Pagination — navigation callbacks
// ---------------------------------------------------------------------------

describe("Pagination — navigation", () => {
  afterEach(() => cleanup());

  it("calls onPageChange with correct page on button click", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={1} totalPages={5} total={50} pageSize={10} onPageChange={onPageChange} />);

    await user.click(screen.getByLabelText("Page 3"));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("calls onPageChange(1) on first-page button", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={3} totalPages={10} total={100} pageSize={10} onPageChange={onPageChange} />);

    await user.click(screen.getByLabelText("First page"));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("calls onPageChange with previous page on ‹ button", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={5} totalPages={10} total={100} pageSize={10} onPageChange={onPageChange} />);

    await user.click(screen.getByLabelText("Previous page"));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("calls onPageChange with next page on › button", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={5} totalPages={10} total={100} pageSize={10} onPageChange={onPageChange} />);

    await user.click(screen.getByLabelText("Next page"));
    expect(onPageChange).toHaveBeenCalledWith(6);
  });

  it("calls onPageChange(totalPages) on last-page button", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={3} totalPages={10} total={100} pageSize={10} onPageChange={onPageChange} />);

    await user.click(screen.getByLabelText("Last page"));
    expect(onPageChange).toHaveBeenCalledWith(10);
  });
});

// ---------------------------------------------------------------------------
// Pagination — disabled states
// ---------------------------------------------------------------------------

describe("Pagination — disabled states", () => {
  afterEach(() => cleanup());

  it("disables first and previous buttons on page 1", () => {
    render(<Pagination page={1} totalPages={5} total={50} pageSize={10} onPageChange={vi.fn()} />);

    expect(screen.getByLabelText("First page")).toBeDisabled();
    expect(screen.getByLabelText("Previous page")).toBeDisabled();
    expect(screen.getByLabelText("Next page")).not.toBeDisabled();
    expect(screen.getByLabelText("Last page")).not.toBeDisabled();
  });

  it("disables next and last buttons on final page", () => {
    render(<Pagination page={5} totalPages={5} total={50} pageSize={10} onPageChange={vi.fn()} />);

    expect(screen.getByLabelText("First page")).not.toBeDisabled();
    expect(screen.getByLabelText("Previous page")).not.toBeDisabled();
    expect(screen.getByLabelText("Next page")).toBeDisabled();
    expect(screen.getByLabelText("Last page")).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Pagination — item count display
// ---------------------------------------------------------------------------

describe("Pagination — item count", () => {
  afterEach(() => cleanup());

  it("shows correct range for a middle page", () => {
    render(<Pagination page={3} totalPages={10} total={95} pageSize={10} onPageChange={vi.fn()} />);

    // Page 3, pageSize 10 → items 21–30 of 95
    expect(screen.getByText("Showing 21–30 of 95")).toBeInTheDocument();
  });

  it("clamps endItem to total on the last partial page", () => {
    render(<Pagination page={10} totalPages={10} total={95} pageSize={10} onPageChange={vi.fn()} />);

    // Page 10, pageSize 10 → items 91–95 of 95
    expect(screen.getByText("Showing 91–95 of 95")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pagination — page size selector
// ---------------------------------------------------------------------------

describe("Pagination — page size selector", () => {
  afterEach(() => cleanup());

  it("renders page size selector when onPageSizeChange is provided", () => {
    render(
      <Pagination
        page={1}
        totalPages={5}
        total={50}
        pageSize={20}
        pageSizeOptions={[10, 20, 50]}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />
    );

    const select = screen.getByLabelText("Items per page");
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue("20");
  });

  it("does not render page size selector when onPageSizeChange is omitted", () => {
    render(<Pagination page={1} totalPages={5} total={50} pageSize={10} onPageChange={vi.fn()} />);

    expect(screen.queryByLabelText("Items per page")).not.toBeInTheDocument();
  });

  it("calls onPageSizeChange with selected value", async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();
    render(
      <Pagination
        page={1}
        totalPages={5}
        total={50}
        pageSize={10}
        pageSizeOptions={[10, 20, 50]}
        onPageChange={vi.fn()}
        onPageSizeChange={onPageSizeChange}
      />
    );

    const select = screen.getByLabelText("Items per page");
    await user.selectOptions(select, "50");
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });
});

// ---------------------------------------------------------------------------
// Pagination — current page indicator
// ---------------------------------------------------------------------------

describe("Pagination — current page indicator", () => {
  afterEach(() => cleanup());

  it("marks current page button with aria-current=page", () => {
    render(<Pagination page={3} totalPages={10} total={100} pageSize={10} onPageChange={vi.fn()} />);

    const currentPage = screen.getByLabelText("Page 3");
    expect(currentPage).toHaveAttribute("aria-current", "page");

    const otherPage = screen.getByLabelText("Page 1");
    expect(otherPage).not.toHaveAttribute("aria-current");
  });
});
