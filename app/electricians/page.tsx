import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { JsonLd } from "@/app/components/json-ld";

export const metadata: Metadata = {
  title: "Electrical Estimates in 30 Seconds | TradePulse",
  description: "Type what the job is. Get a ready-to-send electrical estimate. Works from your phone. 14-day free trial, no card required.",
  alternates: { canonical: "https://www.trytradepulse.com/electricians" },
  openGraph: {
    title: "Electrical Estimates in 30 Seconds | TradePulse",
    description: "Type what the job is. Get a ready-to-send electrical estimate. Works from your phone. 14-day free trial, no card required.",
    url: "https://www.trytradepulse.com/electricians",
    siteName: "TradePulse",
    images: [{ url: "https://www.trytradepulse.com/opengraph-image.png", width: 1200, height: 630, alt: "TradePulse Estimates" }],
    locale: "en_CA",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Electrical Estimates in 30 Seconds | TradePulse",
    description: "Type what the job is. Get a ready-to-send electrical estimate. Works from your phone.",
    images: ["https://www.trytradepulse.com/opengraph-image.png"],
  },
};

export default function ElectriciansPage() {
  return (
    <div className="min-h-dvh bg-white flex flex-col font-[family-name:var(--font-dm-sans)]">
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "TradePulse Estimates",
        "applicationCategory": "BusinessApplication",
        "description": "Create and send professional trade estimates in seconds from your phone.",
        "url": "https://www.trytradepulse.com",
        "operatingSystem": "Web, iOS, Android",
        "offers": {
          "@type": "Offer",
          "price": "39.00",
          "priceCurrency": "CAD",
          "priceValidUntil": "2027-01-01"
        }
      }} />

      {/* Header */}
      <header className="flex items-center justify-between px-6 pt-6 pb-2 max-w-lg mx-auto w-full">
        <Image
          src="/tradepulse-logo.png"
          alt="TradePulse Estimates"
          width={160}
          height={44}
          className="object-contain"
          unoptimized
        />
        <Link
          href="/login"
          className="text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors"
        >
          Sign in
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center px-6 pt-8 pb-36">

        {/* Headline */}
        <div className="w-full max-w-sm text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold leading-tight tracking-tight" style={{ color: "#0D1B2E" }}>
            Your next electrical estimate. Done in 30 seconds.
          </h1>
          <p className="mt-3 text-base text-slate-500 leading-relaxed">
            Type the job. Get a professional quote ready to send. Works from your phone.
          </p>
        </div>

        {/* Estimate card — the proof */}
        <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-xl p-5">

          <div className="flex items-center justify-center mb-4">
            <Image
              src="/circuit-and-co-electrical.png"
              alt="Circuit & Co. Electrical"
              width={200}
              height={80}
              className="object-contain"
              unoptimized
            />
          </div>

          <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest text-amber-500">
            Estimate
          </span>

          <h2 className="mt-2 text-xl font-bold leading-tight" style={{ color: "#0D1B2E" }}>
            200A Electrical Panel Upgrade
          </h2>
          <p className="text-xs text-slate-400 mt-1">Prepared for: David Kowalski</p>
          <p className="text-xs text-slate-400">Date: April 8, 2026</p>

          <p className="text-xs font-bold uppercase tracking-wide mt-5 mb-2" style={{ color: "#0D1B2E" }}>Scope of Work</p>
          <ul className="flex flex-col gap-1.5">
            {[
              "Pull electrical permit from municipality",
              "Remove and dispose of existing 100A panel",
              "Install new 200A main breaker panel",
              "Reconnect all existing circuits to new panel",
              "Inspect and label all breakers",
              "Schedule and pass final inspection",
            ].map((item) => (
              <li key={item} className="flex gap-2 text-xs text-slate-600 leading-snug">
                <span className="text-amber-500 shrink-0 mt-0.5">•</span>
                {item}
              </li>
            ))}
          </ul>

          <p className="text-xs font-bold uppercase tracking-wide mt-5 mb-2" style={{ color: "#0D1B2E" }}>Line Items</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left text-slate-400 font-medium pb-1.5">Item</th>
                <th className="text-right text-slate-400 font-medium pb-1.5">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                ["Labour (6 hours @ $95/hr)", "$570"],
                ["200A main panel (Square D)", "$485"],
                ["Main breaker and hardware", "$120"],
                ["Permit fee", "$185"],
                ["Misc wire and connectors", "$55"],
              ].map(([item, cost]) => (
                <tr key={item}>
                  <td className="py-2 text-slate-700 pr-4">{item}</td>
                  <td className="py-2 text-slate-700 text-right font-medium">{cost}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-xs font-bold uppercase tracking-wide mt-5 mb-2" style={{ color: "#0D1B2E" }}>Pricing Summary</p>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-100">
              {([
                ["Subtotal", "$1,415", false],
                ["Tax (GST 5%)", "$71", false],
                ["Total", "$1,486", true],
                ["Deposit required (25%)", "$372", false],
                ["Balance on completion", "$1,114", false],
              ] as [string, string, boolean][]).map(([label, amount, bold]) => (
                <tr key={label}>
                  <td className={`py-2 ${bold ? "font-bold" : "text-slate-600"}`} style={bold ? { color: "#0D1B2E" } : {}}>{label}</td>
                  <td className={`py-2 text-right ${bold ? "font-bold" : "text-slate-600"}`} style={bold ? { color: "#0D1B2E" } : {}}>{amount}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-xs font-bold uppercase tracking-wide mt-5 mb-1" style={{ color: "#0D1B2E" }}>Payment Terms</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            25% deposit required to schedule. Balance due on completion. Cash, cheque, or credit card. Valid for 30 days.
          </p>
        </div>

        {/* Primary CTA — desktop */}
        <div className="hidden sm:flex flex-col items-center mt-8 gap-3 w-full max-w-sm">
          <Link
            href="/signup?next=%2Fnew%3Fprefill%3Dpanel-upgrade"
            className="flex items-center justify-center w-full rounded-2xl py-4 text-base font-bold transition-opacity hover:opacity-90"
            style={{ backgroundColor: "#f59e0b", color: "#0D1B2E" }}
          >
            Create this estimate free
          </Link>
          <p className="text-xs text-slate-400">14-day free trial. No card required.</p>
        </div>

        {/* How it works */}
        <div className="mt-14 w-full max-w-sm">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-6 text-center">How it works</p>
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
                  <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Trust line */}
        <p className="mt-12 text-sm text-slate-400 text-center max-w-xs leading-relaxed">
          Built for solo electricians who quote jobs in the truck, not at a desk.
        </p>

        {/* Secondary desktop CTA */}
        <Link
          href="/signup?next=%2Fnew%3Fprefill%3Dpanel-upgrade"
          className="hidden sm:inline-flex mt-6 text-sm font-semibold text-amber-600 hover:text-amber-700 transition-colors"
        >
          Start your free trial
        </Link>

      </main>

      {/* Mobile CTA — fixed bottom */}
      <div className="fixed bottom-0 left-0 right-0 sm:hidden px-6 pb-8 pt-4 bg-white border-t border-slate-100">
        <Link
          href="/signup?next=%2Fnew%3Fprefill%3Dpanel-upgrade"
          className="flex items-center justify-center w-full rounded-2xl py-4 text-base font-bold transition-opacity hover:opacity-90"
          style={{ backgroundColor: "#f59e0b", color: "#0D1B2E" }}
        >
          Create this estimate free
        </Link>
        <p className="text-center text-xs text-slate-400 mt-2">14-day free trial. No card required.</p>
      </div>

      <footer className="hidden sm:block text-center py-8 text-sm text-slate-400">
        TradePulse Estimates,{" "}
        <a href="https://trytradepulse.com" className="hover:text-slate-600 transition-colors">
          trytradepulse.com
        </a>
      </footer>
    </div>
  );
}