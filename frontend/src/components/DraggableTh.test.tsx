import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraggableTh } from "./DraggableTh";

const rect = (left: number, width: number) =>
  ({ left, width, top: 0, bottom: 0, right: left + width, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

/** Table with two independent columns; returns the reorder/moveBy spies. */
const renderTwoColumns = () => {
  const onReorder = vi.fn();
  const onMoveBy = vi.fn();
  render(
    <table>
      <thead>
        <tr>
          <DraggableTh unit={["alpha"]} onReorder={onReorder} onMoveBy={onMoveBy}>
            Alpha
          </DraggableTh>
          <DraggableTh unit={["beta"]} onReorder={onReorder} onMoveBy={onMoveBy}>
            Beta
          </DraggableTh>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>2</td>
        </tr>
      </tbody>
    </table>
  );
  return { onReorder, onMoveBy };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DraggableTh", () => {
  it("renders its content in a draggable header cell", () => {
    renderTwoColumns();

    const header = screen.getByRole("columnheader", { name: "Alpha" });
    expect(header).toHaveAttribute("draggable", "true");
    expect(header).toHaveTextContent("Alpha");
  });

  // jsdom drag events carry no clientX — the component treats a missing
  // clientX as 0 (the left edge). "After" is exercised by shifting the
  // target rect left of the cursor's default position.

  it("drops the dragged unit before the target (left half)", () => {
    const { onReorder } = renderTwoColumns();
    const alpha = screen.getByRole("columnheader", { name: "Alpha" });
    const beta = screen.getByRole("columnheader", { name: "Beta" });
    beta.getBoundingClientRect = () => rect(0, 200);

    fireEvent.dragStart(alpha, { dataTransfer: {} });
    fireEvent.drop(beta, { dataTransfer: {} });

    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(["alpha"], "beta", "before");
  });

  it("drops the dragged unit after the target (right half)", () => {
    const { onReorder } = renderTwoColumns();
    const alpha = screen.getByRole("columnheader", { name: "Alpha" });
    const beta = screen.getByRole("columnheader", { name: "Beta" });
    beta.getBoundingClientRect = () => rect(-200, 200);

    fireEvent.dragStart(alpha, { dataTransfer: {} });
    fireEvent.drop(beta, { dataTransfer: {} });

    expect(onReorder).toHaveBeenCalledWith(["alpha"], "beta", "after");
  });

  it("shows a drop indicator while hovering a different unit", () => {
    renderTwoColumns();
    const alpha = screen.getByRole("columnheader", { name: "Alpha" });
    const beta = screen.getByRole("columnheader", { name: "Beta" });
    beta.getBoundingClientRect = () => rect(0, 200);

    fireEvent.dragStart(alpha, { dataTransfer: {} });
    expect(beta.className).not.toContain("bg-violet-50/60");

    fireEvent.dragOver(beta, { dataTransfer: {} });
    expect(beta.className).toContain("bg-violet-50/60");

    fireEvent.drop(beta, { dataTransfer: {} });
    expect(beta.className).not.toContain("bg-violet-50/60");
  });

  it("ignores drops onto a header of the same unit", () => {
    const onReorder = vi.fn();
    // Two headers sharing one unit (e.g. a paired column).
    render(
      <table>
        <thead>
          <tr>
            <DraggableTh unit={["pair"]} onReorder={onReorder} onMoveBy={vi.fn()}>
              Pair One
            </DraggableTh>
            <DraggableTh unit={["pair"]} onReorder={onReorder} onMoveBy={vi.fn()}>
              Pair Two
            </DraggableTh>
          </tr>
        </thead>
      </table>
    );
    const one = screen.getByRole("columnheader", { name: "Pair One" });
    const two = screen.getByRole("columnheader", { name: "Pair Two" });

    fireEvent.dragStart(one, { dataTransfer: {} });
    fireEvent.drop(two, { dataTransfer: {} });

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("does not start a drag from an interactive control inside the header", () => {
    const onReorder = vi.fn();
    render(
      <table>
        <thead>
          <tr>
            <DraggableTh unit={["alpha"]} onReorder={onReorder} onMoveBy={vi.fn()}>
              Alpha <input aria-label="filter" />
            </DraggableTh>
            <DraggableTh unit={["beta"]} onReorder={onReorder} onMoveBy={vi.fn()}>
              Beta
            </DraggableTh>
          </tr>
        </thead>
      </table>
    );
    const input = screen.getByLabelText("filter");
    const beta = screen.getByRole("columnheader", { name: "Beta" });

    fireEvent.dragStart(input, { dataTransfer: {} });
    fireEvent.drop(beta, { dataTransfer: {} });

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("moves the unit with arrow keys when focused", () => {
    const { onMoveBy } = renderTwoColumns();
    const alpha = screen.getByRole("columnheader", { name: "Alpha" });

    fireEvent.keyDown(alpha, { key: "ArrowLeft" });
    expect(onMoveBy).toHaveBeenCalledWith(["alpha"], -1);

    fireEvent.keyDown(alpha, { key: "ArrowRight" });
    expect(onMoveBy).toHaveBeenCalledWith(["alpha"], 1);

    fireEvent.keyDown(alpha, { key: "a" });
    expect(onMoveBy).toHaveBeenCalledTimes(2);
  });

  it("ignores arrow keys pressed inside a control within the header", () => {
    const onMoveBy = vi.fn();
    // Header with a filter input inside (like the admin table headers).
    render(
      <table>
        <thead>
          <tr>
            <DraggableTh unit={["alpha"]} onReorder={vi.fn()} onMoveBy={onMoveBy}>
              Alpha <input aria-label="filter" />
            </DraggableTh>
            <DraggableTh unit={["beta"]} onReorder={vi.fn()} onMoveBy={onMoveBy}>
              Beta
            </DraggableTh>
          </tr>
        </thead>
      </table>
    );

    // Arrow keys pressed inside the input bubble to the th but must not
    // reorder — the cursor keeps moving in the input.
    const input = screen.getByLabelText("filter");
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(onMoveBy).not.toHaveBeenCalled();

    // Arrow keys on the header cell itself still reorder.
    const beta = screen.getByRole("columnheader", { name: "Beta" });
    fireEvent.keyDown(beta, { key: "ArrowLeft" });
    expect(onMoveBy).toHaveBeenCalledWith(["beta"], -1);
  });

  it("shows the selection ring when the header is clicked and clears it on blur", async () => {
    renderTwoColumns();
    const alpha = screen.getByRole("columnheader", { name: "Alpha" });
    expect(alpha.className).not.toContain("ring-btn-start/50");

    // A plain click (no drag) focuses the header → ring appears.
    await userEvent.setup().click(alpha);
    expect(alpha.className).toContain("ring-btn-start/50");

    fireEvent.blur(alpha);
    expect(alpha.className).not.toContain("ring-btn-start/50");
  });

  it("forwards colSpan to the header cell", () => {
    render(
      <table>
        <thead>
          <tr>
            <DraggableTh unit={["wide"]} onReorder={vi.fn()} onMoveBy={vi.fn()} colSpan={2}>
              Wide
            </DraggableTh>
          </tr>
        </thead>
      </table>
    );
    expect(screen.getByRole("columnheader", { name: "Wide" })).toHaveAttribute("colspan", "2");
  });
});
