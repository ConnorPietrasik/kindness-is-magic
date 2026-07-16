import { memo } from "react";

type ErrorBoxVariant = "error" | "success" | "info";

interface ErrorBoxProps {
  variant?: ErrorBoxVariant;
  message: string;
  className?: string;
}

/**
 * ErrorBox — display a message in error, success, or info style.
 */
export const ErrorBox = memo(({ variant = "error", message, className = "" }: ErrorBoxProps) => {
  const styles: Record<ErrorBoxVariant, string> = {
    error: "bg-red-50 text-red-700 border-red-200",
    success: "bg-green-50 text-green-700 border-green-200",
    info: "bg-sky-50 text-sky-700 border-sky-200",
  };

  return <div className={`rounded-lg border px-4 py-2.5 text-sm ${styles[variant] ?? styles.error} ${className}`}>{message}</div>;
});
