/**
 * Home — public brochure/landing page at /home.
 *
 * A single-scroll brochure: hero, how it works, mission, closing CTA.
 * Truly public (no auth wrapper) — renders for guests and signed-in users
 * alike. Copy is polished from the founder-provided org info.
 */

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Card } from "../components/Card";
import { Logo } from "../components/Logo";
import { PublicHeader } from "../components/PublicHeader";
import { SiteFooter } from "../components/SiteFooter";
import { DONATE_URL } from "../lib/links";
import { ROUTES } from "../lib/routes";

export default function Home() {
  const [showTopButton, setShowTopButton] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      setShowTopButton(window.scrollY > 400);
    };
    handleScroll(); // also on mount, in case the page loads with a restored scroll position
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Anchor links (e.g. /home#how-it-works from the header nav) navigate
  // client-side, so the browser never scrolls to the target — do it here,
  // after the section has rendered. The dependency is `location`, not just
  // the hash, so re-clicking a section link to the current hash (same URL)
  // still scrolls.
  useEffect(() => {
    if (!location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
  }, [location]);

  return (
    <div className="min-h-screen bg-white">
      <PublicHeader />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-br from-page-start to-page-end px-4 py-16 text-white sm:py-24">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <Logo className="h-24 w-24" />
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">Kindness is Magic</h1>
          <p className="mt-4 text-lg font-medium text-white/95 sm:text-xl">
            Bringing holiday magic to families living in poverty, one wish at a time.
          </p>
          <p className="mt-4 text-base leading-relaxed text-white/85">
            Kindness is Magic connects families in Milpitas and surrounding areas with neighbors who sponsor their holiday wishes. Local
            sponsorship makes the experience personal, ensuring every gift arrives in time for a magical Christmas.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              to={ROUTES.PUBLIC_FAMILIES}
              className="rounded-lg bg-white px-6 py-3 text-base font-semibold text-brand-dark shadow transition-all duration-300 hover:bg-white/90 hover:scale-105 active:scale-95"
            >
              Meet the Families
            </Link>
            <Link
              to={`${ROUTES.HOME}#how-it-works`}
              className="rounded-lg border border-white/40 bg-white/10 px-6 py-3 text-base font-semibold text-white transition-all duration-300 hover:bg-white/20 hover:scale-105 active:scale-95"
            >
              How it works
            </Link>
          </div>
          <ImageSlot label="Hero photo" className="mt-12 aspect-[16/9] w-full max-w-2xl" />
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────── */}
      <section id="how-it-works" className="scroll-mt-14 bg-white px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-bold tracking-tight text-gray-900">How it works</h2>
          <ImageSlot label="How it works photo" className="mx-auto mt-8 aspect-[16/9] w-full max-w-3xl" />
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <StepCard number={1} title="Families share their wishes">
              Our partners identify local families in need. Each person shares their wishes: one for the entire family, one for every adult,
              and two for every child. Children receive one practical gift like clothes or bedding and one fun gift like a toy or board
              game.
            </StepCard>
            <StepCard number={2} title="You sponsor a family">
              Browse wish lists to find a family to sponsor. You may purchase the gifts personally or donate money to cover the costs for
              our volunteers to handle the shopping.
            </StepCard>
            <StepCard number={3} title="We deliver the magic">
              Volunteers handle any remaining shopping, then sort and wrap every gift. We then coordinate pickup or delivery in time for a
              magical Christmas.
            </StepCard>
          </div>
        </div>
      </section>

      {/* ── Mission ───────────────────────────────────────────────── */}
      <section id="mission" className="scroll-mt-14 bg-slate-50 px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-5xl items-center gap-10 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-gray-900">Why it matters</h2>
            <p className="mt-4 leading-relaxed text-gray-700">
              Jennifer Pietrasik founded Kindness is Magic after leading the Family Giving Tree for 35 years, where she helped more than 2.3
              million children. In retirement, Jennifer continues her commitment to kindness, empathy, caring, and volunteerism by providing
              families with items they truly need and want.
            </p>
            <p className="mt-4 leading-relaxed text-gray-700">
              We envision a world of stability, dignity, and hope where every parent can meet their family's basic needs, and no child's
              future is limited by poverty. By bringing neighbors together to serve with intention, we strengthen our community and prove
              that kindness is transformative.
            </p>
          </div>
          <ImageSlot label="Founder photo" className="aspect-[4/3] w-full" />
        </div>
      </section>

      {/* ── Closing CTA ───────────────────────────────────────────── */}
      <section className="bg-gradient-to-r from-brand-dark to-brand-light px-4 py-16 text-white sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Ready to make a holiday magical?</h2>
          <p className="mt-3 text-lg text-white/85">Browse family wish lists today or donate to help us keep the kindness going.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              to={ROUTES.PUBLIC_FAMILIES}
              className="rounded-lg bg-white px-6 py-3 text-base font-semibold text-brand-dark shadow transition-all duration-300 hover:bg-white/90 hover:scale-105 active:scale-95"
            >
              Meet the Families
            </Link>
            <a
              href={DONATE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-white/40 bg-white/10 px-6 py-3 text-base font-semibold text-white transition-all duration-300 hover:bg-white/20 hover:scale-105 active:scale-95"
            >
              Donate
            </a>
          </div>
        </div>
      </section>

      <SiteFooter />

      {showTopButton && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-8 right-8 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand-dark text-white shadow-lg transition-all duration-300 hover:bg-brand-light hover:scale-110 active:scale-95"
          aria-label="Back to top"
        >
          <span className="text-2xl">↑</span>
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

interface StepCardProps {
  number: number;
  title: string;
  children: ReactNode;
}

function StepCard({ number, title, children }: StepCardProps) {
  return (
    <Card className="transition-all duration-300 hover:-translate-y-2 hover:shadow-lg cursor-default">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-brand-dark to-brand-light text-lg font-bold text-white">
        {number}
      </span>
      <h3 className="mt-4 text-lg font-semibold text-gray-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">{children}</p>
    </Card>
  );
}

interface ImageSlotProps {
  /** Describes the intended photo — becomes the real <img alt> once the photo lands. */
  label: string;
  className?: string;
}

/**
 * ImageSlot — styled brand-gradient placeholder for a page photo.
 * To swap in a real photo: import it from src/assets/ and render
 * <img src={photo} alt={label} loading="lazy" ... /> in its place.
 */
function ImageSlot({ label, className = "" }: ImageSlotProps) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`flex items-center justify-center rounded-2xl bg-gradient-to-br from-brand-dark to-brand-light text-sm font-medium text-white/70 transition-all duration-500 hover:brightness-110 hover:scale-[1.02] ${className}`}
    >
      {label}
    </div>
  );
}
