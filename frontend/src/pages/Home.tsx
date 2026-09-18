/**
 * Home — public brochure/landing page at /home.
 *
 * A single-scroll brochure: hero, how it works, mission, closing CTA.
 * Truly public (no auth wrapper) — renders for guests and signed-in users
 * alike. Copy is polished from the founder-provided org info.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { Logo } from "../components/Logo";
import { PublicHeader } from "../components/PublicHeader";
import { SiteFooter } from "../components/SiteFooter";
import { DONATE_URL } from "../lib/links";
import { ROUTES } from "../lib/routes";

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <PublicHeader />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="bg-gradient-to-br from-page-start to-page-end px-4 py-16 text-white sm:py-24">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <Logo className="h-24 w-24" />
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">Kindness is Magic</h1>
          <p className="mt-4 text-lg font-medium text-white/95 sm:text-xl">
            Making the holidays magical for families living in poverty — one wish at a time.
          </p>
          <p className="mt-4 text-base leading-relaxed text-white/85">
            Kindness is Magic pairs families in need in Milpitas, CA and nearby with generous neighbors who sponsor their holiday wishes.
            When a family in our community is sponsored by someone from our community, the difference is personal — and every gift arrives
            in time for a magical Christmas.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              to={ROUTES.PUBLIC_FAMILIES}
              className="rounded-lg bg-white px-6 py-3 text-base font-semibold text-brand-dark shadow transition-colors hover:bg-white/90"
            >
              Meet the Families
            </Link>
            <a
              href="#how-it-works"
              className="rounded-lg border border-white/40 bg-white/10 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-white/20"
            >
              How it works
            </a>
          </div>
          <ImageSlot label="Hero photo" className="mt-12 aspect-[16/9] w-full max-w-2xl" />
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────── */}
      <section id="how-it-works" className="bg-white px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-bold tracking-tight text-gray-900">How it works</h2>
          <ImageSlot label="How it works photo" className="mx-auto mt-8 aspect-[16/9] w-full max-w-3xl" />
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <StepCard number={1} title="Families share their wishes">
              Our local partners add families experiencing poverty in Milpitas and nearby, along with each member's wishes: one for the
              whole family, one for each adult, and two for each child — one practical (clothes, bedding, school supplies) and one fun
              (toys, stuffed animals, craft kits, board games).
            </StepCard>
            <StepCard number={2} title="You sponsor a family">
              Browse the wish lists and choose the family you'd like to sponsor. You can buy the gifts yourself, or donate the amount that
              covers the cost and leave the shopping to us.
            </StepCard>
            <StepCard number={3} title="We deliver the magic">
              Our volunteers purchase, sort, and wrap every gift, then arrange pickup or delivery — in time for a magical Christmas.
            </StepCard>
          </div>
        </div>
      </section>

      {/* ── Mission ───────────────────────────────────────────────── */}
      <section className="bg-slate-50 px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-5xl items-center gap-10 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-gray-900">Why it matters</h2>
            <p className="mt-4 leading-relaxed text-gray-700">
              Kindness is Magic was founded by Jennifer Pietrasik, former leader of the Family Giving Tree, an organization that served more
              than 2.3 million children over 35 years. Now retired, Jennifer created Kindness is Magic to continue what has always mattered
              most: promoting kindness, empathy, caring, and volunteerism while making sure families receive the items they truly need and
              want — not just what is available.
            </p>
            <p className="mt-4 leading-relaxed text-gray-700">
              We believe small acts of kindness create lasting change. By bringing neighbors together to serve with intention and dignity,
              we strengthen our community and remind everyone that kindness isn't just powerful — it's transformative.
            </p>
          </div>
          <ImageSlot label="Founder photo" className="aspect-[4/3] w-full" />
        </div>
      </section>

      {/* ── Closing CTA ───────────────────────────────────────────── */}
      <section className="bg-gradient-to-r from-brand-dark to-brand-light px-4 py-16 text-white sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Ready to make a holiday magical?</h2>
          <p className="mt-3 text-lg text-white/85">
            Browse our families' wish lists today — or make a donation to help us keep the kindness going.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              to={ROUTES.PUBLIC_FAMILIES}
              className="rounded-lg bg-white px-6 py-3 text-base font-semibold text-brand-dark shadow transition-colors hover:bg-white/90"
            >
              Meet the Families
            </Link>
            <a
              href={DONATE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-white/40 bg-white/10 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-white/20"
            >
              Donate
            </a>
          </div>
        </div>
      </section>

      <SiteFooter />
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
    <Card>
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
      className={`flex items-center justify-center rounded-2xl bg-gradient-to-br from-brand-dark to-brand-light text-sm font-medium text-white/70 ${className}`}
    >
      {label}
    </div>
  );
}
