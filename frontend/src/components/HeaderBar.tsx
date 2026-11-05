import { memo, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROLE_HOME, ROUTES } from "../lib/routes";
import { Logo } from "./Logo";
import { RefreshButton } from "./RefreshButton";

const BRAND_TITLE = "Kindness is Magic";

interface HeaderBarProps {
  /** Left-side slot (e.g. a back link). */
  left?: ReactNode;
  /** Right-side slot for page-specific actions (e.g. a print button). Auth controls are always rendered. */
  right?: ReactNode;
  /** Extra classes for the <header> element (e.g. "no-print"). */
  className?: string;
}

/**
 * HeaderBar — the app's single top bar.
 *
 * Its content is a function of auth state, not of the current page:
 *  - Guest: the logo and centred title link to the brochure (/home — on /home
 *    they scroll to the top instead), the "How it works • Our mission" section
 *    nav is shown, and the right side offers "Sign in".
 *  - Signed in: the logo and title link to the user's role home (ROLE_HOME),
 *    the right side always shows "Sign out", and the brochure nav is hidden.
 *  - While the session is still resolving: plain logo and title with no
 *    controls, so the header never flickers between guest and signed-in.
 *
 * Pages may supply back links via `left` and actions (e.g. print) via `right`.
 */
export const HeaderBar = memo(({ left, right, className = "" }: HeaderBarProps) => {
  const { user, isLoading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const signedIn = !isLoading && user != null;
  const isGuest = !isLoading && user == null;
  const homeTo = signedIn ? ROLE_HOME[user.role] : ROUTES.HOME;
  /** Guests already on /home: the title/logo scroll to top instead of re-navigating. */
  const scrollToTopInstead = isGuest && location.pathname === ROUTES.HOME;

  const handleScrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    navigate(ROUTES.HOME, { replace: true });
  };

  const handleLogout = async () => {
    await logout();
    navigate(ROUTES.LOGIN, { replace: true });
  };

  /**
   * Wraps content in the home container for the current state: a link to the
   * role home, or a scroll-to-top button when a guest is already on /home.
   * (While the session resolves, callers render plain content instead.)
   */
  const homeContent = (content: ReactNode, className: string, ariaLabel?: string) =>
    scrollToTopInstead ? (
      <button type="button" onClick={handleScrollToTop} aria-label={ariaLabel} className={className}>
        {content}
      </button>
    ) : (
      <Link to={homeTo} aria-label={ariaLabel} className={className}>
        {content}
      </Link>
    );

  const logo = isLoading ? <Logo className="h-9 w-9" alt="" /> : homeContent(<Logo className="h-9 w-9" alt="" />, "shrink-0", "Home");

  const title = isLoading ? (
    <span className="absolute left-1/2 -translate-x-1/2 truncate text-lg font-semibold">{BRAND_TITLE}</span>
  ) : (
    homeContent(BRAND_TITLE, "absolute left-1/2 -translate-x-1/2 truncate text-lg font-semibold hover:underline")
  );

  const authControls = signedIn ? (
    <LogoutButton onClick={handleLogout} />
  ) : isGuest ? (
    <Link
      to={ROUTES.LOGIN}
      className="rounded-lg border border-white/30 bg-white/15 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/25"
    >
      Sign in
    </Link>
  ) : null;

  return (
    <header
      className={`relative sticky top-0 z-50 flex items-center justify-between bg-gradient-to-r from-brand-dark to-brand-light px-4 text-white shadow-md h-14 sm:px-6 ${className}`}
    >
      <div className="z-10 flex items-center gap-3">
        {logo}
        {left}
        {isGuest && (
          <nav className="hidden items-center gap-3 text-sm font-medium text-white/90 sm:flex">
            <Link to={`${ROUTES.HOME}#how-it-works`} className="transition-colors hover:text-white">
              How it works
            </Link>
            <span className="text-white/40">•</span>
            <Link to={`${ROUTES.HOME}#mission`} className="transition-colors hover:text-white">
              Our mission
            </Link>
          </nav>
        )}
      </div>
      {title}
      <div className="z-10 flex items-center gap-3">
        <RefreshButton />
        {right}
        {/* The help guides are for signed-in visitors; guests would just bounce
            from /help to the login screen */}
        {signedIn && (
          <Link to={ROUTES.HELP} className="text-sm text-white/90 transition-colors hover:text-white">
            Help
          </Link>
        )}
        {authControls}
      </div>
    </header>
  );
});

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
function LogoutButton({ onClick }: LogoutButtonProps) {
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
