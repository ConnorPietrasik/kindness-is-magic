import { useCallback, useEffect, useMemo, useState } from "react";
import type { PersonDetail, PersonPayload, WishCreate, WishSummary } from "../types/domain";
import { WISH_TYPE } from "../types/domain";
import { Button } from "./Button";
import { Card } from "./Card";
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
  onSubmit: (formData: PersonPayload) => void;
  onCancel: () => void;
  loading?: boolean;
}

/** Internal form state shape — flat fields that map to wishes on submit. */
interface FormState {
  given_name: string;
  age: number;
  title: string;
  wish_description: string;
  wish_size: string;
  fun_wish_description: string;
  note: string;
  family_id: number;
}

/** Map existing wishes into the flat form fields. */
function wishesToFormFields(wishes: WishSummary[]): Pick<FormState, "wish_description" | "wish_size" | "fun_wish_description"> {
  const result: Partial<FormState> = {};
  for (const wish of wishes) {
    if (wish.deleted_at) continue;
    if (wish.type === "adult" || wish.type === "practical") {
      result.wish_description = wish.description;
      result.wish_size = wish.size ?? "";
    } else if (wish.type === "fun") {
      result.fun_wish_description = wish.description;
    }
  }
  return result as Pick<FormState, "wish_description" | "wish_size" | "fun_wish_description">;
}

/** Normalize user-entered size: empty string or "0" → null (N/A). */
function normalizeSize(value: string): string | null {
  if (value === "" || value === "0") return null;
  return value;
}

/** Build the wishes array from form fields based on age. */
function buildWishes(form: FormState): WishCreate[] {
  if (form.age >= 18) {
    return [
      {
        type: WISH_TYPE.adult,
        description: form.wish_description,
        size: normalizeSize(form.wish_size),
      },
    ];
  }
  return [
    {
      type: WISH_TYPE.practical,
      description: form.wish_description,
      size: normalizeSize(form.wish_size),
    },
    {
      type: WISH_TYPE.fun,
      description: form.fun_wish_description,
      size: null,
    },
  ];
}

/**
 * PersonForm — shared form for creating and editing people.
 *
 * Age-based conditional wish rendering:
 * - age >= 18: single "Wish" textarea + "Size" input
 * - age < 18: "Practical Wish" textarea + "Size" input, "Fun Wish" textarea
 *
 * Admin-only features (gated by props):
 * - `familyMap` — shows a family selector on create.
 */
export function PersonForm({ title, initial, isEdit, familyMap, familyOptionsLoading, onSubmit, onCancel, loading }: PersonFormProps) {
  const [form, setForm] = useState<FormState>(() => {
    const base: FormState = {
      ...defaultPersonForm,
      given_name: initial?.given_name ?? "",
      age: initial?.age ?? 0,
      title: initial?.title ?? "",
      note: initial?.note ?? "",
      family_id: initial?.family_id ?? 0,
    };
    // If editing, populate wish fields from existing wishes
    if (initial?.wishes && initial.wishes.length > 0) {
      return { ...base, ...wishesToFormFields(initial.wishes) };
    }
    return base;
  });

  useEffect(() => {
    const base: FormState = {
      ...defaultPersonForm,
      given_name: initial?.given_name ?? "",
      age: initial?.age ?? 0,
      title: initial?.title ?? "",
      note: initial?.note ?? "",
      family_id: initial?.family_id ?? 0,
    };
    // If editing, populate wish fields from existing wishes
    if (initial?.wishes && initial.wishes.length > 0) {
      setForm({ ...base, ...wishesToFormFields(initial.wishes) });
    } else {
      setForm(base);
    }
  }, [initial]);

  const update = (key: keyof FormState, val: string | number) => setForm((prev) => ({ ...prev, [key]: val }));

  const isAdult = form.age >= 18;

  // Only shown on admin create when familyMap is provided
  const familyOptions = familyMap ? Object.entries(familyMap) : [];
  const hasFamilyMap = !!familyMap;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const wishes = buildWishes(form);
      const payload: PersonPayload = {
        given_name: form.given_name,
        age: form.age,
        title: form.title || null,
        note: form.note || null,
        wishes,
        ...(form.family_id > 0 ? { family_id: form.family_id } : {}),
      };
      onSubmit(payload);
    },
    [form, onSubmit]
  );

  // Memoize label text for the primary wish field
  const primaryWishLabel = useMemo(() => (isAdult ? "Wish" : "Practical Wish"), [isAdult]);

  return (
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
                value: form.family_id || "",
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
                value: form.family_id ?? "",
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  update("family_id", e.target.value ? parseInt(e.target.value, 10) : 0),
                required: true,
                min: 1,
                autoComplete: "off",
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
                autoComplete: "off",
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
                autoComplete: "off",
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
                autoComplete: "off",
              }}
            />
          </div>

          {/* Primary wish (adult wish or practical wish) + size */}
          <FormField
            label={primaryWishLabel}
            as="textarea"
            fieldProps={{
              value: form.wish_description,
              onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => update("wish_description", e.target.value),
              required: true,
              maxLength: 60,
              rows: 2,
              autoComplete: "off",
            }}
          />

          <FormField
            label="Size"
            fieldProps={{
              value: form.wish_size,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("wish_size", e.target.value),
              required: true,
              maxLength: 20,
              placeholder: 'e.g. "M", "8", or "0" if N/A',
              autoComplete: "off",
            }}
          />

          {/* Fun wish — children only */}
          {!isAdult && (
            <FormField
              label="Fun Wish"
              as="textarea"
              fieldProps={{
                value: form.fun_wish_description,
                onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => update("fun_wish_description", e.target.value),
                required: true,
                maxLength: 60,
                rows: 2,
                autoComplete: "off",
              }}
            />
          )}

          <div>
            <OptionalLabel text="Note" />
            <FormField
              as="textarea"
              fieldProps={{
                value: form.note || "",
                onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => update("note", e.target.value),
                maxLength: 400,
                rows: 2,
                autoComplete: "off",
              }}
            />
          </div>
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
