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
 *   │  [+ Add Child]                                          │
 *   │  Create form  (conditional)                              │
 *   │  Edit form  (conditional)                               │
 *   │  Table via renderChildren                               │
 *   │  ConfirmDialog + MutationErrors                         │
 *   └──────────────────────────────────────────────────────────┘
 *
 * The component owns all mutations. The caller provides API functions,
 * form components, optional normalise functions, and render callbacks.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { useState } from "react";
import { useCrudManager } from "../hooks/useCrudManager";
import { Button } from "./Button";
import { Card } from "./Card";
import { ConfirmDialog } from "./ConfirmDialog";
import { MutationErrors } from "./MutationErrors";
import { PageSpinner, Spinner } from "./Spinner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Callbacks passed to `renderChildren` for action buttons in table rows.
 */
export interface HierarchicalManageChildCallbacks {
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onRestore: (id: number) => void;
  isEditing: (id: number) => boolean;
  isDeleting: boolean;
  isRestoring: boolean;
}

/**
 * Data passed to `renderParent` so the caller can build the parent card.
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

/**
 * Props for the HierarchicalManage wrapper.
 */
export interface HierarchicalManageProps<
  ParentDetail,
  ParentPayload,
  ParentFormProps extends HierarchicalManageBaseFormProps,
  ListResponse,
  ChildSummary,
  ChildDetail,
  ChildPayload,
  ChildFormProps extends HierarchicalManageBaseFormProps,
> {
  // ── Navigation / layout ───────────────────────────────────
  backLinkTo: string;
  backLinkLabel: string;

  // ── Parent ────────────────────────────────────────────────
  parentId: number;
  parentQueryKey: readonly string[];
  parentFetchFn: (id: number) => Promise<ParentDetail>;
  parentUpdateApi: (id: number, data: ParentPayload) => Promise<ParentDetail>;
  /** Normalise form data into an update payload. Defaults to identity. */
  parentNormaliseFn?: (formData: ParentPayload, original: ParentDetail) => ParentPayload;
  /** React component for the parent edit form */
  parentFormComponent: ComponentType<ParentFormProps>;
  /** Extra props merged into the parent form (beyond title/initial/isEdit/onSubmit/onCancel/loading) */
  parentFormExtra?: Omit<ParentFormProps, keyof HierarchicalManageBaseFormProps>;
  /** Renders the parent card (display rows + edit toggle + form) */
  renderParent: (props: HierarchicalManageParentRenderProps<ParentDetail>) => React.JSX.Element;
  parentInvalidationKeys?: ReadonlyArray<string | readonly string[]>;

  // ── Children ──────────────────────────────────────────────
  childQueryKey: readonly string[];
  childListParams?: Record<string, unknown>;
  childListFn: (params?: Record<string, unknown>) => Promise<ListResponse>;
  childDetailFn: (id: number) => Promise<ChildDetail>;
  childCreateApi: (data: ChildPayload) => Promise<ChildDetail>;
  childUpdateApi: (id: number, data: ChildPayload) => Promise<ChildDetail>;
  childDeleteApi: (id: number) => Promise<void>;
  childRestoreApi?: (id: number) => Promise<ChildDetail>;
  /** Normalise form data for create. Defaults to identity. */
  childCreateNormaliseFn?: (formData: ChildPayload) => ChildPayload;
  /** Normalise form data for update. Defaults to identity. */
  childUpdateNormaliseFn?: (formData: ChildPayload, original: ChildDetail) => ChildPayload;
  /** Default form values for create */
  childFormDefault: ChildPayload;
  /** React component for the child form */
  childFormComponent: ComponentType<ChildFormProps>;
  /** Extra props merged into the child form */
  childFormExtra?: Omit<ChildFormProps, keyof HierarchicalManageBaseFormProps>;
  /** Renders the children table */
  renderChildren: (children: ChildSummary[], callbacks: HierarchicalManageChildCallbacks) => React.JSX.Element;
  childrenTitle: string;
  createButtonLabel: string;
  childInvalidationKeys: ReadonlyArray<string | readonly string[]>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HierarchicalManage<
  ParentDetail,
  ParentPayload,
  ParentFormProps extends HierarchicalManageBaseFormProps,
  ListResponse,
  ChildSummary,
  ChildDetail,
  ChildPayload,
  ChildFormProps extends HierarchicalManageBaseFormProps,
>({
  backLinkTo: _backLinkTo,
  backLinkLabel: _backLinkLabel,

  parentId,
  parentQueryKey,
  parentFetchFn,
  parentUpdateApi,
  parentNormaliseFn,
  parentFormComponent: _ParentForm,
  parentFormExtra: _parentFormExtra,
  renderParent,
  parentInvalidationKeys = [],

  childQueryKey,
  childListParams,
  childListFn,
  childDetailFn,
  childCreateApi,
  childUpdateApi,
  childDeleteApi,
  childRestoreApi,
  childCreateNormaliseFn,
  childUpdateNormaliseFn,
  childFormDefault,
  childFormComponent: ChildForm,
  childFormExtra,
  renderChildren,
  childrenTitle,
  createButtonLabel,
  childInvalidationKeys,
}: HierarchicalManageProps<
  ParentDetail,
  ParentPayload,
  ParentFormProps,
  ListResponse,
  ChildSummary,
  ChildDetail,
  ChildPayload,
  ChildFormProps
>) {
  const queryClient = useQueryClient();

  /* ── Parent query ──────────────────────────────────────── */
  const { data: parentData, isLoading: parentLoading } = useQuery({
    queryKey: parentQueryKey as string[],
    queryFn: () => parentFetchFn(parentId),
  });

  /* ── Parent update mutation ────────────────────────────── */
  const parentUpdateMut = useMutation({
    mutationFn: (formData: ParentPayload) => {
      const payload = parentData ? (parentNormaliseFn ?? defaultNormalise)(formData, parentData as unknown as ParentDetail) : formData;
      return parentUpdateApi(parentId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: parentQueryKey as string[] });
      parentInvalidationKeys.forEach((k) => queryClient.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] }));
    },
  });

  const [showEditParent, setShowEditParent] = useState(false);

  /* ── Children CRUD ─────────────────────────────────────── */
  const crud = useCrudManager({
    rootKey: childQueryKey as string[],
    listParams: childListParams,
    listFn: childListFn,
    detailFn: childDetailFn,
    createFn: childCreateApi,
    updateFn: childUpdateApi,
    deleteFn: childDeleteApi,
    restoreFn: childRestoreApi,
    invalidationKeys: childInvalidationKeys as (string | string[])[],
  });

  /* ── Derived state ─────────────────────────────────────── */
  const childrenList = extractChildrenArray(crud.listData) as ChildSummary[];

  /* ── Child form handlers ───────────────────────────────── */
  function handleChildCreate(formData: ChildPayload) {
    const payload = (childCreateNormaliseFn ?? defaultNormalise)(formData) as ChildPayload;
    crud.createMut?.mutate(payload);
  }

  function handleChildUpdate(formData: ChildPayload) {
    if (crud.editingId == null || crud.detail == null) return;
    const detail = crud.detail as ChildDetail;
    const payload = (childUpdateNormaliseFn ?? defaultNormalise)(formData, detail);
    crud.updateMut?.mutate({ id: crud.editingId, data: payload as ChildPayload });
  }

  /* ── Child callbacks for renderChildren ────────────────── */
  const childCallbacks: HierarchicalManageChildCallbacks = {
    onEdit: crud.openEdit,
    onDelete: crud.confirmDelete,
    onRestore: (id: number) => crud.restoreMut?.mutate(id),
    isEditing: (id: number) => crud.editingId === id,
    isDeleting: crud.deleteMut?.isPending ?? false,
    isRestoring: crud.restoreMut?.isPending ?? false,
  };

  /* ── Parent render props ───────────────────────────────── */
  const parentRenderProps: HierarchicalManageParentRenderProps<ParentDetail> = {
    data: parentData ?? null,
    isEditing: showEditParent,
    onToggleEdit: () => setShowEditParent((v) => !v),
    isSaving: parentUpdateMut.isPending,
    onSave: (formData: unknown) => parentUpdateMut.mutate(formData as ParentPayload),
  };

  /* ── Child form props (built internally) ───────────────── */
  const childCreateFormProps: ChildFormProps = {
    title: createButtonLabel.replace(/^\+ /, "Add "),
    initial: childFormDefault as unknown as Record<string, unknown>,
    isEdit: false,
    onSubmit: (formData: unknown) => handleChildCreate(formData as ChildPayload),
    onCancel: crud.cancelForm,
    loading: crud.createMut?.isPending ?? false,
    ...(childFormExtra ?? {}),
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
          ...(childFormExtra ?? {}),
        } as ChildFormProps)
      : ({} as ChildFormProps);

  /* ── Loading gate ──────────────────────────────────────── */
  if (parentLoading || crud.listLoading) {
    return <PageSpinner />;
  }

  /* ── Render ────────────────────────────────────────────── */
  return (
    <div>
      {/* ── Parent section ────────────────────────────────── */}
      {renderParent(parentRenderProps)}

      {/* ── Children section ──────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">{childrenTitle}</h3>
        <Button onClick={crud.openCreate}>{createButtonLabel}</Button>
      </div>

      {/* Create form */}
      {crud.showForm && <ChildForm {...childCreateFormProps} />}

      {/* Edit form — loading spinner */}
      {crud.editingId != null && crud.detailLoading && (
        <Card className="mb-6 border border-gray-200">
          <div className="flex items-center justify-center gap-3 py-6 text-btn-start">
            <Spinner size="sm" />
            <span className="text-sm font-medium">Loading…</span>
          </div>
        </Card>
      )}

      {/* Edit form */}
      {crud.editingId != null && crud.detail != null && <ChildForm {...childEditFormProps} />}

      {/* Children table */}
      {renderChildren(childrenList, childCallbacks)}

      {/* ── Delete confirmation ───────────────────────────── */}
      <ConfirmDialog
        open={crud.deleteConfirm !== null}
        title={
          <>
            Delete item <strong>#{crud.deleteConfirm}</strong>?
          </>
        }
        onConfirm={() => {
          if (crud.deleteConfirm != null) {
            crud.deleteMut?.mutate(crud.deleteConfirm);
            crud.cancelDelete();
          }
        }}
        onCancel={crud.cancelDelete}
        loading={crud.deleteMut?.isPending ?? false}
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
