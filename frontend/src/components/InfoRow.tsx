import { memo, type ReactNode } from "react";

interface InfoRowProps {
  label: string;
  /** Display value — plain text, a number, or a node (e.g. a badge). `null`/`undefined` renders an em dash. */
  value?: ReactNode;
  isLast?: boolean;
  /** Clamp long values to 60% width with an ellipsis. Off by default — callers opt in where truncation is wanted. */
  truncate?: boolean;
}

/**
 * InfoRow — a single label/value row for display-only detail sections.
 */
export const InfoRow = memo(function InfoRow({ label, value, isLast = false, truncate = false }: InfoRowProps) {
  return (
    <div className={`flex items-baseline justify-between px-1 py-2 ${isLast ? "" : "border-b border-gray-100"}`}>
      <span className="text-sm font-medium text-gray-500">{label}</span>
      <span className={`text-sm font-semibold text-gray-900 ${truncate ? "max-w-[60%] text-right" : ""}`}>{value ?? "\u2014"}</span>
    </div>
  );
});
