import type { ChangeEvent } from "react";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "../lib/utils";
import { FormField } from "./FormField";
import { OptionalLabel } from "./OptionalLabel";

interface DatePickerProps {
  /** ISO 8601 datetime string, or null/undefined for empty. */
  value: string | null | undefined;
  /** Called with ISO 8601 UTC string on change, or empty string when cleared. */
  onChange: (value: string) => void;
  /** Field label. */
  label?: string;
  /** Whether the field is optional (adds "(optional)" suffix to label). */
  isOptional?: boolean;
  /** Validation error message. */
  error?: string | null;
  /** Whether the picker is disabled. */
  disabled?: boolean;
}

/**
 * DatePicker — `<input type="datetime-local">` wrapper that handles
 * local-time ↔ UTC conversion automatically.
 *
 * Accepts `value` as an ISO 8601 string (or null/undefined) and calls
 * `onChange` with an ISO 8601 UTC string (or empty string when cleared).
 *
 * Uses `toDatetimeLocalValue` / `fromDatetimeLocalValue` from utils so the
 * picker always shows the correct local time and stores UTC.
 */
export function DatePicker({ value, onChange, label, isOptional = false, error, disabled }: DatePickerProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(fromDatetimeLocalValue(e.target.value));
  };

  return (
    <div>
      {label && isOptional && <OptionalLabel text={label} />}
      <FormField
        type="datetime-local"
        label={label && !isOptional ? label : undefined}
        fieldProps={{
          value: toDatetimeLocalValue(value),
          onChange: handleChange,
          disabled,
          autoComplete: "off",
        }}
        error={error}
      />
    </div>
  );
}
