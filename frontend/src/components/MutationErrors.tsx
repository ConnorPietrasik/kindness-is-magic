import { memo } from 'react';
import { ErrorBox } from './ErrorBox';
import { formatApiError } from '../lib/utils';

interface MutationError {
  error?: unknown;
}

interface MutationErrorsProps {
  mutations: readonly MutationError[];
  fallback?: string;
}

/**
 * MutationErrors — renders an <ErrorBox> for every mutation that has an
 * error, using the shared formatApiError() helper so all pages produce
 * consistent, user-friendly messages.
 */
export const MutationErrors = memo(function MutationErrors({ mutations, fallback = 'Request failed.' }: MutationErrorsProps) {
  const errors = mutations.filter((m) => m.error);

  if (!errors.length) return null;

  return (
    <div className="mt-4 flex flex-col gap-2">
      {errors.map((mut, i) => (
        <ErrorBox key={i} message={formatApiError(mut.error, fallback)} />
      ))}
    </div>
  );
});
