import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { EstimateDemo } from "@/app/components/EstimateDemo";
import { EstimateDemoElectrical } from "@/app/components/EstimateDemoElectrical";
import { JsonLd } from "@/app/components/json-ld";

export const metadata: Metadata = {
  title: "Estimating Software for Electricians | TradePulse",
  description: "Send professional electrical estimates in seconds. Built for solo electricians and small electrical contractors in Canada.",
  alternates: { canonical: "https://www.trytradepulse.com/electricians" },
  openGraph: {
    title: "Estimating Software for Electricians | TradePulse",
    description: "Send professional electrical estimates in seconds. Built for solo electricians and small electrical contractors in Canada.",
    url: "https://www.trytradepulse.com/electricians",
    siteName: "TradePulse",
    images: [{ url: "https://www.trytradepulse.com/opengraph-image.png", width: 1200, height: 630, alt: "TradePulse Estimates" }],
    locale: "en_CA",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Estimating Software for Electricians | TradePulse",
    description: "Send professional electrical estimates in seconds. Built for solo electricians and small electrical contractors in Canada.",
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
            Most electricians spend 45 minutes writing up a quote by hand. TradePulse does it in seconds.
          </h1>
          <p className="mt-3 text-base text-slate-500 leading-relaxed">
            Quotes done before you&apos;re back in the truck.
          </p>
        </div>

        {/* Interactive demo */}
        <div className="mt-4 w-full max-w-sm">
          <h2 className="text-2xl font-bold text-center leading-tight tracking-tight" style={{ color: "#0D1B2E" }}>
            See it in action
          </h2>
          <div className="mt-6">
            <EstimateDemoElectrical />
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
          Built for solo electricians and small electrical contractors who quote jobs in the truck, not at a desk.
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
      <div className="fixed bottom-0 left-0 right-0 sm:hidden px-6 pb-8 pt-4 bg-white border-t border-slate-100">
        <Link
          href="/signup?next=%2Fnew"
          className="flex items-center justify-center w-full rounded-2xl py-4 text-base font-bold transition-opacity hover:opacity-90"
          style={{ backgroundColor: "#f59e0b", color: "#0D1B2E" }}
        >
          Try it free
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
