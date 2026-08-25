import Image from "next/image";
import { EstimateMarkdown } from "@/app/components/estimate-markdown";
import { DownloadPdfButton } from "@/app/components/download-pdf-button";
import { CompanyEstimateHeader } from "@/app/components/company-estimate-header";
import { loadCustomerPricingView } from "@/lib/estimate-pricing-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { allAmountsInLabel } from "@/lib/currency";
import { readEstimateCurrency } from "@/lib/currency-db";

export default async function ShareEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select(
      "id, title, summary, customer_name, customer_phone, customer_email, job_address, prepared_by, created_at, business_id, include_photos, pricing_source, customer_pricing_mode, status, sent_at, copied_at, completed_at, payment_status, invoice_amount, review_requested_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (!estimate) {
    return (
      <div className="min-h-dvh bg-slate-50 flex flex-col items-center justify-center gap-4 px-5 text-center">
        <Image
          src="/tradepulse-logo.png"
          alt="TradePulse Estimates"
          width={160}
          height={44}
          className="object-contain"
          unoptimized
        />
        <p className="text-slate-400 text-base mt-6">Estimate not found.</p>
      </div>
    );
  }

  const businessPromise = estimate.business_id
    ? supabaseAdmin
        .from("tpe_businesses")
        .select("name, logo_url")
        .eq("id", estimate.business_id)
        .maybeSingle()
    : Promise.resolve({ data: null });

  const [pricing, { data: business }, { data: photoRecords }] = await Promise.all([
    loadCustomerPricingView(estimate),
    businessPromise,
    supabaseAdmin
      .from("tpe_estimate_photos")
      .select("storage_path")
      .eq("estimate_id", id),
  ]);

  const estimateCurrency = await readEstimateCurrency(supabaseAdmin, id);
  const businessName = business?.name ?? "";
  const logoUrl = business?.logo_url ?? null;

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

  return (
    <div className="min-h-dvh bg-slate-50 flex flex-col">
      <main className="flex-1 px-5 pt-6 pb-20 max-w-2xl mx-auto w-full">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">

          {/* Business letterhead */}
          {(logoUrl || businessName || estimate.prepared_by) && (
            <div className="pb-5 mb-5 border-b border-slate-200">
              <CompanyEstimateHeader logoUrl={logoUrl} businessName={businessName} />
              {estimate.prepared_by && (
                <p className={`text-sm text-zinc-500 ${logoUrl || businessName ? "mt-2" : ""}`}>
                  {estimate.prepared_by}
                </p>
              )}
            </div>
          )}

          {/* Badge + title */}
          <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-600">
            Estimate
          </span>
          <h1 className="mt-2 text-2xl font-bold tracking-tight leading-tight text-zinc-900 break-words">
            {estimate.title}
          </h1>

          {/* Customer details */}
          <div className="text-slate-700 text-xs leading-relaxed mb-5 border-t border-slate-100 pt-4">
            {estimate.customer_name && (
              <span className="block">Prepared for: {estimate.customer_name}</span>
            )}
            {estimate.customer_phone && (
              <span className="block">Phone: {estimate.customer_phone}</span>
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
              })}
            </span>
          </div>

          <EstimateMarkdown content={pricing.selected.summary} />

          {/* Outside the pricing table on purpose: a currency code inside an
              amount cell would break parseCost() on a later edit. */}
          <p className="mt-4 text-xs text-slate-500">{allAmountsInLabel(estimateCurrency)}</p>

          {estimate.include_photos && photoUrls.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Photos</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photoUrls.map((url) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={url}
                    src={url}
                    alt="Job site photo"
                    className="aspect-square w-full rounded-xl border border-slate-200 object-cover"
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <DownloadPdfButton
            title={estimate.title ?? ""}
            summary={pricing.selected.summary}
            businessName={businessName}
            logoUrl={logoUrl}
            photoUrls={estimate.include_photos ? photoUrls : []}
          />
        </div>
      </main>

      <footer className="px-5 py-4 text-center">
        <p className="text-slate-400 text-xs">
          Powered by{" "}
          <a
            href="https://trytradepulse.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-500 hover:text-amber-500 transition-colors font-medium"
          >
            TradePulse
          </a>
        </p>
      </footer>
    </div>
  );
}
