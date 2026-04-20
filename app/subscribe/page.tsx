import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, supabaseAdmin } from "@/lib/supabase-server";

export default async function SubscribePage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("subscription_status, trial_ends_at, name")
    .eq("user_id", user.id)
    .maybeSingle();

  // Already active, send to app
  if (business?.subscription_status === "active") redirect("/new");

  const trialExpired = business?.trial_ends_at
    ? new Date(business.trial_ends_at) < new Date()
    : true;

  const daysLeft = business?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(business.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col items-center justify-center px-5 py-16">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-amber-500 flex items-center justify-center mx-auto mb-5">
            <svg viewBox="0 0 20 20" fill="none" className="w-7 h-7" aria-hidden="true">
              <path d="M9 2L4 9h4l-1 5 5-7H8l1-5z" fill="#09090b" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold">
            {trialExpired ? "Your trial has ended" : `${daysLeft} days left in your trial`}
          </h1>
          <p className="text-zinc-400 text-sm mt-2">
            {trialExpired
              ? "Subscribe to keep creating estimates and sending quotes."
              : "Subscribe now to continue without interruption after your trial ends."}
          </p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-4">
          <div className="flex items-end gap-2 mb-1">
            <span className="text-4xl font-bold">$39</span>
            <span className="text-zinc-500 mb-1">/month</span>
          </div>
          <p className="text-zinc-500 text-sm mb-6">Cancel anytime from your profile.</p>

          <ul className="space-y-2.5 mb-6">
            {[
              "Unlimited estimates",
              "SMS and email sending",
              "Custom rates and price book",
              "Your logo on estimates",
              "PDF download",
            ].map(feature => (
              <li key={feature} className="flex items-center gap-3 text-sm text-zinc-300">
                <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true">
                  <path d="M3 8l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {feature}
              </li>
            ))}
          </ul>

          <form action="/api/billing/checkout" method="POST">
            <button
              type="submit"
              className="w-full bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Subscribe, $39/month
            </button>
          </form>
        </div>

        <p className="text-center text-zinc-600 text-xs">
          Powered by Stripe. Your payment is secure.
        </p>

        <p className="text-center text-zinc-500 text-sm mt-4">
          Questions?{" "}
          <a href="mailto:support@trytradepulse.com" className="text-zinc-400 hover:text-zinc-300 transition-colors">
            support@trytradepulse.com
          </a>
        </p>

        {!trialExpired && (
          <div className="text-center mt-4">
            <Link href="/new" className="text-zinc-600 hover:text-zinc-400 text-sm transition-colors">
              Continue trial ({daysLeft} days remaining)
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
