import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type ToastVariant = "error" | "success" | "info";

interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface ToastApi {
  error: (message: string) => void;
  success: (message: string) => void;
  info: (message: string) => void;
  dismiss: (id: number) => void;
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

const ToastContext = createContext<ToastApi | null>(null);

export const ToastProvider = ToastContext.Provider;

/**
 * useToast — imperative toast API.
 *
 * Must be used inside a <ToastProvider>.
 * Throws if called outside the provider (developer error).
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/* ToastContainer — renders stacked toasts at top-right                */
/* ------------------------------------------------------------------ */

const TOAST_DURATIONS: Record<ToastVariant, number> = {
  error: 10000,
  success: 3000,
  info: 5000,
};
const MAX_TOASTS = 5;

const variantStyles: Record<ToastVariant, string> = {
  error: "bg-red-600 text-white",
  success: "bg-green-600 text-white",
  info: "bg-sky-600 text-white",
};

interface ToastContainerProps {
  children: ReactNode;
}

export function ToastContainer({ children }: ToastContainerProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const addToast = useCallback((variant: ToastVariant, message: string) => {
    const id = timers.current.size + Date.now();
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATIONS[variant]);
    timers.current.add(timer);
    setToasts((prev) => {
      const updated = [...prev, { id, variant, message, timer }];
      return updated.slice(-MAX_TOASTS);
    });
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => {
      const toast = prev.find((t) => t.id === id);
      if (toast?.timer) {
        clearTimeout(toast.timer);
        timers.current.delete(toast.timer);
      }
      return prev.filter((t) => t.id !== id);
    });
  }, []);

  // Clean up timers when component unmounts
  useEffect(() => {
    return () => {
      timers.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      error: (message: string) => addToast("error", message),
      success: (message: string) => addToast("success", message),
      info: (message: string) => addToast("info", message),
      dismiss,
    }),
    [addToast, dismiss]
  );

  return (
    <ToastProvider value={api}>
      {/* Toast stack */}
      {toasts.length > 0 && (
        <div className="fixed right-4 top-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg ${variantStyles[toast.variant]}`}
              role="alert"
            >
              <span className="flex-1 text-sm">{toast.message}</span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 text-current/70 hover:text-current"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {children}
    </ToastProvider>
  );
}
