import { forwardRef, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  size?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * Button — reusable button with variants.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", loading = false, className = "", children, ...rest },
  ref
) {
  const variants: Record<ButtonVariant, string> = {
    primary:
      "inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-btn-start/50 disabled:cursor-not-allowed disabled:opacity-50 bg-gradient-to-r from-btn-start to-btn-end text-white hover:opacity-90",
    secondary:
      "inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-btn-start/50 disabled:cursor-not-allowed disabled:opacity-50 border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
    ghost:
      "inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-btn-start/50 disabled:cursor-not-allowed disabled:opacity-50 border border-white/30 bg-white/15 text-white hover:bg-white/25",
    danger:
      "inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-btn-start/50 disabled:cursor-not-allowed disabled:opacity-50 bg-red-600 text-white hover:bg-red-700",
  };

  return (
    <button ref={ref} className={`${variants[variant] ?? variants.primary} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading && (
        <svg
          className="mr-2 h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
      )}
      {children}
    </button>
  );
});

export { Button };
