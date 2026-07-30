/**
 * Admin — Manage Users
 *
 * List, create, edit, delete users.
 * Uses useCrudManager for data fetching and mutations.
 * Supports role filter, text search, and include_deleted toggle.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FormField } from "../components/FormField";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useToast } from "../context/ToastContext";
import {
  adminCreateUser,
  adminDeleteUser,
  adminGetUser,
  adminListFamilies,
  adminListReferrers,
  adminListUsers,
  adminResetUserPassword,
  adminRestoreUser,
  adminUpdateUser,
} from "../lib/api";
import { route } from "../lib/routes";
import { normalizeUpdatePayload } from "../lib/utils";
import type {
  AdminUserCreate,
  AdminUsersListParams,
  AdminUserUpdate,
  ReferrerSummary,
  UserDetail,
  UserPasswordReset,
  UserRole,
} from "../types";

const USER_KEYS = ["adminUsers"];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminUsers() {
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [restoreConfirm, setRestoreConfirm] = useState<number | null>(null);
  const [resetPasswordId, setResetPasswordId] = useState<number | null>(null);

  // Build list params from filters
  const listParams = useMemo<AdminUsersListParams>(
    () => ({
      page,
      page_size: pageSize,
      include_deleted: includeDeleted,
      role: roleFilter || undefined,
      search: searchQuery || undefined,
    }),
    [page, pageSize, includeDeleted, roleFilter, searchQuery]
  );

  // Fetch users
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: [...USER_KEYS, listParams],
    queryFn: () => adminListUsers(listParams),
  });

  // Fetch user detail for editing
  const [editingId, setEditingId] = useState<number | null>(null);
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: [...USER_KEYS, "detail", editingId],
    queryFn: () => adminGetUser(editingId!),
    enabled: editingId != null,
  });

  // Fetch referrers for dropdown (only active)
  const { data: referrerListData } = useQuery({
    queryKey: ["adminReferrersDropdown"],
    queryFn: () => adminListReferrers({ page: 1, page_size: 200, include_deleted: false }),
  });
  const referrers = useMemo<ReferrerSummary[]>(() => referrerListData?.referrers ?? [], [referrerListData]);

  // Fetch families for dropdown (only active)
  const { data: familyListData } = useQuery({
    queryKey: ["adminFamiliesDropdown"],
    queryFn: () => adminListFamilies({ page: 1, page_size: 200, include_deleted: false }),
  });
  const families = useMemo(() => familyListData?.families ?? [], [familyListData]);

  // UI state
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // Mutations
  const queryClient = useQueryClient();
  const toast = useToast();
  const invalidateUsers = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: USER_KEYS });
  }, [queryClient]);

  const createMut = useMutation({
    mutationFn: (data: AdminUserCreate) => adminCreateUser(data),
    onSuccess: () => {
      invalidateUsers();
      setShowForm(false);
      toast.success("User created");
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: AdminUserUpdate }) => adminUpdateUser(id, data),
    onSuccess: () => {
      invalidateUsers();
      setEditingId(null);
      toast.success("User updated");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => adminDeleteUser(id),
    onSuccess: () => {
      invalidateUsers();
      toast.success("User deleted");
    },
  });

  const restoreMut = useMutation({
    mutationFn: (id: number) => adminRestoreUser(id),
    onSuccess: () => {
      invalidateUsers();
      toast.success("User restored");
    },
  });

  const resetPasswordMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UserPasswordReset }) => adminResetUserPassword(id, data),
    onSuccess: () => {
      invalidateUsers();
      setResetPasswordId(null);
      toast.success("Password reset");
    },
  });

  // Handlers
  function handleCreateOrEdit(data: AdminUserCreate | AdminUserUpdate) {
    if (editingId) {
      const payload = normalizeUpdatePayload(data as AdminUserUpdate, detail as UserDetail);
      updateMut.mutate({ id: editingId, data: payload as AdminUserUpdate });
    } else {
      createMut.mutate(data as AdminUserCreate);
    }
  }

  function openCreate() {
    setEditingId(null);
    setShowForm(true);
  }

  function openEdit(id: number) {
    setEditingId(id);
    setShowForm(false);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
  }

  // Reset password form state
  const [resetForm, setResetForm] = useState({ password: "", confirmPassword: "" });

  function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (resetForm.password !== resetForm.confirmPassword) return;
    if (resetPasswordId == null) return;
    resetPasswordMut.mutate({ id: resetPasswordId, data: { password: resetForm.password } });
  }

  const users = listData?.users ?? [];
  const totalPages = listData ? Math.ceil(listData.total / pageSize) : 0;

  if (listLoading) return <PageSpinner />;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink />} />

      <main className="mx-auto max-w-[900px] px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Manage Users</h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => {
                  setIncludeDeleted(e.target.checked);
                  setPage(1);
                }}
                className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
              />
              Show deleted
            </label>
            <Button onClick={openCreate}>+ Add User</Button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
          >
            <option value="">All roles</option>
            <option value="admin">Admin</option>
            <option value="referrer">Referrer</option>
            <option value="family">Family</option>
          </select>
          <input
            type="text"
            placeholder="Search email or name…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
          />
        </div>

        {/* Create / Edit form */}
        {editingId && detailLoading && (
          <Card className="mb-6 flex items-center justify-center gap-2 border border-gray-200 py-6 text-btn-start">
            <Spinner size="sm" />
            <span>Loading…</span>
          </Card>
        )}

        {(showForm || (editingId && detail)) && (
          <UserForm
            title={editingId ? "Edit User" : "Add User"}
            initial={editingId ? (detail ?? defaultUserForm) : defaultUserForm}
            isEdit={!!editingId}
            referrers={referrers}
            families={families}
            onSubmit={handleCreateOrEdit}
            onCancel={cancelForm}
            loading={!!(createMut.isPending || updateMut.isPending)}
          />
        )}

        {/* Table */}
        {users.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No users found.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              <Th>Email</Th>
              <Th>Display Name</Th>
              <Th>Role</Th>
              <Th>Linked to</Th>
              {includeDeleted && <Th>Deleted</Th>}
              <Th>Created</Th>
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {users.map((u) => (
                <Tr key={u.id}>
                  <Td className={u.deleted_at != null ? "text-gray-400" : ""}>{u.email}</Td>
                  <Td className={u.deleted_at != null ? "text-gray-400" : ""}>{u.display_name ?? "—"}</Td>
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
                  {includeDeleted && (
                    <Td>
                      {u.deleted_at != null ? (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Yes</span>
                      ) : (
                        <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">No</span>
                      )}
                    </Td>
                  )}
                  <Td className="text-xs text-gray-500">{new Date(u.created_at).toLocaleDateString()}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => openEdit(u.id)}
                        disabled={!!editingId}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => {
                          setResetPasswordId(u.id);
                          setResetForm({ password: "", confirmPassword: "" });
                        }}
                        disabled={!!editingId}
                      >
                        Reset Pw
                      </Button>
                      {u.deleted_at != null ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => setRestoreConfirm(u.id)}
                          disabled={restoreMut.isPending}
                        >
                          Restore
                        </Button>
                      ) : (
                        <Button
                          variant="danger"
                          size="sm"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => setDeleteConfirm(u.id)}
                          disabled={deleteMut.isPending}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Pagination */}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            {listData?.total ?? 0} user{listData?.total !== 1 ? "s" : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Prev
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              Next
            </Button>
          </div>
        </div>

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
              setDeleteConfirm(null);
            }
          }}
          onCancel={() => setDeleteConfirm(null)}
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

        {/* Errors */}
        <MutationErrors mutations={[createMut, updateMut, deleteMut, restoreMut, resetPasswordMut]} />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* UserForm sub-component                                              */
/* ------------------------------------------------------------------ */

const defaultUserForm = {
  email: "",
  display_name: "",
  role: "referrer" as UserRole,
  password: "",
  referrer_id: null as number | null,
  family_id: null as number | null,
} as const;

interface UserFormProps {
  title: string;
  initial: Partial<UserDetail>;
  isEdit: boolean;
  referrers: ReferrerSummary[];
  families: Array<{ id: number; family_name: string }>;
  onSubmit: (data: AdminUserCreate | AdminUserUpdate) => void;
  onCancel: () => void;
  loading: boolean;
}

function UserForm({ title, initial, isEdit, referrers, families, onSubmit, onCancel, loading }: UserFormProps) {
  const [form, setForm] = useState(() => ({
    email: initial.email ?? "",
    display_name: initial.display_name ?? "",
    role: initial.role ?? ("referrer" as UserRole),
    password: "",
    confirmPassword: "",
    referrer_id: initial.referrer_id ?? null,
    family_id: initial.family_id ?? null,
  }));

  useEffect(() => {
    setForm({
      email: initial.email ?? "",
      display_name: initial.display_name ?? "",
      role: initial.role ?? ("referrer" as UserRole),
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

      if (!isEdit) {
        if (form.password !== form.confirmPassword) return;
      }

      if (isEdit) {
        // Send 0 to clear FKs (backend sentinel for "set to NULL").
        // null means "don't change" on the backend.
        onSubmit({
          display_name: form.display_name,
          role: form.role,
          referrer_id: form.role === "referrer" ? form.referrer_id : 0,
          family_id: form.role === "family" ? form.family_id : 0,
        } as unknown as AdminUserUpdate);
      } else {
        onSubmit({
          email: form.email,
          password: form.password,
          role: form.role,
          display_name: form.display_name || null,
          referrer_id: form.role === "referrer" ? form.referrer_id : null,
          family_id: form.role === "family" ? form.family_id : null,
        } as AdminUserCreate);
      }
    },
    [form, isEdit, onSubmit]
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
            {loading ? "Saving…" : isEdit ? "Update" : "Create"}
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
              {loading ? "Resetting…" : "Set Password"}
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
};

function RoleBadge({ role }: { role: UserRole }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${roleColors[role] ?? "bg-gray-100 text-gray-700"}`}>{role}</span>;
}
