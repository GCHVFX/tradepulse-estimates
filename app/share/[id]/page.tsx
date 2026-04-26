import Image from "next/image";
import { EstimateMarkdown } from "@/app/components/estimate-markdown";
import { DownloadPdfButton } from "@/app/components/download-pdf-button";
import { supabaseAdmin } from "@/lib/supabase-server";

export default async function ShareEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select(
      "title, summary, business_id, customer_name, customer_phone, customer_email, customer_address, prepared_by, created_at"
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

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("logo_url, name, email, phone")
    .eq("user_id", estimate.business_id ?? "")
    .maybeSingle();

  const logoUrl = business?.logo_url ?? null;
  const businessName = business?.name ?? "";
  const businessEmail = business?.email ?? "";
  const businessPhone = business?.phone ?? "";

  return (
    <div className="min-h-dvh bg-slate-50 flex flex-col">
      <main className="flex-1 px-5 pt-6 pb-20 max-w-2xl mx-auto w-full">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">

          {/* Letterhead header */}
          <div className="flex items-center gap-4 pb-5 mb-5 border-b border-slate-200">
            {logoUrl && (
              <Image
                src={logoUrl}
                alt={businessName || "Company logo"}
                width={64}
                height={64}
                className="rounded object-contain"
                unoptimized
              />
            )}
            <div className="min-w-0">
              {businessName && (
                <p className="text-xl font-bold text-zinc-900 leading-tight">{businessName}</p>
              )}
              {estimate.prepared_by && (
                <p className="text-sm text-zinc-500 mt-0.5">{estimate.prepared_by}</p>
              )}
              {(businessEmail || businessPhone) && (
                <p className="text-xs text-zinc-400 mt-1">
                  {[businessPhone, businessEmail].filter(Boolean).join("  ·  ")}
                </p>
              )}
            </div>
          </div>

          {/* Badge + title */}
          <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-600">
            Estimate
          </span>
          <h1 className="mt-2 text-2xl font-bold tracking-tight leading-tight text-zinc-900 break-words">
            {estimate.title}
          </h1>

          {/* Customer details */}
          <div className="text-slate-600 text-xs leading-relaxed mb-5 border-t border-slate-100 pt-4">
            {estimate.customer_name && (
              <span className="block">Prepared for: {estimate.customer_name}</span>
            )}
            {estimate.customer_phone && (
              <span className="block">Phone: {estimate.customer_phone}</span>
            )}
            {estimate.customer_email && (
              <span className="block">Email: {estimate.customer_email}</span>
            )}
            {estimate.customer_address && (
              <span className="block">Address: {estimate.customer_address}</span>
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

          <EstimateMarkdown
            content={(estimate.summary ?? "")
              .split("\n")
              .filter((l: string) => !l.startsWith("# "))
              .join("\n")}
          />
        </div>

        <div className="mt-4">
          <DownloadPdfButton
            title={estimate.title ?? ""}
            summary={estimate.summary ?? ""}
            businessName={businessName}
            logoUrl={logoUrl}
          />
        </div>
      </main>

      <footer className="px-5 py-8 border-t border-slate-200 bg-white text-center">
        <Image
          src="/tradepulse-logo.png"
          alt="TradePulse Estimates"
          width={120}
          height={33}
          className="object-contain mx-auto mb-3 opacity-60"
          unoptimized
        />
        <p className="text-slate-500 text-base">
          Create your own estimate at{" "}
          <a
            href="https://trytradepulse.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-500 hover:text-amber-400 transition-colors font-medium"
          >
            TradePulse
          </a>
        </p>
      </footer>
    </div>
  );
}
