import { memo, type ReactNode, useEffect, useRef } from "react";
import type { ButtonVariant } from "./Button";
import { Button } from "./Button";

/**
 * Open dialogs' tokens in mount order. Every instance shares the same window
 * Escape listener, so the stack is tracked here (module state): the last one
 * opened is topmost (all overlays are `z-50 fixed` — DOM order is paint
 * order), and only it answers Escape, so stacked dialogs dismiss one at a
 * time instead of both closing on a single keypress.
 */
const openDialogTokens: symbol[] = [];

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
  // Stable per-instance token for the open-dialogs registry.
  const tokenRef = useRef<symbol | null>(null);
  if (tokenRef.current === null) tokenRef.current = Symbol("ConfirmDialog");
  // Latest onCancel without a dependency on it: the stack effect must depend
  // on `open` only, or a parent re-render would re-push this token and could
  // reorder the stack against the paint order.
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  // Escape cancels (same as the Cancel button). It also gives Escape something
  // to hit when the dialog sits on top of a non-modal drawer (e.g. the email
  // composer): the drawer yields Escape to any open popup instead of closing.
  useEffect(() => {
    if (!open) return;
    const token = tokenRef.current!;
    openDialogTokens.push(token);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openDialogTokens[openDialogTokens.length - 1] === token) {
        onCancelRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const i = openDialogTokens.indexOf(token);
      if (i !== -1) openDialogTokens.splice(i, 1);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl" role="alertdialog" aria-modal="true">
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
