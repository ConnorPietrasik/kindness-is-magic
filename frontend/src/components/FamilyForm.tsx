import { useCallback, useEffect, useState } from "react";
import type { FamilyDetail, FamilyPayload } from "../types/domain";
import { Button } from "./Button";
import { Card } from "./Card";
import { defaultFamilyForm } from "./defaults";
import { FormField } from "./FormField";
import { OptionalLabel } from "./OptionalLabel";
import { Spinner } from "./Spinner";

interface FamilyFormProps {
  title: string;
  initial?: Partial<FamilyDetail>;
  isEdit?: boolean;
  referrerMap?: Record<number, string>;
  referrerOptionsLoading?: boolean;
  showOptionalFields?: boolean;
  onSubmit: (formData: FamilyPayload) => void;
  onCancel: () => void;
  loading?: boolean;
}

/**
 * FamilyForm — shared form for creating and editing families.
 *
 * Admin-only features (gated by props):
 * - `referrerMap` — shows a referrer selector on both create and edit.
 */
export function FamilyForm({
  title,
  initial,
  isEdit,
  referrerMap,
  referrerOptionsLoading,
  showOptionalFields = true,
  onSubmit,
  onCancel,
  loading,
}: FamilyFormProps) {
  const [form, setForm] = useState(() => ({ ...defaultFamilyForm, ...initial }));

  useEffect(() => {
    setForm({ ...defaultFamilyForm, ...initial });
  }, [initial]);

  const update = (key: string, val: string | number | boolean | null) => setForm((prev) => ({ ...prev, [key]: val }));

  // Referrer select options
  const referrerOptions = referrerMap ? Object.entries(referrerMap) : [];
  const hasReferrerMap = !!referrerMap;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSubmit(form as unknown as FamilyPayload);
    },
    [form, onSubmit]
  );

  return (
    <Card className="mb-6 border border-gray-200">
      <h3 className="mb-4 text-lg font-semibold text-violet-950">{title}</h3>
      <form onSubmit={handleSubmit}>
        <div className="flex flex-col gap-4">
          {/* Referrer select (create and edit when referrerMap is provided) */}
          {hasReferrerMap && referrerOptionsLoading && (
            <div className="flex items-center gap-2 text-btn-start">
              <Spinner size="sm" />
              <span className="text-sm">Loading referrers…</span>
            </div>
          )}
          {hasReferrerMap && !referrerOptionsLoading && referrerOptions.length > 0 && (
            <FormField
              label={isEdit ? "Referrer" : "Referrer"}
              as="select"
              fieldProps={{
                value: isEdit
                  ? String((form as Record<string, unknown>).referrer_id ?? 0)
                  : String((form as Record<string, unknown>).referrer_id) || "",
                onChange: (e: React.ChangeEvent<HTMLSelectElement>) => update("referrer_id", parseInt(e.target.value, 10)),
                required: true,
              }}
            >
              {!isEdit && <option value="">Select referrer…</option>}
              {isEdit && <option value="0">Unassign referrer</option>}
              {referrerOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name} (ID {id})
                </option>
              ))}
            </FormField>
          )}

          <FormField
            label="Family Name"
            fieldProps={{
              value: form.family_name,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("family_name", e.target.value),
              required: true,
              maxLength: 40,
            }}
          />

          <FormField
            label="Family Wish"
            fieldProps={{
              value: form.family_wish,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("family_wish", e.target.value),
              required: true,
              maxLength: 400,
            }}
          />

          <FormField
            label="Contact Name"
            fieldProps={{
              value: form.contact_name,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("contact_name", e.target.value),
              required: true,
              maxLength: 40,
            }}
          />

          {showOptionalFields && (
            <>
              <div>
                <OptionalLabel text="Bio" />
                <FormField
                  as="textarea"
                  fieldProps={{
                    value: form.bio || "",
                    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => update("bio", e.target.value),
                    rows: 3,
                  }}
                />
              </div>

              <div>
                <OptionalLabel text="Address" />
                <FormField
                  type="text"
                  fieldProps={{
                    value: form.address || "",
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("address", e.target.value),
                    maxLength: 200,
                  }}
                />
              </div>

              <div>
                <OptionalLabel text="Phone" />
                <FormField
                  type="text"
                  fieldProps={{
                    value: form.phone_number || "",
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("phone_number", e.target.value),
                    maxLength: 20,
                  }}
                />
              </div>
            </>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <Button type="submit" loading={loading}>
            {loading ? "Saving…" : isEdit ? "Update" : "Create"}
          </Button>
          <Button variant="secondary" type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
