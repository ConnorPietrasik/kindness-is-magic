import { useCallback, useEffect, useMemo, useState } from "react";
import type { PersonDetail, PersonPayload } from "../types/domain";
import { Button } from "./Button";
import { Card } from "./Card";
import { ConfirmDialog } from "./ConfirmDialog";
import { defaultPersonForm } from "./defaults";
import { FormField } from "./FormField";
import { OptionalLabel } from "./OptionalLabel";
import { Spinner } from "./Spinner";

interface PersonFormProps {
  title: string;
  initial?: Partial<PersonDetail>;
  isEdit?: boolean;
  familyMap?: Record<number, string>;
  familyOptionsLoading?: boolean;
  /** When true the form shows a soft-delete toggle (admin-only). */
  showDeletedToggle?: boolean;
  onSubmit: (formData: PersonPayload) => void;
  onCancel: () => void;
  loading?: boolean;
}

/**
 * PersonForm — shared form for creating and editing people.
 *
 * Admin-only features (gated by props):
 * - `familyMap` — shows a family selector on create.
 * - `showDeletedToggle` — shows a soft-delete checkbox that triggers a
 *   confirmation dialog before the mutation fires.
 */
export function PersonForm({
  title,
  initial,
  isEdit,
  familyMap,
  familyOptionsLoading,
  showDeletedToggle = false,
  onSubmit,
  onCancel,
  loading,
}: PersonFormProps) {
  const [form, setForm] = useState(() => ({ ...defaultPersonForm, ...initial }));
  const [pendingDelete, setPendingDelete] = useState(false);

  useEffect(() => {
    setForm({ ...defaultPersonForm, ...initial });
  }, [initial]);

  const update = (key: string, val: string | number | boolean | null) => setForm((prev) => ({ ...prev, [key]: val }));

  // Only shown on admin create when familyMap is provided
  const familyOptions = familyMap ? Object.entries(familyMap) : [];
  const hasFamilyMap = !!familyMap;

  const originalIsDeleted = useMemo(() => initial?.deleted_at != null, [initial]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const formData = form as unknown as PersonPayload;

      // Check if user is soft-deleting
      if (showDeletedToggle && formData.deleted_at != null && !originalIsDeleted) {
        setPendingDelete(true);
        return;
      }

      onSubmit(formData);
    },
    [form, onSubmit, showDeletedToggle, originalIsDeleted]
  );

  const handleConfirmDelete = useCallback(() => {
    setPendingDelete(false);
    onSubmit(form as unknown as PersonPayload);
  }, [form, onSubmit]);

  return (
    <>
      <Card className="mb-6 border border-gray-200">
        <h3 className="mb-4 text-lg font-semibold text-violet-950">{title}</h3>
        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-4">
            {/* Family select (admin create only) */}
            {!isEdit && hasFamilyMap && familyOptionsLoading && (
              <div className="flex items-center gap-2 text-btn-start">
                <Spinner size="sm" />
                <span className="text-sm">Loading families…</span>
              </div>
            )}
            {!isEdit && hasFamilyMap && !familyOptionsLoading && familyOptions.length > 0 && (
              <FormField
                label="Family"
                as="select"
                fieldProps={{
                  value: (form as Record<string, unknown>).family_id || "",
                  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => update("family_id", parseInt(e.target.value, 10)),
                  required: true,
                }}
              >
                <option value="">Select family…</option>
                {familyOptions.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name} (ID {id})
                  </option>
                ))}
              </FormField>
            )}

            {!isEdit && hasFamilyMap && !familyOptionsLoading && familyOptions.length === 0 && (
              <FormField
                label="Family ID"
                type="number"
                fieldProps={{
                  value: (form as Record<string, unknown>).family_id ?? "",
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                    update("family_id", e.target.value ? parseInt(e.target.value, 10) : ""),
                  required: true,
                  min: 1,
                }}
              />
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="Given Name"
                fieldProps={{
                  value: form.given_name,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("given_name", e.target.value),
                  required: true,
                  maxLength: 40,
                }}
              />
              <FormField
                label="Age"
                type="number"
                fieldProps={{
                  value: form.age,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("age", parseInt(e.target.value, 10) || 0),
                  required: true,
                  min: 0,
                  max: 200,
                }}
              />
            </div>

            <div>
              <OptionalLabel text="Title" />
              <FormField
                type="text"
                fieldProps={{
                  value: form.title || "",
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("title", e.target.value),
                  maxLength: 40,
                }}
              />
            </div>

            <FormField
              label="Practical Wish"
              as="textarea"
              fieldProps={{
                value: form.practical_wish,
                onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => update("practical_wish", e.target.value),
                required: true,
                maxLength: 400,
                rows: 2,
              }}
            />

            <FormField
              label="Fun Wish"
              as="textarea"
              fieldProps={{
                value: form.fun_wish,
                onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => update("fun_wish", e.target.value),
                required: true,
                maxLength: 400,
                rows: 2,
              }}
            />

            <div>
              <OptionalLabel text="Note" />
              <FormField
                as="textarea"
                fieldProps={{
                  value: form.note || "",
                  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => update("note", e.target.value),
                  maxLength: 400,
                  rows: 2,
                }}
              />
            </div>

            {/* Soft-delete toggle (admin edit only) */}
            {showDeletedToggle && isEdit && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="person_deleted_at"
                  checked={form.deleted_at != null}
                  onChange={(e) => update("deleted_at", e.target.checked ? new Date().toISOString() : null)}
                  className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
                <label htmlFor="person_deleted_at" className="text-sm font-medium text-gray-700">
                  {form.deleted_at != null ? "Mark as deleted" : "Soft-deleted"}
                  {form.deleted_at != null && !originalIsDeleted && (
                    <span className="ml-1 text-xs text-red-600">(requires confirmation)</span>
                  )}
                </label>
              </div>
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

      {/* Confirmation dialog when soft-deleting */}
      <ConfirmDialog
        open={pendingDelete}
        title="Soft-delete this person?"
        description="The person will be hidden from normal views. The action can be reversed by unchecking 'Soft-deleted'."
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(false)}
      />
    </>
  );
}
