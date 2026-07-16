import { memo } from "react";

type SpinnerSize = "sm" | "md" | "lg";

interface SpinnerProps {
  size?: SpinnerSize;
  color?: string;
  className?: string;
}

const spinnerPath = "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83";

const spinnerSize: Record<SpinnerSize, string> = {
  sm: "w-5 h-5",
  md: "w-8 h-8",
  lg: "w-12 h-12",
};

/**
 * Spinner — animated SVG spinner with configurable size.
 */
export const Spinner = memo(({ size = "md", color = "text-btn-start", className = "" }: SpinnerProps) => (
  <svg
    className={`animate-spin ${spinnerSize[size] ?? spinnerSize.md} ${color} ${className}`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={spinnerPath} />
  </svg>
));

/**
 * PageSpinner — full-screen centred spinner for route loading.
 */
export function PageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <Spinner size="lg" />
    </div>
  );
}

interface InlineSpinnerProps {
  className?: string;
}

/**
 * InlineSpinner — small centred block for section-level loading.
 */
export function InlineSpinner({ className = "" }: InlineSpinnerProps) {
  return (
    <div className={`flex items-center justify-center py-8 ${className}`}>
      <Spinner size="md" />
    </div>
  );
}
