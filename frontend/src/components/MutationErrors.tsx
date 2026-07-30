import { useEffect, useRef } from "react";
import { useToast } from "../context/ToastContext";
import { formatApiError } from "../lib/utils";

interface MutationError {
  error?: unknown;
}

interface MutationErrorsProps {
  mutations: readonly MutationError[];
  fallback?: string;
}

/**
 * MutationErrors — watches mutation errors and displays them as toast
 * notifications so they are always visible to the user.
 *
 * Tracks shown errors per mutation index to avoid duplicate toasts on
 * re-renders while still allowing the same message to reappear if a
 * different mutation produces it.
 */
export function MutationErrors({ mutations, fallback = "Request failed." }: MutationErrorsProps) {
  const toast = useToast();
  // Map from mutation index → last error message shown
  const lastError = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    for (let i = 0; i < mutations.length; i++) {
      const mut = mutations[i];
      if (!mut) continue;

      if (mut.error) {
        const message = formatApiError(mut.error, fallback);
        const prev = lastError.current.get(i);
        if (prev !== message) {
          lastError.current.set(i, message);
          toast.error(message);
        }
      } else {
        // Error cleared — forget what we last showed for this mutation
        lastError.current.delete(i);
      }
    }
  }, [mutations, fallback, toast]);

  return null;
}
