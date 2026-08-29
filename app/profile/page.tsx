import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin, createSupabaseServerClient } from "@/lib/supabase-server";
import { Logo } from "@/app/components/logo";
import { BottomNav } from "@/app/components/bottom-nav";
import { DeleteAccountSection } from "@/app/components/delete-account-section";
import { ProfileForm } from "@/app/components/profile-form";
import { resolveProfileBadge, type ProfileBadgeCopy } from "@/lib/subscription-display";
import { resolveSubscriptionStatus, SUBSCRIPTION_ACCESS_COLUMNS } from "@/lib/subscription-access";

// Tailwind needs each class name to appear literally for its build-time
// scanner to pick it up -- string-interpolating "text-${colorClass}-400"
// would silently produce no styling in production, so this maps to full
// static class strings instead.
const BADGE_COLOR_CLASSES: Record<ProfileBadgeCopy["colorClass"], { dot: string; text: string }> = {
  emerald: { dot: "bg-emerald-400", text: "text-emerald-400" },
  amber: { dot: "bg-amber-400", text: "text-amber-400" },
  red: { dot: "bg-red-400", text: "text-red-400" },
  zinc: { dot: "bg-zinc-400", text: "text-zinc-400" },
};

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; section?: string }>;
}) {
  const { next, section } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabaseAdmin
    .from("tpe_businesses")
    .select(`id, name, phone, email, logo_url, prepared_by, google_review_link, payment_link, ${SUBSCRIPTION_ACCESS_COLUMNS}`)
    .eq("owner_user_id", user.id)
    .maybeSingle();

  const profile = {
    name: data?.name ?? "",
    phone: data?.phone ?? "",
    email: data?.email ?? "",
    logo_url: data?.logo_url ?? "",
    prepared_by: data?.prepared_by ?? "",
    google_review_link: data?.google_review_link ?? "",
    payment_link: data?.payment_link ?? "",
  };

  const nextPath = typeof next === "string" && next.startsWith("/") ? next : null;

  // The corrected status comes from lib/subscription-access.ts -- the same
  // function every access gate decides from, so this page cannot show a
  // state the gate disagrees with. Used for both the header badge below and
  // passed into ProfileForm, so the "Free Trial" upgrade card there (which
  // checks this same value) can't disagree with the badge either.
  const displaySubscriptionStatus = resolveSubscriptionStatus(
    data?.subscription_status,
    data?.plan,
    data?.stripe_subscription_id
  );
  const badge = resolveProfileBadge(data?.subscription_status, data?.plan, data?.stripe_subscription_id);

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
      <header className="px-5 pt-10 pb-3 shrink-0">
        <Logo />
        <h1 className="text-2xl font-bold mt-5">Profile</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Your business details appear on estimates.
        </p>
        {user.email && (
          <p className="text-zinc-400 text-xs mt-1">Signed in as {user.email}</p>
        )}
        {badge && (
          <span className={`inline-flex items-center gap-1.5 text-xs mt-0.5 ${BADGE_COLOR_CLASSES[badge.colorClass].text}`}>
            <span className={`w-1.5 h-1.5 rounded-full inline-block ${BADGE_COLOR_CLASSES[badge.colorClass].dot}`} />
            {badge.label}
          </span>
        )}
      </header>

      <main className="flex-1 px-5 pb-36">
        <ProfileForm
          profile={profile}
          userId={user.id}
          nextPath={nextPath}
          subscriptionStatus={displaySubscriptionStatus ?? "trial"}
          trialEndsAt={data?.trial_ends_at ?? null}
          plan={data?.plan ?? "starter"}
          openSection={section ?? undefined}
          businessId={data?.id ?? null}
        />
        <div className="mt-6 pt-6 border-t border-zinc-900 text-center">
          <Link
            href="/contact"
            className="inline-flex min-h-11 items-center justify-center text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
          >
            Support
          </Link>
        </div>

        <DeleteAccountSection />
      </main>

      <div className="fixed bottom-0 left-0 right-0">
        <BottomNav />
      </div>
    </div>
  );
}
