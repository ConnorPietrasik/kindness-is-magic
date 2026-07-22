/**
 * Referrer Family Detail
 *
 * View/edit a specific family and manage its people.
 * Thin wrapper around HierarchicalManage.
 */

import { useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { defaultFamilyForm, defaultPersonForm } from "../components/defaults";
import { FamilyForm } from "../components/FamilyForm";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import {
  HierarchicalManage,
  type HierarchicalManageChildCallbacks,
  type HierarchicalManageParentRenderProps,
} from "../components/HierarchicalManage";
import { InfoRow } from "../components/InfoRow";
import { PersonForm } from "../components/PersonForm";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
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
import { normalizeUpdatePayload } from "../lib/utils";
import type { FamilyDetail, FamilyPayload, PersonPayload, PersonSummary } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function ReferrerFamilyDetail() {
  const { id: famId } = useParams<{ id: string }>();
  const famIdNum = parseInt(famId!, 10);
  const famIdStr = String(famIdNum);

  const peopleKey = ["referrerFamilyPeople", famIdStr];
  const familyKey = ["referrerFamily", famIdStr];

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" left={<BackLink to={ROUTES.REFERRER_FAMILIES} label="My Families" />} />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Family Detail</h2>

        <HierarchicalManage
          backLinkTo={ROUTES.REFERRER_FAMILIES}
          backLinkLabel="My Families"
          // ── Parent (family) ─────────────────────────────────
          parentId={famIdNum}
          parentQueryKey={familyKey}
          parentFetchFn={getReferrerFamily}
          parentUpdateApi={updateReferrerFamily}
          parentNormaliseFn={(formData, original) => normalizeUpdatePayload(formData, original) as FamilyPayload}
          parentFormComponent={FamilyForm}
          renderParent={(props) => <FamilyCard {...props} />}
          parentInvalidationKeys={[["referrerFamilies"]]}
          // ── Children (people) ───────────────────────────────
          childQueryKey={peopleKey}
          childListFn={() => listReferrerFamilyPeople(famIdNum)}
          childDetailFn={getPerson}
          childCreateApi={(data) => createReferrerFamilyPerson(famIdNum, data)}
          childUpdateApi={updatePerson}
          childDeleteApi={deletePerson}
          childUpdateNormaliseFn={(formData, original) =>
            normalizeUpdatePayload(formData as PersonPayload, original as PersonPayload) as PersonPayload
          }
          childFormDefault={defaultPersonForm as unknown as PersonPayload}
          childFormComponent={PersonForm}
          renderChildren={(rows, callbacks) => <PeopleTable rows={rows as PersonSummary[]} callbacks={callbacks} />}
          childrenTitle="People"
          createButtonLabel="+ Add Person"
          childInvalidationKeys={[peopleKey, familyKey]}
        />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Parent card render                                                  */
/* ------------------------------------------------------------------ */

function FamilyCard(props: HierarchicalManageParentRenderProps<FamilyDetail>) {
  const { data, isEditing, onToggleEdit, isSaving, onSave } = props;

  return (
    <Card className="mb-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-gray-900">{data ? data.family_name : "\u2014"}</h3>
          {data && (
            <span className="inline-flex items-center rounded-full bg-btn-start px-2 py-0.5 text-xs font-semibold text-white">
              {data.person_count ?? 0} person{(data.person_count ?? 0) !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <Button variant="secondary" className="h-8 px-3 text-xs" onClick={onToggleEdit}>
          {isEditing ? "Cancel" : "Edit"}
        </Button>
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
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Children table render                                               */
/* ------------------------------------------------------------------ */

function PeopleTable({ rows, callbacks }: { rows: PersonSummary[]; callbacks: HierarchicalManageChildCallbacks }) {
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
              <Tr key={p.id}>
                <Td className="whitespace-nowrap text-xs text-gray-400">{p.id}</Td>
                <Td className="font-medium text-gray-900">{p.given_name}</Td>
                <Td>{p.age}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      className="h-7 px-2 text-xs"
                      onClick={() => callbacks.onEdit(p.id)}
                      disabled={callbacks.isEditing(p.id)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      className="h-7 px-2 text-xs"
                      onClick={() => callbacks.onDelete(p.id)}
                      disabled={callbacks.isDeleting}
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
  );
}
