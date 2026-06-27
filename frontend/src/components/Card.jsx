import { memo } from 'react';

/**
 * Card — white rounded container with subtle shadow.
 *
 * @param {string} className — extra classes (e.g. 'mb-6')
 * @param {ReactNode} children
 */
export const Card = memo(({ className = '', children }) => (
  <div className={`rounded-xl bg-white p-6 shadow-sm ${className}`}>
    {children}
  </div>
));
