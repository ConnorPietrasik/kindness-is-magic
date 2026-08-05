/**
 * HierarchicalManage — shared wrapper for parent-detail + child-CRUD pages.
 *
 * Encapsulates the repeated layout:
 *
 *   ┌─ Parent info card (view / edit toggle) ─────────────────┐
 *   │  Title + badge                                          │
 *   │  InfoRow fields  or  EditForm                           │
 *   └──────────────────────────────────────────────────────────┘
 *   ── Children section ──────────────────────────────────────
 *   │  [Tabs: Active / Deleted]  (optional)                    │
 *   │  [+ Add Child]                                          │
 *   │  Create form  (conditional)                              │
 *   │  Edit form  (conditional)                               │
 *   │  Table via child.render                                 │
 *   │  Pagination  (optional)                                  │
 *   │  ConfirmDialog + MutationErrors                         │
 *   └──────────────────────────────────────────────────────────┘
 *
 * The component owns all mutations. The caller provides API functions,
 * form components, optional normalise functions, and render callbacks.
 *
 * Page-level chrome (HeaderBar, <main>, outer layout) stays in the caller.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ComponentType, ReactNode } from "react";
import { useMemo, useState } from "react";
import { useToast } from "../context/ToastContext";
import { useCrudManager } from "../hooks/useCrudManager";
import { useCrudTabs } from "../hooks/useCrudTabs";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import type { PaginationParams } from "../types";
import type { ButtonVariant } from "./Button";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { CrudTabs } from "./CrudTabs";
import { MutationErrors } from "./MutationErrors";
import { Pagination } from "./Pagination";
import { PageSpinner } from "./Spinner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Callbacks passed to `child.render` for action buttons in table rows.
 */
export interface HierarchicalManageChildCallbacks {
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onRestore: (id: number) => void;
  isEditing: (id: number) => boolean;
  isDeleting: boolean;
  isRestoring: boolean;
  /** Currently editing entity id (for inline row expansion). Undefined in non-HierarchicalManage usage. */
  editingId?: number | null;
  /** Whether the edit detail is still loading. */
  detailLoading?: boolean;
  /** Edit detail data (typed as unknown — cast in the render callback). */
  detail?: unknown;
  /** Form component to render inside the expanded row. */
  editFormComponent?: ComponentType<unknown>;
  /** Props to spread into the edit form component. */
  editFormProps?: unknown;
  /** Cancel editing (close the expanded row). */
  cancelForm?: () => void;
}

/**
 * Context passed to `child.render` so the caller can adapt row rendering.
 */
export interface HierarchicalManageRenderContext {
  /** Whether the current view is the deleted tab (if tabs are configured) */
  isDeletedView: boolean;
  /** Current parent data (if available) */
  parentData?: unknown;
}

/**
 * Data passed to `parent.render` so the caller can build the parent card.
 */
export interface HierarchicalManageParentRenderProps<ParentDetail> {
  /** Fetched parent data (null while loading) */
  data: ParentDetail | null;
  /** Whether the edit form is visible */
  isEditing: boolean;
  /** Toggle edit mode */
  onToggleEdit: () => void;
  /** Whether the parent update mutation is in-flight */
  isSaving: boolean;
  /** onSubmit handler wired to the internal mutation */
  onSave: (formData: unknown) => void;
}

/**
 * Base props that form components must accept.
 * Each form (FamilyForm, PersonForm, etc.) extends this with its own fields.
 */
export interface HierarchicalManageBaseFormProps {
  title: string;
  initial?: Record<string, unknown>;
  isEdit?: boolean;
  onSubmit: (formData: unknown) => void;
  onCancel: () => void;
  loading?: boolean;
}

// ---------------------------------------------------------------------------
// Grouped prop interfaces
// ---------------------------------------------------------------------------

/** Parent section configuration. */
export interface HierarchicalManageParentConfig<ParentDetail, ParentPayload> {
  /** Parent entity id (from route params) */
  id: number;
  /** React Query key for the parent detail query */
  queryKey: readonly string[];
  /** Fetches parent detail by id */
  fetchFn: (id: number) => Promise<ParentDetail>;
  /** Updates the parent entity */
  updateApi: (id: number, data: ParentPayload) => Promise<ParentDetail>;
  /** Normalise form data into an update payload. Defaults to identity. */
  normaliseFn?: (formData: ParentPayload, original: ParentDetail) => ParentPayload;
  /** Renders the parent card (display rows + edit toggle + form) */
  render: (props: HierarchicalManageParentRenderProps<ParentDetail>) => React.JSX.Element;
  /** Additional query keys to invalidate after parent update */
  invalidationKeys?: ReadonlyArray<string | readonly string[]>;
  /** Entity name for success toast messages (e.g. "Referrer"). Omit to disable. */
  entityName?: string;
}

/** Children section configuration. */
export interface HierarchicalManageChildConfig<
  ListResponse,
  ChildSummary,
  ChildDetail,
  ChildPayload,
  ChildFormProps extends HierarchicalManageBaseFormProps,
> {
  /** React Query key for the children list query (active tab) */
  queryKey: readonly string[];
  /** Fetches the children list. Receives optional pagination params. */
  listFn: (params?: PaginationParams) => Promise<ListResponse>;
  /** Fetches a single child by id (for editing) */
  detailFn: (id: number) => Promise<ChildDetail>;
  /** Creates a new child */
  createApi: (data: ChildPayload) => Promise<ChildDetail>;
  /** Updates an existing child */
  updateApi: (id: number, data: ChildPayload) => Promise<ChildDetail>;
  /** Soft-deletes a child */
  deleteApi: (id: number) => Promise<void>;
  /** Restores a soft-deleted child (optional) */
  restoreApi?: (id: number) => Promise<ChildDetail>;
  /** Normalise form data for create. Defaults to identity. */
  createNormaliseFn?: (formData: ChildPayload) => ChildPayload;
  /** Normalise form data for update. Defaults to identity. */
  updateNormaliseFn?: (formData: ChildPayload, original: ChildDetail) => ChildPayload;
  /** Default form values for create */
  formDefault: ChildPayload;
  /** React component for the child form */
  formComponent: ComponentType<ChildFormProps>;
  /** Extra props merged into the child form */
  formExtra?: Omit<ChildFormProps, keyof HierarchicalManageBaseFormProps>;
  /** Renders the children table */
  render: (
    children: ChildSummary[],
    callbacks: HierarchicalManageChildCallbacks,
    context: HierarchicalManageRenderContext
  ) => React.JSX.Element;
  /** Section title above the children table */
  title: string;
  /** Label for the create button */
  createButtonLabel: string;
  /** Additional query keys to invalidate after child mutations */
  invalidationKeys: ReadonlyArray<string | readonly string[]>;
  /** Entity name for child success toast messages (e.g. "Family"). Omit to disable. */
  entityName?: string;
  /** If true, disable create/edit/delete operations (read-only mode). */
  isReadonly?: boolean;
}

/** Optional deleted tab configuration. */
export interface HierarchicalManageTabsDeletedConfig<ListResponse> {
  /** React Query key for the deleted list query */
  queryKey: readonly string[];
  /** Fetches the deleted items list. Receives optional pagination params. */
  listFn: (params?: PaginationParams) => Promise<ListResponse>;
  /** If true, disable create/edit/delete in deleted view (restore-only) */
  readonly?: boolean;
}

/** Optional pagination configuration. */
export interface HierarchicalManagePaginationConfig {
  /** Enable pagination controls */
  enabled: boolean;
  /** Default page size. Default: 20 */
  defaultPageSize?: number;
}

/** Optional dialog text overrides. */
export interface HierarchicalManageDialogsConfig {
  /** Description shown in the delete confirmation dialog */
  deleteDescription?: ReactNode;
  /** Description shown in the restore confirmation dialog */
  restoreDescription?: ReactNode;
  /** Label on the restore confirm button. Default: "Yes, restore" */
  restoreConfirmLabel?: ReactNode;
  /** Label on the restore button while in-flight. Default: "Restoring…" */
  restoreLoadingLabel?: ReactNode;
  /** Button variant for the restore confirm button. Default: "secondary" */
  restoreVariant?: ButtonVariant;
}

// ---------------------------------------------------------------------------
// Main props interface
// ---------------------------------------------------------------------------

/**
 * Props for the HierarchicalManage wrapper.
 *
 * Props are grouped into `parent`, `child`, and optional `tabs` /
 * `pagination` / `dialogs` objects.
 */
export interface HierarchicalManageProps<
  ParentDetail,
  ParentPayload,
  ListResponse,
  ChildSummary,
  ChildDetail,
  ChildPayload,
  ChildFormProps extends HierarchicalManageBaseFormProps,
> {
  /** Parent section configuration */
  parent: HierarchicalManageParentConfig<ParentDetail, ParentPayload>;
  /** Children section configuration */
  child: HierarchicalManageChildConfig<ListResponse, ChildSummary, ChildDetail, ChildPayload, ChildFormProps>;
  /** Optional deleted tab configuration */
  tabs?: {
    deleted: HierarchicalManageTabsDeletedConfig<ListResponse>;
  };
  /** Optional pagination configuration */
  pagination?: HierarchicalManagePaginationConfig;
  /** Optional dialog text overrides */
  dialogs?: HierarchicalManageDialogsConfig;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HierarchicalManage<
  ParentDetail,
  ParentPayload,
  ListResponse,
  ChildSummary,
  ChildDetail,
  ChildPayload,
  ChildFormProps extends HierarchicalManageBaseFormProps,
>({
  parent,
  child: childConfig,
  tabs,
  pagination,
  dialogs,
}: HierarchicalManageProps<ParentDetail, ParentPayload, ListResponse, ChildSummary, ChildDetail, ChildPayload, ChildFormProps>) {
  const queryClient = useQueryClient();
  const toast = useToast();

  /* ── Pagination ────────────────────────────────────────── */
  const usePaginationControls = pagination?.enabled ?? false;
  const paginationCtrl = usePagination({
    defaultPageSize: pagination?.defaultPageSize,
  });

  /* ── Tab state ─────────────────────────────────────────── */
  const hasDeletedTab = !!tabs?.deleted;
  const { viewTab, isDeletedView, handleTabChange } = useCrudTabs(
    usePaginationControls ? { pagination: { goToPage: paginationCtrl.goToPage } } : undefined
  );

  /* ── Derived CRUD config based on active tab ───────────── */
  const deletedTab = tabs?.deleted;
  const currentRootKey = isDeletedView && deletedTab ? deletedTab.queryKey : childConfig.queryKey;
  const currentListFn = isDeletedView && deletedTab ? deletedTab.listFn : childConfig.listFn;
  const isReadonly = (isDeletedView && deletedTab ? (deletedTab.readonly ?? false) : false) || (childConfig.isReadonly ?? false);

  /* ── Parent query ──────────────────────────────────────── */
  const { data: parentData, isLoading: parentLoading } = useQuery({
    queryKey: parent.queryKey as string[],
    queryFn: () => parent.fetchFn(parent.id),
  });

  /* ── Parent update mutation ────────────────────────────── */
  const parentUpdateMut = useMutation({
    mutationFn: (formData: ParentPayload) => {
      const payload = parentData ? (parent.normaliseFn ?? defaultNormalise)(formData, parentData as unknown as ParentDetail) : formData;
      return parent.updateApi(parent.id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: parent.queryKey as string[] });
      (parent.invalidationKeys ?? []).forEach((k) => queryClient.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] }));
      setShowEditParent(false);
      if (parent.entityName) toast.success(`${parent.entityName} updated`);
    },
  });

  const [showEditParent, setShowEditParent] = useState(false);

  /* ── Children CRUD ─────────────────────────────────────── */
  const crud = useCrudManager({
    rootKey: currentRootKey as string[],
    listParams: usePaginationControls ? paginationCtrl.params : undefined,
    listFn: currentListFn,
    detailFn: childConfig.detailFn,
    createFn: isReadonly ? undefined : childConfig.createApi,
    updateFn: isReadonly ? undefined : childConfig.updateApi,
    deleteFn: isReadonly ? undefined : childConfig.deleteApi,
    restoreFn: childConfig.restoreApi,
    invalidationKeys: childConfig.invalidationKeys as (string | string[])[],
    entityName: childConfig.entityName,
  });

  /* ── Restore confirmation state ────────────────────────── */
  const [restoreConfirm, setRestoreConfirm] = useState<number | null>(null);

  /* ── Derived state ─────────────────────────────────────── */
  const childrenList = extractChildrenArray(crud.listData) as ChildSummary[];

  /* ── Pagination info ───────────────────────────────────── */
  const listTotal = (crud.listData as { total?: number } | undefined)?.total ?? 0;
  const pageInfo = useMemo(
    () => getPaginationInfo(listTotal, paginationCtrl.page, paginationCtrl.pageSize),
    [listTotal, paginationCtrl.page, paginationCtrl.pageSize]
  );

  /* ── Child form handlers ───────────────────────────────── */
  function handleChildCreate(formData: ChildPayload) {
    const payload = (childConfig.createNormaliseFn ?? defaultNormalise)(formData) as ChildPayload;
    crud.createMut?.mutate(payload);
  }

  function handleChildUpdate(formData: ChildPayload) {
    if (crud.editingId == null || crud.detail == null) return;
    const detail = crud.detail as ChildDetail;
    const payload = (childConfig.updateNormaliseFn ?? defaultNormalise)(formData, detail);
    crud.updateMut?.mutate({ id: crud.editingId, data: payload as ChildPayload });
  }

  /* ── Child form props (built internally) ───────────────── */
  const childCreateFormProps: ChildFormProps = {
    title: childConfig.createButtonLabel.replace(/^\+ /, "Add "),
    initial: childConfig.formDefault as unknown as Record<string, unknown>,
    isEdit: false,
    onSubmit: (formData: unknown) => handleChildCreate(formData as ChildPayload),
    onCancel: crud.cancelForm,
    loading: crud.createMut?.isPending ?? false,
    ...(childConfig.formExtra ?? {}),
  } as ChildFormProps;

  const childEditFormProps: ChildFormProps =
    crud.detail != null
      ? ({
          title: "Edit",
          initial: crud.detail as unknown as Record<string, unknown>,
          isEdit: true,
          onSubmit: (formData: unknown) => handleChildUpdate(formData as ChildPayload),
          onCancel: crud.cancelForm,
          loading: crud.updateMut?.isPending ?? false,
          ...(childConfig.formExtra ?? {}),
        } as ChildFormProps)
      : ({} as ChildFormProps);

  /* ── Child callbacks for child.render ──────────────────── */
  const childCallbacks: HierarchicalManageChildCallbacks = {
    onEdit: crud.openEdit,
    onDelete: crud.confirmDelete,
    onRestore: (id: number) => setRestoreConfirm(id),
    isEditing: (id: number) => crud.editingId === id,
    isDeleting: crud.deleteMut?.isPending ?? false,
    isRestoring: crud.restoreMut?.isPending ?? false,
    editingId: crud.editingId,
    detailLoading: crud.detailLoading,
    detail: crud.detail,
    editFormComponent: childConfig.formComponent as ComponentType<unknown>,
    editFormProps: childEditFormProps,
    cancelForm: crud.cancelForm,
  };

  /* ── Render context ────────────────────────────────────── */
  const renderContext: HierarchicalManageRenderContext = {
    isDeletedView,
    parentData: parentData,
  };

  /* ── Parent render props ───────────────────────────────── */
  const parentRenderProps: HierarchicalManageParentRenderProps<ParentDetail> = {
    data: parentData ?? null,
    isEditing: showEditParent,
    onToggleEdit: () => setShowEditParent((v) => !v),
    isSaving: parentUpdateMut.isPending,
    onSave: (formData: unknown) => parentUpdateMut.mutate(formData as ParentPayload),
  };

  /* ── Loading gate ──────────────────────────────────────── */
  if (parentLoading || crud.listLoading) {
    return <PageSpinner />;
  }

  /* ── Render ────────────────────────────────────────────── */
  return (
    <div>
      {/* ── Parent section ────────────────────────────────── */}
      {parent.render(parentRenderProps)}

      {/* ── Children section header ───────────────────────── */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">{childConfig.title}</h3>
        {!isReadonly && <Button onClick={crud.openCreate}>{childConfig.createButtonLabel}</Button>}
      </div>

      {/* ── Tabs (optional) ───────────────────────────────── */}
      {hasDeletedTab && <CrudTabs viewTab={viewTab} onChange={handleTabChange} />}

      {/* ── Tab panel content ─────────────────────────────── */}
      <div role="tabpanel">
        {/* Create form */}
        {crud.showForm && <childConfig.formComponent {...childCreateFormProps} />}

        {/* Children table — edit form renders inline inside expanded rows */}
        {childConfig.render(childrenList, childCallbacks, renderContext)}

        {/* Pagination (optional) */}
        {usePaginationControls && (
          <Pagination
            page={paginationCtrl.page}
            totalPages={pageInfo.totalPages}
            total={listTotal}
            pageSize={paginationCtrl.pageSize}
            onPageChange={(page) => {
              paginationCtrl.goToPage(page);
            }}
            onPageSizeChange={paginationCtrl.setPageSize}
          />
        )}
      </div>

      {/* ── Delete confirmation ───────────────────────────── */}
      <ConfirmDialog
        open={crud.deleteConfirm !== null}
        title={
          <>
            Delete item <strong>#{crud.deleteConfirm}</strong>?
          </>
        }
        description={dialogs?.deleteDescription}
        onConfirm={() => {
          if (crud.deleteConfirm != null) {
            crud.deleteMut?.mutate(crud.deleteConfirm);
            crud.cancelDelete();
          }
        }}
        onCancel={crud.cancelDelete}
        loading={crud.deleteMut?.isPending ?? false}
      />

      {/* ── Restore confirmation ──────────────────────────── */}
      <ConfirmDialog
        open={restoreConfirm !== null}
        title={
          <>
            Restore item <strong>#{restoreConfirm}</strong>?
          </>
        }
        description={dialogs?.restoreDescription}
        onConfirm={() => {
          if (restoreConfirm != null) {
            crud.restoreMut?.mutate(restoreConfirm);
            setRestoreConfirm(null);
          }
        }}
        onCancel={() => setRestoreConfirm(null)}
        loading={crud.restoreMut?.isPending ?? false}
        confirmLabel={dialogs?.restoreConfirmLabel ?? "Yes, restore"}
        loadingLabel={dialogs?.restoreLoadingLabel ?? "Restoring…"}
        confirmVariant={dialogs?.restoreVariant ?? "secondary"}
      />

      {/* ── Errors ────────────────────────────────────────── */}
      <MutationErrors
        mutations={[parentUpdateMut, crud.createMut, crud.updateMut, crud.deleteMut, crud.restoreMut].filter(
          (m): m is NonNullable<typeof m> => m != null
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default normalise — identity (caller can provide normaliseUpdatePayload) */
function defaultNormalise<T, O = unknown>(data: T, _original?: O): T {
  return data;
}

/**
 * Extract the children array from a paginated list response.
 * Handles: { people: [] }, { families: [] }, { referrers: [] }, etc.
 */
function extractChildrenArray<ListResponse>(listData: ListResponse | undefined): unknown[] {
  if (!listData) return [];
  const data = listData as Record<string, unknown>;
  for (const key of ["people", "families", "referrers", "items", "children"]) {
    if (Array.isArray(data[key])) return data[key] as unknown[];
  }
  const firstArray = Object.values(data).find((v) => Array.isArray(v));
  return firstArray ?? [];
}
