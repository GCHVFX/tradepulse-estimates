import { redirect } from "next/navigation";
import { CompanyEstimateHeader } from "@/app/components/company-estimate-header";
import { EstimateActions } from "@/app/components/estimate-actions";
import { DeleteEstimateLink } from "@/app/components/delete-estimate-link";
import { CustomerDetailsBlock } from "@/app/components/customer-details-block";
import { EstimatePhotos } from "@/app/components/estimate-photos";
import { BottomNav } from "@/app/components/bottom-nav";
import { loadContractorPricingRows, loadCustomerPricingView } from "@/lib/estimate-pricing-server";
import { businessTax } from "@/lib/estimate-tax";
import { ContractorPricingEditor } from "@/app/components/contractor-pricing-editor";
import { EstimateMarkdown } from "@/app/components/estimate-markdown";
import { stripTitleHeading } from "@/lib/estimate-prose";
import { calculateContractorPricing } from "@/lib/contractor-pricing";
import { withReconstructionGate } from "@/lib/contractor-pricing-form";
import { classifyEstimate } from "@/lib/estimate-classification";
import { isDelivered } from "@/lib/estimate-delivery";
import { contractorCustomerDocument } from "@/lib/customer-pricing";
import { readEstimateCurrency } from "@/lib/currency-db";
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
    .select("id, logo_url, name, show_company_name_below_logo, email, phone, plan, google_review_link, payment_link, tax_label, tax_rate, labour_rate, markup_percent")
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

  // Phase 1 classification comes first (specs/contractor-owned-pricing.md
  // section 2): it decides which pricing path this page may use at all.
  const pricingClass = classifyEstimate(estimate);
  const isContractorPricing = pricingClass === "contractor_pricing";

  // Pricing rows and photo records are independent once the estimate is
  // owned, so load them together rather than adding another server waterfall.
  // A contractor_pricing estimate never goes through the legacy customer view
  // (it would parse the prose as if it held prices); everything else keeps
  // the frozen legacy path, which uses the business's Rates tax for an
  // undelivered estimate and the stored tax row for a delivered one.
  const [legacyPricing, contractorRows, { data: photoRecords }, estimateCurrency] = await Promise.all([
    isContractorPricing ? Promise.resolve(null) : loadCustomerPricingView(estimate, businessTax(business)),
    isContractorPricing ? loadContractorPricingRows(estimate.id) : Promise.resolve([]),
    supabaseAdmin
      .from("tpe_estimate_photos")
      .select("storage_path")
      .eq("estimate_id", id),
    // The estimate's own snapshot, never the business setting: changing that
    // must not move an estimate that is already saved.
    readEstimateCurrency(supabaseAdmin, id),
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
  const showCompanyNameBelowLogo = business?.show_company_name_below_logo ?? true;
  const businessEmail = business?.email ?? "";
  const businessPhone = business?.phone ?? "";
  const isPro = business?.plan === "pro";
  const googleReviewLink = business?.google_review_link ?? null;
  const isQuoteRequest = pricingClass === "website_quote_intake";

  // withReconstructionGate applies the pricing editor's own "needs
  // attention" reload check (lib/contractor-pricing-form.ts's
  // reconstructConfirmedItems, the single definition) on top of the plain
  // calculation: a contractor_pricing estimate whose persisted 'ea' rows
  // cannot be reliably paired must never read as complete/sendable here
  // either, not just refused editing inside ContractorPricingEditor. Gated
  // on isContractorPricing the same as the calculation itself -- a
  // 'structured'/'markdown' estimate's rows (which may legitimately hold
  // unrelated 'ea' rows) are never passed through this invariant.
  const contractorPricing = isContractorPricing
    ? withReconstructionGate(
        calculateContractorPricing(
          contractorRows.map((row) => ({
            item_type: row.item_type,
            unit: row.unit,
            quantity: row.quantity,
            unit_price: row.unit_price,
            markup_percent: row.markup_percent,
            taxable: row.taxable,
          })),
          {
            taxRatePercent: estimate.tax_rate_snapshot,
            depositPercent: estimate.deposit_percent_snapshot,
            depositThresholdDollars: estimate.deposit_threshold_snapshot,
          }
        ),
        contractorRows
      )
    : null;

  // The customer document and the total every downstream consumer reads. For
  // contractor pricing both come from the persisted rows and snapshots
  // through calculateContractorPricing, never from pricing.selected, which is
  // the legacy markdown parse. An incomplete contractor estimate has no
  // customer document and a total of 0 until the contractor prices it.
  const contractorDocument = isContractorPricing
    ? contractorCustomerDocument(estimate, contractorRows, estimateCurrency)
    : null;
  const customerSummary = contractorDocument
    ? contractorDocument.ready
      ? contractorDocument.document
      : ""
    : legacyPricing?.selected.summary ?? "";
  const estimateTotal = contractorDocument
    ? contractorDocument.ready
      ? contractorDocument.totalCents / 100
      : 0
    : legacyPricing?.selected.total ?? 0;
  // The authoritative send-readiness signal EstimateActions seeds its state
  // from. For contractor pricing this is contractorPricing.complete --
  // calculateContractorPricing's own `complete`, additionally gated by
  // withReconstructionGate above (not a total-is-nonzero guess -- an
  // explicit $0 fixed-labour job is complete and sendable). Deliberately
  // NOT contractorDocument.ready: contractorCustomerDocument() computes its
  // own `calculateContractorPricing` independently (lib/customer-pricing.ts,
  // customer-rendering code this fix does not touch) and has no knowledge of
  // the reconstruction invariant, so it would still read "ready" for a
  // malformed 'ea' pairing the editor itself refuses to interpret. Both
  // calls read the identical persisted rows and the identical estimate
  // snapshots, so contractorPricing.complete and contractorDocument.ready
  // agree in every case except that one. Legacy has no completeness concept
  // of its own, so it keeps the same total-based check EstimateActions has
  // always used for it. The `estimateTotal > 0` branch is unreachable for a
  // contractor_pricing estimate: contractorPricing above is set to `null`
  // exactly when `!isContractorPricing`, the same condition contractorDocument
  // uses, so this ternary always takes the `.complete` branch for one.
  const estimateComplete = contractorPricing ? contractorPricing.complete : estimateTotal > 0;

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
          normally instead. Left plain to match that reality.

          Bottom padding must clear both fixed overlays (EstimateActions'
          bar plus BottomNav) or the fixed bar either shows a gap behind it
          (padding too generous) or hides real estimate content with no way
          to scroll it into view (padding too small) -- the actual bug this
          padding is fixing. Both bars' heights are state- and device-
          dependent: EstimateActions' own content ranges from a single 56px
          button to several stacked panels well over 400px, and BottomNav
          renders taller on a phone with a safe-area inset than one without
          (its own bottom padding is `env(safe-area-inset-bottom)`-driven).
          A static guess of either can't stay correct everywhere -- a flat
          "108px" tuned against a no-safe-area BottomNav measurement is what
          previously let scrolled content end up behind this bar on an
          inset device -- so both publish their real measured height as CSS
          custom properties (--tp-estimate-action-bar-height here,
          --tp-bottom-nav-height from bottom-nav.tsx) and this adds them
          together, minus the 3px EstimateActions already overlaps
          BottomNav by (see its own comment) plus a little breathing room.
          The fallback values only apply before each effect's first paint. */}
      <main
        className="flex-1 px-4 sm:px-5"
        style={{
          paddingBottom:
            "calc(var(--tp-estimate-action-bar-height, 200px) + var(--tp-bottom-nav-height, 87px) - 3px + 24px)",
        }}
      >
        {isQuoteRequest ? (
          <>
            <div className="bg-white rounded-2xl p-5 mt-2">
              <CompanyEstimateHeader
                logoUrl={logoUrl}
                businessName={businessName}
                showCompanyNameBelowLogo={showCompanyNameBelowLogo}
                preparedBy={estimate.prepared_by}
              />
              <span className="mt-3 inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-500">
                Website Quote Request
              </span>

              <CustomerDetailsBlock
                estimateId={estimate.id}
                initialName={estimate.customer_name ?? ""}
                initialPhone={estimate.customer_phone ?? ""}
                initialEmail={estimate.customer_email ?? ""}
                initialAddress={estimate.job_address ?? ""}
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
              <CompanyEstimateHeader
                logoUrl={logoUrl}
                businessName={businessName}
                showCompanyNameBelowLogo={showCompanyNameBelowLogo}
                preparedBy={estimate.prepared_by}
              />
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
                companyName={businessName || undefined}
                businessEmail={businessEmail || undefined}
                dateStr={estimate.created_at ?? ""}
              />

              {isContractorPricing && contractorPricing ? (
                <>
                  {/* The saved job wording. A contractor_pricing estimate
                      stores prose only, so this is the whole generated
                      document; every figure below it comes from the pricing
                      rows, never from this text. The H1 is stripped because
                      the title is already shown above. */}
                  <EstimateMarkdown content={stripTitleHeading(estimate.summary ?? "")} />
                  <ContractorPricingEditor
                    key={estimate.id}
                    estimateId={estimate.id}
                    currency={estimateCurrency}
                    initialRows={contractorRows}
                    initialTax={{
                      label: estimate.tax_label_snapshot,
                      rate: estimate.tax_rate_snapshot,
                    }}
                    initialPricing={contractorPricing}
                    defaults={{
                      labourRate: business.labour_rate,
                      markupPercent: business.markup_percent,
                    }}
                    isDelivered={isDelivered(estimate)}
                    depositPercent={estimate.deposit_percent_snapshot}
                    depositThresholdDollars={estimate.deposit_threshold_snapshot}
                  />
                </>
              ) : (
                // Legacy, read-only (specs/contractor-owned-pricing.md section
                // 14). The frozen customer representation, exactly as the
                // share page renders it, with no editor of any kind. That
                // includes pricing_source='structured': old structured rows do
                // not make an estimate editable under either pricing path.
                <>
                  {!isDelivered(estimate) && (
                    <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                      <p className="text-sm text-zinc-700">
                        This estimate was created with the previous pricing system and is read-only.
                        Create a new estimate to change or send it.
                      </p>
                    </div>
                  )}
                  <EstimateMarkdown content={customerSummary} />
                </>
              )}

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
        summary={customerSummary}
        currency={estimateCurrency}
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
        estimateComplete={estimateComplete}
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
