import type { ReactNode } from "react";
import { ROUTES } from "../lib/routes";
import { BackLink } from "./HeaderBar";
import { PublicHeader } from "./PublicHeader";
import { SiteFooter } from "./SiteFooter";

interface StaticPageProps {
  /** Page heading (rendered as the h1). */
  title: string;
  children: ReactNode;
}

/**
 * StaticPage — shared layout for the static public content pages (privacy
 * policy, financials): PublicHeader with a back link to
 * the brochure, a centred prose column, and the SiteFooter.
 */
export const StaticPage = ({ title, children }: StaticPageProps) => (
  <div className="min-h-screen bg-slate-50">
    <PublicHeader left={<BackLink to={ROUTES.HOME} label="Home" />} />
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900">{title}</h1>
      <div className="prose prose-slate mt-6 max-w-none">{children}</div>
    </main>
    <SiteFooter />
  </div>
);
