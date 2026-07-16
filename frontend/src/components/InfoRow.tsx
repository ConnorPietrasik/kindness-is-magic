import { memo } from 'react';

interface InfoRowProps {
  label: string;
  value?: string | number | null;
  isLast?: boolean;
  truncate?: boolean;
}

/**
 * InfoRow — a single label/value row for display-only detail sections.
 */
export const InfoRow = memo(function InfoRow(
  { label, value, isLast = false, truncate = true }: InfoRowProps,
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
        {value ?? '\u2014'}
      </span>
    </div>
  );
});
