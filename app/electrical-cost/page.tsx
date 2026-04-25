import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/app/components/json-ld";

export const metadata: Metadata = {
  title: "How Much Does an Electrician Cost in 2026? Real Pricing Guide",
  description: "Real electrical costs for common jobs in Canada. Panel upgrades, outlet installs, EV chargers, and more. Prices include labour and materials.",
  alternates: { canonical: "https://www.trytradepulse.com/electrical-cost" },
  openGraph: {
    title: "How Much Does an Electrician Cost in 2026? Real Pricing Guide",
    description: "Real electrical costs for common jobs in Canada. Panel upgrades, outlet installs, EV chargers, and more. Prices include labour and materials.",
    url: "https://www.trytradepulse.com/electrical-cost",
    siteName: "TradePulse",
    images: [{ url: "https://www.trytradepulse.com/opengraph-image.png", width: 1200, height: 630, alt: "TradePulse Estimates" }],
    locale: "en_CA",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "How Much Does an Electrician Cost in 2026? Real Pricing Guide",
    description: "Real electrical costs for common jobs in Canada. Panel upgrades, outlet installs, EV chargers, and more. Prices include labour and materials.",
    images: ["https://www.trytradepulse.com/opengraph-image.png"],
  },
};

export default function ElectricalCostPage() {
  return (
    <div className="min-h-dvh bg-white flex flex-col font-[family-name:var(--font-dm-sans)]">
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "How much does a 200A electrical panel upgrade cost in Canada?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "A panel upgrade from 100A to 200A costs between $1,200 and $2,800 in Canada. This includes the permit, new panel, main breaker, and reconnecting all circuits. Higher end reflects older homes with more complex wiring."
            }
          },
          {
            "@type": "Question",
            "name": "How much does EV charger installation cost in Canada?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Level 2 EV charger installation costs between $500 and $1,600 in Canada. This includes a dedicated 240V circuit, breaker, and charger mount. Higher end reflects long runs or a panel upgrade required."
            }
          },
          {
            "@type": "Question",
            "name": "How much do electricians charge per hour in Canada?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Most electricians in Canada charge $90 to $130 per hour. Emergency and after-hours rates are typically 1.5x to 2x the standard rate."
            }
          },
          {
            "@type": "Question",
            "name": "How much does outlet installation cost in Canada?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "A single outlet installation costs between $150 and $450 in Canada on an existing circuit. Higher end is for GFCI, AFCI, or when a new circuit is required."
            }
          },
          {
            "@type": "Question",
            "name": "How much does a light fixture installation cost in Canada?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Light fixture installation costs between $100 and $400 in Canada to swap an existing fixture. Higher end is for new wiring, pot lights, or a ceiling fan with switch."
            }
          }
        ]
      }} />
      <main className="flex-1 flex flex-col items-center px-6 pt-16 pb-36">
        <div className="w-full max-w-lg">

          <h1 className="text-3xl sm:text-4xl font-bold leading-tight tracking-tight text-slate-900">
            How Much Does an Electrician Cost in 2026?
          </h1>
          <p className="mt-4 text-slate-500 leading-relaxed">
            Real pricing for common electrical jobs in Canada. All prices include labour and materials unless noted. Prices vary by region, job complexity, and contractor.
          </p>

          <div className="mt-10 flex flex-col gap-8">
            {[
              {
                job: "Panel Upgrade (100A to 200A)",
                low: "$1,200",
                mid: "$1,800",
                high: "$2,800",
                notes: "Includes permit, new panel, main breaker, and reconnecting all circuits. Higher end reflects older homes with more complex wiring.",
              },
              {
                job: "EV Charger Installation (Level 2)",
                low: "$500",
                mid: "$900",
                high: "$1,600",
                notes: "Includes dedicated 240V circuit, breaker, and charger mount. Higher end reflects long runs or panel upgrades required.",
              },
              {
                job: "Outlet Installation",
                low: "$150",
                mid: "$250",
                high: "$450",
                notes: "Single outlet on existing circuit. Higher end for GFCI, AFCI, or new circuit required.",
              },
              {
                job: "Light Fixture Installation",
                low: "$100",
                mid: "$200",
                high: "$400",
                notes: "Swap existing fixture. Higher end for new wiring, pot lights, or ceiling fan with switch.",
              },
              {
                job: "Smoke and CO Detector Installation",
                low: "$80",
                mid: "$150",
                high: "$300",
                notes: "Per unit, hardwired and interconnected. Price includes detector. Higher end for attic or difficult access.",
              },
              {
                job: "Electrical Inspection and Troubleshooting",
                low: "$150",
                mid: "$300",
                high: "$600",
                notes: "Diagnostic fee plus repair. Highly variable depending on what is found.",
              },
            ].map(({ job, low, mid, high, notes }) => (
              <div key={job} className="border border-slate-200 rounded-2xl p-5">
                <h2 className="text-base font-bold text-slate-900">{job}</h2>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  {[["Low", low], ["Mid", mid], ["High", high]].map(([label, price]) => (
                    <div key={label} className="flex flex-col items-center bg-slate-50 rounded-xl py-3">
                      <span className="text-xs text-slate-400 font-medium">{label}</span>
                      <span className="text-base font-bold text-slate-900 mt-0.5">{price}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-slate-500 leading-relaxed">{notes}</p>
              </div>
            ))}
          </div>

          <div className="mt-12">
            <h2 className="text-xl font-bold text-slate-900">What affects the price?</h2>
            <ul className="mt-4 flex flex-col gap-3">
              {[
                "Labour rate. Most electricians in Canada charge $90 to $130 per hour.",
                "Permits. Panel upgrades, new circuits, and EV chargers typically require a permit.",
                "Access. Finished walls, attics, and crawl spaces add time and cost.",
                "Materials. Wire gauge, breaker brand, and fixture quality all affect price.",
                "Emergency calls. After-hours rates are typically 1.5x to 2x the standard rate.",
              ].map((item) => (
                <li key={item} className="flex gap-2 text-sm text-slate-600 leading-relaxed">
                  <span className="text-amber-500 shrink-0 mt-1">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-12">
            <h2 className="text-xl font-bold text-slate-900">Sample estimate: Panel upgrade</h2>
            <p className="mt-2 text-sm text-slate-500">This is what a professional electrical estimate looks like for a 200A panel upgrade.</p>

            <div className="mt-4 rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
              <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest text-amber-500">
                Estimate
              </span>
              <h3 className="mt-2 text-lg font-bold text-slate-900">200A Electrical Panel Upgrade</h3>
              <p className="text-xs text-slate-400 mt-1">Date: April 8, 2026</p>

              <p className="text-xs font-bold text-slate-900 uppercase tracking-wide mt-5 mb-2">Scope of Work</p>
              <ul className="flex flex-col gap-1.5">
                {[
                  "Pull electrical permit from municipality",
                  "Remove and dispose of existing 100A panel",
                  "Install new 200A main breaker panel",
                  "Reconnect all existing circuits and label breakers",
                  "Schedule and pass final inspection",
                ].map((item) => (
                  <li key={item} className="flex gap-2 text-xs text-slate-600 leading-snug">
                    <span className="text-amber-500 shrink-0 mt-0.5">•</span>
                    {item}
                  </li>
                ))}
              </ul>

              <p className="text-xs font-bold text-slate-900 uppercase tracking-wide mt-5 mb-2">Line Items</p>
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

              <p className="text-xs font-bold text-slate-900 uppercase tracking-wide mt-5 mb-2">Pricing Summary</p>
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
                      <td className={`py-2 ${bold ? "font-bold text-slate-900" : "text-slate-600"}`}>{label}</td>
                      <td className={`py-2 text-right ${bold ? "font-bold text-slate-900" : "text-slate-600"}`}>{amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-12 rounded-2xl bg-slate-950 p-6 text-center">
            <p className="text-white font-bold text-lg">Are you an electrician?</p>
            <p className="text-slate-400 text-sm mt-2">Create estimates like this in seconds. Send them from your phone before you leave the driveway.</p>
            <Link
              href="/signup"
              className="inline-flex mt-5 items-center justify-center rounded-2xl px-8 py-4 text-base font-bold transition-opacity hover:opacity-90 w-full"
              style={{ backgroundColor: "#f59e0b", color: "#0D1B2E" }}
            >
              Create Your Estimate Free
            </Link>
            <p className="text-slate-600 text-xs mt-3">14-day free trial. No credit card required.</p>
          </div>

        </div>
      </main>

      <footer className="text-center py-8 text-sm text-slate-400">
        TradePulse Estimates,{" "}
        <a href="https://trytradepulse.com" className="hover:text-slate-600 transition-colors">
          trytradepulse.com
        </a>
      </footer>
    </div>
  );
}
