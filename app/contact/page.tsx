import type { Metadata } from "next";
import Link from "next/link";
import { RowLockup } from "@/app/components/wordmark";
import {
  ArrowLeft,
  ChevronRight,
  CreditCard,
  FileText,
  HelpCircle,
  LifeBuoy,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { CopyEmailButton } from "@/app/components/CopyEmailButton";
import { CANONICAL_URL } from "@/lib/site-url";
import { SUPPORT_EMAIL } from "@/lib/email-addresses";


export const metadata: Metadata = {
  title: "TradePulse Support | Contact Us",
  description:
    "Get help with your TradePulse account, estimates, billing, refunds, or privacy and data requests.",
  alternates: { canonical: `${CANONICAL_URL}/contact` },
};

const supportTopics = [
  {
    icon: LockKeyhole,
    title: "Sign-in or account trouble",
    description: "Trouble signing in or accessing your account.",
    subject: "TradePulse sign-in or account help",
    body: "Tell us the email address on your account and what happens when you try to sign in.",
  },
  {
    icon: FileText,
    title: "Estimate help",
    description: "Questions about a specific estimate.",
    subject: "TradePulse estimate help",
    body: "Include the estimate title and what you were trying to do.",
  },
  {
    icon: CreditCard,
    title: "Billing or refund request",
    description: "Billing, subscription, or refund questions.",
    subject: "TradePulse billing or refund request",
    body: "Include the email address on your account.",
  },
  {
    icon: ShieldCheck,
    title: "Privacy or data question",
    description: "Questions about your account data or privacy.",
    subject: "TradePulse privacy or data question",
    body: "Describe your privacy or data question.",
  },
  {
    icon: HelpCircle,
    title: "Something else",
    description: "Anything else we can help with.",
    subject: "TradePulse support question",
    body: "",
  },
] as const;

function supportHref(subject: string, body?: string) {
  // encodeURIComponent, not URLSearchParams: mailto URIs (RFC 6068) don't
  // treat "+" as a space the way HTML form encoding does, so %20 is the
  // safe choice across mail clients.
  const params = [`subject=${encodeURIComponent(subject)}`];
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${SUPPORT_EMAIL}?${params.join("&")}`;
}

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-[#F3E8D0] text-[#26211B]">
      <header className="border-b border-[#C9B384] bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-2.5 sm:px-8 sm:py-3">
          <Link href="/" aria-label="TradePulse home" className="inline-flex min-h-11 items-center">
            <RowLockup variant="light" iconSize={44} textSize={36} />
          </Link>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center gap-2 px-2 text-sm font-semibold text-[#5C4A2E] transition-colors hover:text-[#26211B]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Back home</span>
              <span className="sm:hidden">Home</span>
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#0D1B2E] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-[#0D1B2E] py-6 text-white sm:py-14">
        <div
          className="absolute inset-0 opacity-30"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.2) 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative mx-auto grid max-w-5xl gap-4 px-5 sm:gap-8 sm:px-8 md:grid-cols-[1.1fr_0.9fr] md:items-center">
          <div className="max-w-2xl">
            <div className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest sm:inline-flex" style={{ color: "#9A8F79" }}>
              <LifeBuoy className="h-4 w-4 text-amber-400" aria-hidden="true" />
              TradePulse support
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:mt-6 sm:text-4xl lg:text-5xl">
              Get help and get back to the job.
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed sm:mt-5 sm:text-lg" style={{ color: "#F7F2E9" }}>
              Email us about your account, an estimate, billing, or a privacy question. Include a little context so we can understand the problem.
            </p>
            <a
              href={supportHref("TradePulse support request")}
              className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 text-sm font-bold text-[#0D1B2E] transition-colors hover:bg-amber-400 sm:mt-8 sm:min-h-12 sm:text-base"
            >
              <Mail className="h-5 w-5" aria-hidden="true" />
              Email support
            </a>
            <p className="mt-2 text-xs sm:mt-4 sm:text-sm" style={{ color: "#9A8F79" }}>{SUPPORT_EMAIL}</p>
            <p className="mt-2 text-xs leading-relaxed sm:hidden" style={{ color: "#9A8F79" }}>
              Include your account email, what happened, and a screenshot if useful. Never send your password by email.
            </p>
          </div>

          <aside className="hidden rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm sm:block sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Before you email</p>
            <h2 className="mt-2 text-lg font-bold">Include these details</h2>
            <ul className="mt-3 space-y-1.5 text-sm leading-relaxed" style={{ color: "#F7F2E9" }}>
              <li className="flex gap-2">
                <span className="text-amber-500 shrink-0 mt-1">•</span>
                The email address on your account
              </li>
              <li className="flex gap-2">
                <span className="text-amber-500 shrink-0 mt-1">•</span>
                What you were trying to do
              </li>
              <li className="flex gap-2">
                <span className="text-amber-500 shrink-0 mt-1">•</span>
                What happened instead, including any error message
              </li>
              <li className="flex gap-2">
                <span className="text-amber-500 shrink-0 mt-1">•</span>
                A screenshot, if the problem is visual
              </li>
            </ul>
            <p className="mt-4 border-t border-white/10 pt-3 text-xs leading-relaxed" style={{ color: "#9A8F79" }}>
              Never send your password or full payment-card details by email.
            </p>
          </aside>
        </div>
      </section>

      <section className="py-4 sm:py-10">
        <div className="mx-auto max-w-5xl px-5 sm:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#5C4A2E]">What do you need help with?</p>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-[#26211B] sm:mt-1.5 sm:text-3xl">Choose the closest topic</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[#5C4A2E] sm:mt-2 sm:text-base">
              Each option starts an email with a useful subject line. You can still describe anything else in your message.
            </p>
          </div>

          <div className="mt-3 grid gap-3 sm:mt-5 sm:grid-cols-2">
            {supportTopics.map((topic) => {
              const Icon = topic.icon;

              return (
                <a
                  key={topic.title}
                  href={supportHref(topic.subject, topic.body)}
                  className="group flex min-h-11 touch-manipulation items-center gap-4 rounded-xl border border-[#C9B384] bg-white px-4 py-3 transition hover:bg-[#EADCC0] active:bg-[#EADCC0]"
                >
                  <span className="pointer-events-none flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="pointer-events-none min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[#26211B]">{topic.title}</span>
                    <span className="block text-xs text-[#5C4A2E]">{topic.description}</span>
                  </span>
                  <span className="pointer-events-none hidden shrink-0 items-center gap-1 text-xs font-semibold text-[#0D1B2E] sm:inline-flex">
                    Email support
                  </span>
                  <ChevronRight className="pointer-events-none h-4 w-4 shrink-0 text-[#5C4A2E] transition group-hover:text-[#26211B]" aria-hidden="true" />
                </a>
              );
            })}
          </div>

          <div className="mt-6 rounded-xl border border-[#C9B384] bg-white px-4 py-4 sm:px-6">
            <p className="text-sm font-semibold text-[#26211B]">Can&apos;t open your email app?</p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="mt-1 inline-block min-h-11 touch-manipulation text-sm font-medium text-[#0D1B2E] underline decoration-amber-500 decoration-2 underline-offset-4"
            >
              {SUPPORT_EMAIL}
            </a>
            <div className="mt-3">
              <CopyEmailButton />
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-[#C9B384] bg-white p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div>
              <h2 className="text-xl font-bold text-[#26211B]">Trying to access your account?</h2>
              <p className="mt-2 text-sm leading-relaxed text-[#5C4A2E]">
                Open the sign-in page. If you cannot remember your password, choose <strong>Forgot password?</strong> there.
              </p>
            </div>
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#0D1B2E] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Sign in or reset password
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#C9B384] bg-white">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-[#5C4A2E] sm:flex-row sm:px-8">
          <p>TradePulse · British Columbia, Canada</p>
          <nav className="flex flex-wrap items-center justify-center gap-5">
            <Link href="/" className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-[#26211B]">Home</Link>
            <Link href="/terms" className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-[#26211B]">Terms</Link>
            <Link href="/privacy" className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-[#26211B]">Privacy</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
