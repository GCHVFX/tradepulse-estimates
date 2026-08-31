import type { Metadata } from "next";
import Link from "next/link";
import { EstimateDemo } from "@/app/components/EstimateDemo";
import { RowLockup } from "@/app/components/wordmark";
import { JsonLd } from "@/app/components/json-ld";
import { STARTER_MONTHLY_PRICE_CAD } from "@/lib/plan-pricing";
import { CANONICAL_URL, CANONICAL_DOMAIN } from "@/lib/site-url";
import { SUPPORT_EMAIL } from "@/lib/email-addresses";

export const metadata: Metadata = {
  title: "Plumbing Estimates in 30 Seconds | TradePulse",
  description: "Type what the job is. Get a ready-to-send plumbing estimate. Works from your phone. 14-day free trial, no card required.",
  alternates: { canonical: `${CANONICAL_URL}/plumbers` },
  openGraph: {
    title: "Plumbing Estimates in 30 Seconds | TradePulse",
    description: "Type what the job is. Get a ready-to-send plumbing estimate. Works from your phone. 14-day free trial, no card required.",
    url: `${CANONICAL_URL}/plumbers`,
    siteName: "TradePulse",
    images: [{ url: `${CANONICAL_URL}/opengraph-image.png`, width: 1200, height: 630, alt: "TradePulse Estimates" }],
    locale: "en_CA",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Plumbing Estimates in 30 Seconds | TradePulse",
    description: "Type what the job is. Get a ready-to-send plumbing estimate. Works from your phone.",
    images: [`${CANONICAL_URL}/opengraph-image.png`],
  },
};

export default function PlumbersPage() {
  return (
    <div className="min-h-dvh bg-white flex flex-col font-[family-name:var(--font-dm-sans)]">
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "TradePulse Estimates",
        "applicationCategory": "BusinessApplication",
        "description": "Create and send professional trade estimates in seconds from your phone.",
        "url": CANONICAL_URL,
        "operatingSystem": "Web, iOS, Android",
        "offers": {
          "@type": "Offer",
          "price": STARTER_MONTHLY_PRICE_CAD.toFixed(2),
          "priceCurrency": "CAD",
          "priceValidUntil": "2027-01-01"
        }
      }} />

      {/* Header */}
      <header className="flex items-center justify-between px-6 pt-6 pb-2 max-w-lg mx-auto w-full">
        <RowLockup variant="light" iconSize={44} textSize={36} />
        <Link
          href="/login"
          className="text-sm font-medium text-[#5C4A2E] hover:text-[#26211B] transition-colors"
        >
          Sign in
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center px-6 pt-8 pb-36">

        {/* Headline */}
        <div className="w-full max-w-sm text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold leading-tight tracking-tight" style={{ color: "#0D1B2E" }}>
            Your next plumbing estimate. Done in 30 seconds.
          </h1>
          <p className="mt-3 text-base text-[#5C4A2E] leading-relaxed">
            Type the job. Get a professional quote ready to send. Works from your phone.
          </p>
        </div>

        {/* Interactive demo */}
        <div className="mt-4 w-full max-w-sm">
          <h2 className="text-2xl font-bold text-center leading-tight tracking-tight" style={{ color: "#0D1B2E" }}>
            See it in action
          </h2>
          <div className="mt-6">
            <EstimateDemo />
          </div>
        </div>

        {/* Primary CTA — desktop */}
        <div className="hidden sm:flex flex-col items-center mt-8 gap-3 w-full max-w-sm">
          <Link
            href="/signup?next=%2Fnew"
            className="flex items-center justify-center w-full rounded-2xl py-4 text-base font-bold transition-opacity hover:opacity-90"
            style={{ backgroundColor: "#f59e0b", color: "#0D1B2E" }}
          >
            Try it free
          </Link>
          <p className="text-xs text-[#5C4A2E]">14-day free trial. No card required.</p>
        </div>

        {/* How it works */}
        <div className="mt-14 w-full max-w-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#5C4A2E] mb-6 text-center">How it works</p>
          <ol className="flex flex-col gap-5">
            {[
              ["1", "Describe the job", "A sentence or two from the truck is enough."],
              ["2", "Get a clean estimate", "Labour, materials, taxes, payment terms. All filled in."],
              ["3", "Send it to the customer", "Text, email, or copy a link. Done."],
            ].map(([num, title, desc]) => (
              <li key={num} className="flex gap-4 items-start">
                <span
                  className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ backgroundColor: "#fef3c7", color: "#b45309" }}
                >
                  {num}
                </span>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#0D1B2E" }}>{title}</p>
                  <p className="text-xs text-[#5C4A2E] mt-0.5">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Trust line */}
        <p className="mt-12 text-sm text-[#5C4A2E] text-center max-w-xs leading-relaxed">
          Built for solo plumbers who quote jobs in the truck, not at a desk.
        </p>

        {/* Secondary desktop CTA */}
        <Link
          href="/signup?next=%2Fnew"
          className="hidden sm:inline-flex mt-6 text-sm font-semibold text-amber-600 hover:text-amber-700 transition-colors"
        >
          Start your free trial
        </Link>

      </main>

      {/* Mobile CTA — fixed bottom */}
      <div className="fixed bottom-0 left-0 right-0 sm:hidden px-6 pb-8 pt-4 bg-white border-t border-[#C9B384]">
        <Link
          href="/signup?next=%2Fnew"
          className="flex items-center justify-center w-full rounded-2xl py-4 text-base font-bold transition-opacity hover:opacity-90"
          style={{ backgroundColor: "#f59e0b", color: "#0D1B2E" }}
        >
          Try it free
        </Link>
        <p className="text-center text-xs text-[#5C4A2E] mt-2">14-day free trial. No card required.</p>
      </div>

      <footer className="hidden sm:block text-center py-8 text-sm text-[#5C4A2E]">
        TradePulse Estimates,{" "}
        <a href={CANONICAL_URL} className="hover:text-[#26211B] transition-colors">
          {CANONICAL_DOMAIN}
        </a>
      </footer>

      <footer className="border-t border-[#C9B384] mt-16 py-6 px-5 text-center">
        <div className="flex items-center justify-center gap-6 text-xs text-[#5C4A2E] flex-wrap">
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-[#26211B] transition-colors">{SUPPORT_EMAIL}</a>
          <a href="/terms" className="hover:text-[#26211B] transition-colors">Terms of Service</a>
          <a href="/privacy" className="hover:text-[#26211B] transition-colors">Privacy Policy</a>
        </div>
      </footer>
    </div>
  );
}
