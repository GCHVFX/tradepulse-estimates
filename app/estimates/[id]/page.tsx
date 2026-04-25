import { redirect } from "next/navigation";
import { CompanyEstimateHeader } from "@/app/components/company-estimate-header";
import { EstimateActions } from "@/app/components/estimate-actions";
import { DeleteEstimateLink } from "@/app/components/delete-estimate-link";
import { CustomerDetailsBlock } from "@/app/components/customer-details-block";
import { EditableEstimateBody } from "@/app/components/editable-estimate-body";
import { BottomNav } from "@/app/components/bottom-nav";
import { supabaseAdmin, createSupabaseServerClient } from "@/lib/supabase-server";

export default async function EstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!estimate || estimate.business_id !== user.id) {
    redirect("/estimates");
  }

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("logo_url, name, email")
    .eq("user_id", user.id)
    .maybeSingle();

  const logoUrl = business?.logo_url ?? null;
  const businessName = business?.name ?? "";
  const businessEmail = business?.email ?? "";

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
      <header className="px-4 sm:px-5 pt-6 sm:pt-10 pb-4 shrink-0 border-b border-zinc-900">
        <a
          href="/estimates"
          className="bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium rounded-xl px-4 py-2 min-h-[44px] inline-flex items-center gap-2 transition-colors"
        >
          <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
            <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Estimates
        </a>
      </header>

      <main className="flex-1 px-4 sm:px-5 overflow-auto pb-[18.5rem]">
        <div className="bg-white rounded-2xl p-5 mt-2">
          <CompanyEstimateHeader logoUrl={logoUrl} businessName={businessName} />
          <span className="mt-3 inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-500">
            Estimate
          </span>
          <h1 className="mt-1 text-3xl font-bold tracking-tight leading-tight text-zinc-900 break-words">
            {estimate.title}
          </h1>

          <CustomerDetailsBlock
            estimateId={estimate.id}
            initialName={estimate.customer_name ?? ""}
            initialPhone={estimate.customer_phone ?? ""}
            initialEmail={estimate.customer_email ?? ""}
            initialAddress={estimate.customer_address ?? ""}
            preparedBy={estimate.prepared_by ?? ""}
            companyName={businessName || undefined}
            businessEmail={businessEmail || undefined}
            dateStr={estimate.created_at}
          />

          <EditableEstimateBody
            summary={estimate.summary}
            estimateId={estimate.id}
          />
        </div>
        <DeleteEstimateLink estimateId={estimate.id} />
      </main>

      <EstimateActions
        estimateId={estimate.id}
        title={estimate.title}
        summary={estimate.summary}
        customerPhone={estimate.customer_phone ?? ""}
        customerEmail={estimate.customer_email ?? ""}
        businessName={businessName}
        logoUrl={logoUrl}
      />

      <div className="fixed bottom-0 left-0 right-0 z-40">
        <BottomNav />
      </div>
    </div>
  );
}
