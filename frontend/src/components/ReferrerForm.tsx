/**
 * ReferrerForm — shared form for creating/editing referrers.
 *
 * Used by AdminReferrers, AdminReferrerFamilies, and any page that needs
 * inline referrer creation or editing.
 */

import { useCallback, useEffect, useState } from "react";
import { validatePhoneNumber } from "../lib/validators";
import type { ReferrerDetail, ReferrerPayload } from "../types";
import { Button } from "./Button";
import { Card } from "./Card";
import { FormField } from "./FormField";
import { PhoneInput } from "./PhoneInput";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReferrerFormProps {
  /** Form title (rendered above the form). Omit for no title. */
  title?: string;
  /** Initial values */
  initial: Partial<ReferrerDetail>;
  /** Whether this is an edit (vs. create) */
  isEdit?: boolean;
  /** Submit handler — receives the form payload */
  onSubmit: (data: ReferrerPayload) => void;
  /** Cancel handler */
  onCancel: () => void;
  /** Whether the submit mutation is in-flight */
  loading?: boolean;
  /** Whether to render the Card wrapper. Set to false when already inside a Card. */
  wrapper?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReferrerForm({ title, initial, isEdit = false, onSubmit, onCancel, loading = false, wrapper = true }: ReferrerFormProps) {
  // Extract only payload-relevant fields so ReferrerDetail extras (id, approval_status, etc.) don't leak through
  const [form, setForm] = useState<ReferrerPayload>(() => ({
    name: initial.name,
    phone_number: initial.phone_number,
    family_limit: initial.family_limit,
  }));
  const [phoneError, setPhoneError] = useState<string | null>(null);

  // Re-populate only when the *referrer* being edited changes, not on every new
  // `initial` object identity (background refetches of the same detail).
  const referrerId = initial?.id;
  const [loadedId, setLoadedId] = useState<number | undefined>(referrerId);
  useEffect(() => {
    if (referrerId === loadedId) return;
    setLoadedId(referrerId);
    setForm({ name: initial.name, phone_number: initial.phone_number, family_limit: initial.family_limit });
  }, [initial, referrerId, loadedId]);

  const update = (key: string, val: unknown) => setForm((p) => ({ ...p, [key]: val }));

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const phoneErr = validatePhoneNumber(form.phone_number || "");
      if (phoneErr) {
        setPhoneError(phoneErr);
        return;
      }
      setPhoneError(null);
      onSubmit(form);
    },
    [form, onSubmit]
  );

  const content = (
    <>
      {title && <h3 className="mb-4 text-lg font-semibold text-violet-950">{title}</h3>}
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-4 sm:flex-row">
          <FormField
            label="Name"
            fieldProps={{
              value: form.name,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("name", e.target.value),
              required: true,
              maxLength: 60,
              autoComplete: "off",
            }}
          />
          <FormField
            label="Family Limit"
            type="number"
            fieldProps={{
              value: form.family_limit,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("family_limit", parseInt(e.target.value, 10) || 1),
              required: true,
              min: 1,
              max: 999,
              autoComplete: "off",
            }}
          />
          <PhoneInput
            value={form.phone_number ?? ""}
            onChange={(val) => {
              update("phone_number", val);
              setPhoneError(null);
            }}
            error={phoneError}
          />
        </div>

        <div className="mt-4 flex gap-2">
          <Button type="submit" loading={loading}>
            {loading ? "Saving\u2026" : isEdit ? "Update" : "Create"}
          </Button>
          <Button variant="secondary" type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  );

  if (wrapper) {
    return <Card className="mb-6 border border-gray-200">{content}</Card>;
  }
  return <>{content}</>;
}
