import { memo } from "react";

interface LogoProps {
  /** Tailwind sizing classes, e.g. "h-16 w-16". Defaults to h-20 w-20. */
  className?: string;
  /** Accessible label. */
  alt?: string;
  /**
   * "screen" (default) — the watercolor badge at /logo.png, used across the app.
   * "print" — the higher-contrast badge at /logo-wishcards.jpg, used on the
   * printable wish cards where the deeper colors reproduce better on paper.
   */
  variant?: "screen" | "print";
}

/**
 * Logo — the circular watercolor "Kindness is Magic" badge.
 *
 * Served from /logo.png (screen; 512px) or /logo-wishcards.jpg (print; 1024px),
 * both with white backgrounds in frontend/public.
 * The vector master is logo.svg at the repo root (kept locally, not committed).
 * The badge is circular, so rounded-full just crops any corner fringe.
 */
export const Logo = memo(({ className = "h-20 w-20", alt = "Kindness is Magic", variant = "screen" }: LogoProps) => (
  <img src={variant === "print" ? "/logo-wishcards.jpg" : "/logo.png"} alt={alt} className={`shrink-0 rounded-full ${className}`} />
));
