import { type ReactNode, useId } from "react";

type AsElement = "input" | "select" | "textarea";

interface FormFieldProps {
  label?: string;
  htmlFor?: string;
  type?: string;
  as?: AsElement;
  fieldProps?: Record<string, unknown>;
  className?: string;
  children?: ReactNode;
}

/**
 * FormField — label + input/select/textarea with consistent spacing.
 */
export function FormField({ label, htmlFor, type = "text", as = "input", fieldProps = {}, className = "", children }: FormFieldProps) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  const Component = as;
  const { className: extraClass = "", ...restProps } = fieldProps as Record<string, unknown>;
  const baseInputClass =
    "w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-base outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20";

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <Component
        id={id}
        type={Component === "input" ? type : undefined}
        className={`${baseInputClass}${extraClass ? ` ${extraClass}` : ""}`}
        {...restProps}
      >
        {children}
      </Component>
    </div>
  );
}
