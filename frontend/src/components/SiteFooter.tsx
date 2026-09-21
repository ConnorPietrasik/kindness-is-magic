import { memo } from "react";
import { Link } from "react-router-dom";
import { CONTACT_EMAIL, DONATE_URL, FACEBOOK_URL, INSTAGRAM_URL } from "../lib/links";
import { ROUTES } from "../lib/routes";

/**
 * SiteFooter — the shared footer for all public pages: legal links, Donate,
 * social links, contact email, and copyright. Always no-print (the wish list
 * is printable and the footer never belongs in print).
 */
export const SiteFooter = memo(() => (
  <footer className="no-print bg-gray-900 px-4 py-8 text-sm text-gray-300 sm:px-6">
    <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link to={ROUTES.PRIVACY} className="hover:text-white hover:underline">
          Privacy Policy
        </Link>
        <Link to={ROUTES.FINANCIALS} className="hover:text-white hover:underline">
          Financials
        </Link>
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
