/**
 * Referrer Family Detail
 *
 * View/edit a specific family and manage its people.
 * Thin wrapper around HierarchicalManage.
 *
 * Wish lock features:
 * - Show current wish lock state
 * - "Submit for Admin Review" when lock_level = "family"
 * - "Re-submit for Admin Review" when lock_level = "referrer" + rejection_reason
 * - Show rejection reason banner if present
 * - Disable family/people edit controls when lock_level = "admin"
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { defaultFamilyForm, defaultPersonForm } from "../components/defaults";
import { FamilyForm } from "../components/FamilyForm";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import {
  HierarchicalManage,
  type HierarchicalManageChildCallbacks,
  type HierarchicalManageParentRenderProps,
} from "../components/HierarchicalManage";
import { InfoRow } from "../components/InfoRow";
import { InternalNotesSection } from "../components/InternalNotesSection";
import { PersonForm } from "../components/PersonForm";
import { Spinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { WishLockBadge } from "../components/WishLockBadge";
import { useToast } from "../context/ToastContext";
import {
  createReferrerFamilyPerson,
  deletePerson,
  getPerson,
  getReferrerFamily,
  listReferrerFamilyPeople,
  referrerApproveWishes,
  updatePerson,
  updateReferrerFamily,
} from "../lib/api";
import { referrerFamilies, referrerFamilyDetail, referrerFamilyPeople, referrerReviewQueue } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";
import { normalizeUpdatePayload } from "../lib/utils";
import type { FamilyDetail, FamilyPayload, PersonPayload, PersonSummary } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function ReferrerFamilyDetail() {
  const { id: famId } = useParams<{ id: string }>();
  const famIdNum = parseInt(famId!, 10);
  const famIdStr = String(famIdNum);

  const peopleKey = referrerFamilyPeople(famIdStr);
  const familyKey = referrerFamilyDetail(famIdStr);

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.REFERRER_FAMILIES} label="My Families" />} />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Family Detail</h2>

        <HierarchicalManage
          parent={{
            id: famIdNum,
            queryKey: familyKey,
            fetchFn: getReferrerFamily,
            updateApi: updateReferrerFamily,
            normaliseFn: (formData, original) => normalizeUpdatePayload(formData, original) as FamilyPayload,
            render: (props) => <FamilyCard {...props} famId={famIdNum} />,
            invalidationKeys: [referrerFamilies],
            entityName: "Family",
          }}
          child={{
            queryKey: peopleKey,
            listFn: () => listReferrerFamilyPeople(famIdNum),
            detailFn: getPerson,
            createApi: (data) => createReferrerFamilyPerson(famIdNum, data),
            updateApi: updatePerson,
            deleteApi: deletePerson,
            updateNormaliseFn: (formData, original) => normalizeUpdatePayload(formData as PersonPayload, original),
            formDefault: defaultPersonForm as unknown as PersonPayload,
            formComponent: PersonForm,
            render: (rows, callbacks, ctx) => (
              <PeopleTable
                rows={rows as PersonSummary[]}
                callbacks={callbacks}
                lockLevel={(ctx?.parentData as FamilyDetail | undefined)?.wish_lock_level}
              />
            ),
            title: "People",
            createButtonLabel: "+ Add Person",
            invalidationKeys: [peopleKey, familyKey],
            entityName: "Person",
            isReadonly: false,
          }}
        />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Parent card render                                                  */
/* ------------------------------------------------------------------ */

function FamilyCard(props: HierarchicalManageParentRenderProps<FamilyDetail> & { famId: number }) {
  const { data, isEditing, onToggleEdit, isSaving, onSave, famId } = props;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

  const familyKey = referrerFamilyDetail(String(famId));

  const submitForReviewMut = useMutation({
    mutationFn: referrerApproveWishes,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: familyKey });
      queryClient.invalidateQueries({ queryKey: referrerFamilies });
      queryClient.invalidateQueries({ queryKey: referrerReviewQueue });
      toast.success("Wishes submitted for admin review");
    },
  });

  const saveNotesMut = useMutation({
    mutationFn: (payload: { referrer_notes: string | null }) => updateReferrerFamily(famId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: familyKey });
      queryClient.invalidateQueries({ queryKey: referrerFamilies });
      toast.success("Notes saved");
    },
  });

  // Lock state
  const lockLevel = data?.wish_lock_level ?? "family";
  const rejectionReason = data?.wish_rejection_reason ?? null;
  const isLockedByAdmin = lockLevel === "admin";

  // Determine action button
  const showSubmitButton = lockLevel === "family"; // initial submission
  const showResubmitButton = lockLevel === "referrer" && rejectionReason != null; // re-submit after admin rejection

  return (
    <Card className="mb-6">
      {/* Wish lock state banner */}
      {data && lockLevel === "admin" && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
          <span className="font-medium">Admin-approved:</span> This family is fully approved and visible to donors. Editing is locked.
        </div>
      )}
      {data && lockLevel === "referrer" && rejectionReason && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          <span className="font-medium">Admin rejection:</span> {rejectionReason}
        </div>
      )}
      {data && lockLevel === "referrer" && !rejectionReason && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
          <span className="font-medium">Awaiting admin review:</span> This family's wishes have been submitted for admin approval.
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-gray-900">{data ? data.family_name : "\u2014"}</h3>
          {data && <span className="text-xs font-mono text-gray-400">#{data.display_id}</span>}
          {data && (
            <span className="inline-flex items-center rounded-full bg-btn-start px-2 py-0.5 text-xs font-semibold text-white">
              {data.person_count ?? 0} person{(data.person_count ?? 0) !== 1 ? "s" : ""}
            </span>
          )}
          {data && <WishLockBadge level={lockLevel} />}
        </div>
        <div className="flex items-center gap-2">
          {/* Wish List link (only when locked) */}
          {lockLevel === "admin" && (
            <Link
              to={route.familyWishList(famId)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
            >
              Wish List
            </Link>
          )}
          {/* Submit / Re-submit button */}
          {showSubmitButton && (
            <Button
              variant="success"
              className="h-8 px-3 text-xs"
              onClick={() => setShowSubmitConfirm(true)}
              loading={submitForReviewMut.isPending}
            >
              {submitForReviewMut.isPending ? "Submitting…" : "Submit for Admin Review"}
            </Button>
          )}
          {showResubmitButton && (
            <Button
              variant="success"
              className="h-8 px-3 text-xs"
              onClick={() => setShowSubmitConfirm(true)}
              loading={submitForReviewMut.isPending}
            >
              {submitForReviewMut.isPending ? "Submitting…" : "Re-submit for Admin Review"}
            </Button>
          )}
          {!isLockedByAdmin && (
            <Button variant="secondary" className="h-8 px-3 text-xs" onClick={onToggleEdit}>
              {isEditing ? "Cancel" : "Edit"}
            </Button>
          )}
        </div>
      </div>

      {isEditing ? (
        <FamilyForm
          title="Edit Family"
          initial={data ?? defaultFamilyForm}
          isEdit={true}
          onSubmit={onSave}
          onCancel={() => onToggleEdit()}
          loading={isSaving}
        />
      ) : (
        data && (
          <div className="space-y-0">
            <InfoRow label="Family Name" value={data.family_name} />
            <InfoRow label="Contact" value={data.contact_name} />
            <InfoRow label="Family Wish" value={data.family_wish} />
            <InfoRow label="Bio" value={data.bio} />
            <InfoRow label="Address" value={data.address} />
            <InfoRow label="Phone" value={data.phone_number} isLast />
          </div>
        )
      )}

      {/* Internal Notes section (always available, bypasses wish lock) */}
      {data && (
        <InternalNotesSection
          initialNotes={data.referrer_notes}
          onSave={(notes) => saveNotesMut.mutate({ referrer_notes: notes })}
          isSaving={saveNotesMut.isPending}
        />
      )}

      {/* Submit confirmation dialog */}
      <ConfirmDialog
        open={showSubmitConfirm}
        title="Submit wishes for admin review?"
        description={
          showResubmitButton
            ? "This will re-submit the wishes to the admin after the previous rejection."
            : "This will lock the family wishes and submit them for admin approval. The admin will then review and either approve or reject."
        }
        onConfirm={() => {
          setShowSubmitConfirm(false);
          if (famId) submitForReviewMut.mutate(famId);
        }}
        onCancel={() => setShowSubmitConfirm(false)}
        loading={submitForReviewMut.isPending}
        confirmLabel="Yes, submit"
        loadingLabel="Submitting…"
        confirmVariant="success"
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Children table render                                               */
/* ------------------------------------------------------------------ */

function PeopleTable({
  rows,
  callbacks,
  lockLevel,
}: {
  rows: PersonSummary[];
  callbacks: HierarchicalManageChildCallbacks;
  lockLevel?: string;
}) {
  const isLockedByAdmin = lockLevel === "admin";

  return (
    <Table className="mb-6">
      {rows.length === 0 ? (
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
            {rows.map((p) => (
              <>
                <Tr key={p.id} data-id={p.id}>
                  <Td className="whitespace-nowrap text-xs text-gray-400">{p.display_id}</Td>
                  <Td className="font-medium text-gray-900">{p.given_name}</Td>
                  <Td>{p.age}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      {!isLockedByAdmin ? (
                        <>
                          <Button
                            variant="secondary"
                            className="h-7 px-2 text-xs"
                            onClick={() => (callbacks.isEditing(p.id) ? callbacks.cancelForm?.() : callbacks.onEdit(p.id))}
                          >
                            {callbacks.isEditing(p.id) ? "Done" : "Edit"}
                          </Button>
                          <Button
                            variant="danger"
                            className="h-7 px-2 text-xs"
                            onClick={() => callbacks.onDelete(p.id)}
                            disabled={callbacks.isDeleting}
                          >
                            Delete
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">Locked</span>
                      )}
                    </div>
                  </Td>
                </Tr>
                {callbacks.editingId === p.id && (
                  <Tr key={`${p.id}-edit`}>
                    <Td colSpan={4} className="!py-3">
                      <div className="rounded-xl bg-gray-50 p-4">
                        {callbacks.detailLoading ? (
                          <div className="flex items-center justify-center gap-3 py-6 text-btn-start">
                            <Spinner size="sm" />
                            <span className="text-sm font-medium">Loading…</span>
                          </div>
                        ) : callbacks.editFormComponent && callbacks.editFormProps ? (
                          <callbacks.editFormComponent {...callbacks.editFormProps} />
                        ) : null}
                      </div>
                    </Td>
                  </Tr>
                )}
              </>
            ))}
          </TableBody>
        </>
      )}
    </Table>
  );
}
