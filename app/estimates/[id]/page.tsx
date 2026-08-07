import { redirect } from "next/navigation";
import { CompanyEstimateHeader } from "@/app/components/company-estimate-header";
import { EstimateActions } from "@/app/components/estimate-actions";
import { DeleteEstimateLink } from "@/app/components/delete-estimate-link";
import { CustomerDetailsBlock } from "@/app/components/customer-details-block";
import { EstimatePricingEditor } from "@/app/components/estimate-pricing-editor";
import { EstimatePhotos } from "@/app/components/estimate-photos";
import { BottomNav } from "@/app/components/bottom-nav";
import { loadCustomerPricingView } from "@/lib/estimate-pricing-server";
import { supabaseAdmin, createSupabaseServerClient } from "@/lib/supabase-server";
import { normalizePhoneE164 } from "@/lib/sms-suppression";

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

  // Pricing rows and photo records are independent once the estimate is
  // owned, so load them together rather than adding another server waterfall.
  const [pricing, { data: photoRecords }] = await Promise.all([
    loadCustomerPricingView(estimate),
    supabaseAdmin
      .from("tpe_estimate_photos")
      .select("storage_path")
      .eq("estimate_id", id),
  ]);

  // Each photo carries both its signed URL (short-lived, for display only)
  // and its storage_path (the stable identifier the delete API matches on).
  // The signed URL must never be used as the identifier: it is regenerated on
  // every render and expires, so it cannot address a row.
  const photos: Array<{ url: string; storagePath: string }> = [];
  if (photoRecords && photoRecords.length > 0) {
    for (const record of photoRecords) {
      const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
        .from("tpe-estimate-photos")
        .createSignedUrl(record.storage_path, 60 * 60 * 24); // 24 hours
      if (signedUrlError) {
        console.error(`[estimate-photos] signed URL failed for ${record.storage_path}:`, signedUrlError.message);
      }
      if (signedUrlData?.signedUrl) {
        photos.push({ url: signedUrlData.signedUrl, storagePath: record.storage_path });
      }
    }
  }
  const photoUrls = photos.map((p) => p.url);

  const logoUrl = business?.logo_url ?? null;
  const businessName = business?.name ?? "";
  const businessEmail = business?.email ?? "";
  const businessPhone = business?.phone ?? "";
  const isPro = business?.plan === "pro";
  const googleReviewLink = business?.google_review_link ?? null;
  const isQuoteRequest = estimate.status === "needs_review" && estimate.source === "website_quote";
  const estimateTotal = pricing.selected.total;

  // Only unpaid invoiced estimates need this check -- opting out doesn't
  // matter for an estimate that was never invoiced or is already paid, and
  // both states already gate whether the SMS-opted-out banner can render in
  // EstimateActions. Skipping the query for those cases avoids a suppression
  // lookup on every estimate page view, not just the ones where it matters.
  let smsOptedOut = false;
  if (estimate.payment_status === "unpaid" && estimate.customer_phone) {
    const normalizedPhone = normalizePhoneE164(estimate.customer_phone);
    if (normalizedPhone) {
      const { data: suppression } = await supabaseAdmin
        .from("tpe_sms_suppressions")
        .select("sms_opted_out")
        .eq("phone", normalizedPhone)
        .maybeSingle();
      smsOptedOut = suppression?.sms_opted_out === true;
    }
  }

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

      {/* The wrapping div is min-h-dvh (a floor, not a cap), so once content
          exceeds one screen this main never actually clips or scrolls on its
          own -- overflow-auto here is a no-op, the whole document scrolls
          normally instead. Left plain to match that reality. */}
      <main className="flex-1 px-4 sm:px-5 pb-[14rem]">
        {isQuoteRequest ? (
          <>
            <div className="bg-white rounded-2xl p-5 mt-2">
              <CompanyEstimateHeader logoUrl={logoUrl} businessName={businessName} />
              <span className="mt-3 inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-500">
                Website Quote Request
              </span>

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

              <div className="mt-4 border-t border-zinc-200 pt-4">
                <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-2">Customer Request</h2>
                <p className="text-zinc-900 text-sm leading-relaxed whitespace-pre-wrap">
                  {estimate.description || "No description provided."}
                </p>
                {(estimate.service_type || estimate.urgency || estimate.location) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {estimate.service_type && estimate.service_type !== "unknown" && (
                      <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 capitalize">
                        {estimate.service_type}
                      </span>
                    )}
                    {estimate.location && estimate.location !== "unknown" && (
                      <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 capitalize">
                        {estimate.location}
                      </span>
                    )}
                    {estimate.urgency && estimate.urgency !== "unknown" && (
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                        estimate.urgency === "emergency" ? "bg-red-100 text-red-700" :
                        estimate.urgency === "urgent" ? "bg-amber-100 text-amber-700" :
                        "bg-zinc-100 text-zinc-700"
                      }`}>
                        {estimate.urgency}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <EstimatePhotos
                estimateId={estimate.id}
                photos={photos}
                includePhotos={photoUrls.length > 0}
                isPro={isPro}
              />
            </div>
            <DeleteEstimateLink estimateId={estimate.id} />
          </>
        ) : (
          <>
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

              <EstimatePricingEditor
                key={estimate.id}
                estimateId={estimate.id}
                summary={estimate.summary ?? ""}
                detailedSummary={pricing.detailedSummary}
                groupedSummary={pricing.groupedSummary}
                initialMode={pricing.selected.renderedMode}
                structuredPricing={estimate.pricing_source === "structured"}
                canEditMode={pricing.canEditMode}
                pricingError={!pricing.selected.ok}
              />

              <EstimatePhotos
                estimateId={estimate.id}
                photos={photos}
                includePhotos={estimate.include_photos ?? (photoUrls.length > 0)}
                isPro={isPro}
              />
            </div>
            <DeleteEstimateLink estimateId={estimate.id} />
          </>
        )}
      </main>

      <EstimateActions
        estimateId={estimate.id}
        title={estimate.title ?? ""}
        summary={pricing.selected.summary}
        status={estimate.status}
        source={estimate.source ?? null}
        description={estimate.description ?? null}
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
        hasPhotos={photoUrls.length > 0}
        smsOptedOut={smsOptedOut}
      />

      <div className="fixed bottom-0 left-0 right-0 z-40">
        <BottomNav />
      </div>
    </div>
  );
}
