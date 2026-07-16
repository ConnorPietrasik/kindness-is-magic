import { memo, forwardRef, type ReactNode } from 'react';

interface TableProps {
  className?: string;
  children?: ReactNode;
}

/**
 * Table — styled table wrapper with overflow handling.
 */
export const Table = memo(({ className = '', children }: TableProps) => (
  <div className={`overflow-x-auto rounded-xl border border-gray-200 bg-white ${className}`}>
    <table className="w-full text-left text-sm">{children}</table>
  </div>
));

interface TableHeadProps {
  children?: ReactNode;
}

/**
 * TableHead — header row with uppercase muted text.
 */
export const TableHead = memo(({ children }: TableHeadProps) => (
  <thead className="border-b border-gray-200 bg-gray-50">
    <tr>{children}</tr>
  </thead>
));

interface TableBodyProps {
  children?: ReactNode;
}

/**
 * TableBody — body wrapper.
 */
export const TableBody = memo(({ children }: TableBodyProps) => (
  <tbody className="divide-y divide-gray-100">{children}</tbody>
));

interface ThProps {
  children?: ReactNode;
}

/**
 * Th — header cell.
 */
export const Th = memo(({ children }: ThProps) => (
  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
    {children}
  </th>
));

interface TrProps extends React.HTMLAttributes<HTMLTableRowElement> {
  className?: string;
  children?: ReactNode;
}

/**
 * Tr — body row.
 */
export const Tr = forwardRef<HTMLTableRowElement, TrProps>(
  function Tr({ className = '', children, ...props }, ref) {
    return (
      <tr ref={ref} className={`transition-colors hover:bg-gray-50 ${className}`} {...props}>
        {children}
      </tr>
    );
  },
);

interface TdProps {
  className?: string;
  children?: ReactNode;
}

/**
 * Td — body cell.
 */
export const Td = memo(({ className = '', children }: TdProps) => (
  <td className={`px-4 py-3 text-gray-700 ${className}`}>{children}</td>
));
