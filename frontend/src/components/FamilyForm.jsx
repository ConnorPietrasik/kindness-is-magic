import { useState, useEffect } from 'react';
import { Card } from './Card';
import Button from './Button';
import FormField from './FormField';
import { OptionalLabel } from './OptionalLabel';
import { Spinner } from './Spinner';
import { defaultFamilyForm } from './defaults';

/**
 * FamilyForm — shared form for creating and editing families.
 *
 * @param {string}   title                — "Add Family" | "Edit Family"
 * @param {object}   initial              — pre-filled values (merged with defaultFamilyForm)
 * @param {boolean}  isEdit               — whether we are editing an existing record
 * @param {object}   referrerMap          — { [id]: name } for admin referrer dropdown (omit otherwise)
 * @param {boolean}  showOptionalFields   — render bio, address, phone (default: true)
 * @param {function} onSubmit             — (formData) => void  (normalised — no event wrapper)
 * @param {function} onCancel             — () => void
 * @param {boolean}  loading              — disables submit button
 */
export default function FamilyForm({
  title,
  initial,
  isEdit,
  referrerMap,
  referrerOptionsLoading,
  showOptionalFields = true,
  onSubmit,
  onCancel,
  loading,
}) {
  const [form, setForm] = useState(() => ({ ...defaultFamilyForm, ...initial }));

  useEffect(() => {
    setForm({ ...defaultFamilyForm, ...initial });
  }, [initial]);

  const update = (key, val) => setForm((prev) => ({ ...prev, [key]: val }));

  // Only shown on admin create when referrerMap is provided
  const referrerOptions = referrerMap ? Object.entries(referrerMap) : [];
  const hasReferrerMap = !!referrerMap;

  return (
    <Card className="mb-6 border border-gray-200">
      <h3 className="mb-4 text-lg font-semibold text-violet-950">{title}</h3>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}>
        <div className="flex flex-col gap-4">
          {/* Referrer select (admin create only) */}
          {!isEdit && hasReferrerMap && referrerOptionsLoading && (
            <div className="flex items-center gap-2 text-btn-start">
              <Spinner size="sm" />
              <span className="text-sm">Loading referrers…</span>
            </div>
          )}
          {!isEdit && hasReferrerMap && !referrerOptionsLoading && referrerOptions.length > 0 && (
            <FormField
              label="Referrer"
              as="select"
              fieldProps={{
                value: form.referrer_id || '',
                onChange: (e) => update('referrer_id', parseInt(e.target.value)),
                required: true,
              }}
            >
              <option value="">Select referrer…</option>
              {referrerOptions.map(([id, name]) => (
                <option key={id} value={id}>{name} (ID {id})</option>
              ))}
            </FormField>
          )}

          <FormField
            label="Family Name"
            fieldProps={{
              value: form.family_name,
              onChange: (e) => update('family_name', e.target.value),
              required: true,
              maxLength: 40,
            }}
          />

          <FormField
            label="Family Wish"
            fieldProps={{
              value: form.family_wish,
              onChange: (e) => update('family_wish', e.target.value),
              required: true,
              maxLength: 400,
            }}
          />

          <FormField
            label="Contact Name"
            fieldProps={{
              value: form.contact_name,
              onChange: (e) => update('contact_name', e.target.value),
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
                    value: form.bio || '',
                    onChange: (e) => update('bio', e.target.value),
                    rows: 3,
                  }}
                />
              </div>

              <div>
                <OptionalLabel text="Address" />
                <FormField
                  type="text"
                  fieldProps={{
                    value: form.address || '',
                    onChange: (e) => update('address', e.target.value),
                    maxLength: 200,
                  }}
                />
              </div>

              <div>
                <OptionalLabel text="Phone" />
                <FormField
                  type="text"
                  fieldProps={{
                    value: form.phone_number || '',
                    onChange: (e) => update('phone_number', e.target.value),
                    maxLength: 20,
                  }}
                />
              </div>
            </>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <Button type="submit" loading={loading}>
            {loading ? 'Saving…' : isEdit ? 'Update' : 'Create'}
          </Button>
          <Button variant="secondary" type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
