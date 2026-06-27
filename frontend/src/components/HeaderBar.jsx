import { Link } from 'react-router-dom';
import { memo } from 'react';

/**
 * HeaderBar — purple gradient top bar with title and optional actions.
 *
 * @param {string}  title      — header title text
 * @param {ReactNode} left     — rendered on the left (e.g. back link)
 * @param {ReactNode} right    — rendered on the right (e.g. logout button)
 */
export const HeaderBar = memo(({ title, left, right }) => (
  <header className="relative flex items-center bg-gradient-to-r from-brand-dark to-brand-light px-4 text-white shadow-md h-14 sm:px-6">
    <div className="z-10 min-w-0 flex-shrink-0 pr-12">{left}</div>
    <h1 className="absolute inset-x-0 truncate text-center text-lg font-semibold">{title}</h1>
    <div className="z-10 ml-auto min-w-0 flex-shrink-0 pl-12">{right}</div>
  </header>
));

/**
 * LogoutButton — ghost-style sign-out button for the header.
 */
export function LogoutButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-white/30 bg-white/15 px-4 py-1.5 text-sm text-white transition-colors hover:bg-white/25"
    >
      Sign out
    </button>
  );
}

/**
 * BackLink — arrow link back to the dashboard or a custom path.
 */
export function BackLink({ to = '/dashboard', label = 'Back' }) {
  return (
    <Link to={to} className="text-sm text-white/80 transition-colors hover:text-white">
      ← {label}
    </Link>
  );
}
