import type { ChangeEvent } from "react";
import { FormField } from "./FormField";

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  required?: boolean;
  fieldProps?: Record<string, unknown>;
}

/**
 * PhoneInput — auto-formats digits into `NNN-NNN-NNNN` as the user types.
 *
 * Accepts and returns raw digits only (no dashes).  The formatted display
 * is handled internally so that form state stays clean for API payloads.
 */
export function PhoneInput({ value, onChange, error, required = true, fieldProps = {} }: PhoneInputProps) {
  const rawDigits = typeof value === "string" ? value.replace(/\D/g, "") : "";

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "");
    onChange(digits);
  };

  const displayValue =
    rawDigits.length >= 7
      ? `${rawDigits.slice(0, 3)}-${rawDigits.slice(3, 6)}-${rawDigits.slice(6, 10)}`
      : rawDigits.length >= 4
        ? `${rawDigits.slice(0, 3)}-${rawDigits.slice(3)}`
        : rawDigits;

  return (
    <div>
      <FormField
        label="Phone Number"
        type="tel"
        fieldProps={{
          value: displayValue,
          onChange: handleChange,
          required,
          placeholder: "555-123-4567",
          autoComplete: "tel",
          inputMode: "numeric",
          ...fieldProps,
        }}
        error={error}
      />
      <p className="mt-1 text-xs text-gray-500">10 digits required. Dashes are added automatically.</p>
    </div>
  );
}
