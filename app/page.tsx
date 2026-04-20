import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient, supabaseAdmin } from "@/lib/supabase-server";
import { EstimateDemo } from "@/app/components/EstimateDemo";

export const metadata: Metadata = {
  title: "TradePulse Estimates, Professional Quotes in Seconds",
  description: "Turn a job description into a professional estimate in seconds. Send it from your phone before you leave the driveway. Built for contractors. $39/month.",
  openGraph: {
    title: "TradePulse Estimates, Professional Quotes in Seconds",
    description: "Turn a job description into a professional estimate in seconds. Built for contractors and home service businesses. $39/month, 14-day free trial.",
    type: "website",
  },
};

const STEPS = [
  {
    number: "01",
    title: "Describe the job",
    description: "Type a quick description of the work, what needs doing, how long it will take, what materials you'll need. A sentence or two is enough.",
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
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  let hasAccess = false;
  if (user) {
    const { data: business } = await supabaseAdmin
      .from("tpe_businesses")
      .select("subscription_status, trial_ends_at")
      .eq("user_id", user.id)
      .maybeSingle();

    const isTrialing = business?.subscription_status === "trial" &&
      business?.trial_ends_at &&
      new Date(business.trial_ends_at) > new Date();
    const isActive = business?.subscription_status === "active";
    hasAccess = isTrialing || isActive;
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
        .dash-glow { box-shadow: 0 0 0 1px rgba(13,27,46,0.08), 0 24px 64px rgba(13,27,46,0.12); }
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
        <section className="relative overflow-hidden noise pt-32 pb-24 sm:pt-40 sm:pb-32"
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
              <div className="fade-up delay-300 hidden md:block">
                <EstimateDemo />
              </div>
            </div>
          </div>
        </section>

        {/* Trust strip */}
        <div className="border-y border-slate-100 bg-slate-50 py-5">
          <div className="mx-auto max-w-4xl px-6 flex flex-wrap items-center justify-center gap-8">
            {["$39/month flat", "14-day free trial", "No card required", "Cancel anytime"].map(item => (
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
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#0D1B2E", opacity: 0.4 }}>How it works</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">Three steps. Done before you drive away.</h2>
              <p className="mt-4 text-lg text-slate-500 max-w-xl mx-auto">
                No complicated setup. Works on your phone. Same routine after every job.
              </p>
            </div>

            <div className="relative grid md:grid-cols-3 gap-8 md:gap-6">
              <div className="hidden md:block absolute top-12 left-1/4 right-1/4 h-px"
                style={{ background: "linear-gradient(to right, transparent, #0D1B2E 20%, #0D1B2E 80%, transparent)", opacity: 0.15 }} />
              {STEPS.map((step, i) => (
                <div key={step.number} className="card-lift gradient-border relative rounded-2xl p-7">
                  <div className="flex items-start gap-4 mb-4">
                    <span className="text-4xl font-bold leading-none" style={{ color: "#f59e0b", opacity: 0.7 }}>
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

        {/* App mock */}
        <section className="py-12 sm:py-16 overflow-hidden" style={{ background: "linear-gradient(180deg, #F8FAFC 0%, #F1F5F9 100%)" }}>
          <div className="mx-auto max-w-5xl px-6 sm:px-10">
            <div className="text-center mb-8">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#0D1B2E", opacity: 0.4 }}>The estimate</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">Professional. Ready to send. Every time.</h2>
              <p className="mt-4 text-lg text-slate-500 max-w-lg mx-auto">
                Scope of work, line items, your logo, and payment terms. Looks like it came from a proper business.
              </p>
            </div>

            <div className="dash-glow rounded-2xl bg-white overflow-hidden max-w-2xl mx-auto">
              <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid #F1F5F9", background: "#FAFBFC" }}>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-amber-400" />
                  <div className="w-3 h-3 rounded-full bg-emerald-400" />
                </div>
                <span className="hidden sm:inline text-xs font-medium text-slate-400">tradepulse.app/share/est_abc123</span>
                <div className="w-16" />
              </div>
              <div className="p-6 sm:p-8">
                <div className="mb-1 text-xs text-slate-400">Prepared for: Mike Johnson · 604-555-0182</div>
                <div className="mb-4 text-xs text-slate-400">Prepared by: Smith Plumbing Co. · Date: March 28, 2026</div>
                <h3 className="text-xl font-bold text-slate-900 mb-1">Hot Water Heater Replacement</h3>
                <p className="text-sm text-slate-500 mb-5">Replace existing 50-gallon electric water heater with a new unit. Includes disposal of old unit, new expansion tank, and full system check on completion.</p>

                <div className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-3">Scope of Work</div>
                <ul className="space-y-1.5 mb-5">
                  {["Drain and disconnect existing water heater", "Remove old unit and dispose off-site", "Install new 50-gallon electric water heater", "Install new expansion tank", "Test all connections and confirm operation"].map(item => (
                    <li key={item} className="flex gap-2 text-sm text-slate-600">
                      <span className="text-amber-500 shrink-0">•</span>{item}
                    </li>
                  ))}
                </ul>

                <div className="rounded-xl overflow-hidden border border-slate-200 mb-5">
                  <table className="w-full text-sm">
                    <thead style={{ background: "#F8FAFC" }}>
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">Item</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-400 uppercase tracking-wide">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[["Labour (3 hrs @ $85/hr)", "$255"], ["50-gal water heater (AO Smith)", "$680"], ["Expansion tank", "$95"], ["Materials & fittings", "$45"]].map(([item, price]) => (
                        <tr key={item} style={{ borderTop: "1px solid #F1F5F9" }}>
                          <td className="px-4 py-2.5 text-slate-700">{item}</td>
                          <td className="px-4 py-2.5 text-right text-slate-700">{price}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-between text-sm font-bold text-slate-900 mb-1">
                  <span>Total</span><span style={{ color: "#0D1B2E" }}>$1,075.00</span>
                </div>
                <p className="text-xs text-slate-400 mb-2">Deposit: $537.50 on acceptance · Balance due on completion</p>
                <p className="text-xs text-slate-400">This estimate is valid for 30 days.</p>
              </div>
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
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {BENEFITS.map(b => (
                <div key={b.title} className="card-lift gradient-border rounded-2xl p-6">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 text-lg font-bold"
                    style={{ background: "#FEF3C7", color: "#92400E" }}>
                    {b.icon}
                  </div>
                  <h3 className="font-semibold text-slate-900 mb-2">{b.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-500">{b.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-12 sm:py-16" style={{ background: "linear-gradient(180deg, #F8FAFC 0%, #F1F5F9 100%)" }}>
          <div className="mx-auto max-w-3xl px-6 sm:px-10">
            <div className="text-center mb-8">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#0D1B2E", opacity: 0.4 }}>Pricing</p>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">Simple, flat pricing</h2>
              <p className="mt-4 text-lg text-slate-500">No per-estimate fees. No seat charges. One flat rate.</p>
            </div>

            {/* Competitor comparison */}
            <p className="text-xs font-semibold uppercase tracking-widest text-center mb-3" style={{ color: "#94A3B8" }}>How we compare</p>
            <div className="grid grid-cols-3 gap-0 mb-8 rounded-2xl overflow-hidden border border-slate-200">
              {[
                { name: "ServiceTitan", price: "$250+", note: "per month" },
                { name: "Jobber", price: "$69+", note: "per month" },
                { name: "TradePulse", price: "$39", note: "per month", highlight: true },
              ].map(c => (
                <div key={c.name} className="p-5 text-center"
                  style={{ background: c.highlight ? "#0D1B2E" : "#F8FAFC", borderRight: c.highlight ? "none" : "1px solid #E2E8F0" }}>
                  <p className="text-xs font-semibold mb-3" style={{ color: c.highlight ? "rgba(255,255,255,0.5)" : "#94A3B8" }}>{c.name}</p>
                  <p className="text-2xl sm:text-3xl font-bold" style={{ color: c.highlight ? "#f59e0b" : "#CBD5E1" }}>{c.price}</p>
                  <p className="text-xs mt-1" style={{ color: c.highlight ? "rgba(255,255,255,0.4)" : "#CBD5E1" }}>{c.note}</p>
                  {c.highlight && <p className="text-xs font-semibold mt-2" style={{ color: "#f59e0b" }}>Everything included</p>}
                </div>
              ))}
            </div>

            <div className="rounded-2xl border-2 p-8 sm:p-10 relative" style={{ borderColor: "#0D1B2E" }}>
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                <span className="px-4 py-1 rounded-full text-xs font-semibold text-white" style={{ background: "#0D1B2E" }}>
                  14-day free trial
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-end gap-2 mb-2">
                <span className="text-5xl font-bold text-slate-900">$39</span>
                <span className="text-slate-500 mb-1">/month CAD</span>
              </div>
              <p className="text-sm text-slate-400 mb-8">No card required for trial. Cancel any time before day 14 and pay nothing.</p>

              <div className="grid sm:grid-cols-2 gap-3 mb-8">
                {[
                  "Unlimited estimates",
                  "SMS and email sending",
                  "Your logo on every estimate",
                  "Custom rates and price book",
                  "Customer details saved",
                  "PDF download",
                  "Share link for customers",
                  "Works on phone and desktop",
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
                style={{ background: "#0D1B2E" }}>
                {ctaLabel}
              </Link>

              <p className="text-center text-xs text-slate-400 mt-4">
                Reviews, Payments, and Follow-Up tools coming soon on Pro plan
              </p>
            </div>
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
                  a: "No. If you can type a text message, you can use TradePulse. Setup takes about 5 minutes. Add your company name, logo, and rates, then start generating estimates.",
                },
                {
                  q: "Can I cancel anytime?",
                  a: "Yes. No credit card required to start. If you subscribe after your trial, you can cancel anytime from your Profile page and you won't be charged again.",
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

      </div>
    </>
  );
}
