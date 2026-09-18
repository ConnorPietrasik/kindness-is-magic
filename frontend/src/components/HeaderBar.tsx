import { memo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "../lib/routes";
import { Logo } from "./Logo";

interface HeaderBarProps {
  title: string;
  titleTo?: string;
  /** When set, the centred title is a button that calls this instead of a link (e.g. scroll to top). */
  onTitleClick?: () => void;
  left?: ReactNode;
  right?: ReactNode;
  /** Extra classes for the <header> element (e.g. "no-print"). */
  className?: string;
}

/**
 * HeaderBar — purple gradient top bar with title and optional actions.
 *
 * @param titleTo      Where the centred title links to (default: dashboard).
 *                     Pass a public route on unauthenticated pages. Ignored when onTitleClick is set.
 * @param onTitleClick Renders the centred title as a button that calls this handler.
 */
export const HeaderBar = memo(({ title, titleTo = ROUTES.DASHBOARD, onTitleClick, left, right, className = "" }: HeaderBarProps) => (
  <header
    className={`relative sticky top-0 z-50 flex items-center justify-between bg-gradient-to-r from-brand-dark to-brand-light px-4 text-white shadow-md h-14 sm:px-6 ${className}`}
  >
    <div className="z-10 flex items-center gap-3">
      <Logo className="h-9 w-9" />
      {left}
    </div>
    {onTitleClick ? (
      <button
        type="button"
        onClick={onTitleClick}
        className="absolute left-1/2 -translate-x-1/2 truncate text-lg font-semibold hover:underline"
      >
        {title}
      </button>
    ) : (
      <Link to={titleTo} className="absolute left-1/2 -translate-x-1/2 truncate text-lg font-semibold hover:underline">
        {title}
      </Link>
    )}
    <div className="z-10">{right}</div>
  </header>
));

interface BackLinkProps {
  /** Destination path — always required (no defaults). */
  to: string;
  label?: string;
}

/**
 * BackLink — arrow link to a known parent page.
 * Always requires an explicit `to` prop so navigation is deterministic.
 */
export function BackLink({ to, label = "Back" }: BackLinkProps) {
  return (
    <Link to={to} className="text-sm text-white/80 transition-colors hover:text-white">
      ← {label}
    </Link>
  );
}

interface LogoutButtonProps {
  onClick: () => void;
}

/**
 * LogoutButton — ghost-style sign-out button for the header.
 */
export function LogoutButton({ onClick }: LogoutButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-white/30 bg-white/15 px-4 py-1.5 text-sm text-white transition-colors hover:bg-white/25"
    >
      Sign out
    </button>
  );
}
