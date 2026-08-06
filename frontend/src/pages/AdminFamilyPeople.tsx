/**
 * Admin — Family Detail + People Management
 *
 * View/edit a specific family and manage its people.
 * Thin wrapper around HierarchicalManage.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ActionsDropdown } from "../components/ActionsDropdown";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { DisplayId } from "../components/DisplayId";
import { defaultFamilyForm, defaultPersonForm } from "../components/defaults";
import { FamilyForm } from "../components/FamilyForm";
import { HeaderBar } from "../components/HeaderBar";
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
import { WishCellAdult, WishCellType } from "../components/WishCell";
import { useToast } from "../context/ToastContext";
import { useDeliveryUsers } from "../hooks/useDeliveryUsers";
import {
  adminCreatePerson,
  adminDeletePerson,
  adminGetFamily,
  adminGetReferrersDropdown,
  adminListDeletedPeople,
  adminListFamilyPeople,
  adminRestorePerson,
  adminUpdateFamily,
  adminUpdatePerson,
  getPerson,
} from "../lib/api";
import {
  adminDeletedFamilyPeople,
  adminFamilies,
  adminFamilyDetail,
  adminFamilyPeople,
  adminPackingSlips,
  adminReferrerFamilies,
  adminReferrersDropdown,
  adminWishes,
} from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";
import { normalizeUpdatePayload } from "../lib/utils";
import type { FamilyDetail, FamilyPayload, PersonPayload, PersonSummary } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminFamilyPeople() {
  const { id: famId } = useParams<{ id: string }>();
  const famIdNum = parseInt(famId!, 10);
  const famIdStr = String(famIdNum);

  const peopleKey = adminFamilyPeople(famIdStr);
  const deletedPeopleKey = adminDeletedFamilyPeople(famIdStr);
  const familyKey = adminFamilyDetail(famIdStr);

  // Referrers lookup for the family edit form
  const { data: referrers, isLoading: referrersLoading } = useQuery({
    queryKey: adminReferrersDropdown,
    queryFn: () => adminGetReferrersDropdown(),
  });

  const referrerMap = useMemo((): Record<number, string> => {
    const map: Record<number, string> = {};
    (referrers ?? []).forEach((r) => {
      map[r.id] = r.name;
    });
    return map;
  }, [referrers]);

  // Delivery users lookup (for dropdown)
  const { deliveryUserMap, deliveryUsersLoading } = useDeliveryUsers();

  // Read ?from=referrer to know if user came from a referrer's families page
  const [searchParams] = useSearchParams();
  const cameFromReferrer = searchParams.get("from") === "referrer";

  // Family detail (needed only when coming from referrer to build back link)
  const { data: familyDetail } = useQuery({
    queryKey: adminFamilyDetail(famIdStr),
    queryFn: () => adminGetFamily(famIdNum),
    enabled: cameFromReferrer,
  });

  // Back link: go to referrer's families page only if that's where we came from
  const backLinkTo =
    cameFromReferrer && familyDetail?.referrer_id != null && familyDetail.referrer_id > 0
      ? route.adminReferrerFamilies(familyDetail.referrer_id)
      : ROUTES.ADMIN_FAMILIES;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar
        title="Kindness is Magic"
        left={
          <Link to={backLinkTo} className="text-sm text-white/80 transition-colors hover:text-white">
            ← Back
          </Link>
        }
      />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Family &amp; People</h2>

        <HierarchicalManage
          parent={{
            id: famIdNum,
            queryKey: familyKey,
            fetchFn: adminGetFamily,
            updateApi: adminUpdateFamily,
            normaliseFn: (formData, original) => normalizeUpdatePayload(formData, original) as FamilyPayload,
            render: (props) => (
              <FamilyCard
                {...props}
                famId={famIdNum}
                referrerMap={referrerMap}
                referrersLoading={referrersLoading}
                deliveryUserMap={deliveryUserMap}
                deliveryUsersLoading={deliveryUsersLoading}
              />
            ),
            invalidationKeys: [familyKey],
            entityName: "Family",
          }}
          child={{
            queryKey: peopleKey,
            listFn: () => adminListFamilyPeople(famIdNum),
            detailFn: getPerson,
            createNormaliseFn: (formData) => ({ ...formData, family_id: famIdNum }) as PersonPayload,
            createApi: (data) => adminCreatePerson(data),
            updateApi: adminUpdatePerson,
            deleteApi: adminDeletePerson,
            restoreApi: adminRestorePerson,
            updateNormaliseFn: (formData, original) => normalizeUpdatePayload(formData as PersonPayload, original),
            formDefault: defaultPersonForm as unknown as PersonPayload,
            formComponent: PersonForm,
            render: (rows, callbacks, ctx) => (
              <PeopleTable rows={rows as PersonSummary[]} callbacks={callbacks} isDeletedView={ctx.isDeletedView} />
            ),
            title: "People",
            createButtonLabel: "+ Add Person",
            invalidationKeys: [peopleKey, deletedPeopleKey, familyKey, adminPackingSlips, adminWishes],
            entityName: "Person",
          }}
          tabs={{
            deleted: {
              queryKey: deletedPeopleKey,
              listFn: (params) =>
                adminListDeletedPeople({
                  page: params?.page ?? 1,
                  page_size: params?.page_size ?? 20,
                  family_id: famIdNum,
                }),
              readonly: true,
            },
          }}
        />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Parent card render                                                  */
/* ------------------------------------------------------------------ */

function FamilyCard(
  props: HierarchicalManageParentRenderProps<FamilyDetail> & {
    famId: number;
    referrerMap: Record<number, string>;
    referrersLoading: boolean;
    deliveryUserMap: Record<number, string>;
    deliveryUsersLoading: boolean;
  }
) {
  const { data, isEditing, onToggleEdit, isSaving, onSave, famId, referrerMap, referrersLoading, deliveryUserMap, deliveryUsersLoading } =
    props;
  const queryClient = useQueryClient();
  const toast = useToast();
  const lockLevel = data?.wish_lock_level ?? "family";
  const familyKey = adminFamilyDetail(String(famId));

  const saveNotesMut = useMutation({
    mutationFn: (payload: { referrer_notes: string | null }) => adminUpdateFamily(famId, payload),
    onSuccess: (updatedFamily) => {
      queryClient.invalidateQueries({ queryKey: familyKey });
      queryClient.invalidateQueries({ queryKey: adminFamilyPeople(String(famId)) });
      queryClient.invalidateQueries({ queryKey: adminFamilies });
      if (updatedFamily?.referrer_id != null && updatedFamily.referrer_id > 0) {
        queryClient.invalidateQueries({ queryKey: adminReferrerFamilies(String(updatedFamily.referrer_id)) });
      }
      toast.success("Notes saved");
    },
  });

  return (
    <Card className="mb-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">{data ? data.family_name : "\u2014"}</h3>
            {data && (
              <span className="text-xs font-mono text-gray-400">
                #<DisplayId displayId={data.display_id} familyId={data.id} referrerId={data.referrer_id} />
              </span>
            )}
            {data && (
              <span className="inline-flex items-center rounded-full bg-btn-start px-2 py-0.5 text-xs font-semibold text-white">
                {(data.person_count ?? 0) === 1 ? "1 person" : `${data.person_count ?? 0} people`}
              </span>
            )}
          </div>
          {data && data.referrer_id != null && data.referrer_id > 0 && (
            <Link
              to={route.adminReferrerFamilies(data.referrer_id)}
              className="text-xs text-gray-400 transition-colors hover:text-violet-600"
            >
              Referrer: {data.referrer_name || `ID ${data.referrer_id}`}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2">
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
          <Button variant="secondary" className="h-8 px-3 text-xs" onClick={onToggleEdit}>
            {isEditing ? "Cancel" : "Edit"}
          </Button>
        </div>
      </div>

      {isEditing ? (
        <FamilyForm
          title="Edit Family"
          initial={data ?? defaultFamilyForm}
          isEdit={true}
          referrerMap={referrerMap}
          referrerOptionsLoading={referrersLoading}
          deliveryUserMap={deliveryUserMap}
          deliveryUsersLoading={deliveryUsersLoading}
          showReferrerNotes
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
            <InfoRow label="Phone" value={data.phone_number} />
            <InfoRow
              label="Delivery Person"
              value={data.delivery_user_name || (data.delivery_user_id != null ? `ID ${data.delivery_user_id}` : null)}
              isLast
            />
          </div>
        )
      )}

      {/* Internal Notes section (always available) */}
      {data && (
        <InternalNotesSection
          initialNotes={data.referrer_notes}
          onSave={(notes) => saveNotesMut.mutate({ referrer_notes: notes })}
          isSaving={saveNotesMut.isPending}
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Children table render                                               */
/* ------------------------------------------------------------------ */

function PeopleTable({
  rows,
  callbacks,
  isDeletedView,
}: {
  rows: PersonSummary[];
  callbacks: HierarchicalManageChildCallbacks;
  isDeletedView: boolean;
}) {
  return (
    <Table className="mb-6">
      {rows.length === 0 ? (
        <TableBody>
          <Tr>
            <Td className="!text-center !text-gray-400 py-12">
              {isDeletedView ? "No deleted people in this family." : "No people in this family yet."}
            </Td>
          </Tr>
        </TableBody>
      ) : (
        <>
          <TableHead>
            <Th>ID</Th>
            <Th>Name</Th>
            <Th>Age</Th>
            <Th>Practical Wish</Th>
            <Th>Fun Wish</Th>
            <Th>Actions</Th>
          </TableHead>
          <TableBody>
            {rows.map((p) => (
              <>
                <Tr key={p.id}>
                  <Td className="whitespace-nowrap text-xs text-gray-400">{p.display_id}</Td>
                  <Td className="font-medium text-gray-900">{p.given_name}</Td>
                  <Td>{p.age}</Td>
                  {p.age >= 18 ? (
                    <WishCellAdult wishes={p.wishes} />
                  ) : (
                    <>
                      <WishCellType wishes={p.wishes} type="practical" />
                      <WishCellType wishes={p.wishes} type="fun" />
                    </>
                  )}
                  <Td>
                    <div className="flex items-center gap-2">
                      {!isDeletedView && (
                        <Button
                          variant="secondary"
                          className="h-7 px-2 text-xs"
                          onClick={() => (callbacks.isEditing(p.id) ? callbacks.cancelForm?.() : callbacks.onEdit(p.id))}
                        >
                          {callbacks.isEditing(p.id) ? "Done" : "Edit"}
                        </Button>
                      )}
                      {isDeletedView ? (
                        <Button
                          variant="secondary"
                          className="h-7 px-2 text-xs"
                          onClick={() => callbacks.onRestore(p.id)}
                          disabled={callbacks.isRestoring}
                        >
                          Restore
                        </Button>
                      ) : (
                        <ActionsDropdown
                          items={[
                            {
                              label: "Delete",
                              variant: "danger" as const,
                              onClick: () => callbacks.onDelete(p.id),
                            },
                          ]}
                          disabled={callbacks.isDeleting}
                        />
                      )}
                    </div>
                  </Td>
                </Tr>
                {callbacks.editingId === p.id && (
                  <Tr key={`${p.id}-edit`}>
                    <Td colSpan={6} className="!py-3">
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
