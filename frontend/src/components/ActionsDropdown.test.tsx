import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ActionItem, ActionsDropdown } from "./ActionsDropdown";

afterEach(() => {
  cleanup();
});

const defaultItems: ActionItem[] = [
  { label: "Edit", variant: "secondary", onClick: vi.fn() },
  { label: "Delete", variant: "danger", onClick: vi.fn() },
];

function getTrigger() {
  return screen.getByRole("button", { name: /more actions/i });
}

function getMenu() {
  return screen.getByRole("menu");
}

describe("ActionsDropdown", () => {
  it("renders trigger button when items are provided", () => {
    render(<ActionsDropdown items={defaultItems} />);
    expect(getTrigger()).toBeInTheDocument();
  });

  it("hides trigger when items array is empty", () => {
    render(<ActionsDropdown items={[]} />);
    expect(screen.queryByRole("button", { name: /more actions/i })).not.toBeInTheDocument();
  });

  it("hides trigger when all items are disabled", () => {
    render(<ActionsDropdown items={defaultItems.map((item): ActionItem => ({ ...item, disabled: true }))} />);
    expect(screen.queryByRole("button", { name: /more actions/i })).not.toBeInTheDocument();
  });

  it("shows trigger when some items are disabled but not all", () => {
    render(<ActionsDropdown items={[defaultItems[0]!, { ...defaultItems[1]!, disabled: true }]} />);
    expect(getTrigger()).toBeInTheDocument();
  });

  it("opens menu when trigger is clicked", async () => {
    const user = userEvent.setup();
    render(<ActionsDropdown items={defaultItems} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(getTrigger());
    expect(getMenu()).toBeInTheDocument();
  });

  it("closes menu when trigger is clicked again", async () => {
    const user = userEvent.setup();
    render(<ActionsDropdown items={defaultItems} />);

    await user.click(getTrigger());
    expect(getMenu()).toBeInTheDocument();

    await user.click(getTrigger());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("calls the correct onClick when a menu item is clicked", async () => {
    const user = userEvent.setup();
    const items = defaultItems.map((item) => ({ ...item, onClick: vi.fn() }));
    render(<ActionsDropdown items={items} />);

    await user.click(getTrigger());
    await user.click(getMenu());

    // Click the first visible item in the menu
    const menuItems = within(getMenu()).getAllByRole("menuitem");
    await user.click(menuItems[0]!);

    expect(items[0]!.onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes menu on click outside", async () => {
    const user = userEvent.setup();
    const wrapper = render(<ActionsDropdown items={defaultItems} />);

    await user.click(getTrigger());
    expect(getMenu()).toBeInTheDocument();

    // Click on the document body (outside the dropdown)
    await user.click(wrapper.container);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes menu on Escape key", async () => {
    const user = userEvent.setup();
    render(<ActionsDropdown items={defaultItems} />);

    await user.click(getTrigger());
    expect(getMenu()).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders menu items with correct labels", async () => {
    const user = userEvent.setup();
    render(<ActionsDropdown items={defaultItems} />);

    await user.click(getTrigger());
    const menu = getMenu();

    expect(within(menu).getByText("Edit")).toBeInTheDocument();
    expect(within(menu).getByText("Delete")).toBeInTheDocument();
  });

  it("disables disabled menu items", async () => {
    const user = userEvent.setup();
    const items: ActionItem[] = [
      { label: "Enabled", onClick: vi.fn() },
      { label: "Disabled", onClick: vi.fn(), disabled: true },
    ];
    render(<ActionsDropdown items={items} />);

    await user.click(getTrigger());
    const menu = getMenu();
    const disabledItem = within(menu).getByText("Disabled").closest("button");
    expect(disabledItem!).toBeDisabled();
  });

  it("does not call onClick for disabled items", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <ActionsDropdown
        items={[
          { label: "Disabled", onClick, disabled: true },
          { label: "Other", onClick: vi.fn() },
        ]}
      />
    );

    await user.click(getTrigger());
    const menu = getMenu();
    const disabledItem = within(menu).getByText("Disabled").closest("button");
    await user.click(disabledItem!);

    expect(onClick).not.toHaveBeenCalled();
  });

  it("disables trigger when disabled prop is true", () => {
    render(<ActionsDropdown items={defaultItems} disabled />);
    expect(getTrigger()).toBeDisabled();
  });

  it("renders children alongside the trigger", () => {
    render(
      <ActionsDropdown items={defaultItems}>
        <span data-testid="child">Sibling content</span>
      </ActionsDropdown>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(getTrigger()).toBeInTheDocument();
  });

  it("applies danger styling to danger variant items", async () => {
    const user = userEvent.setup();
    render(<ActionsDropdown items={[{ label: "Danger Action", variant: "danger", onClick: vi.fn() }]} />);

    await user.click(getTrigger());
    const menu = getMenu();
    const dangerItem = within(menu).getByText("Danger Action").closest("button");
    expect(dangerItem).toHaveClass("text-red-600");
  });
});
