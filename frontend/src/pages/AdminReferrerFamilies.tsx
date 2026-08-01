/**
 * Admin — Referrer Detail + Families Management
 *
 * View/edit a specific referrer and manage their families.
 * Thin wrapper around HierarchicalManage exercising all features:
 * tabs (active/deleted), pagination, restore confirmation, dialogs.
 */

import { Link, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { defaultFamilyForm, defaultReferrerForm } from "../components/defaults";
import { FamilyForm } from "../components/FamilyForm";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import {
  HierarchicalManage,
  type HierarchicalManageChildCallbacks,
  type HierarchicalManageParentRenderProps,
} from "../components/HierarchicalManage";
import { InfoRow } from "../components/InfoRow";
import { ReferrerForm } from "../components/ReferrerForm";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import {
  adminCreateFamily,
  adminDeleteFamily,
  adminGetFamily,
  adminGetReferrer,
  adminListDeletedFamilies,
  adminListReferrerFamilies,
  adminRestoreFamily,
  adminUpdateFamily,
  adminUpdateReferrer,
} from "../lib/api";
import {
  adminDeletedFamilies,
  adminDeletedReferrerFamilies,
  adminFamilies,
  adminReferrerDetail,
  adminReferrerFamilies,
} from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";
import { formatDateTime, normalizeUpdatePayload } from "../lib/utils";
import type { FamilyPayload, FamilySummary, ReferrerDetail } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AdminReferrerFamilies() {
  const { id: refId } = useParams<{ id: string }>();
  const refIdNum = parseInt(refId!, 10);
  const refIdStr = String(refIdNum);

  const referrerKey = adminReferrerDetail(refIdStr);
  const familiesKey = adminReferrerFamilies(refIdStr);
  const deletedFamiliesKey = adminDeletedReferrerFamilies(refIdStr);

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.ADMIN_REFERRERS} label="Referrers" />} />

      <main className="mx-auto max-w-[960px] px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Referrer &amp; Families</h2>

        <HierarchicalManage
          parent={{
            id: refIdNum,
            queryKey: referrerKey,
            fetchFn: adminGetReferrer,
            updateApi: adminUpdateReferrer,
            render: (props) => <ReferrerCard {...props} />,
          }}
          child={{
            queryKey: familiesKey,
            listFn: (params) => adminListReferrerFamilies(refIdNum, params ?? undefined),
            detailFn: adminGetFamily,
            createApi: (data) => adminCreateFamily(data),
            updateApi: adminUpdateFamily,
            deleteApi: adminDeleteFamily,
            restoreApi: adminRestoreFamily,
            createNormaliseFn: (formData) => ({ ...formData, referrer_id: refIdNum }),
            updateNormaliseFn: (formData, original) => normalizeUpdatePayload(formData, original) as FamilyPayload,
            formDefault: defaultFamilyForm as unknown as FamilyPayload,
            formComponent: FamilyForm,
            render: (rows, callbacks, ctx) => (
              <FamiliesTable rows={rows as FamilySummary[]} callbacks={callbacks} isDeletedView={ctx.isDeletedView} />
            ),
            title: "Families",
            createButtonLabel: "+ Add Family",
            invalidationKeys: [familiesKey, deletedFamiliesKey, adminFamilies, adminDeletedFamilies],
            entityName: "Family",
          }}
          tabs={{
            deleted: {
              queryKey: deletedFamiliesKey,
              listFn: (params) =>
                adminListDeletedFamilies({
                  page: params?.page ?? 1,
                  page_size: params?.page_size ?? 20,
                  referrer_id: refIdNum,
                }),
              readonly: true,
            },
          }}
          pagination={{ enabled: true }}
          dialogs={{
            deleteDescription: "This will also soft-delete all people in the family.",
            restoreDescription: "This will also restore all people in the family.",
          }}
        />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Parent card render                                                  */
/* ------------------------------------------------------------------ */

function ReferrerCard(props: HierarchicalManageParentRenderProps<ReferrerDetail>) {
  const { data, isEditing, onToggleEdit, isSaving, onSave } = props;

  return (
    <Card className="mb-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-gray-900">{data ? data.name : "\u2014"}</h3>
          {data && <span className="text-xs font-mono text-gray-400">#{data.id}</span>}
          {data && (
            <span className="inline-flex items-center rounded-full bg-btn-start px-2 py-0.5 text-xs font-semibold text-white">
              {(data.family_count ?? 0) === 1 ? "1 family" : `${data.family_count ?? 0} families`}
            </span>
          )}
        </div>
        <Button variant="secondary" className="h-8 px-3 text-xs" onClick={onToggleEdit}>
          {isEditing ? "Cancel" : "Edit"}
        </Button>
      </div>

      {isEditing ? (
        <ReferrerForm
          title="Edit Referrer"
          initial={data ?? defaultReferrerForm}
          isEdit={true}
          onSubmit={onSave}
          onCancel={() => onToggleEdit()}
          loading={isSaving}
        />
      ) : (
        data && (
          <div className="space-y-0">
            <InfoRow label="Name" value={data.name} />
            <InfoRow label="Phone" value={data.phone_number} />
            <InfoRow label="Family Limit" value={`${data.family_count ?? 0} / ${data.family_limit}`} isLast />
          </div>
        )
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Children table render                                               */
/* ------------------------------------------------------------------ */

function FamiliesTable({
  rows,
  callbacks,
  isDeletedView,
}: {
  rows: FamilySummary[];
  callbacks: HierarchicalManageChildCallbacks;
  isDeletedView: boolean;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <p className="py-8 text-center text-gray-400">
          {isDeletedView ? "No deleted families for this referrer." : "No families for this referrer yet."}
        </p>
      </Card>
    );
  }

  return (
    <Table>
      <TableHead>
        <Th>ID</Th>
        <Th>Family Name</Th>
        <Th>Contact</Th>
        <Th>People</Th>
        <Th>Pickup Window</Th>
        <Th>Actions</Th>
      </TableHead>
      <TableBody>
        {rows.map((f) => (
          <Tr key={f.id}>
            <Td className="whitespace-nowrap text-xs text-gray-400">{f.display_id}</Td>
            <Td className={f.deleted_at != null ? "text-gray-400" : ""}>
              {f.family_name}
              {f.deleted_at == null && !isDeletedView && (
                <Link
                  to={route.familyWishList(f.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Wish List"
                  className="ml-1 text-xs text-gray-400 transition-colors hover:text-violet-600"
                  title="Wish List"
                >
                  📝
                </Link>
              )}
            </Td>
            <Td>{f.contact_name}</Td>
            <Td className="whitespace-nowrap">{f.person_count ?? 0}</Td>
            <Td className="whitespace-nowrap text-sm text-gray-500">{formatDateTime(f.pickup_window)}</Td>
            <Td>
              <div className="flex items-center gap-2">
                {!isDeletedView && f.deleted_at == null && (
                  <Link
                    to={`${route.adminFamilyPeople(f.id)}?from=referrer`}
                    className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                  >
                    Manage
                  </Link>
                )}
                {!isDeletedView && f.deleted_at == null && (
                  <>
                    <Button
                      variant="secondary"
                      className="h-7 px-2 text-xs"
                      onClick={() => callbacks.onEdit(f.id)}
                      disabled={callbacks.isEditing(f.id)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      className="h-7 px-2 text-xs"
                      onClick={() => callbacks.onDelete(f.id)}
                      disabled={callbacks.isDeleting}
                    >
                      Delete
                    </Button>
                  </>
                )}
                {isDeletedView && (
                  <Button
                    variant="secondary"
                    className="h-7 px-2 text-xs"
                    onClick={() => callbacks.onRestore(f.id)}
                    disabled={callbacks.isRestoring}
                  >
                    Restore
                  </Button>
                )}
              </div>
            </Td>
          </Tr>
        ))}
      </TableBody>
    </Table>
  );
}
