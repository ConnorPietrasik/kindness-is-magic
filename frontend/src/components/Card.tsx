import { memo, type ReactNode } from 'react';

interface CardProps {
  className?: string;
  children?: ReactNode;
}

/**
 * Card — white rounded container with subtle shadow.
 */
export const Card = memo(({ className = '', children }: CardProps) => (
  <div className={`rounded-xl bg-white p-6 shadow-sm ${className}`}>
    {children}
  </div>
));
