import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — TradePulse",
  description: "How TradePulse collects, uses, and protects your information.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-3xl mx-auto px-5 py-12">
        <Link
          href="/"
          className="text-sm text-zinc-400 hover:text-white"
        >
          ← Back to TradePulse
        </Link>

        <h1 className="text-2xl font-bold mt-8">Privacy Policy</h1>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          <strong className="text-white">TradePulse</strong>
          <br />
          Effective date: June 15, 2026
          <br />
          Last updated: July 18, 2026
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          TradePulse is operated as a sole proprietorship by Greg Hansen, based
          in British Columbia, Canada. This policy explains what information we
          collect, how we use it, and your rights regarding it.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          What We Collect
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          <strong className="text-white">Account information</strong>
          <br />
          When you create an account, we collect your email address and password
          (stored as a secure hash).
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          <strong className="text-white">Business profile information</strong>
          <br />
          Information you choose to provide: business name, phone number, company
          logo, and payment link.
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          <strong className="text-white">Customer data</strong>
          <br />
          Information you enter when creating estimates: customer names, phone
          numbers, email addresses, and job addresses. This data belongs to you.
          We store it on your behalf so you can access your estimates.
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          <strong className="text-white">Usage data</strong>
          <br />
          We use PostHog to collect anonymized analytics about how the app is
          used (pages visited, features clicked, session duration). We use Sentry
          to collect error reports when the app crashes or behaves unexpectedly.
          Neither tool collects personally identifiable information beyond what is
          necessary to diagnose issues.
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          <strong className="text-white">Payment information</strong>
          <br />
          Payments are processed by Stripe. We do not store or have access to
          your credit card number or banking details. Stripe&apos;s privacy
          policy applies to payment data.
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          <strong className="text-white">Photos</strong>
          <br />
          If you use the camera or photo upload feature on an estimate, those
          photos are sent to Anthropic for AI analysis and are not stored by
          TradePulse. If you choose to attach photos to a saved estimate
          instead, those photos are stored in our cloud storage on your behalf.
        </p>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          <strong className="text-white">Voice recordings</strong>
          <br />
          If you use voice dictation, your recording is sent to
          Google&apos;s Gemini API for transcription into text. TradePulse
          does not store the audio recording itself.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          How We Use Your Information
        </h2>

        <ul className="text-zinc-300 text-sm leading-relaxed mt-4 list-disc pl-5 space-y-1">
          <li>To provide and operate the TradePulse service</li>
          <li>
            To send you transactional emails (estimate confirmations, payment
            reminders, account notices)
          </li>
          <li>To diagnose and fix technical problems</li>
          <li>To improve the product based on usage patterns</li>
        </ul>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          We do not sell your data. We do not share your data with third parties
          except as described in this policy.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          Third-Party Services
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          TradePulse uses the following third-party services to operate:
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border border-zinc-800 text-sm text-zinc-300 border-collapse">
            <thead>
              <tr>
                <th className="border border-zinc-800 px-3 py-2 text-left font-semibold text-white">
                  Service
                </th>
                <th className="border border-zinc-800 px-3 py-2 text-left font-semibold text-white">
                  Purpose
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-zinc-800 px-3 py-2">Supabase</td>
                <td className="border border-zinc-800 px-3 py-2">
                  Database and authentication
                </td>
              </tr>
              <tr>
                <td className="border border-zinc-800 px-3 py-2">Stripe</td>
                <td className="border border-zinc-800 px-3 py-2">
                  Payment processing
                </td>
              </tr>
              <tr>
                <td className="border border-zinc-800 px-3 py-2">Twilio</td>
                <td className="border border-zinc-800 px-3 py-2">
                  SMS delivery
                </td>
              </tr>
              <tr>
                <td className="border border-zinc-800 px-3 py-2">Resend</td>
                <td className="border border-zinc-800 px-3 py-2">
                  Email delivery
                </td>
              </tr>
              <tr>
                <td className="border border-zinc-800 px-3 py-2">PostHog</td>
                <td className="border border-zinc-800 px-3 py-2">
                  Product analytics
                </td>
              </tr>
              <tr>
                <td className="border border-zinc-800 px-3 py-2">Sentry</td>
                <td className="border border-zinc-800 px-3 py-2">
                  Error monitoring
                </td>
              </tr>
              <tr>
                <td className="border border-zinc-800 px-3 py-2">Anthropic</td>
                <td className="border border-zinc-800 px-3 py-2">
                  AI estimate generation, photo analysis
                </td>
              </tr>
              <tr>
                <td className="border border-zinc-800 px-3 py-2">Google Gemini</td>
                <td className="border border-zinc-800 px-3 py-2">
                  Voice dictation transcription
                </td>
              </tr>
              <tr>
                <td className="border border-zinc-800 px-3 py-2">Google Places</td>
                <td className="border border-zinc-800 px-3 py-2">
                  Business search for review link lookup
                </td>
              </tr>
              <tr>
                <td className="border border-zinc-800 px-3 py-2">Vercel</td>
                <td className="border border-zinc-800 px-3 py-2">
                  Hosting and deployment
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          Each of these services has its own privacy policy. Your data may be
          stored on servers in the United States or other jurisdictions outside
          Canada.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          Data Retention
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          We retain your account and estimate data for as long as your account is
          active. If you delete your account, we will delete your personal
          information within 30 days, except where we are required to retain it
          for legal or tax purposes.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          Your Rights
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          You have the right to:
        </p>

        <ul className="text-zinc-300 text-sm leading-relaxed mt-4 list-disc pl-5 space-y-1">
          <li>Access the personal information we hold about you</li>
          <li>Correct inaccurate information</li>
          <li>Request deletion of your account and data</li>
          <li>Export your data</li>
        </ul>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          To exercise any of these rights, email us at{" "}
          <a
            href="mailto:support@trytradepulse.com"
            className="text-white underline"
          >
            support@trytradepulse.com
          </a>
          .
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">Children</h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          TradePulse is not intended for use by anyone under the age of 18. We do
          not knowingly collect information from minors.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">
          Changes to This Policy
        </h2>

        <p className="text-zinc-300 text-sm leading-relaxed mt-4">
          We may update this policy from time to time. We will notify you of
          material changes by email or by posting a notice in the app. Continued
          use of TradePulse after changes are posted constitutes acceptance of
          the updated policy.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-white">Contact</h2>

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
