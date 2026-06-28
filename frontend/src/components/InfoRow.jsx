import { memo } from 'react';

/**
 * InfoRow — a single label/value row for display-only detail sections.
 *
 * React auto-escapes JSX content so no manual escaping is needed.
 *
 * @param {string}  label   — field label
 * @param {*}       value   — field value
 * @param {boolean} isLast  — omit bottom border on last row
 * @param {boolean} truncate — limit value width to 60 % with right-alignment
 */
export const InfoRow = memo(function InfoRow(
  { label, value, isLast = false, truncate = true },
) {
  return (
    <div
      className={`flex items-baseline justify-between px-1 py-2 ${
        isLast ? '' : 'border-b border-gray-100'
      }`}
    >
      <span className="text-sm font-medium text-gray-500">{label}</span>
      <span
        className={`text-sm font-semibold text-gray-900 ${
          truncate ? 'max-w-[60%] text-right' : ''
        }`}
      >
        {value ?? '—'}
      </span>
    </div>
  );
});
