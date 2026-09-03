import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/email-addresses";

export const metadata = {
  title: "Privacy Policy — TradePulse",
  description: "How TradePulse collects, uses, and protects your information.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white text-[#26211B]">
      <div className="max-w-3xl mx-auto px-5 py-12">
        <Link
          href="/"
          className="text-sm text-[#5C4A2E] hover:text-[#26211B] transition-colors"
        >
          ← Back to TradePulse
        </Link>

        <h1 className="text-2xl font-bold mt-8 text-[#26211B]">Privacy Policy</h1>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          <strong className="text-[#26211B]">TradePulse</strong>
          <br />
          Effective date: June 15, 2026
          <br />
          Last updated: July 18, 2026
        </p>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          TradePulse is operated as a sole proprietorship by Greg Hansen, based
          in British Columbia, Canada. This policy explains what information we
          collect, how we use it, and your rights regarding it.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-[#26211B]">
          What We Collect
        </h2>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          <strong className="text-[#26211B]">Account information</strong>
          <br />
          When you create an account, we collect your email address and password
          (stored as a secure hash). If you sign in with Google, we receive your
          name and email address from Google. Your password is not shared with
          us in this case.
        </p>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          <strong className="text-[#26211B]">Business profile information</strong>
          <br />
          Information you choose to provide: business name, phone number, company
          logo, and payment link.
        </p>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          <strong className="text-[#26211B]">Customer data</strong>
          <br />
          Information you enter when creating estimates: customer names, phone
          numbers, email addresses, and job addresses. This data belongs to you.
          We store it on your behalf so you can access your estimates.
        </p>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          <strong className="text-[#26211B]">Usage data</strong>
          <br />
          We use PostHog to collect anonymized analytics about how the app is
          used (pages visited, features clicked, session duration). We use Sentry
          to collect error reports when the app crashes or behaves unexpectedly.
          Neither tool collects personally identifiable information beyond what is
          necessary to diagnose issues. We use your approximate location, derived
          from your IP address, to determine whether to display Canadian-specific
          content on our marketing pages. We do not store this location data.
        </p>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          <strong className="text-[#26211B]">Payment information</strong>
          <br />
          Payments are processed by Stripe. We do not store or have access to
          your credit card number or banking details. Stripe&apos;s privacy
          policy applies to payment data.
        </p>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          <strong className="text-[#26211B]">Photos</strong>
          <br />
          If you use the camera or photo upload feature on an estimate, those
          photos are sent to Anthropic for AI analysis and are not stored by
          TradePulse. If you choose to attach photos to a saved estimate
          instead, those photos are stored in our cloud storage on your behalf.
        </p>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          <strong className="text-[#26211B]">Voice recordings</strong>
          <br />
          If you use voice dictation, your recording is sent to
          Google&apos;s Gemini API for transcription into text. TradePulse
          does not store the audio recording itself.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-[#26211B]">
          How We Use Your Information
        </h2>

        <ul className="text-[#5C4A2E] text-sm leading-relaxed mt-4 list-disc pl-5 space-y-1">
          <li>To provide and operate the TradePulse service</li>
          <li>
            To send you transactional emails (estimate confirmations, payment
            reminders, account notices)
          </li>
          <li>To diagnose and fix technical problems</li>
          <li>To improve the product based on usage patterns</li>
        </ul>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          We do not sell your data. We do not share your data with third parties
          except as described in this policy.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-[#26211B]">
          Third-Party Services
        </h2>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          TradePulse uses the following third-party services to operate:
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#C9B384]">
                <th className="text-left font-semibold text-[#26211B] pb-1.5 pr-4">
                  Service
                </th>
                <th className="text-left font-semibold text-[#26211B] pb-1.5">
                  Purpose
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#C9B384]">
              <tr>
                <td className="py-2 pr-4 text-[#5C4A2E]">Supabase</td>
                <td className="py-2 text-[#5C4A2E]">
                  Database and authentication
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-[#5C4A2E]">Google</td>
                <td className="py-2 text-[#5C4A2E]">
                  Sign-in authentication
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-[#5C4A2E]">Stripe</td>
                <td className="py-2 text-[#5C4A2E]">
                  Payment processing
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-[#5C4A2E]">Twilio</td>
                <td className="py-2 text-[#5C4A2E]">
                  SMS delivery
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-[#5C4A2E]">Resend</td>
                <td className="py-2 text-[#5C4A2E]">
                  Email delivery
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-[#5C4A2E]">PostHog</td>
                <td className="py-2 text-[#5C4A2E]">
                  Product analytics
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-[#5C4A2E]">Sentry</td>
                <td className="py-2 text-[#5C4A2E]">
                  Error monitoring
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-[#5C4A2E]">Anthropic</td>
                <td className="py-2 text-[#5C4A2E]">
                  AI estimate generation, photo analysis
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-[#5C4A2E]">Google Gemini</td>
                <td className="py-2 text-[#5C4A2E]">
                  Voice dictation transcription
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-[#5C4A2E]">Google Places</td>
                <td className="py-2 text-[#5C4A2E]">
                  Business search for review link lookup
                </td>
              </tr>
              <tr>
                <td className="py-2 pr-4 text-[#5C4A2E]">Vercel</td>
                <td className="py-2 text-[#5C4A2E]">
                  Hosting and deployment
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          Each of these services has its own privacy policy. Your data may be
          stored on servers in the United States or other jurisdictions outside
          Canada.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-[#26211B]">
          Data Retention
        </h2>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          We retain your account and estimate data for as long as your account is
          active. If you delete your account, we will delete your personal
          information within 30 days, except where we are required to retain it
          for legal or tax purposes.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-[#26211B]">
          Your Rights
        </h2>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          You have the right to:
        </p>

        <ul className="text-[#5C4A2E] text-sm leading-relaxed mt-4 list-disc pl-5 space-y-1">
          <li>Access the personal information we hold about you</li>
          <li>Correct inaccurate information</li>
          <li>Request deletion of your account and data</li>
          <li>Export your data</li>
        </ul>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          To exercise any of these rights, email us at{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-[#26211B] underline"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-[#26211B]">Children</h2>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          TradePulse is not intended for use by anyone under the age of 18. We do
          not knowingly collect information from minors.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-[#26211B]">
          Changes to This Policy
        </h2>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          We may update this policy from time to time. We will notify you of
          material changes by email or by posting a notice in the app. Continued
          use of TradePulse after changes are posted constitutes acceptance of
          the updated policy.
        </p>

        <h2 className="text-lg font-semibold mt-8 mb-2 text-[#26211B]">Contact</h2>

        <p className="text-[#5C4A2E] text-sm leading-relaxed mt-4">
          Greg Hansen
          <br />
          TradePulse
          <br />
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-[#26211B] underline"
          >
            {SUPPORT_EMAIL}
          </a>
          <br />
          British Columbia, Canada
        </p>
      </div>
    </div>
  );
}
