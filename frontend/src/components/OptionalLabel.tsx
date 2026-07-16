import { memo } from "react";

interface OptionalLabelProps {
  text: string;
}

/**
 * OptionalLabel — renders a field label with an "(optional)" suffix.
 */
export const OptionalLabel = memo(function OptionalLabel({ text }: OptionalLabelProps) {
  return (
    <span className="mb-1.5 block text-sm font-medium text-gray-700">
      {text} <span className="font-normal text-gray-400">(optional)</span>
    </span>
  );
});
