import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastContainer } from "../context/ToastContext";
import { HierarchicalManage, type HierarchicalManageChildCallbacks, type HierarchicalManageRenderContext } from "./HierarchicalManage";

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
  deleted_at?: string | null;
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
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastContainer>{children}</ToastContainer>
    </QueryClientProvider>
  );
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
    childListDeleted: vi.fn().mockResolvedValue({
      items: [{ id: 99, name: "Deleted Child", deleted_at: "2024-01-01" }],
      total: 1,
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
    childRestore: vi.fn().mockResolvedValue({ id: 99, name: "Restored Child" } as TestChild),
  };
}

function baseProps(fns: ReturnType<typeof makeApiFns>) {
  return {
    parent: {
      id: 1,
      queryKey: ["testParent", "1"] as const,
      fetchFn: fns.parentFetch,
      updateApi: fns.parentUpdate,
      render: ({
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
    },

    child: {
      queryKey: ["testChildren", "1"] as const,
      listFn: fns.childList,
      detailFn: fns.childDetail,
      createApi: fns.childCreate,
      updateApi: fns.childUpdate,
      deleteApi: fns.childDelete,
      restoreApi: fns.childRestore,
      formDefault: { name: "" } as never,
      formComponent: MockForm as never,
      render: (children: TestChild[], _callbacks: HierarchicalManageChildCallbacks, _ctx: HierarchicalManageRenderContext) => (
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
      title: "Children",
      createButtonLabel: "+ Add Child",
      invalidationKeys: [["testChildren", "1"]],
    },
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

  it("shows an error message when the parent fetch fails", async () => {
    const fns = makeApiFns();
    fns.parentFetch.mockRejectedValue({ response: { data: { detail: "Family not found" } } });
    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    // The failure is visible instead of a blank parent card
    await screen.findByText("Family not found");
    expect(screen.queryByTestId("parent-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("children-table")).not.toBeInTheDocument();
  });

  /* ── Parent rendering ──────────────────────────────────── */

  it("renders parent data via render callback", async () => {
    const fns = makeApiFns();
    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("parent-name")).toHaveTextContent("Parent");
    });
  });

  it("calls parent.fetchFn with parent.id on mount", async () => {
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

    await user.click(screen.getByTestId("form-cancel"));
    expect(screen.queryByTestId("mock-form")).not.toBeInTheDocument();
  });

  it("calls parent.updateApi when parent form is submitted", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("toggle-edit")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("toggle-edit"));

    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(fns.parentUpdate).toHaveBeenCalledWith(1, expect.any(Object));
    });
  });

  /* ── Children rendering ────────────────────────────────── */

  it("renders children list via render callback", async () => {
    const fns = makeApiFns();
    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("child-row-10")).toBeInTheDocument();
      expect(screen.getByTestId("child-row-11")).toBeInTheDocument();
    });
  });

  it("calls children.listFn on mount", async () => {
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

  it("calls children.createApi when create form is submitted", async () => {
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
      child: {
        ...props.child,
        render: (_children: TestChild[], callbacks: HierarchicalManageChildCallbacks, _ctx: HierarchicalManageRenderContext) => (
          <div>
            <button type="button" data-testid="delete-btn" onClick={() => callbacks.onDelete(10)}>
              Delete
            </button>
          </div>
        ),
      },
    };

    render(<HierarchicalManage {...overrideProps} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("delete-btn")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("delete-btn"));
    expect(screen.getByText(/Delete item/)).toBeInTheDocument();
  });

  it("calls children.deleteApi on confirm", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    const props = baseProps(fns);
    const overrideProps = {
      ...props,
      child: {
        ...props.child,
        render: (_children: TestChild[], callbacks: HierarchicalManageChildCallbacks, _ctx: HierarchicalManageRenderContext) => (
          <div>
            <button type="button" data-testid="delete-btn" onClick={() => callbacks.onDelete(10)}>
              Delete
            </button>
          </div>
        ),
      },
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
      child: {
        ...props.child,
        render: (_children: TestChild[], callbacks: HierarchicalManageChildCallbacks, _ctx: HierarchicalManageRenderContext) => (
          <div>
            <button type="button" data-testid="delete-btn" onClick={() => callbacks.onDelete(10)}>
              Delete
            </button>
          </div>
        ),
      },
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

  it("renders delete description from dialogs config", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    const props = baseProps(fns);
    const overrideProps = {
      ...props,
      dialogs: { deleteDescription: "This will also delete related items." },
      child: {
        ...props.child,
        render: (_children: TestChild[], callbacks: HierarchicalManageChildCallbacks, _ctx: HierarchicalManageRenderContext) => (
          <div>
            <button type="button" data-testid="delete-btn" onClick={() => callbacks.onDelete(10)}>
              Delete
            </button>
          </div>
        ),
      },
    };

    render(<HierarchicalManage {...overrideProps} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("delete-btn")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("delete-btn"));
    expect(screen.getByText("This will also delete related items.")).toBeInTheDocument();
  });

  /* ── Restore confirmation ──────────────────────────────── */

  it("shows restore confirm dialog when onRestore is called", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    const props = baseProps(fns);
    const overrideProps = {
      ...props,
      child: {
        ...props.child,
        render: (_children: TestChild[], callbacks: HierarchicalManageChildCallbacks, _ctx: HierarchicalManageRenderContext) => (
          <div>
            <button type="button" data-testid="restore-btn" onClick={() => callbacks.onRestore(10)}>
              Restore
            </button>
          </div>
        ),
      },
    };

    render(<HierarchicalManage {...overrideProps} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("restore-btn")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("restore-btn"));
    expect(screen.getByText(/Restore item/)).toBeInTheDocument();
    expect(screen.getByText("Yes, restore")).toBeInTheDocument();
  });

  it("calls children.restoreApi on restore confirm", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    const props = baseProps(fns);
    const overrideProps = {
      ...props,
      child: {
        ...props.child,
        render: (_children: TestChild[], callbacks: HierarchicalManageChildCallbacks, _ctx: HierarchicalManageRenderContext) => (
          <div>
            <button type="button" data-testid="restore-btn" onClick={() => callbacks.onRestore(10)}>
              Restore
            </button>
          </div>
        ),
      },
    };

    render(<HierarchicalManage {...overrideProps} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("restore-btn")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("restore-btn"));
    await user.click(screen.getByText("Yes, restore"));

    await waitFor(() => {
      expect(fns.childRestore).toHaveBeenCalledWith(10, expect.anything());
    });
  });

  it("renders restore description from dialogs config", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    const props = baseProps(fns);
    const overrideProps = {
      ...props,
      dialogs: { restoreDescription: "This will also restore related items." },
      child: {
        ...props.child,
        render: (_children: TestChild[], callbacks: HierarchicalManageChildCallbacks, _ctx: HierarchicalManageRenderContext) => (
          <div>
            <button type="button" data-testid="restore-btn" onClick={() => callbacks.onRestore(10)}>
              Restore
            </button>
          </div>
        ),
      },
    };

    render(<HierarchicalManage {...overrideProps} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("restore-btn")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("restore-btn"));
    expect(screen.getByText("This will also restore related items.")).toBeInTheDocument();
  });

  /* ── Tab switching ─────────────────────────────────────── */

  it("renders tabs when tabs.deleted is provided", async () => {
    const fns = makeApiFns();
    const props = baseProps(fns);
    const overrideProps = {
      ...props,
      tabs: {
        deleted: {
          queryKey: ["testDeletedChildren", "1"] as const,
          listFn: fns.childListDeleted,
        },
      },
    };

    render(<HierarchicalManage {...overrideProps} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Active" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Deleted" })).toBeInTheDocument();
    });
  });

  it("switches to deleted tab and calls deleted listFn", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    const props = baseProps(fns);
    const overrideProps = {
      ...props,
      tabs: {
        deleted: {
          queryKey: ["testDeletedChildren", "1"] as const,
          listFn: fns.childListDeleted,
        },
      },
    };

    render(<HierarchicalManage {...overrideProps} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("child-row-10")).toBeInTheDocument();
    });

    // Switch to deleted tab
    await user.click(screen.getByRole("tab", { name: "Deleted" }));

    await waitFor(() => {
      expect(fns.childListDeleted).toHaveBeenCalled();
    });
  });

  it("passes isDeletedView context to render callback", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    let capturedContext: HierarchicalManageRenderContext | null = null;

    const props = baseProps(fns);
    const overrideProps = {
      ...props,
      tabs: {
        deleted: {
          queryKey: ["testDeletedChildren", "1"] as const,
          listFn: fns.childListDeleted,
        },
      },
      child: {
        ...props.child,
        render: (_children: TestChild[], _callbacks: HierarchicalManageChildCallbacks, ctx: HierarchicalManageRenderContext) => {
          capturedContext = ctx;
          return <div data-testid="children-table">{ctx.isDeletedView ? "deleted" : "active"}</div>;
        },
      },
    };

    render(<HierarchicalManage {...overrideProps} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("children-table")).toHaveTextContent("active");
    });
    expect(capturedContext).toMatchObject({ isDeletedView: false });
    expect(capturedContext).toHaveProperty("parentData");

    await user.click(screen.getByRole("tab", { name: "Deleted" }));

    await waitFor(() => {
      expect(screen.getByTestId("children-table")).toHaveTextContent("deleted");
    });
    expect(capturedContext).toMatchObject({ isDeletedView: true });
  });

  it("hides create button in readonly deleted tab", async () => {
    const user = userEvent.setup();
    const fns = makeApiFns();
    const props = baseProps(fns);
    const overrideProps = {
      ...props,
      tabs: {
        deleted: {
          queryKey: ["testDeletedChildren", "1"] as const,
          listFn: fns.childListDeleted,
          readonly: true,
        },
      },
    };

    render(<HierarchicalManage {...overrideProps} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "+ Add Child" })).toBeInTheDocument();
    });

    // Switch to deleted tab
    await user.click(screen.getByRole("tab", { name: "Deleted" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "+ Add Child" })).not.toBeInTheDocument();
    });
  });

  /* ── Pagination ────────────────────────────────────────── */

  it("renders pagination when pagination.enabled is true", async () => {
    const fns = makeApiFns();
    fns.childList.mockResolvedValueOnce({
      items: Array.from({ length: 25 }, (_, i) => ({ id: i, name: `Child ${i}` })),
      total: 25,
      page: 1,
      page_size: 20,
      total_pages: 2,
    } as TestListResponse);

    const props = baseProps(fns);
    const overrideProps = {
      ...props,
      pagination: { enabled: true },
    };

    render(<HierarchicalManage {...overrideProps} />, { wrapper: wrap() });

    await waitFor(() => {
      // Pagination component renders "Showing X–Y of Z"
      expect(screen.getByText(/Showing 1–20 of 25/)).toBeInTheDocument();
    });
  });

  it("does not render pagination when pagination is not configured", async () => {
    const fns = makeApiFns();
    render(<HierarchicalManage {...baseProps(fns)} />, { wrapper: wrap() });

    await waitFor(() => {
      expect(screen.getByTestId("child-row-10")).toBeInTheDocument();
    });

    // Pagination component should not be present
    expect(screen.queryByText(/Showing 1–/)).not.toBeInTheDocument();
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
