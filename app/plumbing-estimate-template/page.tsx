import type { Metadata } from "next";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PLUMBING_ESTIMATE_TEMPLATE } from "./content";

export const metadata: Metadata = {
  title: "Plumbing Estimate Template: How to Write Quotes That Close Jobs",
  description:
    "Professional plumbing estimate template with step-by-step guide. See exactly what to include in a quote: scope, line items, payment terms, assumptions. Built for plumbers.",
  alternates: { canonical: "https://trytradepulse.com/plumbing-estimate-template" },
  openGraph: {
    title: "Plumbing Estimate Template: How to Write Quotes That Close Jobs",
    description:
      "Professional plumbing estimate template with step-by-step guide. See exactly what to include in a quote: scope, line items, payment terms, assumptions. Built for plumbers.",
    url: "https://trytradepulse.com/plumbing-estimate-template",
    siteName: "TradePulse",
    images: [{ url: "https://trytradepulse.com/opengraph-image.png", width: 1200, height: 630, alt: "TradePulse Estimates" }],
    locale: "en_CA",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "Plumbing Estimate Template: How to Write Quotes That Close Jobs",
    description:
      "Professional plumbing estimate template with step-by-step guide. See exactly what to include in a quote: scope, line items, payment terms, assumptions.",
    images: ["https://trytradepulse.com/opengraph-image.png"],
  },
};

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-3xl sm:text-4xl font-bold leading-tight tracking-tight text-white mt-10 mb-5 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2
      className="text-xl sm:text-2xl font-bold text-white mt-12 mb-4 pl-3"
      style={{ borderLeft: "3px solid #f59e0b" }}
    >
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-lg font-semibold text-white mt-8 mb-2">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-slate-300 leading-relaxed mb-4">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-5 space-y-2 pl-1">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-5 space-y-2 pl-1 list-decimal list-inside text-slate-300">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="text-slate-300 leading-relaxed flex gap-2">
      <span className="text-amber-500 mt-1 shrink-0">•</span>
      <span>{children}</span>
    </li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-white">{children}</strong>
  ),
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href} className="text-amber-500 font-medium underline underline-offset-2 hover:text-amber-400 transition-colors">
      {children}
    </a>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="mb-6 overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-white/5">{children}</thead>
  ),
  th: ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) => (
    <th
      className="px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap"
      style={{ textAlign: style?.textAlign ?? "left" }}
    >
      {children}
    </th>
  ),
  td: ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) => (
    <td
      className="px-3 py-2.5 border-t border-white/10 text-slate-300 whitespace-nowrap"
      style={{ textAlign: style?.textAlign ?? "left" }}
    >
      {children}
    </td>
  ),
  hr: () => <hr className="border-white/10 my-8" />,
};

export default function PlumbingEstimateTemplatePage() {
  return (
    <div className="min-h-dvh bg-[#0D1B2E] flex flex-col font-[family-name:var(--font-dm-sans)]">
      <main className="flex-1 flex flex-col items-center px-6 pt-12 pb-24">
        <article className="w-full max-w-2xl">
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200 transition-colors mb-8">
            ← Back to TradePulse
          </Link>

          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {PLUMBING_ESTIMATE_TEMPLATE}
          </ReactMarkdown>

          {/* Related links */}
          <div className="mt-12 border-t border-white/10 pt-8">
            <p className="text-sm font-semibold text-white uppercase tracking-wide">Keep reading</p>
            <ul className="mt-4 space-y-2">
              <li>
                <Link href="/plumbers" className="text-amber-500 font-medium underline underline-offset-2 hover:text-amber-400 transition-colors">
                  TradePulse for plumbers
                </Link>
              </li>
              <li>
                <Link href="/plumbing-cost" className="text-amber-500 font-medium underline underline-offset-2 hover:text-amber-400 transition-colors">
                  How much does a plumber cost in 2026?
                </Link>
              </li>
              <li>
                <Link href="/" className="text-amber-500 font-medium underline underline-offset-2 hover:text-amber-400 transition-colors">
                  TradePulse home
                </Link>
              </li>
            </ul>
          </div>

          {/* CTA */}
          <div className="mt-12 rounded-2xl bg-white/5 border border-white/10 p-6 text-center">
            <p className="text-white font-bold text-lg">Stop writing estimates from scratch</p>
            <p className="text-slate-400 text-sm mt-2">
              Turn a job description into a professional estimate in seconds. Send it from your phone before you leave the driveway.
            </p>
            <Link
              href="/signup"
              className="inline-flex mt-5 items-center justify-center rounded-2xl px-8 py-4 text-base font-bold transition-opacity hover:opacity-90 w-full"
              style={{ backgroundColor: "#f59e0b", color: "#0D1B2E" }}
            >
              Create Your Estimate Free
            </Link>
            <p className="text-slate-600 text-xs mt-3">14-day free trial. No credit card required.</p>
          </div>
        </article>
      </main>

      <footer className="text-center py-8 text-sm text-slate-500">
        TradePulse Estimates,{" "}
        <a href="https://trytradepulse.com" className="hover:text-slate-300 transition-colors">
          trytradepulse.com
        </a>
      </footer>
    </div>
  );
}
