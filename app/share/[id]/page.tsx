import { EstimateMarkdown } from "@/app/components/estimate-markdown";
import { RowLockup } from "@/app/components/wordmark";
import { DownloadPdfButton } from "@/app/components/download-pdf-button";
import { CompanyEstimateHeader } from "@/app/components/company-estimate-header";
import { loadContractorPricingRows, loadCustomerPricingView } from "@/lib/estimate-pricing-server";
import { businessTax } from "@/lib/estimate-tax";
import { classifyEstimate } from "@/lib/estimate-classification";
import { contractorCustomerDocument } from "@/lib/customer-pricing";
import { isDelivered } from "@/lib/estimate-delivery";
import { supabaseAdmin } from "@/lib/supabase-server";
import { allAmountsInLabel } from "@/lib/currency";
import { readEstimateCurrency } from "@/lib/currency-db";
import { CANONICAL_URL } from "@/lib/site-url";
import { preparedByLabel } from "@/lib/estimate-identity";
import { formatPhoneDisplay } from "@/lib/format-phone";

export default async function ShareEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select(
      "id, title, summary, customer_name, customer_phone, customer_email, job_address, prepared_by, created_at, business_id, include_photos, pricing_source, customer_pricing_mode, source, status, sent_at, copied_at, completed_at, payment_status, invoice_amount, review_requested_at, currency, tax_label_snapshot, tax_rate_snapshot, deposit_percent_snapshot, deposit_threshold_snapshot"
    )
    .eq("id", id)
    .maybeSingle();

  if (!estimate) {
    return (
      <div className="min-h-dvh bg-[#F3E8D0] flex flex-col items-center justify-center gap-4 px-5 text-center">
        <RowLockup variant="light" iconSize={44} textSize={36} />
        <p className="text-[#5C4A2E] text-base mt-6">Estimate not found.</p>
      </div>
    );
  }

  // The estimate is loaded first, and delivery decides what the business row
  // is needed for. A delivered estimate is priced from its own stored tax row,
  // so a missing or failed business read must never stop the customer's
  // estimate from rendering; branding just falls back to the same empty values
  // it always did. An undelivered estimate is priced from Rates and cannot
  // render without it: loadCustomerPricingView raises rather than pricing
  // against a guessed tax (lib/estimate-tax.ts).
  const [{ data: business, error: businessError }, { data: photoRecords }] = await Promise.all([
    supabaseAdmin
      .from("tpe_businesses")
      .select("name, logo_url, show_company_name_below_logo, tax_label, tax_rate")
      .eq("id", estimate.business_id)
      .maybeSingle(),
    supabaseAdmin
      .from("tpe_estimate_photos")
      .select("storage_path")
      .eq("estimate_id", id),
  ]);

  if (!business) {
    console.error("[share] business row unavailable", {
      estimateId: id,
      delivered: isDelivered(estimate),
      error: businessError?.message ?? "not found",
    });
  }

  const estimateCurrency = await readEstimateCurrency(supabaseAdmin, id);

  // Classification first, before any completeness check or rendering
  // decision (specs/contractor-owned-pricing.md section 13). A legacy estimate
  // has no contractor pricing rows, so checking completeness first would
  // refuse every legacy customer document.
  //
  // customerDocument is the exact markdown the customer sees, and the exact
  // string the PDF renders, so the two cannot disagree. null means there is no
  // document a customer may see yet.
  const pricingClass = classifyEstimate(estimate);
  let customerDocument: string | null;

  if (pricingClass === "contractor_pricing") {
    // Persisted rows, the estimate's own snapshots and its currency, through
    // calculateContractorPricing. The rows never leave the server: only the
    // finished document does, and it carries selling amounts only.
    const rows = await loadContractorPricingRows(estimate.id);
    const result = contractorCustomerDocument(estimate, rows, estimateCurrency);
    customerDocument = result.ready ? result.document : null;
  } else if (pricingClass === "website_quote_intake") {
    // Unpriced inbound intake has no customer document to show.
    customerDocument = null;
  } else {
    // Legacy: the frozen historical representation, unchanged.
    const pricing = await loadCustomerPricingView(estimate, business ? businessTax(business) : null);
    customerDocument = pricing.selected.summary;
  }
  const businessName = business?.name ?? "";
  const logoUrl = business?.logo_url ?? null;
  const showCompanyNameBelowLogo = business?.show_company_name_below_logo ?? true;
  const preparedByText = preparedByLabel(estimate.prepared_by);

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

  if (customerDocument === null) {
    // Not ready: no prose, no partial pricing, no photos, no PDF. Nothing
    // about an unfinished estimate reaches the customer or the page payload.
    return (
      <div className="min-h-dvh bg-[#F3E8D0] flex flex-col items-center justify-center gap-4 px-5 text-center">
        <RowLockup variant="light" iconSize={44} textSize={36} />
        <p className="text-[#26211B] text-lg font-semibold mt-6">This estimate isn&apos;t ready yet.</p>
        <p className="text-[#5C4A2E] text-base">
          {businessName ? `${businessName} is still finishing it.` : "Your contractor is still finishing it."}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#F3E8D0] flex flex-col">
      <main className="flex-1 px-5 pt-6 pb-20 max-w-2xl mx-auto w-full">
        <div className="bg-white rounded-2xl border border-[#C9B384] shadow-sm p-6">

          {/* Business letterhead */}
          {(logoUrl || businessName || preparedByText) && (
            <div className="pb-5 mb-5 border-b border-[#C9B384]">
              <CompanyEstimateHeader
                logoUrl={logoUrl}
                businessName={businessName}
                showCompanyNameBelowLogo={showCompanyNameBelowLogo}
                preparedBy={estimate.prepared_by}
              />
            </div>
          )}

          {/* Badge + title */}
          <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-600">
            Estimate
          </span>
          <h1 className="mt-2 text-2xl font-bold tracking-tight leading-tight text-[#26211B] break-words">
            {estimate.title}
          </h1>

          {/* Customer details */}
          <div className="text-[#5C4A2E] text-xs leading-relaxed mb-5 border-t border-[#C9B384] pt-4">
            {estimate.customer_name && (
              <span className="block">Prepared for: {estimate.customer_name}</span>
            )}
            {estimate.customer_phone && (
              <span className="block">Phone: {formatPhoneDisplay(estimate.customer_phone)}</span>
            )}
            {estimate.customer_email && (
              <span className="block">Email: {estimate.customer_email}</span>
            )}
            {estimate.job_address && (
              <span className="block">Address: {estimate.job_address}</span>
            )}
            <span className="block">
              Date:{" "}
              {new Date(estimate.created_at ?? "").toLocaleDateString("en-CA", {
                month: "long",
                day: "numeric",
                year: "numeric",
                timeZone: "America/Vancouver",
              })}
            </span>
          </div>

          <EstimateMarkdown content={customerDocument} />

          {/* Outside the pricing table on purpose: a currency code inside an
              amount cell would break parseCost() on a later edit. */}
          <p className="mt-4 text-xs text-[#5C4A2E]">{allAmountsInLabel(estimateCurrency)}</p>

          {estimate.include_photos && photoUrls.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[#5C4A2E]">Photos</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photoUrls.map((url) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={url}
                    src={url}
                    alt="Job site photo"
                    className="aspect-square w-full rounded-xl border border-[#C9B384] object-cover"
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <DownloadPdfButton
            title={estimate.title ?? ""}
            summary={customerDocument}
            businessName={businessName}
            logoUrl={logoUrl}
            showCompanyNameBelowLogo={showCompanyNameBelowLogo}
            preparedBy={estimate.prepared_by}
            photoUrls={estimate.include_photos ? photoUrls : []}
            currency={estimateCurrency}
          />
        </div>
      </main>

      <footer className="px-5 py-4 text-center">
        <p className="text-[#5C4A2E] text-xs">
          Powered by{" "}
          <a
            href={CANONICAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#5C4A2E] hover:text-amber-500 transition-colors font-medium"
          >
            TradePulse
          </a>
        </p>
      </footer>
    </div>
  );
}
