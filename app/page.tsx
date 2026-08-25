import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, supabaseAdmin } from "@/lib/supabase-server";
import { EstimateDemo } from "@/app/components/EstimateDemo";
import { TradeExamples } from "@/app/components/TradeExamples";
import { STARTER_MONTHLY_PRICE_CAD } from "@/lib/plan-pricing";
import { headers } from "next/headers";
import { currencyFromCountry, currencyPrefix, formatMonthlyPlanPrice, planMonthlyPrice } from "@/lib/currency";

export const metadata: Metadata = {
  title: "Estimate Software for Contractors & Trades | TradePulse",
  description: `Generate professional estimates in seconds. Send quotes from the job site via text or email. Built for Canadian plumbers, electricians, and trades. CA$${STARTER_MONTHLY_PRICE_CAD}/month.`,
  alternates: { canonical: "https://trytradepulse.com" },
  openGraph: {
    title: "Professional Estimates in Seconds | TradePulse",
    description: "Create and send professional estimates from the job site in seconds. Built for Canadian contractors.",
    url: "https://trytradepulse.com",
    siteName: "TradePulse",
    images: [
      {
        url: "https://trytradepulse.com/social-card.png",
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
    images: ["https://trytradepulse.com/social-card.png"],
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

const BENEFITS = [
  {
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
        <path d="M11 2L4 11h7l-2 7 7-9h-7l2-7z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    title: "Quote on the spot",
    description: "Send a professional estimate before you leave the driveway. Customers decide faster when the quote arrives while the job is still fresh.",
  },
  {
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
        <path d="M3 5h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="7" cy="5" r="2" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="13" cy="15" r="2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
    title: "Your rates, built in",
    description: "Set your labour rate and markup once. Every estimate uses your numbers automatically. No more recalculating from scratch.",
  },
  {
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
        <path d="M5 3h7l3 3v11a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 3v4h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 9h6M7 12h6M7 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: "Professional output",
    description: "Scope of work, line items, payment terms, and your logo. Looks like it came from a proper business, not a notes app.",
  },
  {
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
        <path d="M17.5 2.5l-15 5.5 6 2 2 6 7-13.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8.5 10L17.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: "Send how you want",
    description: "Text it, email it, or send a link. Customers can view the estimate on any device. No app download required on their end.",
  },
  {
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
        <circle cx="10" cy="6" r="3.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 18c0-3.9 3.1-7 7-7s7 3.1 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: "Customer details saved",
    description: "Name, phone, email, and address saved to the estimate. Edit customer details any time without regenerating the whole quote.",
  },
  {
    icon: (
      <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
        <rect x="5.5" y="1.5" width="9" height="17" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M9 15.5h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    title: "Built for the field",
    description: "Designed for one hand on a phone in a driveway, not a desk. Large buttons, minimal typing, fast to load.",
  },
];

export default async function LandingPage() {
  // The same resolver /signup uses, reading the same Vercel header, so the
  // price a US visitor sees here cannot disagree with the one they are
  // offered at signup. currencyFromCountry() is the single country rule:
  // US is USD, and Canada, an unknown country, and a missing header are all
  // CAD. Reading a request header keeps this route rendered per request, so
  // one visitor's country can never be cached and served to another.
  const currency = currencyFromCountry((await headers()).get("x-vercel-ip-country"));

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  let hasAccess = false;
  if (user) {
    const { data: business } = await supabaseAdmin
      .from("tpe_businesses")
      .select("subscription_status, trial_ends_at")
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (!business) redirect("/onboarding");

    const isTrialing = business.subscription_status === "trial" &&
      business.trial_ends_at &&
      new Date(business.trial_ends_at) > new Date();
    const isActive = business.subscription_status === "active";
    const isComplimentary = business.subscription_status === "complimentary";
    hasAccess = isTrialing || isActive || isComplimentary;

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
        .card-lift { transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .card-lift:hover { transform: translateY(-3px); box-shadow: 0 16px 40px rgba(0,0,0,0.1); }
        @keyframes type-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .line-1 { animation: type-in 0.4s ease 0.8s both; }
        .line-2 { animation: type-in 0.4s ease 1.1s both; }
        .line-3 { animation: type-in 0.4s ease 1.4s both; }
        .line-4 { animation: type-in 0.4s ease 1.7s both; }
        .line-5 { animation: type-in 0.4s ease 2.0s both; }
        .gradient-border {
          position: relative;
          background: white;
        }
        .gradient-border::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(135deg, rgba(13,27,46,0.3), rgba(13,27,46,0.05));
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
        }
      `}</style>

      <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }} className="min-h-screen bg-white text-slate-900 overflow-x-hidden">

        {/* Nav */}
        <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-2 sm:py-4 sm:px-10"
          style={{ background: "rgba(255,255,255,0.85)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <img src="/tradepulse-logo.png" alt="TradePulse Estimates" className="h-10 w-auto sm:h-14" />
          <div className="flex items-center gap-3 sm:gap-6">
            <Link href="#how-it-works" className="hidden sm:block text-sm text-slate-600 hover:text-slate-900 transition-colors">How it works</Link>
            <Link href="#pricing" className="hidden sm:block text-sm text-slate-600 hover:text-slate-900 transition-colors">Pricing</Link>
            {user ? (
              <Link href={ctaHref}
                className="inline-flex items-center justify-center h-9 px-5 rounded-lg text-sm font-semibold text-white transition hover:opacity-90"
                style={{ background: "#0D1B2E" }}>
                {hasAccess ? "Go to App" : "Subscribe"}
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors">Sign in</Link>
                <Link href="/signup"
                  className="inline-flex items-center justify-center h-9 px-4 sm:px-5 rounded-lg text-sm font-semibold text-white transition hover:opacity-90"
                  style={{ background: "#0D1B2E" }}>
                  Start Free
                </Link>
              </>
            )}
          </div>
        </nav>

        {/* Hero */}
        <section className="relative overflow-hidden noise pt-20 pb-24 sm:pt-40 sm:pb-32"
          style={{ background: "linear-gradient(160deg, #0D1B2E 0%, #1a2e47 60%, #0f2236 100%)" }}>
          <div className="dot-grid absolute inset-0 opacity-60" />
          <div className="orb absolute -top-32 -right-32 w-[600px] h-[600px] rounded-full opacity-20"
            style={{ background: "radial-gradient(circle, #f59e0b 0%, transparent 70%)" }} />
          <div className="orb-2 absolute -bottom-40 -left-20 w-[500px] h-[500px] rounded-full opacity-10"
            style={{ background: "radial-gradient(circle, #3B7DD8 0%, transparent 70%)" }} />

          <div className="relative mx-auto max-w-6xl px-6 sm:px-10">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <div>
                <div className="fade-up inline-flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full text-xs font-medium tracking-wide"
                  style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.8)" }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                  Built for contractors and home service businesses
                </div>

                <h1 className="fade-up delay-100 text-4xl sm:text-5xl lg:text-[3.5rem] leading-[1.1] text-white font-bold tracking-tight">
                  Send a professional estimate<br />
                  <em className="not-italic" style={{ color: "#f59e0b" }}>before you leave the job</em>
                </h1>

                <p className="fade-up delay-200 mt-6 text-lg leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>
                  Describe the job. Get a complete, itemised estimate with your rates and branding. Send it by text or email while you&apos;re still at the property.
                </p>

                <div className="fade-up delay-300 mt-10 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <Link href={ctaHref}
                    className="inline-flex items-center justify-center h-12 px-8 rounded-xl text-base font-semibold transition hover:opacity-90 active:scale-95 shadow-lg"
                    style={{ background: "#f59e0b", color: "#0D1B2E" }}>
                    {ctaLabel}
                  </Link>
                  {!user && (
                    <Link href="/login"
                      className="inline-flex items-center justify-center h-12 px-6 rounded-xl text-base font-medium transition hover:bg-white/10"
                      style={{ color: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.2)" }}>
                      Sign in
                    </Link>
                  )}
                </div>

                <p className="fade-up delay-400 mt-5 text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
                  14-day free trial. No credit card required.
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
        <div className="bg-white py-5">
          <div className="mx-auto max-w-4xl px-6 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-8 text-center">
            {PAIN_POINTS.map((point, i) => (
              <div key={point} className="flex items-center gap-3 sm:gap-8">
                <p className="text-sm sm:text-base font-medium text-slate-700">{point}</p>
                {i < PAIN_POINTS.length - 1 && (
                  <span className="hidden sm:block w-1 h-1 rounded-full bg-slate-300" aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Trust strip */}
        <div className="border-y border-slate-100 bg-slate-50 py-5">
          <div className="mx-auto max-w-4xl px-6 flex flex-wrap items-center justify-center gap-8">
            {[`${formatMonthlyPlanPrice("starter", currency)} flat`, "14-day free trial", "No card required", "Cancel anytime"].map(item => (
              <div key={item} className="flex items-center gap-2 text-sm text-slate-500">
                <svg className="w-4 h-4 text-emerald-500 shrink-0" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {item}
              </div>
            ))}
          </div>
        </div>

        {/* How it works */}
        <section id="how-it-works" className="py-12 sm:py-16 bg-white">
          <div className="mx-auto max-w-5xl px-6 sm:px-10">
            <div className="text-center mb-8">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3 text-zinc-500">How it works</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">Three steps. Done before you drive away.</h2>
              <p className="mt-4 text-lg text-slate-500 max-w-xl mx-auto">
                No complicated setup. Works on your phone. Same routine after every job.
              </p>
            </div>

            <div className="relative grid md:grid-cols-3 gap-4 md:gap-6">
              <div className="hidden md:block absolute top-12 left-1/4 right-1/4 h-px"
                style={{ background: "linear-gradient(to right, transparent, #0D1B2E 20%, #0D1B2E 80%, transparent)", opacity: 0.15 }} />
              {STEPS.map((step, i) => (
                <div key={step.number} className="card-lift gradient-border relative rounded-2xl p-5 md:p-7">
                  <div className="flex items-start gap-4 mb-3 md:mb-4">
                    <span className="text-3xl md:text-4xl font-bold leading-none" style={{ color: "#f59e0b", opacity: 0.7 }}>
                      {step.number}
                    </span>
                    {i < STEPS.length - 1 && (
                      <div className="hidden md:flex absolute -right-3 top-10 w-6 h-6 rounded-full bg-white border border-slate-200 items-center justify-center z-10">
                        <svg className="w-3 h-3 text-slate-400" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-500">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Trade-specific examples */}
        <section className="py-12 sm:py-16 bg-slate-50">
          <div className="mx-auto max-w-5xl px-6 sm:px-10">
            <div className="text-center mb-8">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3 text-zinc-500">See it for your trade</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">See what TradePulse creates</h2>
              <p className="mt-4 text-lg text-slate-500 max-w-xl mx-auto">
                Example jobs using common trade scenarios. Your estimates use your own rates and line items.
              </p>
            </div>
            <TradeExamples />
          </div>
        </section>

        {/* Workflow showcase: what happens after generation */}
        <section className="py-12 sm:py-16 bg-white">
          <div className="mx-auto max-w-5xl px-6 sm:px-10">
            <div className="text-center mb-8">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3 text-zinc-500">After it&apos;s generated</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">Review, edit, send, done</h2>
              <p className="mt-4 text-lg text-slate-500 max-w-xl mx-auto">
                The estimate is a starting point, not a final answer. You stay in control before it reaches the customer.
              </p>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
              {WORKFLOW_STEPS.map(step => (
                <div key={step.title} className="rounded-xl bg-slate-50 p-4 sm:p-5">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3" style={{ background: "#FEF3C7", color: "#92400E" }}>
                    {step.icon}
                  </div>
                  <h3 className="text-sm sm:text-base font-semibold text-slate-900 mb-1.5">{step.title}</h3>
                  <p className="text-xs sm:text-sm leading-relaxed text-slate-500">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Benefits */}
        <section className="py-12 sm:py-16 bg-white">
          <div className="mx-auto max-w-5xl px-6 sm:px-10">
            <div className="text-center mb-8">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#0D1B2E", opacity: 0.4 }}>Why it works</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">Less time quoting. More jobs won.</h2>
              <p className="mt-4 text-lg text-slate-500 max-w-lg mx-auto">
                Contractors who quote faster win more jobs. Customers say yes while the work is still top of mind.
              </p>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
              {BENEFITS.map(b => (
                <div key={b.title} className="card-lift gradient-border rounded-2xl p-4 sm:p-6">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center mb-3 sm:mb-4 text-lg font-bold"
                    style={{ background: "#FEF3C7", color: "#92400E" }}>
                    {b.icon}
                  </div>
                  <h3 className="text-sm sm:text-base font-semibold text-slate-900 mb-1.5 sm:mb-2">{b.title}</h3>
                  <p className="text-xs sm:text-sm leading-relaxed text-slate-500">{b.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Positioning */}
        <section className="py-12 sm:py-16 bg-slate-50">
          <div className="mx-auto max-w-2xl px-6 sm:px-10 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 leading-tight">
              Fast estimates without another complicated business platform
            </h2>
            <p className="mt-5 text-base sm:text-lg text-slate-500 leading-relaxed">
              Set up in minutes. Built for a phone, not a desk, so it holds up in a driveway or on a job site.
              It is not a CRM and it is not a full field-service platform. It is one job: turning a job description into an estimate you can send before you leave.
            </p>
          </div>
        </section>

        {/* After the estimate */}
        <section className="py-12 sm:py-16 bg-white">
          <div className="mx-auto max-w-4xl px-6 sm:px-10">
            <div className="text-center mb-8">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#0D1B2E", opacity: 0.4 }}>After the estimate</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">Estimates come first. This comes after.</h2>
            </div>
            <div className="grid sm:grid-cols-3 gap-4 sm:gap-6">
              {AFTER_ESTIMATE.map(item => (
                <div key={item.title} className="text-center sm:text-left">
                  <div className="flex items-center justify-center sm:justify-start gap-2 mb-1.5">
                    <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                    {item.pro && (
                      <span className="text-[10px] font-bold leading-none text-amber-600 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">PRO</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-12 sm:py-16 bg-white">
          <div className="mx-auto max-w-3xl px-6 sm:px-10">
            <div className="text-center mb-8">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#0D1B2E", opacity: 0.4 }}>Pricing</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">Simple, flat pricing</h2>
              <p className="mt-4 text-lg text-slate-500">No per-estimate fees. No seat charges. Two flat rates.</p>
            </div>
          </div>

          <div className="mx-auto max-w-4xl px-6 sm:px-10">
            <div className="grid sm:grid-cols-2 gap-6">

              <div className="rounded-2xl border-2 p-8 relative" style={{ borderColor: "#E2E8F0" }}>
                <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#94A3B8" }}>Starter</p>
                <div className="flex items-end gap-2 mb-2">
                  <span className="text-4xl font-bold text-slate-900">{`${currencyPrefix(currency)}${planMonthlyPrice("starter", currency)}`}</span>
                  <span className="text-slate-500 mb-1">/month</span>
                </div>
                <p className="text-sm text-slate-400 mb-6">Estimates only. No card required for a 14-day trial.</p>

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
                      <span className="text-sm text-slate-600">{feature}</span>
                    </div>
                  ))}
                </div>

                <Link href={ctaHref}
                  className="flex items-center justify-center w-full h-12 rounded-xl text-base font-semibold text-white transition hover:opacity-90"
                  style={{ background: "#64748B" }}>
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
                  <span className="text-4xl font-bold text-slate-900">{`${currencyPrefix(currency)}${planMonthlyPrice("pro", currency)}`}</span>
                  <span className="text-slate-500 mb-1">/month</span>
                </div>
                <p className="text-sm text-slate-400 mb-6">Everything in Starter, plus:</p>

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
                        <p className="text-sm font-semibold text-slate-800">{item.title}</p>
                        <p className="text-xs text-slate-500">{item.description}</p>
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

            <p className="text-center text-xs text-slate-400 mt-6">
              Starter includes a 14-day free trial, no card required. Pro is billed right away. First paid charge has a 30-day money-back guarantee.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-12 sm:py-16 bg-white">
          <div className="mx-auto max-w-3xl px-6 sm:px-10">
            <div className="text-center mb-8">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#0D1B2E", opacity: 0.4 }}>FAQ</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">Common questions</h2>
            </div>
            <div className="space-y-4">
              {[
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
              ].map(item => (
                <div key={item.q} className="rounded-xl bg-white border border-slate-200 p-6">
                  <h3 className="font-semibold text-slate-900 mb-2">{item.q}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-12 sm:py-16" style={{ background: "linear-gradient(135deg, #0D1B2E 0%, #1a2e47 100%)" }}>
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
        <footer className="border-t border-slate-100 py-10 bg-white">
          <div className="mx-auto max-w-5xl px-6 sm:px-10 flex flex-col sm:flex-row items-center justify-between gap-6">
            <img src="/tradepulse-logo.png" alt="TradePulse Estimates" className="h-7 w-auto" />
            <nav className="flex flex-wrap items-center justify-center gap-6">
              <Link href="#how-it-works" className="text-sm text-slate-500 hover:text-slate-800 transition-colors">How it works</Link>
              <Link href="#pricing" className="text-sm text-slate-500 hover:text-slate-800 transition-colors">Pricing</Link>
              {user ? (
                <Link href={ctaHref}
                  className="inline-flex h-9 items-center justify-center px-5 rounded-lg text-sm font-semibold text-white transition hover:opacity-90"
                  style={{ background: "#0D1B2E" }}>
                  {hasAccess ? "Go to App" : "Subscribe"}
                </Link>
              ) : (
                <>
                  <Link href="/login" className="text-sm text-slate-500 hover:text-slate-800 transition-colors">Sign In</Link>
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

        <footer className="border-t border-zinc-800 mt-16 py-6 px-5 text-center">
          <div className="flex items-center justify-center gap-6 text-xs text-zinc-600 flex-wrap">
            <Link href="/contact" className="inline-flex min-h-11 items-center transition-colors hover:text-zinc-900">Support</Link>
            <Link href="/terms" className="inline-flex min-h-11 items-center transition-colors hover:text-zinc-900">Terms of Service</Link>
            <Link href="/privacy" className="inline-flex min-h-11 items-center transition-colors hover:text-zinc-900">Privacy Policy</Link>
          </div>
        </footer>

      </div>
    </>
  );
}
