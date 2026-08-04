import { memo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "../lib/routes";

interface HeaderBarProps {
  title: string;
  left?: ReactNode;
  right?: ReactNode;
}

/**
 * HeaderBar — purple gradient top bar with title and optional actions.
 */
export const HeaderBar = memo(({ title, left, right }: HeaderBarProps) => (
  <header className="relative flex items-center justify-between bg-gradient-to-r from-brand-dark to-brand-light px-4 text-white shadow-md h-14 sm:px-6">
    <div className="z-10">{left}</div>
    <Link to={ROUTES.DASHBOARD} className="absolute left-1/2 -translate-x-1/2 truncate text-lg font-semibold hover:underline">
      {title}
    </Link>
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
