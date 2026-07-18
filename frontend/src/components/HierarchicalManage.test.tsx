import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HierarchicalManage, type HierarchicalManageChildCallbacks } from "./HierarchicalManage";

// ---------------------------------------------------------------------------
// Test data types
// ---------------------------------------------------------------------------

interface TestParent {
  id: number;
  name: string;
  count: number;
}

interface TestChild {
  id: number;
  name: string;
}

interface TestListResponse {
  items: TestChild[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ---------------------------------------------------------------------------
// Mock form component
// ---------------------------------------------------------------------------

interface MockFormProps {
  title: string;
  initial?: Record<string, unknown>;
  isEdit?: boolean;
  onSubmit: (formData: unknown) => void;
  onCancel: () => void;
  loading?: boolean;
}

function MockForm({ title, onSubmit, onCancel, loading }: MockFormProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name: "Submitted" });
      }}
      data-testid="mock-form"
    >
      <span>{title}</span>
      <button type="submit" disabled={loading}>
        Submit
      </button>
      <button type="button" onClick={onCancel} data-testid="form-cancel">
        Cancel
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let queryClient: QueryClient;

function wrap() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function makeApiFns() {
  return {
    parentFetch: vi.fn().mockResolvedValue({ id: 1, name: "Parent", count: 3 } as TestParent),
    parentUpdate: vi.fn().mockResolvedValue({ id: 1, name: "Updated Parent", count: 3 } as TestParent),
    childList: vi.fn().mockResolvedValue({
      items: [
        { id: 10, name: "Child A" },
        { id: 11, name: "Child B" },
      ],
      total: 2,
      page: 1,
      page_size: 20,
      total_pages: 1,
    } as TestListResponse),
    childDetail: vi.fn().mockImplementation((id: number) => Promise.resolve({ id, name: `Detail ${id}` } as TestChild)),
    childCreate: vi.fn().mockResolvedValue({ id: 99, name: "New Child" } as TestChild),
    childUpdate: vi
      .fn()
      .mockImplementation((_id: number, data: Record<string, unknown>) =>
        Promise.resolve({ id: _id, name: (data.name as string) ?? `Updated ${_id}` } as TestChild)
      ),
    childDelete: vi.fn().mockResolvedValue(undefined as undefined),
  };
}

function baseProps(fns: ReturnType<typeof makeApiFns>) {
  return {
    backLinkTo: "/back",
    backLinkLabel: "Back",

    parentId: 1,
    parentQueryKey: ["testParent", "1"] as const,
    parentFetchFn: fns.parentFetch,
    parentUpdateApi: fns.parentUpdate,
    parentFormComponent: MockForm as never,
    renderParent: ({
      data,
      isEditing,
      onToggleEdit,
      onSave,
      isSaving,
    }: {
      data: TestParent | null;
      isEditing: boolean;
      onToggleEdit: () => void;
      onSave: (formData: unknown) => void;
      isSaving: boolean;
    }) => (
      <div data-testid="parent-card">
        <span data-testid="parent-name">{data?.name ?? "\u2014"}</span>
        <button type="button" data-testid="toggle-edit" onClick={onToggleEdit} disabled={isSaving}>
          {isEditing ? "Cancel" : "Edit"}
        </button>
        {isEditing && <MockForm title="Edit Parent" onSubmit={onSave} onCancel={onToggleEdit} loading={isSaving} />}
      </div>
    ),

    childQueryKey: ["testChildren", "1"] as const,
    childListFn: fns.childList,
    childDetailFn: fns.childDetail,
    childCreateApi: fns.childCreate,
    childUpdateApi: fns.childUpdate,
    childDeleteApi: fns.childDelete,
    childFormDefault: { name: "" } as never,
    childFormComponent: MockForm as never,
    renderChildren: (children: TestChild[], _callbacks: HierarchicalManageChildCallbacks) => (
      <table data-testid="children-table">
        <tbody>
          {children.map((c) => (
            <tr key={c.id} data-testid={`child-row-${c.id}`}>
              <td>{c.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
    childrenTitle: "Children",
    createButtonLabel: "+ Add Child",
    childInvalidationKeys: [["testChildren", "1"]],
  } as const;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HierarchicalManage", () => {
  afterEach(() => {
    vi.clearAllMocks();
    if (queryClient) queryClient.clear();
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* ── Loading state ─────────────────────────────────────── */

  it("shows spinner while parent and children are loading", () => {
    const fns = makeApiFns();
    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    expect(document.querySelector("svg.animate-spin")).toBeInTheDocument();
  });

  /* ── Parent rendering ──────────────────────────────────── */

  it("renders parent data via renderParent callback", async () => {
    const fns = makeApiFns();
    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("parent-name")).toHaveTextContent("Parent");
    });
  });

  it("calls parentFetchFn with parentId on mount", async () => {
    const fns = makeApiFns();
    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(fns.parentFetch).toHaveBeenCalledWith(1);
    });
  });

  /* ── Parent edit toggle ────────────────────────────────── */

  it("toggles edit mode when edit button is clicked", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("parent-name")).toBeInTheDocument();
    });

    expect(screen.getByTestId("toggle-edit")).toHaveTextContent("Edit");

    await user.click(screen.getByTestId("toggle-edit"));
    expect(screen.getByTestId("toggle-edit")).toHaveTextContent("Cancel");
    expect(screen.getByTestId("mock-form")).toBeInTheDocument();
  });

  it("cancels edit mode when form cancel is clicked", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("toggle-edit")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("toggle-edit"));
    expect(screen.getByTestId("mock-form")).toBeInTheDocument();

    // Click cancel inside the form (not the toggle button)
    await user.click(screen.getByTestId("form-cancel"));
    expect(screen.queryByTestId("mock-form")).not.toBeInTheDocument();
  });

  it("calls parentUpdateApi when parent form is submitted", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    // Open edit
    await waitFor(() => {
      expect(screen.getByTestId("toggle-edit")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("toggle-edit"));

    // Submit form
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(fns.parentUpdate).toHaveBeenCalledWith(1, expect.any(Object));
    });
  });

  /* ── Children rendering ────────────────────────────────── */

  it("renders children list via renderChildren callback", async () => {
    const fns = makeApiFns();
    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("child-row-10")).toBeInTheDocument();
      expect(screen.getByTestId("child-row-11")).toBeInTheDocument();
    });
  });

  it("calls childListFn on mount", async () => {
    const fns = makeApiFns();
    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(fns.childList).toHaveBeenCalled();
    });
  });

  /* ── Child create ──────────────────────────────────────── */

  it("shows create form when add button is clicked", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "+ Add Child" })).toBeInTheDocument();
    });

    expect(screen.queryByTestId("mock-form")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Add Child" }));
    expect(screen.getByTestId("mock-form")).toBeInTheDocument();
  });

  it("calls childCreateApi when create form is submitted", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "+ Add Child" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "+ Add Child" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(fns.childCreate).toHaveBeenCalled();
    });
  });

  it("hides create form after successful create", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "+ Add Child" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "+ Add Child" }));
    expect(screen.getByTestId("mock-form")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.queryByTestId("mock-form")).not.toBeInTheDocument();
    });
  });

  /* ── Child delete confirmation ─────────────────────────── */

  it("shows confirm dialog when delete is triggered", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    const props = baseProps(fns);
    const overrideProps = {
      ...props,
      renderChildren: (_children: TestChild[], callbacks: HierarchicalManageChildCallbacks) => (
        <div>
          <button type="button" data-testid="delete-btn" onClick={() => callbacks.onDelete(10)}>
            Delete
          </button>
        </div>
      ),
    };

    render(<HierarchicalManage {...overrideProps} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("delete-btn")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("delete-btn"));
    expect(screen.getByText(/Delete item/)).toBeInTheDocument();
  });

  it("calls childDeleteApi on confirm", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    const props = baseProps(fns);
    const overrideProps = {
      ...props,
      renderChildren: (_children: TestChild[], callbacks: HierarchicalManageChildCallbacks) => (
        <div>
          <button type="button" data-testid="delete-btn" onClick={() => callbacks.onDelete(10)}>
            Delete
          </button>
        </div>
      ),
    };

    render(<HierarchicalManage {...overrideProps} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("delete-btn")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("delete-btn"));
    await user.click(screen.getByText("Yes, delete"));

    await waitFor(() => {
      expect(fns.childDelete).toHaveBeenCalledWith(10, expect.anything());
    });
  });

  it("closes confirm dialog on cancel", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    const props = baseProps(fns);
    const overrideProps = {
      ...props,
      renderChildren: (_children: TestChild[], callbacks: HierarchicalManageChildCallbacks) => (
        <div>
          <button type="button" data-testid="delete-btn" onClick={() => callbacks.onDelete(10)}>
            Delete
          </button>
        </div>
      ),
    };

    render(<HierarchicalManage {...overrideProps} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("delete-btn")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("delete-btn"));
    expect(screen.getByText(/Delete item/)).toBeInTheDocument();

    await user.click(screen.getByText("Cancel"));
    expect(screen.queryByText(/Delete item/)).not.toBeInTheDocument();
  });

  /* ── Error display ─────────────────────────────────────── */

  it("displays error when child create fails", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    fns.childCreate.mockRejectedValueOnce({ response: { data: { detail: "Create failed" } } });

    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "+ Add Child" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "+ Add Child" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.getByText("Create failed")).toBeInTheDocument();
    });
  });
});
