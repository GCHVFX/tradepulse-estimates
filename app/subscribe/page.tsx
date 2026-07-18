import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient, supabaseAdmin } from "@/lib/supabase-server";
import { PlanPicker } from "@/app/components/plan-picker";

export default async function SubscribePage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const { preview } = await searchParams;
  const isPreview = preview === "true";

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!isPreview && !user) redirect("/login");

  const { data: business } = user
    ? await supabaseAdmin
        .from("tpe_businesses")
        .select("subscription_status, trial_ends_at, name, plan, stripe_customer_id, stripe_subscription_id")
        .eq("owner_user_id", user.id)
        .maybeSingle()
    : { data: null };

  const isActive = business?.subscription_status === "active";
  const isComplimentary = business?.subscription_status === "complimentary";

  const trialExpired = business?.trial_ends_at
    ? new Date(business.trial_ends_at) < new Date()
    : true;

  const daysLeft = business?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(business.trial_ends_at).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  const neverHadTrial = business?.plan === "pro" && !business?.trial_ends_at;
  const isStarter = business?.plan !== "pro";
  const isPro = business?.plan === "pro";
  const isPastDue = business?.subscription_status === "past_due";
  // Only offer the Stripe Portal when there is a subscription on file to manage.
  // A lapsed trial has a customer but no paid subscription; they need Checkout.
  const hasStripeSubscription = Boolean(business?.stripe_customer_id && business?.stripe_subscription_id);
  const needsPortal = isPastDue && hasStripeSubscription;
  const canManageBilling = hasStripeSubscription && (isActive || isPastDue);
  const showProOnly = (isActive && isStarter) || neverHadTrial;
  const proBillingReady = Boolean(process.env.STRIPE_PRO_PRICE_ID);
  const availablePlans: Array<"starter" | "pro"> = showProOnly
    ? proBillingReady ? ["pro"] : []
    : proBillingReady ? ["starter", "pro"] : ["starter"];
  const showPlanPicker = !isComplimentary && !(isActive && isPro) && !needsPortal && availablePlans.length > 0;
  const proOnlyUnavailable = showProOnly && !proBillingReady;

  const title = isComplimentary
    ? "You're all set"
    : isActive && isPro
    ? "You're on Pro"
    : isActive && isStarter
    ? "Upgrade to Pro"
    : needsPortal
    ? "Update your billing"
    : isPastDue
    ? "Subscribe to keep using TradePulse"
    : neverHadTrial
    ? "Finish setting up Pro"
    : trialExpired
    ? "Your trial has ended"
    : `${daysLeft} days left in your trial`;

  const description = isComplimentary
    ? "Your complimentary TradePulse access is active. No billing needed."
    : isActive && isPro
    ? "Manage or cancel your TradePulse Pro subscription from Stripe."
    : isActive && isStarter
    ? "Add photo estimates, review requests, and payment reminders."
    : needsPortal
    ? "Update your payment method in Stripe to keep using TradePulse."
    : isPastDue
    ? "Your trial has ended. Choose a plan to keep creating estimates and sending quotes."
    : neverHadTrial
    ? "Subscribe to start using TradePulse Pro."
    : trialExpired
    ? "Choose Starter or Pro to keep creating estimates and sending quotes."
    : "Choose Starter or Pro when you're ready. You can also keep using your trial until it ends.";

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col items-center justify-center px-5 py-16">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.png" alt="TradePulse" className="w-14 h-14 rounded-2xl mx-auto mb-5" />
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-zinc-400 text-sm mt-2">
            {description}
          </p>
        </div>

        <div className="mb-4">
          {showPlanPicker ? (
            <>
              <p className="text-zinc-400 text-sm mb-4 text-center">
                {proBillingReady
                  ? "Cancel anytime from your profile."
                  : "Pro checkout is not configured yet. Starter is available now."}
              </p>

              <PlanPicker
                defaultPlan={showProOnly ? "pro" : business?.plan === "pro" && proBillingReady ? "pro" : "starter"}
                availablePlans={availablePlans}
                submitAction={showProOnly ? "/api/billing/upgrade" : undefined}
                submitLabel={showProOnly ? "Upgrade to Pro, $69/month" : undefined}
                disabled={isPreview}
              />
            </>
          ) : (
            <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-6 text-center">
              <p className="text-white font-semibold">
                {proOnlyUnavailable ? "Pro billing is not ready" : needsPortal ? "Payment needs attention" : "No upgrade needed"}
              </p>
              <p className="text-zinc-400 text-sm mt-2">
                {proOnlyUnavailable
                  ? "Pro checkout is not configured yet. Email support if you need this upgrade right away."
                  : needsPortal
                  ? "Open Stripe to update your card or manage your subscription."
                  : "You already have every TradePulse feature."}
              </p>
            </div>
          )}
        </div>

        {canManageBilling && !isPreview && (
          <form action="/api/billing/portal" method="POST" className="mt-3">
            <button
              type="submit"
              className="w-full text-zinc-400 hover:text-zinc-300 text-sm py-3 transition-colors min-h-[44px]"
            >
              Manage or cancel subscription
            </button>
          </form>
        )}

        <p className="text-center text-zinc-500 text-xs mt-3">
          Powered by Stripe. Your payment is secure. Refund requests are handled manually by support.
        </p>

        <p className="text-center text-zinc-400 text-sm mt-4">
          Questions?{" "}
          <a href="mailto:support@trytradepulse.com" className="text-zinc-400 hover:text-zinc-300 transition-colors">
            support@trytradepulse.com
          </a>
        </p>

        {!trialExpired && !isActive && (
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
