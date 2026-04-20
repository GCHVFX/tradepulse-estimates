import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DownloadPdfButton } from "@/app/components/download-pdf-button";
import { supabaseAdmin } from "@/lib/supabase-server";

// Detect whether a td's direct child is a <strong> element — used to style
// the Total row in the pricing summary table without needing row-level context.
function isDirectlyBold(children: React.ReactNode): boolean {
  return (
    !!children &&
    typeof children === "object" &&
    "type" in (children as object) &&
    (children as React.ReactElement).type === "strong"
  );
}

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-xl font-bold text-zinc-900 mt-6 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2
      className="text-base font-bold mt-6 mb-2 uppercase tracking-wide text-zinc-900 pl-3"
      style={{ borderLeft: "3px solid #f59e0b" }}
    >
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-base font-semibold text-zinc-700 mt-4 mb-1.5">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-zinc-700 text-sm leading-relaxed mb-3">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-3 space-y-1 pl-1">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-3 space-y-1 pl-1 list-decimal list-inside">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="text-zinc-700 text-sm leading-relaxed flex gap-2">
      <span className="text-amber-500 mt-0.5 shrink-0">•</span>
      <span>{children}</span>
    </li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-zinc-900">{children}</strong>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="mb-4 overflow-x-auto rounded-lg border border-zinc-200">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-zinc-100">{children}</thead>
  ),
  th: ({
    children,
    style,
  }: {
    children?: React.ReactNode;
    style?: React.CSSProperties;
  }) => (
    <th
      className="px-3 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide"
      style={{ textAlign: style?.textAlign ?? "left" }}
    >
      {children}
    </th>
  ),
  td: ({
    children,
    style,
  }: {
    children?: React.ReactNode;
    style?: React.CSSProperties;
  }) => {
    const bold = isDirectlyBold(children);
    return (
      <td
        className={`px-3 border-t ${
          bold
            ? "py-3 border-zinc-300 text-base font-bold text-zinc-900"
            : "py-2.5 border-zinc-200 text-zinc-700"
        }`}
        style={{ textAlign: style?.textAlign ?? "left" }}
      >
        {children}
      </td>
    );
  },
  hr: () => <hr className="border-zinc-200 my-4" />,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="text-zinc-400 text-xs leading-relaxed mb-4 not-italic">
      {children}
    </blockquote>
  ),
};

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
    .eq("user_id", estimate.business_id)
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
          <div className="flex items-start gap-4 pb-5 mb-5 border-b border-slate-200">
            {logoUrl && (
              <Image
                src={logoUrl}
                alt={businessName || "Company logo"}
                width={120}
                height={48}
                className="object-contain shrink-0"
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
          <div className="text-slate-500 text-xs leading-relaxed mb-5 border-t border-slate-100 pt-4">
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
              {new Date(estimate.created_at).toLocaleDateString("en-CA", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>

          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {estimate.summary
              .split("\n")
              .filter((l: string) => !l.startsWith("# "))
              .join("\n")}
          </ReactMarkdown>
        </div>

        <div className="mt-4">
          <DownloadPdfButton
            title={estimate.title}
            summary={estimate.summary}
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
