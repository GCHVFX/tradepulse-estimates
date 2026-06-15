import Link from "next/link";

export const metadata = {
  title: "Terms of Service — TradePulse",
  description: "The terms that govern your use of TradePulse.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-3xl mx-auto px-5 py-12">
        <Link
          href="/"
          className="text-sm text-zinc-400 hover:text-white"
        >
          ← Back to TradePulse
        </Link>

        <h1 className="text-2xl font-bold mt-8">Terms of Service</h1>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          <strong className="text-white">TradePulse</strong>
          <br />
          Effective date: June 15, 2026
          <br />
          Last updated: June 15, 2026
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          TradePulse is operated as a sole proprietorship by Greg Hansen, based
          in British Columbia, Canada. By creating an account or using
          TradePulse, you agree to these terms.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          1. The Service
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          TradePulse provides tools for contractors and tradespeople to create
          estimates, collect payments, request reviews, and manage customer
          follow-up. The service is available via subscription.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          2. Your Account
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          You are responsible for keeping your login credentials secure. You are
          responsible for all activity that occurs under your account. You must
          be 18 years of age or older to use TradePulse.
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          You agree not to:
        </p>

        <ul className="text-zinc-300 text-sm leading-relaxed mt-4 list-disc pl-5 space-y-1">
          <li>Share your account with other people</li>
          <li>Use TradePulse for any unlawful purpose</li>
          <li>Attempt to access other users' data</li>
          <li>Reverse engineer or copy any part of the service</li>
        </ul>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          3. Subscriptions and Billing
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          TradePulse offers a 14-day free trial with no credit card required.
          After the trial, continued use requires a paid subscription.
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          Subscriptions are billed monthly. You can cancel at any time.
          Cancellation takes effect at the end of the current billing period. We
          do not offer refunds for partial months.
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          Prices are listed in Canadian dollars and may change with 30 days
          notice.
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          Payments are processed by Stripe. By subscribing, you also agree to
          Stripe's terms of service.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          4. Your Data
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          You own your data. The estimates, customer information, and business
          details you create in TradePulse belong to you.
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          By using TradePulse, you grant us a limited licence to store, process,
          and transmit your data solely for the purpose of providing the service
          to you.
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          We do not sell your data or use your customer information for any
          purpose other than operating TradePulse on your behalf.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          5. AI-Generated Content
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          TradePulse uses AI to generate estimate content. AI-generated estimates
          are a starting point. You are responsible for reviewing all estimates
          before sending them to customers. We make no guarantee that
          AI-generated content is accurate, complete, or appropriate for any
          specific job.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          6. Acceptable Use
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          TradePulse is for legitimate business use by contractors and
          tradespeople. You agree not to use TradePulse to send spam, harass
          customers, or conduct any fraudulent activity.
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          We reserve the right to suspend or terminate accounts that violate
          these terms.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          7. Availability
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          We aim to keep TradePulse available at all times but do not guarantee
          uninterrupted access. We may perform maintenance, updates, or
          experience outages. We are not liable for losses caused by downtime.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          8. Limitation of Liability
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          TradePulse is provided as-is. To the maximum extent permitted by law,
          Greg Hansen and TradePulse are not liable for any indirect, incidental,
          or consequential damages arising from your use of the service,
          including lost revenue, lost customers, or errors in AI-generated
          estimates.
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          Our total liability to you for any claim arising from use of TradePulse
          is limited to the amount you paid us in the 30 days before the claim
          arose.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          9. Termination
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          You can cancel your account at any time by contacting{" "}
          <a
            href="mailto:support@trytradepulse.com"
            className="text-white underline"
          >
            support@trytradepulse.com
          </a>{" "}
          or through the billing settings in the app.
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          We may suspend or terminate your account if you violate these terms,
          with or without notice.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          10. Governing Law
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          These terms are governed by the laws of British Columbia, Canada. Any
          disputes will be resolved in the courts of British Columbia.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          11. Changes to These Terms
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          We may update these terms from time to time. We will notify you of
          material changes by email. Continued use of TradePulse after changes
          are posted constitutes acceptance of the updated terms.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          12. Contact
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          Greg Hansen
          <br />
          TradePulse
          <br />
          <a
            href="mailto:support@trytradepulse.com"
            className="text-white underline"
          >
            support@trytradepulse.com
          </a>
          <br />
          British Columbia, Canada
        </p>
      </div>
    </div>
  );
}
