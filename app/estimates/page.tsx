import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseAdmin, createSupabaseServerClient } from "@/lib/supabase-server";
import { Logo } from "@/app/components/logo";
import { BottomNav } from "@/app/components/bottom-nav";
import { DeleteEstimateButton } from "@/app/components/delete-estimate-button";
import { LocalDateText } from "@/app/components/local-date-text";
import { SetupChecklist } from "@/app/components/setup-checklist";

interface Estimate {
  id: string;
  title: string;
  customer_name: string;
  job_address: string;
  created_at: string;
  status: string;
  source?: string | null;
  description?: string | null;
  sent_via?: string | null;
  sent_at?: string | null;
  copied_at?: string | null;
  completed_at?: string | null;
  payment_status?: string | null;
}


export default async function EstimatesPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, name, plan")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  const { data: estimates } = business
    ? await supabaseAdmin
        .from("tpe_estimates")
        .select("id, title, customer_name, job_address, created_at, status, source, description, sent_via, sent_at, copied_at, completed_at, payment_status")
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })
    : { data: null };

  const items = (estimates ?? []) as Estimate[];
  const isPro = business?.plan === "pro";
  const unpaidCount = items.filter(
    (e) => e.payment_status === "unpaid" || e.payment_status === "overdue"
  ).length;

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
      <header className="px-5 pt-10 pb-6 shrink-0">
        <Logo />
        <div className="flex items-center justify-between mt-5">
          <h1 className="text-2xl font-bold">Estimates</h1>
          <Link
            href="/new"
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-semibold text-sm rounded-xl px-4 py-2.5 transition-colors min-h-[44px]"
          >
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            New Estimate
          </Link>
        </div>
      </header>

      <main className="flex-1 px-5 pb-28">
        <Link
          href="/payments"
          className="relative inline-flex items-center gap-1.5 mb-4 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:text-white transition-colors min-h-[32px]"
        >
          <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5" aria-hidden="true">
            <path d="M8 1.5v13M11.5 4.5c-.5-.8-1.5-1.2-2.5-1.2-1.5 0-2.8.9-2.8 2 0 1.7 3.3 1.4 3.3 3.2 0 1.1-1.3 2-2.8 2-1 0-2-.4-2.5-1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          Unpaid Invoices{isPro && unpaidCount > 0 ? ` · ${unpaidCount}` : ""}
          {!isPro && (
            <span className="text-[9px] font-bold leading-none text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded px-1 py-0.5">
              PRO
            </span>
          )}
        </Link>
        {business && (
          <SetupChecklist
            businessId={business.id}
            hasBusinessName={Boolean(business.name?.trim())}
            hasEstimates={items.length > 0}
          />
        )}
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <svg viewBox="0 0 48 48" fill="none" className="w-12 h-12 text-zinc-700" aria-hidden="true">
              <rect x="8" y="6" width="32" height="36" rx="3" stroke="currentColor" strokeWidth="2" />
              <path d="M16 16h16M16 22h16M16 28h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <p className="text-zinc-400 text-sm">No estimates yet.</p>
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
              const isQuoteRequest = estimate.status === "needs_review" && estimate.source === "website_quote";
              const isSent = estimate.status === "sent";
              const isDone = estimate.status === "done";
              const displayTitle = estimate.title || estimate.description || "Untitled";

              const deliveryLabel =
                estimate.sent_via === "sms" ? "SMS"
                : estimate.sent_via === "email" ? "Email"
                : estimate.copied_at ? "Copied"
                : null;
              const deliveryTime = estimate.sent_via ? estimate.sent_at : estimate.copied_at;

              return (
                <li key={estimate.id}>
                  <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl min-h-[88px] active:bg-zinc-800 transition-colors overflow-hidden">
                    <Link href={`/estimates/${estimate.id}`} className="flex-1 px-4 py-4 min-w-0">
                      <span className="text-white font-medium text-sm leading-snug block truncate">{displayTitle}</span>
                      {(estimate.customer_name || estimate.job_address) && (
                        <span className="text-zinc-400 text-xs mt-0.5 block truncate">
                          {[estimate.customer_name, estimate.job_address].filter(Boolean).join(" · ")}
                        </span>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <LocalDateText
                          dateStr={estimate.created_at}
                          prefix="Created"
                          className="text-zinc-400 text-xs"
                        />
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            isQuoteRequest
                              ? "bg-amber-500/15 text-amber-400"
                              : isDone
                              ? "bg-green-500/10 text-green-500/70"
                              : isSent
                              ? "bg-blue-500/15 text-blue-300"
                              : "bg-zinc-800 text-zinc-300"
                          }`}
                        >
                          {isQuoteRequest ? "Quote Request" : isDone ? "Done" : isSent ? "Sent" : "Draft"}
                        </span>
                      </div>

                      {(isSent || isDone) && deliveryLabel && deliveryTime && (
                        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 py-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            <span className="font-semibold text-zinc-100">{deliveryLabel}</span>
                            <LocalDateText
                              dateStr={deliveryTime}
                              showTime
                              className="text-zinc-300 text-xs"
                            />
                          </div>
                        </div>
                      )}

                      {isDone && estimate.completed_at && (
                        <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 py-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            <span className="font-semibold text-zinc-100">Completed</span>
                            <LocalDateText
                              dateStr={estimate.completed_at}
                              showTime
                              className="text-zinc-300 text-xs"
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
