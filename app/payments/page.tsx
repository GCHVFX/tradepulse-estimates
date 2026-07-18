import { redirect } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/app/components/logo";
import { BottomNav } from "@/app/components/bottom-nav";
import { supabaseAdmin, createSupabaseServerClient } from "@/lib/supabase-server";

function formatDueDate(dueDate: string): string {
  const [year, month, day] = dueDate.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function daysOverdue(dueDate: string): number {
  const [year, month, day] = dueDate.slice(0, 10).split("-").map(Number);
  const dueUtc = Date.UTC(year, month - 1, day);
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((todayUtc - dueUtc) / (24 * 60 * 60 * 1000));
}

function formatReminderSent(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

export default async function PaymentsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, plan")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  const isPro = business?.plan === "pro";

  if (!isPro) {
    return (
      <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
        <main className="flex-1 flex flex-col items-center justify-center px-5 pb-28">
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/favicon.png" alt="TradePulse" className="w-14 h-14 rounded-2xl mx-auto mb-5" />
              <h1 className="text-2xl font-bold">Payments is a Pro feature</h1>
              <p className="text-zinc-400 text-sm mt-2">
                Track outstanding invoices and let TradePulse send payment reminders for you.
              </p>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              <ul className="space-y-2.5 mb-6">
                {[
                  "Mark estimates as invoiced",
                  "Automated SMS and email reminders",
                  "One tap to mark invoices paid",
                  "See every outstanding invoice in one place",
                ].map(feature => (
                  <li key={feature} className="flex items-center gap-3 text-sm text-zinc-300">
                    <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true">
                      <path d="M3 8l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href="/subscribe"
                className="w-full bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center"
              >
                Upgrade to Pro
              </Link>
            </div>
          </div>
        </main>

        <div className="fixed bottom-0 left-0 right-0">
          <BottomNav />
        </div>
      </div>
    );
  }

  const { data: estimates } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id, title, customer_name, invoice_amount, due_date, last_reminder_sent_at, reminder_count")
    .eq("business_id", business.id)
    .in("payment_status", ["unpaid", "overdue"])
    .not("invoice_amount", "is", null)
    .order("due_date", { ascending: true });

  const invoices = estimates ?? [];

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
      <header className="px-5 pt-10 pb-3 shrink-0">
        <Logo />
        <h1 className="text-2xl font-bold mt-5">Payments</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Outstanding invoices. Reminders go out automatically until marked paid.
        </p>
      </header>

      <main className="flex-1 px-5 pb-28">
        {invoices.length === 0 ? (
          <div className="mt-8 text-center">
            <p className="text-zinc-400 text-sm">No outstanding invoices.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 mt-2">
            {invoices.map((invoice) => {
              const overdue = invoice.due_date ? daysOverdue(invoice.due_date) : 0;
              return (
                <Link
                  key={invoice.id}
                  href={`/estimates/${invoice.id}`}
                  className="block bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-4 hover:border-zinc-700 hover:bg-zinc-800 transition-colors min-h-[44px]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white font-semibold text-sm truncate">
                        {invoice.title?.trim() || "Untitled estimate"}
                      </p>
                      <p className="text-zinc-400 text-xs mt-0.5 truncate">
                        {invoice.customer_name?.trim() || "No customer"}
                      </p>
                    </div>
                    {invoice.invoice_amount !== null && (
                      <p className="text-white font-bold text-base shrink-0">
                        ${invoice.invoice_amount.toFixed(2)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3 mt-2.5">
                    <p className={`text-xs ${overdue > 0 ? "text-red-400 font-semibold" : "text-zinc-400"}`}>
                      {invoice.due_date
                        ? overdue > 0
                          ? `${overdue} ${overdue === 1 ? "day" : "days"} overdue`
                          : `Due ${formatDueDate(invoice.due_date)}`
                        : "No due date"}
                    </p>
                    <p className="text-zinc-400 text-xs">
                      {invoice.last_reminder_sent_at
                        ? `${invoice.reminder_count ?? 0} ${(invoice.reminder_count ?? 0) === 1 ? "reminder" : "reminders"}, last sent ${formatReminderSent(invoice.last_reminder_sent_at)}`
                        : "No reminders sent yet"}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0">
        <BottomNav />
      </div>
    </div>
  );
}
