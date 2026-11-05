import type { ReactNode } from "react";
import { BackLink, HeaderBar } from "./HeaderBar";
import { SiteFooter } from "./SiteFooter";

export interface HelpSection {
  /** Anchor id (also the screenshot file slug convention). */
  id: string;
  /** TOC label and section heading. */
  title: string;
  body: ReactNode;
}

interface HelpPageProps {
  /** Page heading (rendered as the h1). */
  title: string;
  /** Lead paragraph(s) under the h1. */
  intro?: ReactNode;
  /**
   * The page's sections. One array drives both the TOC sidebar and the
   * rendered content, so the two can't drift apart.
   */
  sections: HelpSection[];
  /**
   * Back link destination: ROLE_HOME[role] for authenticated guides,
   * ROUTES.HOME for public pages (like StaticPage). (A prop named `role`
   * would collide with the ARIA role attribute in the linter.)
   */
  backTo: string;
  /** Back link label: "Back" for app guides, "Home" for public pages. */
  backLabel?: "Back" | "Home";
  /**
   * Public pages render outside ProtectedRoute (which renders the footer
   * for authenticated pages), so they must render it themselves.
   */
  renderFooter?: boolean;
}

/**
 * HelpPage — shared layout for the per-role user guides: HeaderBar with a
 * back link, a sticky table-of-contents sidebar (desktop), and a prose
 * column. Sections are h2-headed blocks with ids for the TOC anchors
 * (scroll-mt keeps them clear of the sticky header).
 */
export function HelpPage({ title, intro, sections, backTo, backLabel = "Back", renderFooter = false }: HelpPageProps) {
  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar left={<BackLink to={backTo} label={backLabel} />} />

      <div className="mx-auto flex max-w-6xl gap-10 px-4 py-8 sm:px-6">
        <nav aria-label="On this page" className="hidden w-56 flex-shrink-0 lg:block">
          <ul className="sticky top-20 space-y-0.5 text-sm">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="block rounded-lg px-2 py-1.5 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 max-w-3xl flex-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">{title}</h1>
          {intro != null && <div className="prose prose-slate mt-4 max-w-none">{intro}</div>}
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-20 pt-6">
              <div className="prose prose-slate max-w-none">
                <h2>{section.title}</h2>
                {section.body}
              </div>
            </section>
          ))}
        </main>
      </div>

      {renderFooter && <SiteFooter />}
    </div>
  );
}
