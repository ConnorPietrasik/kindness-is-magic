/**
 * PackingSlipsView — shared print-optimized packing slip rendering.
 *
 * Used by both AdminPackingSlips (all fully-approved families, optional
 * family_ids filter) and DeliveryPackingSlips (families assigned to the
 * delivery person). Renders the error/empty states, the slip cards, and
 * the print styles (landscape, B&W, hide chrome, page breaks).
 *
 * Only display_ids are shown — no family names, contact names, or bios.
 */

import { formatApiError } from "../lib/utils";
import type { PackingSlipItem } from "../types";
import { wishText } from "./WishCell";

/* ------------------------------------------------------------------ */
/* PackingSlipsView                                                    */
/* ------------------------------------------------------------------ */

export interface PackingSlipsViewProps {
  /** Query data. Pages render `PageSpinner` themselves while loading. */
  data: PackingSlipItem[] | undefined;
  isError: boolean;
  error: unknown;
  /** Context line shown under "No packing slips found." */
  emptyMessage: string;
}

export function PackingSlipsView({ data, isError, error, emptyMessage }: PackingSlipsViewProps) {
  return (
    <>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {isError || !data ? (
          <div className="rounded-xl border border-gray-200 bg-white py-12 text-center shadow-sm">
            <p className="text-gray-500">{formatApiError(error, "Unable to load packing slips. Please try again.")}</p>
          </div>
        ) : data.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white py-12 text-center shadow-sm">
            <p className="text-gray-500">No packing slips found.</p>
            <p className="mt-1 text-sm text-gray-400">{emptyMessage}</p>
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
        /* Narrow ID / Age columns — zero horizontal padding; fixed Name width */
        .packing-slip-th-narrow {
          width: 40px;
          text-align: center;
          padding-left: 0;
          padding-right: 0;
        }
        .packing-slip-td-narrow {
          text-align: center;
          padding-left: 0;
          padding-right: 0;
        }
        .packing-slip-col-name {
          width: 140px;
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
    </>
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
              <th className="packing-slip-th packing-slip-th-narrow">ID</th>
              <th className="packing-slip-th packing-slip-col-name">Name</th>
              <th className="packing-slip-th packing-slip-th-narrow">Age</th>
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
      <td className="packing-slip-td packing-slip-td-narrow whitespace-nowrap font-mono text-sm font-bold">{person.display_id}</td>
      <td className="packing-slip-td font-medium">{person.given_name}</td>
      <td className="packing-slip-td packing-slip-td-narrow whitespace-nowrap text-sm">{person.age}</td>
      <td className="packing-slip-td">{practicalOrAdult ? wishText(practicalOrAdult) : "—"}</td>
      {hasFunCol && <td className="packing-slip-td">{fun ? wishText(fun) : "—"}</td>}
    </tr>
  );
}
