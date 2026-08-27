import { memo } from "react";

interface LogoProps {
  /** Tailwind sizing classes, e.g. "h-16 w-16". Defaults to h-20 w-20. */
  className?: string;
  /** Accessible label. */
  alt?: string;
}

/**
 * Logo — the circular watercolor "Kindness is Magic" badge.
 *
 * Served from /logo.png (512px, white background, see frontend/public).
 * The vector master is logo.svg at the repo root (kept locally, not committed).
 * The badge is circular, so rounded-full just crops any corner fringe.
 */
export const Logo = memo(({ className = "h-20 w-20", alt = "Kindness is Magic" }: LogoProps) => (
  <img src="/logo.png" alt={alt} className={`shrink-0 rounded-full ${className}`} />
));
