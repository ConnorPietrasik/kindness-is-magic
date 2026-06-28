import { useState, useEffect } from 'react';
import { Card } from './Card';
import Button from './Button';
import FormField from './FormField';
import { OptionalLabel } from './OptionalLabel';
import { Spinner } from './Spinner';
import { defaultPersonForm } from './defaults';

/**
 * PersonForm — shared form for creating and editing people.
 *
 * @param {string}   title           — "Add Person" | "Edit Person"
 * @param {object}   initial         — pre-filled values (merged with defaultPersonForm)
 * @param {boolean}  isEdit          — whether we are editing an existing record
 * @param {object}   familyMap       — { [id]: name } for admin family dropdown (omit for referrer/family pages)
 * @param {function} onSubmit        — (formData) => void  (normalised — no event wrapper)
 * @param {function} onCancel        — () => void
 * @param {boolean}  loading         — disables submit button
 */
export default function PersonForm({ title, initial, isEdit, familyMap, familyOptionsLoading, onSubmit, onCancel, loading }) {
  const [form, setForm] = useState(() => ({ ...defaultPersonForm, ...initial }));

  useEffect(() => {
    setForm({ ...defaultPersonForm, ...initial });
  }, [initial]);

  const update = (key, val) => setForm((prev) => ({ ...prev, [key]: val }));

  // Only shown on admin create when familyMap is provided
  const familyOptions = familyMap ? Object.entries(familyMap) : [];
  const hasFamilyMap = !!familyMap;

  return (
    <Card className="mb-6 border border-gray-200">
      <h3 className="mb-4 text-lg font-semibold text-violet-950">{title}</h3>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}>
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
                value: form.family_id || '',
                onChange: (e) => update('family_id', parseInt(e.target.value)),
                required: true,
              }}
            >
              <option value="">Select family…</option>
              {familyOptions.map(([id, name]) => (
                <option key={id} value={id}>{name} (ID {id})</option>
              ))}
            </FormField>
          )}

          {!isEdit && hasFamilyMap && !familyOptionsLoading && familyOptions.length === 0 && (
            <FormField
              label="Family ID"
              type="number"
              fieldProps={{
                value: form.family_id ?? '',
                onChange: (e) => update('family_id', e.target.value ? parseInt(e.target.value) : ''),
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
                onChange: (e) => update('given_name', e.target.value),
                required: true,
                maxLength: 40,
              }}
            />
            <FormField
              label="Age"
              type="number"
              fieldProps={{
                value: form.age,
                onChange: (e) => update('age', parseInt(e.target.value) || 0),
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
                value: form.title || '',
                onChange: (e) => update('title', e.target.value),
                maxLength: 40,
              }}
            />
          </div>

          <FormField
            label="Practical Wish"
            as="textarea"
            fieldProps={{
              value: form.practical_wish,
              onChange: (e) => update('practical_wish', e.target.value),
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
              onChange: (e) => update('fun_wish', e.target.value),
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
                value: form.note || '',
                onChange: (e) => update('note', e.target.value),
                maxLength: 400,
                rows: 2,
              }}
            />
          </div>
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
