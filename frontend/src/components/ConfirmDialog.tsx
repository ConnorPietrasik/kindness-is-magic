import { memo, type ReactNode } from "react";
import type { ButtonVariant } from "./Button";
import { Button } from "./Button";

interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  confirmLabel?: ReactNode;
  loadingLabel?: ReactNode;
  confirmVariant?: ButtonVariant;
}

/**
 * ConfirmDialog — modal confirmation dialog for destructive actions
 * (and other actions that need explicit user confirmation).
 *
 * @param confirmLabel  Label on the confirm button (default: "Yes, delete")
 * @param loadingLabel  Label while the mutation is in-flight (default: "Deleting…")
 * @param confirmVariant  Button variant (default: "danger")
 */
export const ConfirmDialog = memo(function ConfirmDialog({
  open,
  title,
  description,
  onConfirm,
  onCancel,
  loading = false,
  confirmLabel = "Yes, delete",
  loadingLabel = "Deleting…",
  confirmVariant = "danger",
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
        <p className="mb-4 text-sm text-gray-700">
          {title}
          {description && <span className="block text-xs text-gray-500">{description}</span>}
        </p>
        <div className="flex gap-3">
          <Button variant={confirmVariant} className="flex-1" onClick={onConfirm} loading={loading}>
            {loading ? loadingLabel : confirmLabel}
          </Button>
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
});
