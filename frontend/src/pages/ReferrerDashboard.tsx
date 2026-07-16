/**
 * Referrer Dashboard
 *
 * Shows the referrer's own info, family list with actions,
 * and a card linking to manage each family's people.
 * Uses useCrudManager for family CRUD; self-edit stays inline.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { defaultFamilyForm, defaultReferrerForm } from "../components/defaults";
import { FamilyForm } from "../components/FamilyForm";
import { FormField } from "../components/FormField";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { InfoRow } from "../components/InfoRow";
import { MutationErrors } from "../components/MutationErrors";
import { PageSpinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useCrudManager } from "../hooks/useCrudManager";
import {
  createReferrerFamily,
  deleteReferrerFamily,
  getReferrerMe,
  listReferrerFamilies,
  patchReferrerMe,
  updateReferrerFamily,
} from "../lib/api";
import { ROUTES, route } from "../lib/routes";
import type { FamilyDetail, ReferrerDetail } from "../types";

const REFERRER_ME_KEY = ["referrerMe"];
const REFERRER_FAMILIES_KEY = ["referrerFamilies"];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function ReferrerDashboard() {
  const queryClient = useQueryClient();

  // Referrer self-info
  const { data: referrerInfo, isLoading: infoLoading } = useQuery({
    queryKey: REFERRER_ME_KEY,
    queryFn: getReferrerMe,
  });

  // Family CRUD via hook (no detailFn — data sourced from list)
  const {
    listData,
    listLoading: famLoading,
    createMut: createFamMut,
    updateMut: updateFamMut,
    deleteMut: deleteFamMut,
    showForm,
    editingId,
    deleteConfirm,
    openCreate,
    openEdit,
    cancelForm,
    confirmDelete,
    cancelDelete,
  } = useCrudManager({
    rootKey: REFERRER_FAMILIES_KEY,
    listFn: listReferrerFamilies,
    createFn: createReferrerFamily as (data: unknown) => Promise<FamilyDetail>,
    updateFn: updateReferrerFamily as (id: number, data: unknown) => Promise<FamilyDetail>,
    deleteFn: deleteReferrerFamily,
    invalidationKeys: [REFERRER_FAMILIES_KEY, REFERRER_ME_KEY],
  });

  // Self-edit mutation (not part of CRUD pattern)
  const updateSelfMut = useMutation({
    mutationFn: patchReferrerMe,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REFERRER_ME_KEY });
      setShowEditSelf(false);
    },
  });

  const [showEditSelf, setShowEditSelf] = useState(false);

  function handleUpdateSelf(formData: Record<string, unknown>) {
    updateSelfMut.mutate(formData);
  }

  function handleCreateFam(formData: Record<string, unknown>) {
    createFamMut?.mutate(formData);
  }

  function handleUpdateFam(formData: Record<string, unknown>) {
    if (!editingId) return;
    updateFamMut?.mutate({ id: editingId, data: formData });
  }

  if (infoLoading || famLoading) return <PageSpinner />;

  const families: FamilyDetail[] = listData ?? [];
  const familyLimit = referrerInfo?.family_limit ?? 0;
  const familyCount = referrerInfo?.family_count ?? 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.DASHBOARD} label="Dashboard" />} />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Referrer Dashboard</h2>

        {/* ── Referrer info card ──────────────────────────────── */}
        <Card className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">My Profile</h3>
            <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => setShowEditSelf(!showEditSelf)}>
              {showEditSelf ? "Cancel" : "Edit"}
            </Button>
          </div>

          {showEditSelf ? (
            <ReferrerSelfForm
              initial={referrerInfo ?? defaultReferrerForm}
              onSubmit={handleUpdateSelf}
              onCancel={() => setShowEditSelf(false)}
              loading={updateSelfMut.isPending}
            />
          ) : (
            <div className="space-y-0">
              <InfoRow label="Name" value={referrerInfo?.name} truncate={false} />
              <InfoRow label="Phone" value={referrerInfo?.phone_number} truncate={false} />
              <InfoRow label="Family Limit" value={`${familyCount} / ${familyLimit}`} isLast truncate={false} />
            </div>
          )}
        </Card>

        {/* ── Families ────────────────────────────────────────── */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">My Families</h3>
          {familyCount < familyLimit && <Button onClick={openCreate}>+ Add Family</Button>}
        </div>

        {showForm && (
          <FamilyForm
            title="Add Family"
            initial={defaultFamilyForm}
            isEdit={false}
            onSubmit={handleCreateFam}
            onCancel={cancelForm}
            loading={createFamMut?.isPending}
            showOptionalFields={false}
          />
        )}

        {editingId && (
          <FamilyForm
            title="Edit Family"
            initial={families.find((f) => f.id === editingId) || defaultFamilyForm}
            isEdit={true}
            onSubmit={handleUpdateFam}
            onCancel={cancelForm}
            loading={updateFamMut?.isPending}
          />
        )}

        <Table className="mb-6">
          {families.length === 0 ? (
            <TableBody>
              <Tr>
                <Td className="!text-center !text-gray-400 py-12">No families yet. Add one to get started.</Td>
              </Tr>
            </TableBody>
          ) : (
            <>
              <TableHead>
                <Th>ID</Th>
                <Th>Family Name</Th>
                <Th>Family Wish</Th>
                <Th>Contact</Th>
                <Th>People</Th>
                <Th>Actions</Th>
              </TableHead>
              <TableBody>
                {families.map((f) => (
                  <Tr key={f.id}>
                    <Td className="whitespace-nowrap text-xs text-gray-400">{f.id}</Td>
                    <Td className="font-medium text-gray-900">{f.family_name}</Td>
                    <Td className="max-w-xs truncate">{f.family_wish ?? ""}</Td>
                    <Td>{f.contact_name}</Td>
                    <Td className="whitespace-nowrap">{f.person_count ?? 0}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Link
                          to={route.referrerFamilyDetail(f.id)}
                          className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                        >
                          Manage
                        </Link>
                        <Button variant="secondary" className="h-7 px-2 text-xs" onClick={() => openEdit(f.id)} disabled={!!editingId}>
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          className="h-7 px-2 text-xs"
                          onClick={() => confirmDelete(f.id)}
                          disabled={deleteFamMut?.isPending}
                        >
                          Delete
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TableBody>
            </>
          )}
        </Table>

        {/* ── Delete confirmation ─────────────────────────────── */}
        <ConfirmDialog
          open={deleteConfirm !== null}
          title={
            <>
              Delete family <strong>#{deleteConfirm}</strong>?
            </>
          }
          onConfirm={() => {
            if (deleteConfirm != null) {
              deleteFamMut?.mutate(deleteConfirm);
              cancelDelete();
            }
          }}
          onCancel={cancelDelete}
          loading={deleteFamMut?.isPending}
        />

        {/* ── Errors ──────────────────────────────────────────── */}
        <MutationErrors
          mutations={[updateSelfMut, createFamMut, updateFamMut, deleteFamMut].filter((m): m is NonNullable<typeof m> => m != null)}
        />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ReferrerSelfForm (inline — not shared per spec)                    */
/* ------------------------------------------------------------------ */
interface ReferrerSelfFormProps {
  initial: Partial<ReferrerDetail>;
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  loading: boolean;
}

function ReferrerSelfForm({ initial, onSubmit, onCancel, loading }: ReferrerSelfFormProps) {
  const [form, setForm] = useState<Record<string, unknown>>(() => ({ ...initial }));

  useEffect(() => {
    setForm({ ...initial });
  }, [initial]);

  const update = (key: string, val: unknown) => setForm((p) => ({ ...p, [key]: val }));

  return (
    <form
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="mx-auto max-w-sm space-y-3"
    >
      <FormField
        label="Name"
        fieldProps={{
          type: "text",
          value: form.name,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("name", e.target.value),
          required: true,
          maxLength: 60,
        }}
      />
      <FormField
        label="Phone"
        fieldProps={{
          type: "text",
          value: form.phone_number,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("phone_number", e.target.value),
          required: true,
          maxLength: 20,
        }}
      />
      <div className="flex gap-3 pt-1">
        <Button type="submit" loading={loading} className="flex-1">
          {loading ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
      </div>
    </form>
  );
}
