import { memo, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ROUTES } from "../lib/routes";
import { HeaderBar, LogoutButton } from "./HeaderBar";

interface PublicHeaderProps {
  /** Left-side slot (e.g. a back link). */
  left?: ReactNode;
  /** Extra classes for the <header> element (e.g. "no-print"). */
  className?: string;
}

/**
 * PublicHeader — the shared header for all public (brochure) pages.
 *
 * The centred title links to the brochure at /home from any other public
 * page, and when already on /home scrolls to the top and clears the section
 * anchor from the URL. The left nav anchors
 * to the /home sections for guests and signed-in visitors alike (signed-in
 * users reach the app via the Dashboard link on the right). The right side
 * adapts to the auth state: guests get a "Sign in" link; signed-in users
 * get a "Dashboard" link plus sign-out (clicking sign-out navigates to the
 * login page).
 */
export const PublicHeader = memo(({ left, className }: PublicHeaderProps) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const onHome = location.pathname === ROUTES.HOME;

  const handleLogout = async () => {
    await logout();
    navigate(ROUTES.LOGIN);
  };

  /** Title on /home: scroll to top and clear the section anchor (replace — no history entry). */
  const handleTitleClick = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    navigate(ROUTES.HOME, { replace: true });
  };

  const right = user ? (
    <div className="flex items-center gap-2">
      <Link
        to={ROUTES.DASHBOARD}
        className="rounded-lg border border-white/30 bg-white/15 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/25"
      >
        Dashboard
      </Link>
      <LogoutButton onClick={handleLogout} />
    </div>
  ) : (
    <Link
      to={ROUTES.LOGIN}
      className="rounded-lg border border-white/30 bg-white/15 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/25"
    >
      Sign in
    </Link>
  );

  return (
    <HeaderBar
      title="Kindness is Magic"
      titleTo={ROUTES.HOME}
      onTitleClick={onHome ? handleTitleClick : undefined}
      left={
        <>
          {left}
          <nav className="hidden items-center gap-3 text-sm font-medium text-white/90 sm:flex">
            <Link to={`${ROUTES.HOME}#how-it-works`} className="hover:text-white transition-colors">
              How it works
            </Link>
            <span className="text-white/40">•</span>
            <Link to={`${ROUTES.HOME}#mission`} className="hover:text-white transition-colors">
              Our mission
            </Link>
          </nav>
        </>
      }
      right={right}
      className={className}
    />
  );
});
