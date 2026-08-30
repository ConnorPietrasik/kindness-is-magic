/**
 * Admin — Packing Slips
 *
 * Compact print-optimized table for volunteers to verify all gifts for a family.
 *
 * Accepts optional `family_ids` query param (comma-separated) to filter.
 * Rendering (cards, empty/error states, print styles) is shared with the
 * delivery page via `PackingSlipsView`.
 */

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { PackingSlipsView } from "../components/PackingSlips";
import { PageSpinner } from "../components/Spinner";

import { adminGetPackingSlips } from "../lib/api";
import { adminPackingSlips } from "../lib/queryKeys";
import { ROUTES } from "../lib/routes";

export default function AdminPackingSlips() {
  const [searchParams] = useSearchParams();
  const familyIdsParam = searchParams.get("family_ids");

  // Parse comma-separated family IDs or pass undefined for "all"
  const familyIds = familyIdsParam
    ? familyIdsParam
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n))
    : undefined;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [...adminPackingSlips, familyIds],
    queryFn: () => adminGetPackingSlips(familyIds),
  });

  if (isLoading) return <PageSpinner />;

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

      <PackingSlipsView
        data={data}
        isError={isError}
        error={error}
        emptyMessage={familyIds ? "None of the selected families are ready for packing." : "No families are fully approved yet."}
      />
    </div>
  );
}
