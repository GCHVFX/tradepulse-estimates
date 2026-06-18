import { redirect } from "next/navigation";
import { CompanyEstimateHeader } from "@/app/components/company-estimate-header";
import { EstimateActions } from "@/app/components/estimate-actions";
import { DeleteEstimateLink } from "@/app/components/delete-estimate-link";
import { CustomerDetailsBlock } from "@/app/components/customer-details-block";
import { EditableEstimateBody } from "@/app/components/editable-estimate-body";
import { EstimatePhotos } from "@/app/components/estimate-photos";
import { BottomNav } from "@/app/components/bottom-nav";
import { supabaseAdmin, createSupabaseServerClient } from "@/lib/supabase-server";
import { calculateEstimateTotal } from "@/lib/estimate-summary";

export default async function EstimatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sent?: string }>;
}) {
  const { id } = await params;
  const { sent } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, logo_url, name, email, phone, plan, google_review_link, payment_link")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business) {
    redirect("/estimates");
  }

  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select("*")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!estimate) {
    redirect("/estimates");
  }

  // Fetch photos from tpe_estimate_photos table
  const { data: photoRecords } = await supabaseAdmin
    .from("tpe_estimate_photos")
    .select("storage_path")
    .eq("estimate_id", id);

  const photoUrls: string[] = [];
  if (photoRecords && photoRecords.length > 0) {
    for (const record of photoRecords) {
      const { data: signedUrlData } = await supabaseAdmin.storage
        .from("tpe-estimate-photos")
        .createSignedUrl(record.storage_path, 60 * 60 * 24); // 24 hours
      if (signedUrlData?.signedUrl) {
        photoUrls.push(signedUrlData.signedUrl);
      }
    }
  }

  const logoUrl = business?.logo_url ?? null;
  const businessName = business?.name ?? "";
  const businessEmail = business?.email ?? "";
  const businessPhone = business?.phone ?? "";
  const isPro = business?.plan === "pro";
  const googleReviewLink = business?.google_review_link ?? null;
  const estimateTotal = calculateEstimateTotal(estimate.summary ?? "");

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

      <main className="flex-1 px-4 sm:px-5 overflow-auto pb-[14rem]">
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
            initialAddress={estimate.job_address ?? ""}
            preparedBy={estimate.prepared_by ?? ""}
            companyName={businessName || undefined}
            businessEmail={businessEmail || undefined}
            dateStr={estimate.created_at ?? ""}
          />

          <EditableEstimateBody
            summary={estimate.summary ?? ""}
            estimateId={estimate.id}
          />

          <EstimatePhotos
            estimateId={estimate.id}
            photoUrls={photoUrls}
            includePhotos={estimate.include_photos ?? false}
            isPro={isPro}
          />
        </div>
        <DeleteEstimateLink estimateId={estimate.id} />
      </main>

      <EstimateActions
        estimateId={estimate.id}
        title={estimate.title ?? ""}
        summary={estimate.summary ?? ""}
        status={estimate.status}
        customerPhone={estimate.customer_phone ?? ""}
        customerEmail={estimate.customer_email ?? ""}
        customerName={estimate.customer_name ?? ""}
        businessName={businessName}
        businessPhone={businessPhone}
        logoUrl={logoUrl}
        isPro={isPro}
        googleReviewLink={googleReviewLink}
        reviewRequestedAt={estimate.review_requested_at ?? null}
        paymentStatus={estimate.payment_status ?? null}
        invoiceAmount={estimate.invoice_amount ?? null}
        estimateTotal={estimateTotal}
        justSent={sent === "1"}
        businessHasPaymentLink={Boolean(business?.payment_link?.trim())}
      />

      <div className="fixed bottom-0 left-0 right-0 z-40">
        <BottomNav />
      </div>
    </div>
  );
}
