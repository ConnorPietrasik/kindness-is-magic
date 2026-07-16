/**
 * Admin — Manage Families
 *
 * List, create, edit, delete families.
 * Uses useCrudManager for data fetching and mutations.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { defaultFamilyForm } from "../components/defaults";
import { FamilyForm } from "../components/FamilyForm";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useCrudManager } from "../hooks/useCrudManager";
import { adminCreateFamily, adminDeleteFamily, adminGetFamily, adminListFamilies, adminListReferrers, adminUpdateFamily } from "../lib/api";
import type { FamilyDetail } from "../types";

const FAMILY_KEYS = ["adminFamilies"];
const REFERRER_KEYS = ["adminReferrers"];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminFamilies() {
  const {
    listData,
    listLoading,
    detail,
    detailLoading,
    createMut,
    updateMut,
    deleteMut,
    showForm,
    editingId,
    deleteConfirm,
    openCreate,
    openEdit,
    cancelForm,
    confirmDelete,
    cancelDelete,
  } = useCrudManager({
    rootKey: FAMILY_KEYS,
    listFn: adminListFamilies,
    detailFn: adminGetFamily,
    createFn: adminCreateFamily as (data: unknown) => Promise<FamilyDetail>,
    updateFn: adminUpdateFamily as (id: number, data: unknown) => Promise<FamilyDetail>,
    deleteFn: adminDeleteFamily,
  });

  // Referrers lookup (for dropdown + display)
  const { data: referrerData, isLoading: referrersLoading } = useQuery({
    queryKey: REFERRER_KEYS,
    queryFn: adminListReferrers,
  });

  const referrerMap = useMemo((): Record<number, string> => {
    const map: Record<number, string> = {};
    (referrerData?.referrers ?? []).forEach((r) => {
      map[r.id] = r.name;
    });
    return map;
  }, [referrerData]);

  function handleCreate(formData: Record<string, unknown>) {
    createMut?.mutate(formData);
  }

  function handleUpdate(formData: Record<string, unknown>) {
    if (!editingId) return;
    updateMut?.mutate({ id: editingId, data: formData });
  }

  if (listLoading) return <PageSpinner />;

  const families = listData?.families ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink />} />

      <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-violet-950">Manage Families</h2>
          <Button onClick={openCreate}>+ Add Family</Button>
        </div>

        {/* Create / Edit form */}
        {editingId && detailLoading && (
          <Card className="mb-6 flex items-center justify-center gap-2 border border-gray-200 py-6 text-btn-start">
            <Spinner size="sm" />
            <span>Loading…</span>
          </Card>
        )}

        {(showForm || (editingId && detail)) && (
          <FamilyForm
            title={editingId ? "Edit Family" : "Add Family"}
            initial={editingId ? (detail ?? defaultFamilyForm) : defaultFamilyForm}
            isEdit={!!editingId}
            referrerMap={referrerMap}
            referrerOptionsLoading={referrersLoading}
            onSubmit={editingId ? handleUpdate : handleCreate}
            onCancel={cancelForm}
            loading={createMut?.isPending || updateMut?.isPending}
          />
        )}

        {/* Table */}
        {families.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No families yet.</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              <Th>ID</Th>
              <Th>Family Name</Th>
              <Th>Contact</Th>
              <Th>Referrer</Th>
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {families.map((f) => (
                <Tr key={f.id}>
                  <Td>{f.id}</Td>
                  <Td>{f.family_name}</Td>
                  <Td>{f.contact_name}</Td>
                  <Td>{referrerMap[f.referrer_id] || `ID ${f.referrer_id}`}</Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => openEdit(f.id)}
                        disabled={!!editingId}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => confirmDelete(f.id)}
                        disabled={deleteMut?.isPending}
                      >
                        Delete
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TableBody>
          </Table>
        )}

        {/* Delete confirmation */}
        <ConfirmDialog
          open={deleteConfirm !== null}
          title={
            <>
              Delete family <strong>#{deleteConfirm}</strong>?
            </>
          }
          onConfirm={() => {
            if (deleteConfirm != null) {
              deleteMut?.mutate(deleteConfirm);
              cancelDelete();
            }
          }}
          onCancel={cancelDelete}
          loading={deleteMut?.isPending}
        />

        {/* Errors */}
        <MutationErrors mutations={[createMut, updateMut, deleteMut].filter((m): m is NonNullable<typeof m> => m != null)} />
      </main>
    </div>
  );
}
