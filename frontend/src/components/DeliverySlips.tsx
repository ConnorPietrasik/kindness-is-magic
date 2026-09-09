/**
 * DeliverySlipsView — shared print-optimized delivery slip rendering.
 *
 * Used by both AdminDeliverySlips (all verified families, optional
 * family_ids filter + scope) and DeliverySlips (families assigned to the
 * delivery person). Unlike packing slips, delivery slips deliberately
 * carry family PII — the driver needs it to identify the household and
 * call if lost. Renders the error/empty states, the slip cards, and the
 * print styles (portrait, B&W, hide chrome, keep each slip unsplit).
 *
 * Slips flow in a 2–3 column grid. A transient hidden probe measures the
 * widest card (longest line, unwrapped) and `chooseSlipColumns` picks the
 * most columns that fit the printable page width, so long content gets
 * fewer, wider columns instead of wrapping or colliding.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { chooseSlipColumns, formatApiError } from "../lib/utils";
import type { DeliverySlipItem } from "../types";

/* ------------------------------------------------------------------ */
/* DeliverySlipsView                                                   */
/* ------------------------------------------------------------------ */

export interface DeliverySlipsViewProps {
  /** Query data. Pages render `PageSpinner` themselves while loading. */
  data: DeliverySlipItem[] | undefined;
  isError: boolean;
  error: unknown;
  /** Context line shown under "No delivery slips found." */
  emptyMessage: string;
}

export function DeliverySlipsView({ data, isError, error, emptyMessage }: DeliverySlipsViewProps) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [longestCardWidth, setLongestCardWidth] = useState(0);
  // The data array the probe was last measured against. The probe renders
  // only while `data` is newer than that — one commit per fetch. The layout
  // effect reads its width and drops the probe before paint, so the
  // steady-state DOM contains each slip exactly once (no duplicated text
  // for screen readers or tests).
  const [measuredFor, setMeasuredFor] = useState<DeliverySlipItem[] | null>(null);

  useLayoutEffect(() => {
    if (data == null || data.length === 0 || measuredFor === data) return;
    const probe = measureRef.current;
    if (!probe) return;
    // The probe renders the same cards with white-space: nowrap in a
    // max-content box, so its width is the longest card's longest line —
    // the width a column needs to show any card without wrapping.
    setLongestCardWidth(probe.offsetWidth);
    setMeasuredFor(data);
  }, [data, measuredFor]);

  const columnCount = chooseSlipColumns(longestCardWidth);

  return (
    <>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {isError || !data ? (
          <div className="rounded-xl border border-gray-200 bg-white py-12 text-center shadow-sm">
            <p className="text-gray-500">{formatApiError(error, "Unable to load delivery slips. Please try again.")}</p>
          </div>
        ) : data.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white py-12 text-center shadow-sm">
            <p className="text-gray-500">No delivery slips found.</p>
            <p className="mt-1 text-sm text-gray-400">{emptyMessage}</p>
          </div>
        ) : (
          <>
            {/* Transient width probe — out of flow, invisible, not printed */}
            {measuredFor !== data && (
              <div ref={measureRef} aria-hidden className="delivery-slip-measure absolute invisible w-max whitespace-nowrap">
                {data.map((family) => (
                  <DeliverySlipCard key={family.id} family={family} />
                ))}
              </div>
            )}
            {/* minmax(0, max-content): each column is exactly as wide as its
                longest card; if the page/screen is narrower than the math
                says, tracks shrink toward 0 and text wraps instead of
                overflowing */}
            <div
              className="delivery-slip-list grid gap-x-4 gap-y-8"
              style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, max-content))` }}
            >
              {data.map((family) => (
                <DeliverySlipCard key={family.id} family={family} />
              ))}
            </div>
          </>
        )}
      </main>

      {/* Print styles — portrait, B&W, hide chrome, keep each slip unsplit */}
      <style>{`
        @page { size: portrait; margin: 8mm; }
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; color: black !important; }
          header { display: none !important; }
          main { padding: 0 !important; max-width: none !important; }
          .delivery-slip-measure { display: none !important; }
          /* Tighter print row gap than the screen's gap-y-8 */
          .delivery-slip-list { row-gap: 16px !important; }
          /* Keep each slip unsplit, so the browser moves the whole card to
             the next page when it doesn't fit. (A card taller than a full
             page will still split.) */
          .delivery-slip-card {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          /* Tighter print density — smaller family ID */
          .delivery-slip-family-id {
            font-size: 18px !important;
            line-height: 1.2;
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
        }
      `}</style>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* DeliverySlipCard — single family section                            */
/* ------------------------------------------------------------------ */

interface DeliverySlipCardProps {
  family: DeliverySlipItem;
}

function DeliverySlipCard({ family }: DeliverySlipCardProps) {
  return (
    <div className="delivery-slip-card">
      {/* Display ID must match the box/packing-slip labels */}
      <h2 className="delivery-slip-family-id text-2xl font-bold text-gray-900">{family.display_id}</h2>
      <div className="mt-1 space-y-0.5 text-sm text-gray-700">
        <p>
          <span className="font-semibold">Family:</span> {family.family_name}
        </p>
        <p>
          <span className="font-semibold">Address:</span> {family.address}
        </p>
        <p>
          <span className="font-semibold">Contact:</span> {family.contact_name}
        </p>
        {family.phone_number && (
          <p>
            <span className="font-semibold">Phone:</span> {family.phone_number}
          </p>
        )}
      </div>
    </div>
  );
}
