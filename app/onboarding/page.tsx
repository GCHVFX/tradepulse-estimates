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
  google_review_link: string | null;
};

async function getOrCreateBusiness(userId: string): Promise<BusinessSetup | null> {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, name, phone, email, logo_url, prepared_by, google_review_link")
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (existingError) {
    console.error("[onboarding] business lookup failed:", existingError.message);
    return null;
  }

  if (existing) return existing;

  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: created, error: createError } = await supabaseAdmin
    .from("tpe_businesses")
    .insert({
      owner_user_id: userId,
      name: "",
      slug: userId,
      plan: "starter",
      subscription_status: "trial",
      trial_ends_at: trialEndsAt,
    })
    .select("id, name, phone, email, logo_url, prepared_by, google_review_link")
    .single();

  if (createError) {
    console.error("[onboarding] business create failed:", createError.message);
    return null;
  }

  return created;
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/onboarding");
  }

  const business = await getOrCreateBusiness(user.id);
  if (!business) {
    redirect("/login?error=business_setup_failed");
  }

  const nextPath = typeof next === "string" && next.startsWith("/") ? next : "/estimates";

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
            google_review_link: business.google_review_link ?? "",
          }}
        />
      </main>
    </div>
  );
}
