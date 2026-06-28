import { memo } from 'react';
import Button from './Button';

/**
 * ConfirmDialog — modal confirmation dialog for destructive actions.
 *
 * @param {boolean} open        — whether the dialog is visible
 * @param {string}  title       — primary prompt text
 * @param {string}  description — secondary detail text
 * @param {function} onConfirm  — called when user confirms
 * @param {function} onCancel   — called when user cancels
 * @param {boolean} loading     — disable buttons while mutation is in-flight
 */
export const ConfirmDialog = memo(function ConfirmDialog({
  open,
  title,
  description,
  onConfirm,
  onCancel,
  loading = false,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
        <p className="mb-4 text-sm text-gray-700">
          {title}
          {description && (
            <span className="block text-xs text-gray-500">{description}</span>
          )}
        </p>
        <div className="flex gap-3">
          <Button
            variant="danger"
            className="flex-1"
            onClick={onConfirm}
            loading={loading}
          >
            {loading ? 'Deleting…' : 'Yes, delete'}
          </Button>
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
});
