import { memo, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { CONTACT_EMAIL, DONATE_URL, FACEBOOK_URL, INSTAGRAM_URL } from "../lib/links";
import { ROUTES } from "../lib/routes";

interface FooterLinkProps {
  to: string;
  children: ReactNode;
}

/**
 * FooterLink — brochure nav link. Clicking the page you are already on
 * scrolls to its top instead of doing nothing (the header's title and logo
 * use the same convention on /home).
 */
function FooterLink({ to, children }: FooterLinkProps) {
  const { pathname } = useLocation();

  const handleClick = () => {
    if (pathname === to) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <Link to={to} onClick={handleClick} className="hover:text-white hover:underline">
      {children}
    </Link>
  );
}

/**
 * SiteFooter — the shared footer for all public pages: legal links, Donate,
 * social links, contact email, and copyright. Always no-print (the wish list
 * is printable and the footer never belongs in print).
 */
export const SiteFooter = memo(() => (
  <footer className="mt-auto no-print bg-gray-900 px-4 py-8 text-sm text-gray-300 sm:px-6">
    <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <nav aria-label="Site" className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <FooterLink to={ROUTES.HOME}>Home</FooterLink>
        <FooterLink to={ROUTES.PRIVACY}>Privacy Policy</FooterLink>
        <FooterLink to={ROUTES.FINANCIALS}>Financials</FooterLink>
        <FooterLink to={ROUTES.WISH_LIST_GUIDE}>Wish List Guide</FooterLink>
        <FooterLink to={ROUTES.HELP_DONOR}>Sponsor Guide</FooterLink>
      </nav>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <a href={DONATE_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-white hover:underline">
          Donate
        </a>
        <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="hover:text-white hover:underline">
          Instagram
        </a>
        <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" className="hover:text-white hover:underline">
          Facebook
        </a>
        <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-white hover:underline">
          {CONTACT_EMAIL}
        </a>
      </div>
    </div>
    <p className="mx-auto mt-4 max-w-5xl text-xs text-gray-500">© {new Date().getFullYear()} Kindness is Magic. All rights reserved.</p>
  </footer>
));
