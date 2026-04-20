import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin, createSupabaseServerClient } from "@/lib/supabase-server";
import { Logo } from "@/app/components/logo";
import { BottomNav } from "@/app/components/bottom-nav";
import { DeleteEstimateButton } from "@/app/components/delete-estimate-button";
import { LocalDateText } from "@/app/components/local-date-text";

interface Estimate {
  id: string;
  title: string;
  customer_name: string;
  customer_address: string;
  created_at: string;
  status: string;
  sent_via?: string | null;
  sent_at?: string | null;
}

function formatSentMethod(sentVia?: string | null): string {
  if (sentVia === "sms") return "SMS";
  if (sentVia === "email") return "Email";
  return "Sent";
}

export default async function EstimatesPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: estimates }, { data: business }] = await Promise.all([
    supabaseAdmin
      .from("tpe_estimates")
      .select("id, title, customer_name, customer_address, created_at, status, sent_via, sent_at")
      .eq("business_id", user.id)
      .order("created_at", { ascending: false }),
    supabaseAdmin.from("tpe_businesses").select("name").eq("user_id", user.id).maybeSingle(),
  ]);

  const items = (estimates ?? []) as Estimate[];
  const businessName = (business as { name?: string } | null)?.name ?? "";

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
      <header className="px-5 pt-10 pb-6 shrink-0">
        <Logo businessName={businessName} />
        <h1 className="text-2xl font-bold mt-5">Estimates</h1>
      </header>

      <main className="flex-1 px-5 pb-28">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <svg viewBox="0 0 48 48" fill="none" className="w-12 h-12 text-zinc-700" aria-hidden="true">
              <rect x="8" y="6" width="32" height="36" rx="3" stroke="currentColor" strokeWidth="2" />
              <path d="M16 16h16M16 22h16M16 28h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <p className="text-zinc-500 text-sm">No estimates yet.</p>
            <Link
              href="/new"
              className="mt-1 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-sm rounded-xl px-6 py-3 transition-colors min-h-[44px] flex items-center"
            >
              Create Your First Estimate
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((estimate) => {
              const isSent = estimate.status === "sent";

              return (
                <li key={estimate.id}>
                  <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl min-h-[88px] active:bg-zinc-800 transition-colors overflow-hidden">
                    <Link href={`/estimates/${estimate.id}`} className="flex-1 px-4 py-4 min-w-0">
                      <span className="text-white font-medium text-sm leading-snug block truncate">{estimate.title}</span>
                      {(estimate.customer_name || estimate.customer_address) && (
                        <span className="text-zinc-500 text-xs mt-0.5 block truncate">
                          {[estimate.customer_name, estimate.customer_address].filter(Boolean).join(" · ")}
                        </span>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <LocalDateText
                          dateStr={estimate.created_at}
                          prefix="Created"
                          className="text-zinc-500 text-xs"
                        />
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                            isSent ? "bg-green-500/15 text-green-300" : "bg-zinc-800 text-zinc-300"
                          }`}
                        >
                          {isSent ? "Sent" : "Draft"}
                        </span>
                      </div>

                      {isSent && estimate.sent_at && (
                        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 py-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            <span className="font-semibold text-zinc-100">{formatSentMethod(estimate.sent_via)}</span>
                            <LocalDateText
                              dateStr={estimate.sent_at}
                              className="text-zinc-300"
                            />
                          </div>
                        </div>
                      )}
                    </Link>
                    <div className="pr-2">
                      <DeleteEstimateButton estimateId={estimate.id} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0">
        <BottomNav />
      </div>
    </div>
  );
}
