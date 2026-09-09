/**
 * Admin — Delivery Slips
 *
 * Print-optimized delivery slips (display ID, where to drive, family name,
 * contact, phone) for verified families.
 *
 * URL-driven: optional `family_ids` (row-action filter, takes precedence)
 * plus a scope bar — everyone | assigned (to anyone) | assigned (to a
 * specific person) | unassigned. "Specific person" writes `delivery_user_id`
 * on top of `scope=assigned`; before a person is picked it shows a prompt
 * without fetching. Choosing a different scope clears `delivery_user_id`;
 * changing scope while `family_ids` is present clears `family_ids` and
 * applies the new scope.
 *
 * Rendering (cards, empty/error states, print styles) is shared with the
 * delivery page via `DeliverySlipsView`.
 */

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { DeliverySlipsView } from "../components/DeliverySlips";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { PageSpinner } from "../components/Spinner";
import { useDeliveryUsers } from "../hooks/useDeliveryUsers";
import { adminGetDeliverySlips, type DeliverySlipScope } from "../lib/api";
import { adminDeliverySlips } from "../lib/queryKeys";
import { ROUTES } from "../lib/routes";

/** Scope select values — "specific" reveals the delivery-person select. */
type ScopeChoice = DeliverySlipScope | "specific";

const SCOPE_OPTIONS: { value: ScopeChoice; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "assigned", label: "Assigned (to anyone)" },
  { value: "specific", label: "Assigned (to specific person)" },
  { value: "unassigned", label: "Unassigned" },
];

function emptyMessageFor(hasFamilyIds: boolean, scopeChoice: ScopeChoice, personId: number | null): string {
  if (hasFamilyIds) return "None of the selected families are verified yet.";
  if (scopeChoice === "specific" && personId == null) return "Choose a delivery person to see their slips.";
  if (personId != null) return "No verified families are assigned to this delivery person yet.";
  if (scopeChoice === "assigned") return "No verified families have a delivery person yet.";
  if (scopeChoice === "unassigned") return "No verified families without a delivery person yet.";
  return "No verified families yet.";
}

export default function AdminDeliverySlips() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { deliveryUserMap } = useDeliveryUsers();

  // --- Parse URL params --------------------------------------------------
  // family_ids (row-action filter) — takes precedence over scope
  const familyIds = searchParams
    .get("family_ids")
    ?.split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));
  const hasFamilyIds = !!familyIds && familyIds.length > 0;

  // scope — invalid/absent values fall back to "all"
  const rawScope = searchParams.get("scope");
  const scope: DeliverySlipScope = rawScope === "assigned" || rawScope === "unassigned" ? rawScope : "all";

  // delivery_user_id — equality filter on top of scope. The param's
  // presence (even empty) marks "specific person" mode before a person is
  // picked; its value filters once one is.
  const rawPerson = searchParams.get("delivery_user_id");
  const personId = rawPerson != null && /^\d+$/.test(rawPerson) ? parseInt(rawPerson, 10) : null;

  // The scope select reflects the URL; while family_ids is present it shows
  // its default (scope has no effect in the row-action view) and the
  // person select is hidden.
  const scopeChoice: ScopeChoice = hasFamilyIds ? "all" : rawPerson != null ? "specific" : scope;
  const personSelectValue = hasFamilyIds ? "" : personId != null ? String(personId) : "";

  // "Specific person" before a person is picked has nothing to filter by —
  // withhold the list (prompt the user) instead of falling back to the
  // unfiltered assigned population.
  const needsPerson = !hasFamilyIds && scopeChoice === "specific" && personId == null;

  // --- URL updates --------------------------------------------------------
  /** Apply param updates atomically (null removes the param). */
  function updateParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value == null) params.delete(key);
      else params.set(key, value);
    }
    setSearchParams(params);
  }

  function handleScopeChange(value: ScopeChoice) {
    updateParams({
      // "Assigned (to specific person)" is a subset of Assigned — the person
      // select writes delivery_user_id on top of it. The empty value marks
      // the mode until a person is picked.
      scope: value === "specific" ? "assigned" : value,
      delivery_user_id: value === "specific" ? "" : null,
      // Changing scope exits the row-action view and applies the new scope.
      family_ids: null,
    });
  }

  function handlePersonChange(value: string) {
    updateParams({ delivery_user_id: value || null });
  }

  // --- Query ---------------------------------------------------------------
  const { data, isLoading, isError, error } = useQuery({
    queryKey: [...adminDeliverySlips, scope, personId, familyIds],
    queryFn: () => adminGetDeliverySlips(hasFamilyIds ? { familyIds } : { scope, deliveryUserId: personId ?? undefined }),
    enabled: !needsPerson,
  });

  if (isLoading) return <PageSpinner />;

  const selectClass =
    "rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20";

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar
        title="Kindness is Magic"
        left={<BackLink to={ROUTES.ADMIN_FAMILIES} label="Families" />}
        right={
          <div className="no-print flex items-center gap-2">
            <Button variant="secondary" onClick={() => window.print()}>
              🖨️ Print
            </Button>
          </div>
        }
      />

      {/* Scope bar — inert (shows its default) while family_ids is present */}
      <div className="no-print mx-auto max-w-3xl px-4 pt-4 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            aria-label="Scope"
            value={scopeChoice}
            onChange={(e) => handleScopeChange(e.target.value as ScopeChoice)}
            className={selectClass}
          >
            {SCOPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {scopeChoice === "specific" && (
            <select
              aria-label="Delivery person"
              value={personSelectValue}
              onChange={(e) => handlePersonChange(e.target.value)}
              className={selectClass}
            >
              <option value="">Choose a delivery person…</option>
              {Object.entries(deliveryUserMap).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <DeliverySlipsView
        data={needsPerson ? [] : data}
        isError={isError}
        error={error}
        emptyMessage={emptyMessageFor(hasFamilyIds, scopeChoice, personId)}
      />
    </div>
  );
}
