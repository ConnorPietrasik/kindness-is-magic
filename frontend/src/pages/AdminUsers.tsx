/**
 * Admin — Manage Users
 *
 * List, create, edit, delete users.
 * Uses useCrudManager for data fetching and mutations.
 * Separate "Deleted" tab calls the /deleted endpoint.
 * Supports role filter and text search on both tabs.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ActionsDropdown } from "../components/ActionsDropdown";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CrudTabs } from "../components/CrudTabs";
import { FormField } from "../components/FormField";
import { HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { Pagination } from "../components/Pagination";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useToast } from "../context/ToastContext";
import { useCrudManager } from "../hooks/useCrudManager";
import { useCrudTabs } from "../hooks/useCrudTabs";
import { getPaginationInfo, usePagination } from "../hooks/usePagination";
import {
  adminCreateUser,
  adminDeleteUser,
  adminGetFamiliesDropdown,
  adminGetReferrersDropdown,
  adminGetUser,
  adminListDeletedUsers,
  adminListUsers,
  adminResetUserPassword,
  adminRestoreUser,
  adminUpdateUser,
} from "../lib/api";
import { adminDeletedUsers, adminFamiliesDropdown, adminReferrersDropdown, adminUsers } from "../lib/queryKeys";
import { route } from "../lib/routes";
import { normalizeUpdatePayload } from "../lib/utils";
import type {
  AdminUserCreate,
  AdminUsersListParams,
  AdminUserUpdate,
  FamilyDropdownItem,
  ReferrerDropdownItem,
  UserDetail,
  UserListResponse,
  UserPasswordReset,
  UserRole,
} from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminUsers() {
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [restoreConfirm, setRestoreConfirm] = useState<number | null>(null);
  const [resetPasswordId, setResetPasswordId] = useState<number | null>(null);

  const pagination = usePagination();
  const { viewTab, isDeletedView, handleTabChange } = useCrudTabs({ pagination });
  const queryClient = useQueryClient();
  const toast = useToast();

  // Build list params from filters (no include_deleted — deleted uses separate endpoint)
  const listParams = useMemo<AdminUsersListParams>(
    () => ({
      ...pagination.params,
      role: roleFilter || undefined,
      search: searchQuery || undefined,
    }),
    [pagination.params, roleFilter, searchQuery]
  );

  // CRUD manager for users
  const {
    listData,
    listLoading,
    detail,
    detailLoading,
    createMut,
    updateMut,
    deleteMut,
    restoreMut,
    showForm,
    editingId,
    deleteConfirm,
    openCreate,
    openEdit,
    cancelForm,
    confirmDelete,
    cancelDelete,
  } = useCrudManager<UserListResponse, UserDetail, AdminUserCreate, AdminUsersListParams>({
    rootKey: isDeletedView ? adminDeletedUsers : adminUsers,
    listFn: isDeletedView ? adminListDeletedUsers : adminListUsers,
    listParams,
    detailFn: adminGetUser,
    createFn: isDeletedView ? undefined : adminCreateUser,
    updateFn: isDeletedView ? undefined : adminUpdateUser,
    deleteFn: isDeletedView ? undefined : adminDeleteUser,
    restoreFn: adminRestoreUser,
    invalidationKeys: [adminUsers, adminDeletedUsers],
    entityName: "User",
  });

  // Fetch referrers for dropdown (only active)
  const { data: referrers } = useQuery({
    queryKey: adminReferrersDropdown,
    queryFn: () => adminGetReferrersDropdown(),
  });

  // Fetch families for dropdown (only active)
  const { data: families } = useQuery({
    queryKey: adminFamiliesDropdown,
    queryFn: () => adminGetFamiliesDropdown(),
  });

  // Reset password mutation (special — not standard CRUD)
  const resetPasswordMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UserPasswordReset }) => adminResetUserPassword(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminUsers });
      queryClient.invalidateQueries({ queryKey: adminDeletedUsers });
      setResetPasswordId(null);
      toast.success("Password reset");
    },
  });

  // Handlers — construct typed payloads from form state
  function handleCreateUser(formData: UserFormState) {
    createMut.mutate({
      email: formData.email,
      password: formData.password,
      role: formData.role,
      display_name: formData.display_name || null,
      referrer_id: formData.role === "referrer" ? formData.referrer_id : null,
      family_id: formData.role === "family" ? formData.family_id : null,
    });
  }

  function handleUpdateUser(formData: UserFormState) {
    if (editingId == null || detail == null) return;
    const payload: AdminUserUpdate = {
      display_name: formData.display_name,
      role: formData.role,
      // 0 is the backend sentinel for "set FK to NULL".
      // AdminUserUpdate types this as number | null, so 0 is a valid number.
      referrer_id: formData.role === "referrer" ? formData.referrer_id : 0,
      family_id: formData.role === "family" ? formData.family_id : 0,
    };
    // Call adminUpdateUser directly — useCrudManager's Payload is AdminUserCreate
    // which doesn't match AdminUserUpdate (missing email/password). The hook
    // still handles list invalidation and toasts via its onSuccess callback.
    updateMut.mutate({ id: editingId, data: normalizeUpdatePayload(payload, detail) as AdminUserCreate });
  }

  // Reset password form state
  const [resetForm, setResetForm] = useState({ password: "", confirmPassword: "" });

  function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (resetForm.password !== resetForm.confirmPassword) return;
    if (resetPasswordId == null) return;
    resetPasswordMut.mutate({ id: resetPasswordId, data: { password: resetForm.password } });
  }

  const pageInfo = useMemo(
    () => getPaginationInfo(listData?.total ?? 0, pagination.page, pagination.pageSize),
    [listData?.total, pagination.page, pagination.pageSize]
  );

  const users = listData?.users ?? [];

  if (listLoading) return <PageSpinner />;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" />

      <main className="mx-auto max-w-[900px] px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Manage Users</h2>
          {!isDeletedView && <Button onClick={openCreate}>+ Add User</Button>}
        </div>

        {/* Tabs */}
        <CrudTabs viewTab={viewTab} onChange={handleTabChange} />

        {/* Tab panel content */}
        <div role="tabpanel">
          {/* Filters */}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                pagination.goToPage(1);
              }}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            >
              <option value="">All roles</option>
              <option value="admin">Admin</option>
              <option value="referrer">Referrer</option>
              <option value="family">Family</option>
              <option value="purchaser">Purchaser</option>
              <option value="delivery">Delivery</option>
            </select>
            <input
              type="text"
              placeholder="Search email or name…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                pagination.goToPage(1);
              }}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            />
          </div>

          {/* Create form (active tab only) */}
          {showForm && (
            <UserForm
              title="Add User"
              initial={defaultUserForm}
              isEdit={false}
              referrers={referrers ?? []}
              families={families ?? []}
              onCreate={handleCreateUser}
              onUpdate={handleUpdateUser}
              onCancel={cancelForm}
              loading={!!createMut.isPending}
            />
          )}

          {/* Table */}
          {users.length === 0 ? (
            <Card>
              <p className="py-8 text-center text-gray-400">{isDeletedView ? "No deleted users." : "No users found."}</p>
            </Card>
          ) : (
            <Table>
              <TableHead>
                <Th>Email</Th>
                <Th>Display Name</Th>
                <Th>Role</Th>
                <Th>Linked to</Th>
                <Th>Created</Th>
                <Th>Actions</Th>
              </TableHead>
              <TableBody>
                {users.map((u) => (
                  <>
                    <Tr key={u.id}>
                      <Td className={u.deleted_at != null ? "text-gray-400" : ""}>{u.email}</Td>
                      <Td className={u.deleted_at != null ? "text-gray-400" : ""}>{u.display_name}</Td>
                      <Td>
                        <RoleBadge role={u.role} />
                      </Td>
                      <Td>
                        {u.referrer_id ? (
                          <Link to={route.adminReferrerFamilies(u.referrer_id)} className="text-btn-start hover:underline">
                            {u.referrer_name}
                          </Link>
                        ) : u.family_id ? (
                          <Link to={route.adminFamilyPeople(u.family_id)} className="text-btn-start hover:underline">
                            {u.family_name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td className="text-xs text-gray-500">{new Date(u.created_at).toLocaleDateString()}</Td>
                      <Td>
                        <div className="flex gap-2">
                          {!isDeletedView && u.deleted_at == null && (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="px-3 py-1.5 text-xs"
                                onClick={() => (editingId === u.id ? cancelForm() : openEdit(u.id))}
                              >
                                {editingId === u.id ? "Done" : "Edit"}
                              </Button>
                              <ActionsDropdown
                                items={[
                                  {
                                    label: "Reset Pw",
                                    variant: "secondary" as const,
                                    onClick: () => {
                                      setResetPasswordId(u.id);
                                      setResetForm({ password: "", confirmPassword: "" });
                                    },
                                    disabled: !!editingId,
                                  },
                                  {
                                    label: "Delete",
                                    variant: "danger" as const,
                                    onClick: () => confirmDelete(u.id),
                                  },
                                ]}
                                disabled={deleteMut.isPending}
                              />
                            </>
                          )}
                          {isDeletedView && (
                            <Button
                              variant="secondary"
                              size="sm"
                              className="px-3 py-1.5 text-xs"
                              onClick={() => setRestoreConfirm(u.id)}
                              disabled={restoreMut.isPending}
                            >
                              Restore
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                    {editingId === u.id && (
                      <Tr key={`${u.id}-edit`}>
                        <Td colSpan={6} className="!py-3">
                          <div className="rounded-xl bg-gray-50 p-4">
                            {detailLoading ? (
                              <div className="flex items-center justify-center gap-3 py-6 text-btn-start">
                                <Spinner size="sm" />
                                <span className="text-sm font-medium">Loading…</span>
                              </div>
                            ) : detail ? (
                              <UserForm
                                title="Edit User"
                                initial={detail}
                                isEdit={true}
                                referrers={referrers ?? []}
                                families={families ?? []}
                                onCreate={handleCreateUser}
                                onUpdate={handleUpdateUser}
                                onCancel={cancelForm}
                                loading={!!updateMut.isPending}
                              />
                            ) : null}
                          </div>
                        </Td>
                      </Tr>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Pagination */}
          <Pagination
            page={pagination.page}
            totalPages={pageInfo.totalPages}
            total={listData?.total ?? 0}
            pageSize={pagination.pageSize}
            onPageChange={pagination.goToPage}
            onPageSizeChange={pagination.setPageSize}
          />

          {/* Delete confirmation */}
          <ConfirmDialog
            open={deleteConfirm !== null}
            title={
              <>
                Delete user <strong>#{deleteConfirm}</strong>?
              </>
            }
            description="This will soft-delete the user. They will no longer be able to log in."
            onConfirm={() => {
              if (deleteConfirm != null) {
                deleteMut.mutate(deleteConfirm);
                cancelDelete();
              }
            }}
            onCancel={cancelDelete}
            loading={deleteMut.isPending}
          />

          {/* Restore confirmation */}
          <ConfirmDialog
            open={restoreConfirm !== null}
            title={
              <>
                Restore user <strong>#{restoreConfirm}</strong>?
              </>
            }
            onConfirm={() => {
              if (restoreConfirm != null) {
                restoreMut.mutate(restoreConfirm);
                setRestoreConfirm(null);
              }
            }}
            onCancel={() => setRestoreConfirm(null)}
            loading={restoreMut.isPending}
            confirmLabel="Yes, restore"
            loadingLabel="Restoring…"
            confirmVariant="secondary"
          />

          {/* Reset password dialog */}
          <ResetPasswordDialog
            open={resetPasswordId !== null}
            userId={resetPasswordId}
            form={resetForm}
            setForm={setResetForm}
            onSubmit={handleResetPassword}
            onCancel={() => setResetPasswordId(null)}
            loading={resetPasswordMut.isPending}
          />
        </div>

        {/* Errors */}
        <MutationErrors mutations={[createMut, updateMut, deleteMut, restoreMut, resetPasswordMut]} />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* UserForm sub-component                                              */
/* ------------------------------------------------------------------ */

const defaultUserForm: UserFormState = {
  email: "",
  display_name: "",
  role: "referrer",
  password: "",
  confirmPassword: "",
  referrer_id: null,
  family_id: null,
};

/** Internal form state — mirrors the inputs the user fills in. */
interface UserFormState {
  email: string;
  display_name: string;
  role: UserRole;
  password: string;
  confirmPassword: string;
  referrer_id: number | null;
  family_id: number | null;
}

interface UserFormProps {
  title: string;
  initial: Partial<UserDetail>;
  isEdit: boolean;
  referrers: ReferrerDropdownItem[];
  families: FamilyDropdownItem[];
  onCreate: (data: UserFormState) => void;
  onUpdate: (data: UserFormState) => void;
  onCancel: () => void;
  loading: boolean;
}

function UserForm({ title, initial, isEdit, referrers, families, onCreate, onUpdate, onCancel, loading }: UserFormProps) {
  const [form, setForm] = useState<UserFormState>(() => ({
    email: initial.email ?? "",
    display_name: initial.display_name ?? "",
    role: initial.role ?? "referrer",
    password: "",
    confirmPassword: "",
    referrer_id: initial.referrer_id ?? null,
    family_id: initial.family_id ?? null,
  }));

  useEffect(() => {
    setForm({
      email: initial.email ?? "",
      display_name: initial.display_name ?? "",
      role: initial.role ?? "referrer",
      password: "",
      confirmPassword: "",
      referrer_id: initial.referrer_id ?? null,
      family_id: initial.family_id ?? null,
    });
  }, [initial]);

  const update = (key: string, val: unknown) => setForm((p) => ({ ...p, [key]: val }));

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      if (!isEdit && form.password !== form.confirmPassword) return;

      if (isEdit) {
        onUpdate(form);
      } else {
        onCreate(form);
      }
    },
    [form, isEdit, onCreate, onUpdate]
  );

  const isReferrer = form.role === "referrer";
  const isFamily = form.role === "family";

  return (
    <Card className="mb-6 border border-gray-200">
      <h3 className="mb-4 text-lg font-semibold text-violet-950">{title}</h3>
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-4 sm:flex-row">
          <FormField
            label="Email"
            type="email"
            fieldProps={{
              value: form.email,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("email", e.target.value),
              required: true,
              disabled: isEdit,
              autoComplete: "off",
            }}
          />
          <FormField
            label="Display Name"
            fieldProps={{
              value: form.display_name,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("display_name", e.target.value),
              maxLength: 40,
              autoComplete: "off",
            }}
          />
          <select
            value={form.role}
            onChange={(e) => update("role", e.target.value as UserRole)}
            className="rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
          >
            <option value="admin">Admin</option>
            <option value="referrer">Referrer</option>
            <option value="family">Family</option>
            <option value="purchaser">Purchaser</option>
            <option value="delivery">Delivery</option>
          </select>
        </div>

        {/* Conditional FK dropdowns */}
        {isReferrer && (
          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Referrer</label>
            <select
              value={form.referrer_id ?? ""}
              onChange={(e) => update("referrer_id", e.target.value ? parseInt(e.target.value, 10) : null)}
              required
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            >
              <option value="">Select a referrer…</option>
              {referrers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {isFamily && (
          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">Family</label>
            <select
              value={form.family_id ?? ""}
              onChange={(e) => update("family_id", e.target.value ? parseInt(e.target.value, 10) : null)}
              required
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            >
              <option value="">Select a family…</option>
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.family_name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Password fields — create only */}
        {!isEdit && (
          <div className="mt-4 flex flex-col gap-4 sm:flex-row">
            <FormField
              label="Password"
              type="password"
              fieldProps={{
                value: form.password,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("password", e.target.value),
                required: true,
                minLength: 8,
                placeholder: "Min 8 characters",
                autoComplete: "off",
              }}
            />
            <FormField
              label="Confirm Password"
              type="password"
              fieldProps={{
                value: form.confirmPassword,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("confirmPassword", e.target.value),
                required: true,
                minLength: 8,
                autoComplete: "off",
              }}
            />
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <Button type="submit" loading={loading}>
            {loading ? "Saving\u2026" : isEdit ? "Update" : "Create"}
          </Button>
          <Button variant="secondary" type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* ResetPasswordDialog                                                 */
/* ------------------------------------------------------------------ */

interface ResetPasswordDialogProps {
  open: boolean;
  userId: number | null;
  form: { password: string; confirmPassword: string };
  setForm: (form: { password: string; confirmPassword: string }) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  loading: boolean;
}

function ResetPasswordDialog({ open, userId, form, setForm, onSubmit, onCancel, loading }: ResetPasswordDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
        <p className="mb-4 text-sm font-semibold text-gray-700">
          Reset password for user <strong>#{userId}</strong>
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <FormField
            label="New password"
            type="password"
            fieldProps={{
              value: form.password,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, password: e.target.value }),
              required: true,
              minLength: 8,
              placeholder: "Min 8 characters",
              autoComplete: "off",
            }}
          />
          <FormField
            label="Confirm password"
            type="password"
            fieldProps={{
              value: form.confirmPassword,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, confirmPassword: e.target.value }),
              required: true,
              minLength: 8,
              autoComplete: "off",
            }}
          />
          <div className="flex gap-3 pt-1">
            <Button type="submit" className="flex-1" loading={loading}>
              {loading ? "Resetting\u2026" : "Set Password"}
            </Button>
            <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* RoleBadge                                                           */
/* ------------------------------------------------------------------ */

const roleColors: Record<UserRole, string> = {
  admin: "bg-red-100 text-red-700",
  referrer: "bg-blue-100 text-blue-700",
  family: "bg-green-100 text-green-700",
  purchaser: "bg-orange-100 text-orange-700",
  delivery: "bg-teal-100 text-teal-700",
};

function RoleBadge({ role }: { role: UserRole }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${roleColors[role] ?? "bg-gray-100 text-gray-700"}`}>{role}</span>;
}
