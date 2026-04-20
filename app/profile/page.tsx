import { redirect } from "next/navigation";
import { supabaseAdmin, createSupabaseServerClient } from "@/lib/supabase-server";
import { Logo } from "@/app/components/logo";
import { BottomNav } from "@/app/components/bottom-nav";
import { ProfileForm } from "@/app/components/profile-form";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabaseAdmin
    .from("tpe_businesses")
    .select("name, phone, email, logo_url, prepared_by, subscription_status, trial_ends_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const profile = {
    name: data?.name ?? "",
    phone: data?.phone ?? "",
    email: data?.email ?? "",
    logo_url: data?.logo_url ?? "",
    prepared_by: data?.prepared_by ?? "",
  };

  const nextPath = typeof next === "string" && next.startsWith("/") ? next : null;

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
      <header className="px-5 pt-10 pb-3 shrink-0">
        <Logo businessName={profile.name} />
        <h1 className="text-2xl font-bold mt-5">Profile</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Your business details appear on estimates.
        </p>
        {user.email && (
          <p className="text-zinc-600 text-xs mt-1">Signed in as {user.email}</p>
        )}
        {data?.subscription_status === "active" && (
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            Subscription active
          </span>
        )}
        {data?.subscription_status === "trial" && (
          <span className="inline-flex items-center gap-1.5 text-xs text-amber-400 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
            Free trial
          </span>
        )}
      </header>

      <main className="flex-1 px-5 pb-28">
        <ProfileForm
          profile={profile}
          userId={user.id}
          nextPath={nextPath}
          subscriptionStatus={data?.subscription_status ?? "trial"}
          trialEndsAt={data?.trial_ends_at ?? null}
        />
      </main>

      <div className="fixed bottom-0 left-0 right-0">
        <BottomNav />
      </div>
    </div>
  );
}
