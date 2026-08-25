import { redirect } from "next/navigation";
import { supabaseAdmin, createSupabaseServerClient } from "@/lib/supabase-server";
import { Logo } from "@/app/components/logo";
import { OnboardingForm } from "@/app/components/onboarding-form";

type BusinessSetup = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  prepared_by: string;
};

/**
 * Looks the business up. It never creates one.
 *
 * This page used to insert a tpe_businesses row with plan 'starter',
 * subscription_status 'trial' and no Stripe customer or subscription behind
 * it, which proxy.ts then honoured as a valid trial. Any authenticated
 * identity without a business could reach it and mint itself 14 days of
 * unbilled access. Accounts are created only by /api/auth/signup and by the
 * Google signup branch of /auth/callback, both of which provision Stripe
 * first through lib/account-provisioning.
 */
async function findBusiness(userId: string): Promise<BusinessSetup | null> {
  const { data, error } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, name, phone, email, logo_url, prepared_by")
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[onboarding] business lookup failed:", error.message);
    return null;
  }

  return data;
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  // The route is kept only so stale links stay safe. Signing out has to
  // happen on a real response, which a server component cannot produce, so
  // proxy.ts clears the session for a no-business identity before this
  // renders. These redirects are the backstop for anything that reaches here
  // anyway, including an unauthenticated visitor.
  if (!user) {
    redirect("/signup");
  }

  const business = await findBusiness(user.id);
  if (!business) {
    redirect("/signup?error=setup_required");
  }

  const nextPath = typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
    ? next
    : "/estimates";

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
      <header className="px-5 pt-10 pb-6 shrink-0">
        <Logo />
        <h1 className="text-2xl font-bold mt-5">Set up your business</h1>
        <p className="text-zinc-400 text-sm mt-1">
          These details appear on estimates, emails, and texts. You can update them later.
        </p>
        {user.email && (
          <p className="text-zinc-500 text-xs mt-2">Signed in as {user.email}</p>
        )}
      </header>

      <main className="flex-1 px-5 pb-10">
        <OnboardingForm
          businessId={business.id}
          nextPath={nextPath}
          profile={{
            name: business.name ?? "",
            phone: business.phone ?? "",
            email: business.email ?? "",
            logo_url: business.logo_url ?? "",
            prepared_by: business.prepared_by ?? "",
          }}
        />
      </main>
    </div>
  );
}
