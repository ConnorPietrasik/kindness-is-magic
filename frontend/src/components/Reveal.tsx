import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

interface RevealProps {
  children: ReactNode;
  className?: string;
}

/**
 * Fades its content in (opacity + 16px rise) the first time it scrolls into
 * the viewport. The animation is an enhancement, never a gate: content
 * renders fully visible when the reveal cannot run — reduced-motion
 * preference, no IntersectionObserver, or no matchMedia (test environments).
 */
export function Reveal({ children, className = "" }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(() => !canReveal());

  useEffect(() => {
    if (shown) return;
    const node = ref.current;
    if (!node) return;

    // Fire once the top edge is ~10% above the viewport bottom, so the fade
    // is already under way by the time the section is in view.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shown]);

  const state = shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0";

  return (
    <div ref={ref} className={`transition-all duration-700 ease-out motion-reduce:transition-none ${state} ${className}`}>
      {children}
    </div>
  );
}

/** Whether a scroll reveal can actually run in this environment for this user. */
function canReveal(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.IntersectionObserver === "undefined") return false;
  // Checked lazily (some test environments lack matchMedia) and used only to
  // suppress the reveal — its absence never blocks content.
  if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  return true;
}
