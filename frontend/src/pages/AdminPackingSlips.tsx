/**
 * Admin — Packing Slips
 *
 * Compact print-optimized table for volunteers to verify all gifts for a family.
 * Only display_ids are shown — no family names, contact names, or bios.
 *
 * Accepts optional `family_ids` query param (comma-separated) to filter.
 */

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { PageSpinner } from "../components/Spinner";
import { wishText } from "../components/WishCell";

import { adminGetPackingSlips } from "../lib/api";
import { adminPackingSlips } from "../lib/queryKeys";
import { ROUTES } from "../lib/routes";
import { formatApiError } from "../lib/utils";
import type { PackingSlipItem } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
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

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {isError || !data ? (
          <div className="rounded-xl border border-gray-200 bg-white py-12 text-center shadow-sm">
            <p className="text-gray-500">{formatApiError(error, "Unable to load packing slips. Please try again.")}</p>
          </div>
        ) : data.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white py-12 text-center shadow-sm">
            <p className="text-gray-500">No packing slips found.</p>
            <p className="mt-1 text-sm text-gray-400">
              {familyIds ? "None of the selected families are ready for packing." : "No families are fully approved yet."}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {data.map((family) => (
              <PackingSlipCard key={family.id} family={family} />
            ))}
          </div>
        )}
      </main>

      {/* Print styles — landscape, B&W, hide chrome, page breaks */}
      <style>{`
        /* Fixed-layout table — column widths set on <th>, text wraps */
        .packing-slip-table {
          table-layout: fixed;
          border-collapse: collapse;
        }
        .packing-slip-th {
          padding: 6px 12px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #6b7280;
          border-bottom: 1px solid #e5e7eb;
        }
        .packing-slip-td {
          padding: 8px 12px;
          vertical-align: top;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        @page { size: landscape; margin: 8mm; }
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; color: black !important; }
          header { display: none !important; }
          main { padding: 0 !important; max-width: none !important; }
          .packing-slip-card {
            page-break-after: always;
            break-after: page;
          }
          .packing-slip-card:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          /* Force B&W — strip backgrounds, use black borders */
          * {
            background: transparent !important;
            color: black !important;
            border-color: black !important;
            text-shadow: none !important;
            box-shadow: none !important;
          }
          a { text-decoration: underline !important; }
          .packing-slip-table { width: 100% !important; border: 1px solid #000 !important; }
          .packing-slip-th, .packing-slip-td { border: 1px solid #000 !important; }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PackingSlipCard — single family section                             */
/* ------------------------------------------------------------------ */

interface PackingSlipCardProps {
  family: PackingSlipItem;
}

function PackingSlipCard({ family }: PackingSlipCardProps) {
  const hasFunWishes = family.people.some((p) => p.wishes.some((w) => !w.deleted_at && w.type === "fun"));

  return (
    <div className="packing-slip-card">
      {/* Compact header row */}
      <div className="mb-1 flex items-baseline gap-3">
        <h2 className="shrink-0 text-2xl font-bold text-gray-900">{family.display_id}</h2>
        <span className="min-w-0 text-sm text-gray-600">{family.family_wish}</span>
      </div>

      {/* People table — fixed layout so long text wraps instead of scrolling */}
      {family.people.length === 0 ? (
        <p className="text-sm text-gray-400">No family members.</p>
      ) : (
        <table className="packing-slip-table w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="packing-slip-th" style={{ width: "40px", textAlign: "center", padding: "6px 0" }}>
                ID
              </th>
              <th className="packing-slip-th" style={{ width: "140px" }}>
                Name
              </th>
              <th className="packing-slip-th" style={{ width: "40px", textAlign: "center", padding: "6px 0" }}>
                Age
              </th>
              <th className="packing-slip-th">Practical / Adult</th>
              {hasFunWishes && <th className="packing-slip-th">Fun</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {family.people.map((person) => (
              <PersonRow key={person.display_id} person={person} hasFunCol={hasFunWishes} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PersonRow — single person row in the table                          */
/* ------------------------------------------------------------------ */

interface PersonRowProps {
  person: PackingSlipItem["people"][number];
  hasFunCol: boolean;
}

function PersonRow({ person, hasFunCol }: PersonRowProps) {
  const activeWishes = person.wishes.filter((w) => !w.deleted_at);
  const practicalOrAdult = activeWishes.find((w) => w.type === "practical" || w.type === "adult");
  const fun = activeWishes.find((w) => w.type === "fun");

  return (
    <tr>
      <td className="packing-slip-td whitespace-nowrap font-mono text-sm font-bold" style={{ textAlign: "center", padding: "8px 0" }}>
        {person.display_id}
      </td>
      <td className="packing-slip-td font-medium">{person.given_name}</td>
      <td className="packing-slip-td whitespace-nowrap text-sm" style={{ textAlign: "center", padding: "8px 0" }}>
        {person.age}
      </td>
      <td className="packing-slip-td">{practicalOrAdult ? wishText(practicalOrAdult) : "—"}</td>
      {hasFunCol && <td className="packing-slip-td">{fun ? wishText(fun) : "—"}</td>}
    </tr>
  );
}
