/**
 * Referrer Family Detail
 *
 * View/edit a specific family and manage its people.
 * Uses useCrudManager for people CRUD; family edit stays inline.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { defaultFamilyForm, defaultPersonForm } from "../components/defaults";
import { FamilyForm } from "../components/FamilyForm";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { InfoRow } from "../components/InfoRow";
import { MutationErrors } from "../components/MutationErrors";
import { PersonForm } from "../components/PersonForm";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useCrudManager } from "../hooks/useCrudManager";
import {
  createReferrerFamilyPerson,
  deletePerson,
  getPerson,
  getReferrerFamily,
  listReferrerFamilyPeople,
  updatePerson,
  updateReferrerFamily,
} from "../lib/api";
import { ROUTES } from "../lib/routes";
import type { FamilyPayload, PersonPayload } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function ReferrerFamilyDetail() {
  const { id: famId } = useParams<{ id: string }>();
  const famIdNum = parseInt(famId!, 10);
  const famIdStr = String(famIdNum);
  const queryClient = useQueryClient();

  // Family detail (not CRUD — single resource)
  const { data: family, isLoading: famLoading } = useQuery({
    queryKey: ["referrerFamily", famIdStr],
    queryFn: () => getReferrerFamily(famIdNum),
  });

  const updateFamMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: FamilyPayload }) => updateReferrerFamily(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["referrerFamily", famIdStr] });
      queryClient.invalidateQueries({ queryKey: ["referrerFamilies"] });
    },
  });

  const [showEditFamily, setShowEditFamily] = useState(false);

  // People CRUD via hook
  const peopleKey = ["referrerFamilyPeople", famIdStr];
  const {
    listData,
    listLoading: peopleLoading,
    detail: personDetail,
    detailLoading: personDetailLoading,
    createMut: createPersonMut,
    updateMut: updatePersonMut,
    deleteMut: deletePersonMut,
    showForm,
    editingId: editingPersonId,
    deleteConfirm,
    openCreate,
    openEdit,
    cancelForm,
    confirmDelete,
    cancelDelete,
  } = useCrudManager({
    rootKey: peopleKey,
    listFn: () => listReferrerFamilyPeople(famIdNum),
    detailFn: getPerson,
    createFn: (data: PersonPayload) => createReferrerFamilyPerson(famIdNum, data),
    updateFn: updatePerson,
    deleteFn: deletePerson,
    invalidationKeys: [peopleKey, ["referrerFamily", famIdStr]],
  });

  function handleUpdateFam(formData: FamilyPayload) {
    updateFamMut.mutate({ id: famIdNum, data: formData });
  }

  function handleCreatePerson(formData: PersonPayload) {
    createPersonMut?.mutate(formData);
  }

  function handleUpdatePerson(formData: PersonPayload) {
    if (!editingPersonId) return;
    updatePersonMut?.mutate({ id: editingPersonId, data: formData });
  }

  if (famLoading || peopleLoading) return <PageSpinner />;

  const people = listData ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.REFERRER_DASHBOARD} label="My Families" />} />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Family Detail</h2>

        {/* ── Family info card ──────────────────────────────── */}
        <Card className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900">{family ? family.family_name : "—"}</h3>
              {family && (
                <span className="inline-flex items-center rounded-full bg-btn-start px-2 py-0.5 text-xs font-semibold text-white">
                  {family.person_count ?? 0} person{(family.person_count ?? 0) !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => setShowEditFamily(!showEditFamily)}>
              {showEditFamily ? "Cancel" : "Edit"}
            </Button>
          </div>

          {showEditFamily ? (
            <FamilyForm
              title="Edit Family"
              initial={family ?? defaultFamilyForm}
              isEdit={true}
              onSubmit={handleUpdateFam}
              onCancel={() => setShowEditFamily(false)}
              loading={updateFamMut.isPending}
            />
          ) : (
            family && (
              <div className="space-y-0">
                <InfoRow label="Family Name" value={family.family_name} />
                <InfoRow label="Contact" value={family.contact_name} />
                <InfoRow label="Family Wish" value={family.family_wish} />
                <InfoRow label="Bio" value={family.bio} />
                <InfoRow label="Address" value={family.address} />
                <InfoRow label="Phone" value={family.phone_number} isLast />
              </div>
            )
          )}
        </Card>

        {/* ── People section ────────────────────────────────── */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">People</h3>
          <Button onClick={openCreate}>+ Add Person</Button>
        </div>

        {showForm && (
          <PersonForm
            title="Add Person"
            initial={defaultPersonForm}
            isEdit={false}
            onSubmit={handleCreatePerson}
            onCancel={cancelForm}
            loading={createPersonMut?.isPending}
          />
        )}

        {editingPersonId && personDetailLoading && (
          <Card className="mb-6 border border-gray-200">
            <div className="flex items-center justify-center gap-3 py-6 text-btn-start">
              <Spinner size="sm" />
              <span className="text-sm font-medium">Loading person details…</span>
            </div>
          </Card>
        )}

        {editingPersonId && personDetail && (
          <PersonForm
            title="Edit Person"
            initial={personDetail}
            isEdit={true}
            onSubmit={handleUpdatePerson}
            onCancel={cancelForm}
            loading={updatePersonMut?.isPending}
          />
        )}

        <Table className="mb-6">
          {people.length === 0 ? (
            <TableBody>
              <Tr>
                <Td className="!text-center !text-gray-400 py-12">No people in this family yet.</Td>
              </Tr>
            </TableBody>
          ) : (
            <>
              <TableHead>
                <Th>ID</Th>
                <Th>Name</Th>
                <Th>Age</Th>
                <Th>Actions</Th>
              </TableHead>
              <TableBody>
                {people.map((p) => (
                  <Tr key={p.id}>
                    <Td className="whitespace-nowrap text-xs text-gray-400">{p.id}</Td>
                    <Td className="font-medium text-gray-900">{p.given_name}</Td>
                    <Td>{p.age}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          className="h-7 px-2 text-xs"
                          onClick={() => openEdit(p.id)}
                          disabled={!!editingPersonId}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          className="h-7 px-2 text-xs"
                          onClick={() => confirmDelete(p.id)}
                          disabled={deletePersonMut?.isPending}
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

        {/* ── Delete confirmation ───────────────────────────── */}
        <ConfirmDialog
          open={deleteConfirm !== null}
          title={
            <>
              Delete person <strong>#{deleteConfirm}</strong>?
            </>
          }
          onConfirm={() => {
            if (deleteConfirm != null) {
              deletePersonMut?.mutate(deleteConfirm);
              cancelDelete();
            }
          }}
          onCancel={cancelDelete}
          loading={deletePersonMut?.isPending}
        />

        {/* ── Errors ────────────────────────────────────────── */}
        <MutationErrors
          mutations={[updateFamMut, createPersonMut, updatePersonMut, deletePersonMut].filter((m): m is NonNullable<typeof m> => m != null)}
        />
      </main>
    </div>
  );
}
