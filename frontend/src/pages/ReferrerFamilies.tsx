/**
 * Referrer Families — approved families CRUD page.
 *
 * Extracted from the old ReferrerDashboard. Shows the families table
 * with Manage / Edit / Delete actions, plus the inline add/edit forms.
 * Also shows a pending approvals alert when there are pending families.
 */

import { useQuery } from "@tanstack/react-query";
import React from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { defaultFamilyForm } from "../components/defaults";
import { FamilyForm } from "../components/FamilyForm";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useCrudManager } from "../hooks/useCrudManager";
import {
  createReferrerFamily,
  deleteReferrerFamily,
  getReferrerFamily,
  getReferrerMe,
  listPendingFamilies,
  listReferrerFamilies,
  updateReferrerFamily,
} from "../lib/api";
import { pendingFamilies as PENDING_FAMILIES_KEY, referrerFamilies, referrerFamily, referrerMe } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";
import { normalizeUpdatePayload } from "../lib/utils";
import type { FamilyPayload, WishLockLevel } from "../types";

function getLockLevelRowClass(wishLockLevel: WishLockLevel): string {
  if (wishLockLevel === "admin") return "bg-emerald-50";
  if (wishLockLevel === "referrer") return "bg-amber-50";
  return "";
}

export default function ReferrerFamilies() {
  // Referrer self-info (for family limit)
  const { data: referrerInfo, isLoading: infoLoading } = useQuery({
    queryKey: referrerMe,
    queryFn: getReferrerMe,
  });

  // Pending families count (for the alert card)
  const { data: pendingFamilies } = useQuery({
    queryKey: PENDING_FAMILIES_KEY,
    queryFn: listPendingFamilies,
  });

  // Family CRUD via hook (detailFn fetches full record for editing)
  const {
    listData,
    listLoading: famLoading,
    detail,
    detailLoading,
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
    rootKey: referrerFamilies,
    listFn: listReferrerFamilies,
    detailFn: getReferrerFamily,
    createFn: createReferrerFamily,
    updateFn: updateReferrerFamily,
    deleteFn: deleteReferrerFamily,
    invalidationKeys: [referrerFamilies, referrerMe, referrerFamily],
    entityName: "Family",
  });

  function handleCreateFam(formData: FamilyPayload) {
    createFamMut?.mutate(formData);
  }

  function handleUpdateFam(formData: FamilyPayload) {
    if (!editingId || !detail) return;
    const payload = normalizeUpdatePayload(formData, detail);
    updateFamMut?.mutate({ id: editingId, data: payload as FamilyPayload });
  }

  if (infoLoading || famLoading) return <PageSpinner />;

  const families = listData?.families ?? [];
  const familyLimit = referrerInfo?.family_limit ?? 0;
  const familyCount = referrerInfo?.family_count ?? 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.DASHBOARD} label="Dashboard" />} />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">My Families</h2>

        {/* ── Pending families alert ──────────────────────────── */}
        {pendingFamilies && pendingFamilies.length > 0 && (
          <Link
            to={ROUTES.REFERRER_FAMILY_INVITES}
            className="mb-6 block rounded-xl border border-amber-200 bg-amber-50 px-6 py-4 text-sm font-semibold text-amber-800 shadow-sm transition-colors hover:bg-amber-100"
          >
            {pendingFamilies.length} family{pendingFamilies.length > 1 ? "ies" : ""} awaiting your approval →
          </Link>
        )}

        {/* ── Families ────────────────────────────────────────── */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">Approved Families</h3>
            <span className="text-xs font-mono text-gray-400">
              {familyCount} / {familyLimit}
            </span>
          </div>
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
                  <React.Fragment key={f.id}>
                    <Tr className={getLockLevelRowClass(f.wish_lock_level)}>
                      <Td className="whitespace-nowrap text-xs text-gray-400">{f.display_id}</Td>
                      <Td className="font-medium text-gray-900">
                        {f.family_name}
                        {f.referrer_notes != null && (
                          <span className="ml-1 text-xs" title="Has internal notes">
                            📝
                          </span>
                        )}
                        {f.wish_lock_level === "admin" && (
                          <Link
                            to={route.familyWishList(f.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Wish List"
                            className="ml-1 text-xs text-gray-400 transition-colors hover:text-violet-600"
                            title="Wish List"
                          >
                            📄
                          </Link>
                        )}
                      </Td>
                      <Td className="max-w-xs truncate">{f.family_wish ?? ""}</Td>
                      <Td>{f.contact_name}</Td>
                      <Td className="whitespace-nowrap">{f.person_count ?? 0}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Link
                            to={route.referrerFamilyDetail(f.id)}
                            className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                          >
                            {" "}
                            Manage
                          </Link>
                          <Button
                            variant="secondary"
                            className="h-7 px-2 text-xs"
                            onClick={() => (editingId === f.id ? cancelForm() : openEdit(f.id))}
                          >
                            {editingId === f.id ? "Done" : "Edit"}
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
                    {editingId === f.id && (
                      <Tr key={`${f.id}-edit`}>
                        <Td colSpan={6} className="!py-3">
                          <div className="rounded-xl bg-gray-50 p-4">
                            {detailLoading ? (
                              <div className="flex items-center justify-center gap-3 py-6 text-gray-400">
                                <Spinner size="sm" />
                                <span className="text-sm">Loading…</span>
                              </div>
                            ) : detail ? (
                              <FamilyForm
                                title="Edit Family"
                                initial={detail}
                                isEdit={true}
                                showReferrerNotes
                                onSubmit={handleUpdateFam}
                                onCancel={cancelForm}
                                loading={updateFamMut?.isPending}
                              />
                            ) : null}
                          </div>
                        </Td>
                      </Tr>
                    )}
                  </React.Fragment>
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
        <MutationErrors mutations={[createFamMut, updateFamMut, deleteFamMut].filter((m): m is NonNullable<typeof m> => m != null)} />
      </main>
    </div>
  );
}
