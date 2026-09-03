import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, supabaseAdmin } from "@/lib/supabase-server";
import { EstimateDemo } from "@/app/components/EstimateDemo";
import { RowLockup } from "@/app/components/wordmark";
import { MarketingNav } from "@/app/components/marketing-nav";
import { TradeExamples } from "@/app/components/TradeExamples";
import { FaqAccordion } from "@/app/components/faq-accordion";
import { STARTER_MONTHLY_PRICE_CAD } from "@/lib/plan-pricing";
import { headers } from "next/headers";
import { currencyFromCountry, currencyPrefix, formatMonthlyPlanPrice, planMonthlyPrice } from "@/lib/currency";
import { CANONICAL_URL } from "@/lib/site-url";
import { hasSubscriptionAccess, SUBSCRIPTION_ACCESS_COLUMNS } from "@/lib/subscription-access";
import { isVisitorInCanada } from "@/lib/geo";

export const metadata: Metadata = {
  title: "Estimate Software for Contractors & Trades | TradePulse",
  description: `Generate professional estimates in seconds. Send quotes from the job site via text or email. Built for Canadian plumbers, electricians, and trades. CA$${STARTER_MONTHLY_PRICE_CAD}/month.`,
  alternates: { canonical: CANONICAL_URL },
  openGraph: {
    title: "Professional Estimates in Seconds | TradePulse",
    description: "Create and send professional estimates from the job site in seconds. Built for Canadian contractors.",
    url: CANONICAL_URL,
    siteName: "TradePulse",
    images: [
      {
        url: `${CANONICAL_URL}/social-card.png`,
        width: 1200,
        height: 630,
        alt: "TradePulse Estimates",
      },
    ],
    locale: "en_CA",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Professional Estimates in Seconds | TradePulse",
    description: "Create and send professional estimates from the job site in seconds.",
    images: [`${CANONICAL_URL}/social-card.png`],
  },
};

const STEPS = [
  {
    number: "01",
    title: "Describe the job",
    description: "Type or dictate a quick description of the work, what needs doing, how long it may take, and any materials required. A sentence or two is enough.",
  },
  {
    number: "02",
    title: "Get a professional estimate",
    description: "TradePulse turns your description into a complete, itemised estimate with scope of work, line items, and payment terms. Ready in seconds.",
  },
  {
    number: "03",
    title: "Send it on the spot",
    description: "Text or email the estimate directly to your customer before you leave the property. No more quoting at night. No more lost jobs.",
  },
] as const;

const PAIN_POINTS = [
  "No more quoting after dinner",
  "No more rebuilding every estimate",
  "No more losing jobs to a faster quote",
] as const;

const WORKFLOW_STEPS = [
  {
    title: "Review the estimate",
    description: "Check the scope, line items, and total before anything goes out.",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
        <path d="M3 10s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    title: "Make light edits",
    description: "Fix a line, adjust a detail, or update customer info in seconds.",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
        <path d="M12.5 3.5l4 4L6 18H2v-4L12.5 3.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Send it to the customer",
    description: "Text it, email it, or send a link, straight from the job site.",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
        <path d="M17.5 2.5l-15 5.5 6 2 2 6 7-13.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "What the customer sees",
    description: "A clean estimate page with your logo, the scope of work, and the price. No login needed.",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
        <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 7h8M6 10h8M6 13h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
] as const;

const AFTER_ESTIMATE = [
  { title: "Reviews", description: "Ask for a Google review once a job is marked done.", pro: true },
  { title: "Payments", description: "Automatic reminders until an invoiced job is paid.", pro: true },
  { title: "Follow-Up", description: "Coming soon. Stay in touch with past customers.", pro: true },
] as const;

const FAQ_ITEMS = [
  {
    q: "How does the AI know what to write?",
    a: "You describe the job in plain language, what needs doing, how long it takes, what materials you'll need. TradePulse turns that into a complete estimate with scope of work, line items, and payment terms. The more detail you give, the more accurate the output.",
  },
  {
    q: "Can I use my own prices?",
    a: "Yes. Set your hourly labour rate, materials markup, and any common line items in the Rates section. Every estimate uses your numbers automatically.",
  },
  {
    q: "What does the customer see?",
    a: "They get a link to a clean estimate page with your logo, their details, the full scope of work, and a line-item breakdown. Works on any device. No app required on their end.",
  },
  {
    q: "Can I edit the estimate before sending?",
    a: "Yes. Every section is editable after generation. You can also update customer details at any time without regenerating the estimate.",
  },
  {
    q: "Do I need to be technical to use this?",
    a: "No. Type or dictate the job details in plain language. TradePulse turns them into a professional estimate. Setup takes about five minutes.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. No credit card required to start. If you subscribe after your trial, you can cancel anytime from your Profile page and you won't be charged again. Your first paid charge has a 30-day money-back guarantee handled by support.",
  },
] as const;

export default async function LandingPage() {
  // The same resolver /signup uses, reading the same Vercel header, so the
  // price a US visitor sees here cannot disagree with the one they are
  // offered at signup. currencyFromCountry() is the single country rule:
  // US is USD, and Canada, an unknown country, and a missing header are all
  // CAD. Reading a request header keeps this route rendered per request, so
  // one visitor's country can never be cached and served to another.
  const visitorCountry = (await headers()).get("x-vercel-ip-country");
  const currency = currencyFromCountry(visitorCountry);
  // Separate from currency: the "Proudly Canadian" line only ever shows for
  // a confirmed CA visitor, never as a fallback. See lib/geo.ts.
  const showCanadianBadge = isVisitorInCanada(visitorCountry);

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  let hasAccess = false;
  if (user) {
    const { data: business } = await supabaseAdmin
      .from("tpe_businesses")
      .select(SUBSCRIPTION_ACCESS_COLUMNS)
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (!business) redirect("/onboarding");

    hasAccess = hasSubscriptionAccess(business);

    // Logged-in users never see the marketing homepage. Send them to the app
    // or the paywall depending on their account state. An incomplete profile
    // (no name, logo, etc.) is nudged via the setup checklist on /estimates,
    // not a hard redirect, so it doesn't fight the /new landing after signup.
    redirect(hasAccess ? "/estimates" : "/subscribe");
  }

  const ctaHref = user ? (hasAccess ? "/new" : "/subscribe") : "/signup";
  const ctaLabel = user ? (hasAccess ? "Go to App" : "Subscribe") : "Try free for 14 days";

  return (
    <>
      <style>{`
        html { scroll-behavior: smooth; }
        .dot-grid {
          background-image: radial-gradient(circle, rgba(255,255,255,0.12) 1px, transparent 1px);
          background-size: 28px 28px;
        }
        /* Hero photo + scrim. Mobile stacks to one column, so the text sits
           over the full width of the photo and needs a stronger, roughly
           uniform scrim. The directional left-to-right scrim from the spec
           only makes sense once the layout splits into two columns at md,
           where the right side is the demo widget. */
        .hero-photo {
          background-image:
            linear-gradient(178deg, rgba(38,33,27,0.80) 0%, rgba(38,33,27,0.72) 50%, rgba(38,33,27,0.76) 100%),
            url('/trades-van.jpg');
          background-size: cover;
          background-repeat: no-repeat;
        }
        /* The mobile hero is much taller/narrower than the source photo's
           square crop, so cover-sizing shows a totally different slice than
           on desktop -- 32% 18% (tuned for the wide desktop crop) put the
           visible window over the tree canopy on the left, missing the
           person entirely. Tuned separately by checking the rendered result,
           not computed once and assumed correct. */
        @media (max-width: 767px) {
          .hero-photo { background-position: 56% 24%; background-size: 140%; }
        }
        @media (min-width: 768px) {
          .hero-photo {
            /* Holds ~0.74 across the whole text column (which ends near 48% of
               the hero), then falls off fast so the photo reads clearly on the
               right where the demo widget sits. Tuned against measured contrast,
               not by eye: at the spec's starting values the orange headline
               came out at 2.38:1 against the real photo pixels, under the 3.0
               needed for large text. */
            background-image:
              linear-gradient(100deg, rgba(38,33,27,0.80) 0%, rgba(38,33,27,0.74) 48%, rgba(38,33,27,0.26) 82%),
              url('/trades-van.jpg');
            background-position: 32% 18%;
          }
        }
        /* The nav wordmark's WordmarkText sets font-size inline (shared by
           every RowLockup usage sitewide), so this overrides it with
           !important rather than touching wordmark.tsx -- scoped to just
           this one nav instance below the breakpoint where the icon+text
           lockup alone (313px at 36px text) would otherwise leave no room
           in a 375px-wide bar for the CTA button or the menu button.
           Value tuned against real measurement, not guessed: see
           HANDOFF.md for the numbers this was checked against. */
        @media (max-width: 639px) {
          .nav-lockup span { font-size: 17px !important; }
        }
        /* The 17px shrink above isn't enough on its own below ~390px: the
           bar has no explicit gap between the wordmark and the right-hand
           CTA/hamburger group, so it's entirely dependent on justify-between
           leaving slack, and there just isn't any at these widths. Measured
           on the real rendered nav, not guessed: at 375px the gap was only
           7.4px; at 360px and 320px it was 0px, with the CTA and hamburger
           themselves visibly compressed narrower than their padding wants
           (CTA 77.3px vs its natural 98.9px at 320px) -- this is the
           reported "crowding" bug. At 390px and up the gap is already a
           comfortable 22px+ with nothing compressed, so this rule only
           needs to apply below that. Dropping "Estimates" (its own span,
           targeted structurally so wordmark.tsx -- shared by every other
           RowLockup usage sitewide -- doesn't need a className added just
           for this one nav instance) frees ~55px, which is more than the
           roughly 15-50px shortfall across 320-375px and restores the CTA
           and hamburger to their natural, uncompressed size everywhere in
           that range. Chosen over shrinking the font further (already at
           17px, smaller risks illegibility) or tightening the CTA's
           padding (would still need dropping something at 320px anyway,
           since the shortfall there exceeds what padding alone can give
           back). See HANDOFF.md for the full per-width measurements. */
        @media (max-width: 389px) {
          .nav-lockup span span + span { display: none; }
        }
        .noise::after {
          content: '';
          position: absolute;
          inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
          pointer-events: none;
        }
        @keyframes orb-drift {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%       { transform: translate(40px, -30px) scale(1.05); }
          66%       { transform: translate(-20px, 20px) scale(0.97); }
        }
        .orb   { animation: orb-drift 12s ease-in-out infinite; }
        .orb-2 { animation: orb-drift 16s ease-in-out infinite reverse; }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fade-up   { animation: fade-up 0.7s ease both; }
        .delay-100 { animation-delay: 0.1s; }
        .delay-200 { animation-delay: 0.2s; }
        .delay-300 { animation-delay: 0.3s; }
        .delay-400 { animation-delay: 0.4s; }
        @keyframes type-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .line-1 { animation: type-in 0.4s ease 0.8s both; }
        .line-2 { animation: type-in 0.4s ease 1.1s both; }
        .line-3 { animation: type-in 0.4s ease 1.4s both; }
        .line-4 { animation: type-in 0.4s ease 1.7s both; }
        .line-5 { animation: type-in 0.4s ease 2.0s both; }
      `}</style>

      <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", background: "#F3E8D0", color: "#26211B" }} className="min-h-screen overflow-x-hidden">

        {/* Nav */}
        <MarketingNav hasLoggedInUser={!!user} hasAccess={hasAccess} ctaHref={ctaHref} />

        {/* Hero */}
        <section className="hero-photo relative overflow-hidden pt-20 pb-24 sm:pt-40 sm:pb-32">
          <div className="relative mx-auto max-w-6xl px-6 sm:px-10">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <div>
                <h1 className="fade-up text-4xl sm:text-5xl lg:text-[3.5rem] leading-[1.15]"
                  style={{ fontFamily: "var(--font-instrument-serif), Georgia, serif", fontWeight: 400, color: "#F7F2E9" }}>
                  Send a professional estimate<br />
                  <em className="not-italic" style={{ color: "#F59E0B" }}>before you leave the job</em>
                </h1>

                <p className="fade-up delay-100 mt-6 text-lg leading-relaxed" style={{ color: "rgba(247,242,233,0.88)" }}>
                  Describe the job. Get a complete, itemised estimate with your rates and branding. Send it by text or email while you&apos;re still at the property.
                </p>

                <div className="fade-up delay-200 mt-10 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <Link href={ctaHref}
                    className="inline-flex items-center justify-center h-12 px-8 rounded-xl text-base font-semibold transition hover:opacity-90 active:scale-95 shadow-lg"
                    style={{ background: "#f59e0b", color: "#0D1B2E" }}>
                    {ctaLabel}
                  </Link>
                  {!user && (
                    <Link href="/login"
                      className="inline-flex items-center justify-center h-12 px-6 rounded-xl text-base font-medium transition hover:bg-white/10"
                      style={{ color: "rgba(247,242,233,0.92)", border: "1px solid rgba(247,242,233,0.45)" }}>
                      Sign in
                    </Link>
                  )}
                </div>

                <p className="fade-up delay-300 mt-5 text-sm" style={{ color: "rgba(247,242,233,0.78)" }}>
                  14-day free trial. No credit card required.
                </p>

                <p className="fade-up delay-400 mt-2 text-sm" style={{ color: "rgba(247,242,233,0.78)" }}>
                  Built for contractors and home service businesses
                </p>
              </div>

              {/* Estimate mock */}
              <div className="fade-up delay-300">
                <EstimateDemo />
              </div>
            </div>
          </div>
        </section>

        {/* Contractor pain strip */}
        <div className="bg-[#F3E8D0] py-5">
          <div className="mx-auto max-w-4xl px-6 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-8 text-center">
            {PAIN_POINTS.map((point, i) => (
              <div key={point} className="flex items-center gap-3 sm:gap-8">
                <p className="text-sm sm:text-base font-medium text-[#26211B]">{point}</p>
                {i < PAIN_POINTS.length - 1 && (
                  <span className="hidden sm:block w-1 h-1 rounded-full bg-[#C9B384]" aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Trust strip */}
        <div className="border-y border-[#C9B384] bg-[#EADCC0] py-5">
          <div className="mx-auto max-w-4xl px-6 flex flex-wrap items-center justify-center gap-8">
            {[`${formatMonthlyPlanPrice("starter", currency)} flat`, "14-day free trial", "No card required", "Cancel anytime"].map(item => (
              <div key={item} className="flex items-center gap-2 text-sm text-[#5C4A2E]">
                <svg className="w-4 h-4 text-emerald-500 shrink-0" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {item}
              </div>
            ))}
          </div>
        </div>

        {/* How it works */}
        <section id="how-it-works" className="py-12 sm:py-16 bg-[#F3E8D0]">
          <div className="mx-auto max-w-5xl px-6 sm:px-10">
            <div className="text-center mb-8">
              <h2 className="text-3xl sm:text-4xl font-bold text-[#26211B]">Three steps. Done before you drive away.</h2>
              <p className="mt-4 text-lg text-[#5C4A2E] max-w-xl mx-auto">
                No complicated setup. Works on your phone. Same routine after every job.
              </p>
            </div>

            <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#C9B384]">
              {STEPS.map((step) => (
                <div key={step.number} className="py-6 md:py-0 md:px-8 first:pt-0 first:md:pl-0 last:pb-0 last:md:pr-0">
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-sm font-semibold" style={{ color: "#B45309" }}>{step.number}</span>
                    <h3 className="text-lg font-semibold text-[#26211B]">{step.title}</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-[#5C4A2E]">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Trade-specific examples */}
        <section className="py-12 sm:py-16 bg-[#EADCC0]">
          <div className="mx-auto max-w-5xl px-6 sm:px-10">
            <div className="text-center mb-8">
              <h2 className="text-3xl sm:text-4xl font-bold text-[#26211B]">See what TradePulse creates</h2>
              <p className="mt-4 text-lg text-[#5C4A2E] max-w-xl mx-auto">
                Example jobs using common trade scenarios. Your estimates use your own rates and line items.
              </p>
            </div>
            <TradeExamples />
          </div>
        </section>

        {/* Workflow showcase: what happens after generation */}
        <section className="py-12 sm:py-16 bg-[#F3E8D0]">
          <div className="mx-auto max-w-5xl px-6 sm:px-10">
            <div className="text-center mb-8">
              <h2 className="text-3xl sm:text-4xl font-bold text-[#26211B]">Review, edit, send, done</h2>
              <p className="mt-4 text-lg text-[#5C4A2E] max-w-xl mx-auto">
                The estimate is a starting point, not a final answer. You stay in control before it reaches the customer.
              </p>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
              {WORKFLOW_STEPS.map(step => (
                <div key={step.title} className="rounded-xl bg-[#EADCC0] p-4 sm:p-5">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3" style={{ background: "#FEF3C7", color: "#92400E" }}>
                    {step.icon}
                  </div>
                  <h3 className="text-sm sm:text-base font-semibold text-[#26211B] mb-1.5">{step.title}</h3>
                  <p className="text-xs sm:text-sm leading-relaxed text-[#5C4A2E]">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Positioning */}
        <section className="py-12 sm:py-16 bg-[#EADCC0]">
          <div className="mx-auto max-w-2xl px-6 sm:px-10 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-[#26211B] leading-tight">
              Fast estimates without another complicated business platform
            </h2>
            <p className="mt-5 text-base sm:text-lg text-[#5C4A2E] leading-relaxed">
              Set up in minutes. Built for a phone, not a desk, so it holds up in a driveway or on a job site.
              It is not a CRM and it is not a full field-service platform. It is one job: turning a job description into an estimate you can send before you leave.
            </p>
          </div>
        </section>

        {/* After the estimate */}
        <section className="py-12 sm:py-16 bg-[#F3E8D0]">
          <div className="mx-auto max-w-4xl px-6 sm:px-10">
            <div className="text-center mb-8">
              <h2 className="text-3xl sm:text-4xl font-bold text-[#26211B]">Estimates come first. This comes after.</h2>
            </div>
            <div className="grid sm:grid-cols-3 gap-4 sm:gap-6">
              {AFTER_ESTIMATE.map(item => (
                <div key={item.title} className="text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start gap-2 mb-1.5">
                    <h3 className="text-sm font-semibold text-[#26211B]">{item.title}</h3>
                    {item.pro && (
                      <span className="text-[10px] font-bold leading-none text-amber-600 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">PRO</span>
                    )}
                  </div>
                  <p className="text-xs text-[#5C4A2E] leading-relaxed">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-12 sm:py-16 bg-[#F3E8D0]">
          <div className="mx-auto max-w-3xl px-6 sm:px-10">
            <div className="text-center mb-8">
              <h2 className="text-3xl sm:text-4xl font-bold text-[#26211B]">Simple, flat pricing</h2>
              <p className="mt-4 text-lg text-[#5C4A2E]">No per-estimate fees. No seat charges. Two flat rates.</p>
              {showCanadianBadge && (
                <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-[#5C4A2E]">
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 21c.5 -4.5 2.5 -8 7 -10" />
                    <path d="M13 19c-2.733 0 -4.16 -3.11 -5 -5c-1.892 -.84 -4 -1.826 -4 -4.556c1.014 -.644 2.816 -.649 4 -.444c-.312 -2.071 -.37 -4.414 1 -6c2.364 .369 3 4 3 4c1.463 -1.368 4 -2 6 -2c0 2 -.63 4.538 -2 6q 3.687 .996 4 3c-1.586 1.36 -3.933 1.311 -6 1q .19 1.098 -1 4" />
                  </svg>
                  Proudly Canadian, priced in CAD
                </p>
              )}
            </div>
          </div>

          <div className="mx-auto max-w-4xl px-6 sm:px-10">
            <div className="grid sm:grid-cols-2 gap-6">

              <div className="rounded-2xl border-2 p-8 relative" style={{ borderColor: "#C9B384" }}>
                <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5C4A2E" }}>Starter</p>
                <div className="flex items-end gap-2 mb-2">
                  <span className="text-4xl font-bold text-[#26211B]">{`${currencyPrefix(currency)}${planMonthlyPrice("starter", currency)}`}</span>
                  <span className="text-[#5C4A2E] mb-1">/month</span>
                </div>
                <p className="text-sm text-[#5C4A2E] mb-6">Estimates only. No card required for a 14-day trial.</p>

                <div className="flex flex-col gap-2.5 mb-8">
                  {[
                    "Unlimited estimates",
                    "Voice dictation",
                    "SMS and email sending",
                    "Your logo on every estimate",
                    "Custom rates and price book",
                    "Customer details saved",
                    "PDF download",
                  ].map(feature => (
                    <div key={feature} className="flex items-center gap-3">
                      <svg className="w-5 h-5 shrink-0 text-emerald-500" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="7" fill="#ECFDF5" />
                        <path d="M5 8l2 2 4-4" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="text-sm text-[#5C4A2E]">{feature}</span>
                    </div>
                  ))}
                </div>

                <Link href={ctaHref}
                  className="flex items-center justify-center w-full h-12 rounded-xl text-base font-semibold transition hover:opacity-90"
                  style={{ background: "#f59e0b", color: "#0D1B2E" }}>
                  {ctaLabel}
                </Link>
              </div>

              <div className="rounded-2xl border-2 p-8 relative" style={{ borderColor: "#0D1B2E" }}>
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="px-4 py-1 rounded-full text-xs font-semibold" style={{ background: "#f59e0b", color: "#0D1B2E" }}>
                    Everything included
                  </span>
                </div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#0D1B2E" }}>Pro</p>
                <div className="flex items-end gap-2 mb-2">
                  <span className="text-4xl font-bold text-[#26211B]">{`${currencyPrefix(currency)}${planMonthlyPrice("pro", currency)}`}</span>
                  <span className="text-[#5C4A2E] mb-1">/month</span>
                </div>
                <p className="text-sm text-[#5C4A2E] mb-6">Everything in Starter, plus:</p>

                <div className="flex flex-col gap-3 mb-8">
                  {[
                    { title: "AI Photo Estimates", description: "Take a photo of the job and TradePulse uses it to help draft the estimate." },
                    { title: "Google Review Requests", description: "Ask customers for Google reviews after completed jobs." },
                    { title: "Payment Reminders", description: "Automatic follow-up on unpaid invoices." },
                    { title: "Customer Follow-Ups (Coming Soon)", description: "Stay connected with past customers and generate repeat business." },
                  ].map(item => (
                    <div key={item.title} className="flex items-start gap-3">
                      <svg className="w-5 h-5 shrink-0 text-emerald-500 mt-0.5" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="8" r="7" fill="#ECFDF5" />
                        <path d="M5 8l2 2 4-4" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div>
                        <p className="text-sm font-semibold text-[#26211B]">{item.title}</p>
                        <p className="text-xs text-[#5C4A2E]">{item.description}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <Link href="/signup?plan=pro"
                  className="flex items-center justify-center w-full h-12 rounded-xl text-base font-semibold text-white transition hover:opacity-90"
                  style={{ background: "#0D1B2E" }}>
                  Subscribe Now
                </Link>
              </div>

            </div>

            <p className="text-center text-xs text-[#5C4A2E] mt-6">
              Starter includes a 14-day free trial, no card required. Pro is billed right away. First paid charge has a 30-day money-back guarantee.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-12 sm:py-16 bg-[#F3E8D0]">
          <div className="mx-auto max-w-3xl px-6 sm:px-10">
            <div className="text-center mb-8">
              <h2 className="text-3xl sm:text-4xl font-bold text-[#26211B]">Common questions</h2>
            </div>
            <FaqAccordion items={FAQ_ITEMS} />
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-12 sm:py-16" style={{ background: "#26211B" }}>
          <div className="relative mx-auto max-w-2xl px-6 text-center">
            <div className="dot-grid absolute inset-0 opacity-30" />
            <div className="relative">
              <h2 className="text-4xl sm:text-5xl font-bold text-white leading-tight">
                Quote faster.<br />
                <span style={{ color: "#f59e0b" }}>Win more jobs.</span>
              </h2>
              <p className="mt-6 text-xl leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>
                No complicated setup. No learning curve. Send your first estimate today.
              </p>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href={ctaHref}
                  className="inline-flex items-center justify-center px-9 rounded-xl text-base font-semibold transition hover:opacity-90 active:scale-95 shadow-lg"
                  style={{ background: "#f59e0b", color: "#0D1B2E", height: "52px" }}>
                  {ctaLabel}
                </Link>
                {!user && (
                  <Link href="/login"
                    className="text-base font-medium underline underline-offset-4 transition"
                    style={{ color: "rgba(255,255,255,0.5)" }}>
                    Already have an account?
                  </Link>
                )}
              </div>
              <p className="mt-6 text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
                14-day free trial. No card required.
              </p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-[#C9B384] py-10 bg-[#F3E8D0]">
          <div className="mx-auto max-w-5xl px-6 sm:px-10 flex flex-col sm:flex-row items-center justify-between gap-6">
            {/* Mark A at every size, per Greg's call -- LogoMarkLight applies its own small-size treatment (thicker stroke, gridlines dropped) under 24px, no Mark C swap. 20/19 matches the reference sheet's own small/dense pairing (near 1:1, not an oversized icon shrunk-down in text only). Comfortably inside this row's ~189px budget at its tightest breakpoint (sm:, 640px) -- see HANDOFF.md for the measurement. */}
            <RowLockup variant="light" iconSize={20} textSize={19} />
            <nav className="flex flex-wrap items-center justify-center gap-6">
              <Link href="#how-it-works" className="text-sm text-[#5C4A2E] hover:text-[#26211B] transition-colors">How it works</Link>
              <Link href="#pricing" className="text-sm text-[#5C4A2E] hover:text-[#26211B] transition-colors">Pricing</Link>
              {user ? (
                <Link href={ctaHref}
                  className="inline-flex h-9 items-center justify-center px-5 rounded-lg text-sm font-semibold text-white transition hover:opacity-90"
                  style={{ background: "#0D1B2E" }}>
                  {hasAccess ? "Go to App" : "Subscribe"}
                </Link>
              ) : (
                <>
                  <Link href="/login" className="text-sm text-[#5C4A2E] hover:text-[#26211B] transition-colors">Sign In</Link>
                  <Link href="/signup"
                    className="inline-flex h-9 items-center justify-center px-5 rounded-lg text-sm font-semibold text-white transition hover:opacity-90"
                    style={{ background: "#0D1B2E" }}>
                    Start Free
                  </Link>
                </>
              )}
            </nav>
          </div>
        </footer>

        <footer className="border-t border-[#C9B384] mt-16 py-6 px-5 text-center">
          <div className="flex items-center justify-center gap-6 text-xs text-[#5C4A2E] flex-wrap">
            <Link href="/contact" className="inline-flex min-h-11 items-center transition-colors hover:text-[#26211B]">Support</Link>
            <Link href="/terms" className="inline-flex min-h-11 items-center transition-colors hover:text-[#26211B]">Terms of Service</Link>
            <Link href="/privacy" className="inline-flex min-h-11 items-center transition-colors hover:text-[#26211B]">Privacy Policy</Link>
          </div>
        </footer>

      </div>
    </>
  );
}
