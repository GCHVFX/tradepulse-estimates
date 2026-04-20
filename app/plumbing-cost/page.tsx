import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How Much Does a Plumber Cost in 2026? Real Pricing Guide",
  description: "Real plumbing costs for common jobs in Canada. Water heaters, drain repairs, fixture installs, and more. Prices include labour and materials.",
};

export default function PlumbingCostPage() {
  return (
    <div className="min-h-dvh bg-white flex flex-col font-[family-name:var(--font-dm-sans)]">
      <main className="flex-1 flex flex-col items-center px-6 pt-16 pb-36">
        <div className="w-full max-w-lg">

          <h1 className="text-3xl sm:text-4xl font-bold leading-tight tracking-tight text-slate-900">
            How Much Does a Plumber Cost in 2026?
          </h1>
          <p className="mt-4 text-slate-500 leading-relaxed">
            Real pricing for common plumbing jobs in Canada. All prices include labour and materials unless noted. Prices vary by region, job complexity, and contractor.
          </p>

          {/* Jobs table */}
          <div className="mt-10 flex flex-col gap-8">

            {[
              {
                job: "Water Heater Replacement (40-50 gallon)",
                low: "$900",
                mid: "$1,400",
                high: "$2,100",
                notes: "Includes removal of old unit, new tank, connections, and testing. Higher end reflects power-vent or tankless units.",
              },
              {
                job: "Toilet Replacement",
                low: "$300",
                mid: "$550",
                high: "$900",
                notes: "Includes removal of old toilet, new standard two-piece unit, wax ring, and supply line. Higher end for wall-mounted or comfort-height models.",
              },
              {
                job: "Drain Cleaning (Snaking)",
                low: "$150",
                mid: "$275",
                high: "$450",
                notes: "Kitchen or bathroom drain. Higher end reflects main line or camera inspection.",
              },
              {
                job: "Faucet Installation",
                low: "$150",
                mid: "$250",
                high: "$400",
                notes: "Includes shutoff valves and supply lines. Price does not include the faucet itself.",
              },
              {
                job: "Sump Pump Replacement",
                low: "$500",
                mid: "$800",
                high: "$1,300",
                notes: "Includes new pump, check valve, and discharge line connection. Battery backup adds $200 to $400.",
              },
              {
                job: "Pipe Repair (burst or leaking)",
                low: "$250",
                mid: "$600",
                high: "$1,500",
                notes: "Highly variable depending on access, pipe material, and length of repair.",
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

          {/* What affects price */}
          <div className="mt-12">
            <h2 className="text-xl font-bold text-slate-900">What affects the price?</h2>
            <ul className="mt-4 flex flex-col gap-3">
              {[
                "Labour rate. Most plumbers in Canada charge $85 to $120 per hour.",
                "Access. Jobs behind walls, under slabs, or in tight spaces cost more.",
                "Materials. Fixtures and fittings vary widely in price.",
                "Emergency vs. scheduled. After-hours calls typically add 50% or more.",
                "Permits. Some jobs like water heater replacements require a permit, which adds $100 to $300.",
              ].map((item) => (
                <li key={item} className="flex gap-2 text-sm text-slate-600 leading-relaxed">
                  <span className="text-amber-500 shrink-0 mt-1">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Sample estimate */}
          <div className="mt-12">
            <h2 className="text-xl font-bold text-slate-900">Sample estimate: Water heater replacement</h2>
            <p className="mt-2 text-sm text-slate-500">This is what a professional plumbing estimate looks like for a mid-range water heater job.</p>

            <div className="mt-4 rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
              <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest text-amber-500">
                Estimate
              </span>
              <h3 className="mt-2 text-lg font-bold text-slate-900">Replace 50-Gallon Hot Water Heater</h3>
              <p className="text-xs text-slate-400 mt-1">Date: April 8, 2026</p>

              <p className="text-xs font-bold text-slate-900 uppercase tracking-wide mt-5 mb-2">Scope of Work</p>
              <ul className="flex flex-col gap-1.5">
                {[
                  "Remove and dispose of existing water heater",
                  "Install new Bradford White 50-gallon natural gas heater",
                  "Replace expansion tank",
                  "Connect gas and water lines, test for leaks",
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
                    ["Labour (3 hours @ $85/hr)", "$255"],
                    ["Bradford White 50-gal natural gas heater", "$680"],
                    ["Expansion tank", "$130"],
                    ["Fittings and connectors", "$45"],
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
                    ["Subtotal", "$1,110", false],
                    ["Tax (GST 5%)", "$56", false],
                    ["Total", "$1,166", true],
                    ["Deposit required (25%)", "$292", false],
                    ["Balance on completion", "$874", false],
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

          {/* CTA */}
          <div className="mt-12 rounded-2xl bg-slate-950 p-6 text-center">
            <p className="text-white font-bold text-lg">Are you a plumber?</p>
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
