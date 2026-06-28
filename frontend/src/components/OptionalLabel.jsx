import { memo } from 'react';

/**
 * OptionalLabel — renders a field label with an "(optional)" suffix.
 *
 * Used for form fields that are not required so the UX is consistent
 * across all pages.
 *
 * @param {string} text — the field name
 */
export const OptionalLabel = memo(function OptionalLabel({ text }) {
  return (
    <label className="mb-1.5 block text-sm font-medium text-gray-700">
      {text} <span className="font-normal text-gray-400">(optional)</span>
    </label>
  );
});
