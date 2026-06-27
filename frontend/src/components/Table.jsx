import { memo, forwardRef } from 'react';

/**
 * Table — styled table wrapper with overflow handling.
 */
export const Table = memo(({ className = '', children }) => (
  <div className={`overflow-x-auto rounded-xl border border-gray-200 bg-white ${className}`}>
    <table className="w-full text-left text-sm">{children}</table>
  </div>
));

/**
 * TableHead — header row with uppercase muted text.
 */
export const TableHead = memo(({ children }) => (
  <thead className="border-b border-gray-200 bg-gray-50">
    <tr>{children}</tr>
  </thead>
));

/**
 * TableBody — body wrapper.
 */
export const TableBody = memo(({ children }) => (
  <tbody className="divide-y divide-gray-100">{children}</tbody>
));

/**
 * Th — header cell.
 */
export const Th = memo(({ children }) => (
  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
    {children}
  </th>
));

/**
 * Tr — body row.
 */
export const Tr = forwardRef(function Tr({ className = '', children, ...props }, ref) {
  return (
    <tr ref={ref} className={`transition-colors hover:bg-gray-50 ${className}`} {...props}>
      {children}
    </tr>
  );
});

/**
 * Td — body cell.
 */
export const Td = memo(({ className = '', children }) => (
  <td className={`px-4 py-3 text-gray-700 ${className}`}>{children}</td>
));
