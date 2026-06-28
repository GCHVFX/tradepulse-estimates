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
        .select("subscription_status, trial_ends_at, name, plan")
        .eq("owner_user_id", user.id)
        .maybeSingle()
    : { data: null };

  const isActive = business?.subscription_status === "active";
  const isTrialing =
    business?.subscription_status === "trial" &&
    business?.trial_ends_at &&
    new Date(business.trial_ends_at) > new Date();
  const isComplimentary = business?.subscription_status === "complimentary";
  const hasAccess = isActive || isTrialing || isComplimentary;

  if (!isPreview && hasAccess) redirect("/estimates");

  const trialExpired = business?.trial_ends_at
    ? new Date(business.trial_ends_at) < new Date()
    : true;

  const daysLeft = business?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(business.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  const neverHadTrial = business?.plan === "pro" && !business?.trial_ends_at;

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
            {neverHadTrial
              ? "Finish setting up Pro"
              : trialExpired
              ? "Your trial has ended"
              : `${daysLeft} days left in your trial`}
          </h1>
          <p className="text-zinc-400 text-sm mt-2">
            {neverHadTrial
              ? "Subscribe to start using TradePulse Pro."
              : trialExpired
              ? "Subscribe to keep creating estimates and sending quotes."
              : "Subscribe now to continue without interruption after your trial ends."}
          </p>
        </div>

        <div className="mb-4">
          <p className="text-zinc-400 text-sm mb-4 text-center">Cancel anytime from your profile.</p>

          <PlanPicker
            defaultPlan={business?.plan === "pro" ? "pro" : "starter"}
            disabled={isPreview}
          />
        </div>

        <p className="text-center text-zinc-500 text-xs">
          Powered by Stripe. Your payment is secure.
        </p>

        <p className="text-center text-zinc-400 text-sm mt-4">
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
