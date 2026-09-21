/**
 * Home — public brochure/landing page at /home.
 *
 * A single-scroll brochure: hero, how it works, founder, mission, closing CTA.
 * Truly public (no auth wrapper) — renders for guests and signed-in users
 * alike. Copy is polished from the founder-provided org info.
 */

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import baggingPhoto from "../assets/home-bagging.jpg";
import deliveryPhoto from "../assets/home-delivery.jpg";
import founderPhoto from "../assets/home-founder.jpg";
import giftTablesPhoto from "../assets/home-gift-tables.jpg";
import heroPhoto from "../assets/home-hero.jpg";
import howItWorksPhoto from "../assets/home-how-it-works.jpg";
import { Card } from "../components/Card";
import { Logo } from "../components/Logo";
import { PublicHeader } from "../components/PublicHeader";
import { Reveal } from "../components/Reveal";
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
          <img
            src={heroPhoto}
            alt="Two smiling volunteers holding wrapped Christmas presents in front of a table full of gifts at the Elves Workshop"
            className="mt-12 aspect-[16/9] w-full max-w-2xl rounded-2xl object-cover"
            loading="eager"
            fetchPriority="high"
          />
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────── */}
      <section id="how-it-works" className="scroll-mt-14 bg-white px-4 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <h2 className="text-center text-3xl font-bold tracking-tight text-gray-900">How it works</h2>
            <img
              src={howItWorksPhoto}
              alt="Two smiling volunteers wrapping a Christmas present together at the gift wrapping station"
              className="mx-auto mt-8 aspect-[16/9] w-full max-w-3xl rounded-2xl object-cover"
              loading="lazy"
            />
          </Reveal>
          <Reveal className="mt-10 grid gap-6 md:grid-cols-3">
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
              Volunteers handle any remaining shopping, then check, sort, and wrap every gift. We then coordinate pickup or delivery in time
              for a magical Christmas.
            </StepCard>
          </Reveal>

          {/* Photo band: the gift pipeline, left to right — sorted, bagged, loaded */}
          <Reveal className="mt-12 grid gap-6 sm:grid-cols-3">
            <figure>
              <img
                src={giftTablesPhoto}
                alt="Long tables of wrapped Christmas presents, sorted and labeled by family"
                className="aspect-[4/3] w-full rounded-2xl object-cover"
                loading="lazy"
              />
              <figcaption className="mt-2 text-center text-sm text-gray-600">Sorted and labeled by family</figcaption>
            </figure>
            <figure>
              <img
                src={baggingPhoto}
                alt="A smiling volunteer bagging wrapped Christmas gifts in clear plastic at the Elves Workshop"
                className="aspect-[4/3] w-full rounded-2xl object-cover"
                loading="lazy"
              />
              <figcaption className="mt-2 text-center text-sm text-gray-600">Bagged and ready to go</figcaption>
            </figure>
            <figure>
              <img
                src={deliveryPhoto}
                alt="Two volunteers standing in a truck loaded with gifts and blankets, ready for delivery"
                className="aspect-[4/3] w-full rounded-2xl object-cover"
                loading="lazy"
              />
              <figcaption className="mt-2 text-center text-sm text-gray-600">Loading up for delivery</figcaption>
            </figure>
          </Reveal>
        </div>
      </section>

      {/* ── Founder ───────────────────────────────────────────────── */}
      <section id="founder" className="scroll-mt-14 bg-slate-50 px-4 py-16 sm:px-6 sm:py-20">
        <Reveal className="mx-auto grid max-w-5xl items-center gap-10 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-gray-900">Meet the founder</h2>
            <p className="mt-4 leading-relaxed text-gray-700">
              Jennifer Pietrasik founded Kindness is Magic after leading the Family Giving Tree for 35 years, where she helped more than 2.3
              million children. In retirement, Jennifer continues her commitment to kindness, empathy, caring, and volunteerism by providing
              families with items they truly need and want.
            </p>
          </div>
          <img
            src={founderPhoto}
            alt="Jennifer Pietrasik, founder of Kindness is Magic, seated in her Queen Elf costume at the Elves Workshop"
            className="aspect-[4/3] w-full rounded-2xl object-cover"
            loading="lazy"
          />
        </Reveal>
      </section>

      {/* ── Mission ───────────────────────────────────────────────── */}
      <section id="mission" className="scroll-mt-14 bg-white px-4 py-16 sm:px-6 sm:py-20">
        <Reveal className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900">Our mission</h2>
          <p className="mt-4 text-xl leading-relaxed text-gray-700">
            We envision a world of stability, dignity, and hope where every parent can meet their family's basic needs, and no child's
            future is limited by poverty. By bringing neighbors together to serve with intention, we strengthen our community and prove that
            kindness is transformative.
          </p>
        </Reveal>
      </section>

      {/* ── Closing CTA ───────────────────────────────────────────── */}
      <section className="bg-gradient-to-r from-brand-dark to-brand-light px-4 py-16 text-white sm:px-6">
        <Reveal className="mx-auto max-w-3xl text-center">
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
        </Reveal>
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
