/**
 * Family People Management
 *
 * List, create, edit, delete people for the current family.
 * Uses useCrudManager for data fetching and mutations.
 */

import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { defaultPersonForm } from "../components/defaults";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { MutationErrors } from "../components/MutationErrors";
import { PersonForm } from "../components/PersonForm";
import { PageSpinner, Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useCrudManager } from "../hooks/useCrudManager";
import { createFamilyPerson, deletePerson, getPerson, listFamilyPeople, updatePerson } from "../lib/api";
import { ROUTES } from "../lib/routes";
import { normalizeUpdatePayload } from "../lib/utils";
import type { PersonDetail, PersonPayload } from "../types";

const FAMILY_PEOPLE_KEY = ["familyPeople"];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function FamilyPeople() {
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
    rootKey: FAMILY_PEOPLE_KEY,
    listFn: listFamilyPeople,
    detailFn: getPerson,
    createFn: createFamilyPerson,
    updateFn: updatePerson,
    deleteFn: deletePerson,
  });

  function handleCreate(formData: PersonPayload) {
    createMut?.mutate(formData);
  }

  function handleUpdate(formData: PersonPayload) {
    if (!editingId) return;
    const payload = normalizeUpdatePayload(formData, detail as PersonDetail);
    updateMut?.mutate({ id: editingId, data: payload as PersonPayload });
  }

  if (listLoading) return <PageSpinner />;

  const people = listData?.people ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.FAMILY_DASHBOARD} label="Family Dashboard" />} />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Manage People</h2>
          <Button onClick={openCreate}>+ Add Person</Button>
        </div>

        {/* Create form */}
        {showForm && (
          <PersonForm
            title="Add Person"
            initial={defaultPersonForm}
            isEdit={false}
            onSubmit={handleCreate}
            onCancel={cancelForm}
            loading={createMut?.isPending}
          />
        )}

        {/* Edit loading */}
        {editingId && detailLoading && (
          <Card className="mb-6 border border-gray-200">
            <div className="flex items-center justify-center gap-3 py-6 text-btn-start">
              <Spinner size="sm" />
              <span className="text-sm font-medium">Loading person details…</span>
            </div>
          </Card>
        )}

        {/* Edit form */}
        {editingId && detail && (
          <PersonForm
            title="Edit Person"
            initial={detail}
            isEdit={true}
            onSubmit={handleUpdate}
            onCancel={cancelForm}
            loading={updateMut?.isPending}
          />
        )}

        {/* Table */}
        <Table className="mb-6">
          {people.length === 0 ? (
            <TableBody>
              <Tr>
                <Td className="!text-center !text-gray-400 py-12">No people yet. Add one to get started.</Td>
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
                        <Button variant="secondary" className="h-7 px-2 text-xs" onClick={() => openEdit(p.id)} disabled={!!editingId}>
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          className="h-7 border-red-300 bg-white text-xs text-red-600 hover:bg-red-50"
                          onClick={() => confirmDelete(p.id)}
                          disabled={deleteMut?.isPending}
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

        {/* Delete confirmation */}
        <ConfirmDialog
          open={deleteConfirm !== null}
          title={
            <>
              Delete person <strong>#{deleteConfirm}</strong>?
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
