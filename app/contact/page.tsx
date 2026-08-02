import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  CreditCard,
  FileText,
  LifeBuoy,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";

export const metadata: Metadata = {
  title: "TradePulse Support | Contact Us",
  description:
    "Get help with your TradePulse account, estimates, billing, refunds, or privacy and data requests.",
  alternates: { canonical: "https://trytradepulse.com/contact" },
};

const supportTopics = [
  {
    icon: LockKeyhole,
    title: "Sign-in or account trouble",
    description:
      "Tell us which email address you use for TradePulse and what happens when you try to sign in.",
    subject: "TradePulse account help",
  },
  {
    icon: FileText,
    title: "Estimate help",
    description:
      "Include the estimate title or reference and what you were trying to do. A screenshot is helpful when something looks wrong.",
    subject: "TradePulse estimate help",
  },
  {
    icon: CreditCard,
    title: "Billing or refund request",
    description:
      "Use the email address on your account. Refund requests for the first paid charge are reviewed manually through support.",
    subject: "TradePulse billing help",
  },
  {
    icon: ShieldCheck,
    title: "Privacy or data question",
    description:
      "Email us with a question about your account data or privacy. We will confirm what information is needed for your request.",
    subject: "TradePulse privacy or data question",
  },
] as const;

function supportHref(subject: string) {
  return `mailto:support@trytradepulse.com?subject=${encodeURIComponent(subject)}`;
}

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" aria-label="TradePulse home" className="inline-flex min-h-11 items-center">
            <Image
              src="/tradepulse-logo.png"
              alt="TradePulse Estimates"
              width={185}
              height={60}
              className="h-10 w-auto"
              priority
            />
          </Link>
          <div className="flex items-center gap-2 sm:gap-4">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center gap-2 px-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-950"
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

      <section className="relative overflow-hidden bg-[#0D1B2E] py-16 text-white sm:py-20">
        <div
          className="absolute inset-0 opacity-30"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.2) 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative mx-auto grid max-w-5xl gap-10 px-5 sm:px-8 md:grid-cols-[1.1fr_0.9fr] md:items-center">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-slate-200">
              <LifeBuoy className="h-4 w-4 text-amber-400" aria-hidden="true" />
              TradePulse support
            </div>
            <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
              Get help and get back to the job.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-300">
              Email us about your account, an estimate, billing, or a privacy question. Include a little context so we can understand the problem.
            </p>
            <a
              href={supportHref("TradePulse support request")}
              className="mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 text-base font-bold text-[#0D1B2E] transition-colors hover:bg-amber-400"
            >
              <Mail className="h-5 w-5" aria-hidden="true" />
              Email support
            </a>
            <p className="mt-4 text-sm text-slate-400">support@trytradepulse.com</p>
          </div>

          <aside className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Before you email</p>
            <h2 className="mt-3 text-xl font-bold">Include these details</h2>
            <ul className="mt-5 space-y-4 text-sm leading-relaxed text-slate-300">
              {[
                "The email address on your TradePulse account",
                "What you were trying to do",
                "What happened instead, including any error message",
                "A screenshot when the problem is visual",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-6 border-t border-white/10 pt-5 text-xs leading-relaxed text-slate-400">
              Never send your password or full payment-card details by email.
            </p>
          </aside>
        </div>
      </section>

      <section className="py-14 sm:py-18">
        <div className="mx-auto max-w-5xl px-5 sm:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">What do you need help with?</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Choose the closest topic</h2>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              Each option starts an email with a useful subject line. You can still describe anything else in your message.
            </p>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {supportTopics.map((topic) => {
              const Icon = topic.icon;

              return (
                <a
                  key={topic.title}
                  href={supportHref(topic.subject)}
                  className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg hover:shadow-slate-200/60"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-5 text-lg font-bold text-slate-950">{topic.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{topic.description}</p>
                  <span className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-[#0D1B2E] underline decoration-amber-500 decoration-2 underline-offset-4">
                    Email about this
                  </span>
                </a>
              );
            })}
          </div>

          <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div>
              <h2 className="text-xl font-bold text-slate-950">Trying to access your account?</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
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

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-slate-500 sm:flex-row sm:px-8">
          <p>TradePulse · British Columbia, Canada</p>
          <nav className="flex flex-wrap items-center justify-center gap-5">
            <Link href="/" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-900">Home</Link>
            <Link href="/terms" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-900">Terms</Link>
            <Link href="/privacy" className="inline-flex min-h-11 items-center transition-colors hover:text-slate-900">Privacy</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
