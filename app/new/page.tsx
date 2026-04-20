"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import { EditableEstimateBody } from "@/app/components/editable-estimate-body";
import { formatPhoneInput } from "@/lib/format-phone";
import remarkGfm from "remark-gfm";
import { Logo } from "@/app/components/logo";
import { BottomNav } from "@/app/components/bottom-nav";
import { SendEstimateSheet } from "@/app/components/send-estimate-sheet";
import { CustomerDetailsBlock } from "@/app/components/customer-details-block";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

function Spinner({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

const inputClass =
  "w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3.5 text-white placeholder-zinc-600 text-base focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]";

const PREFILLS: Record<string, string> = {
  "water-heater": "Replace 50-gallon water heater, Bradford White natural gas unit, new expansion tank, about 3 hours labour.",
  "panel-upgrade": "Upgrade 100A panel to 200A, pull permit, new Square D 200A panel, reconnect all circuits, about 6 hours labour.",
  "drain-cleaning": "Clear blocked main drain, camera inspection, hydro jet if needed.",
  "leak-repair": "Locate and repair pipe leak under kitchen sink, replace shutoff valves, check surrounding connections.",
};

function NewPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [jobDescription, setJobDescription] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [jobAddress, setJobAddress] = useState("");

  const [view, setView] = useState<"form" | "estimate">("form");
  const [generating, setGenerating] = useState(false);
  const [estimate, setEstimate] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [savedEstimateId, setSavedEstimateId] = useState<string | null>(null);
  const [showSendSheet, setShowSendSheet] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [preparedBy, setPreparedBy] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [customerDetailsSaved, setCustomerDetailsSaved] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  const jobPlaceholders = [
    "Replace hot water tank in basement",
    "Install 200 amp electrical panel",
    "Fix leaking pipe under kitchen sink",
    "Install exhaust fan in upstairs bathroom",
    "Repair roof leak over garage",
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % jobPlaceholders.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const key = searchParams.get("prefill");
    if (key && PREFILLS[key]) {
      setJobDescription(PREFILLS[key]);
    }
  }, [searchParams]);

  useEffect(() => {
    fetch("/api/estimates")
      .then((r) => r.json())
      .then((d: { estimates?: unknown[] }) => {
        if (Array.isArray(d?.estimates) && d.estimates.length === 0) {
          setIsFirstTime(true);
        }
      })
      .catch(() => {});
  }, []);

  const needsProfileSetup = !logoUrl && !businessName && !preparedBy && !businessEmail;

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function handleGenerate() {
    setView("estimate");
    setGenerating(true);
    setEstimate("");
    setError("");
    setSaved(false);
    setSavedEstimateId(null);
    setJobTitle("");

    fetch("/api/profile")
      .then((r) => r.json())
      .then(
        (d: {
          profile?: {
            logo_url?: string;
            prepared_by?: string;
            name?: string;
            email?: string;
          };
        }) => {
          if (d?.profile?.logo_url) setLogoUrl(d.profile.logo_url);
          if (d?.profile?.prepared_by) setPreparedBy(d.profile.prepared_by);
          if (d?.profile?.name) setBusinessName(d.profile.name);
          if (d?.profile?.email) setBusinessEmail(d.profile.email);
        }
      )
      .catch(() => {});

    try {
      const res = await fetch("/api/generate-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobDescription,
          customerName: customerName || undefined,
          customerPhone: customerPhone || undefined,
          customerEmail: customerEmail || undefined,
          jobAddress: jobAddress || undefined,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || `Server error ${res.status}`);
      }

      if (!res.body) {
        throw new Error("No response body returned from server");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        let readResult;
        try {
          readResult = await reader.read();
        } catch (streamErr) {
          throw new Error(
            streamErr instanceof Error
              ? streamErr.message
              : "Estimate generation stream failed"
          );
        }

        const { done, value } = readResult;
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const errorMarkerIndex = buffer.indexOf("\n__ERROR__:");
        if (errorMarkerIndex !== -1) {
          const errorMessage = buffer
            .slice(errorMarkerIndex + "\n__ERROR__:".length)
            .trim();
          buffer = buffer.slice(0, errorMarkerIndex);
          setEstimate(buffer);
          throw new Error(errorMessage || "Estimate generation failed");
        }

        const idMarkerIndex = buffer.indexOf("\n__ID__:");
        if (idMarkerIndex !== -1) {
          const id = buffer.slice(idMarkerIndex + "\n__ID__:".length).trim();
          setSavedEstimateId(id);
          buffer = buffer.slice(0, idMarkerIndex);
        }

        const h1Line = buffer.split("\n").find((l) => l.startsWith("# "));
        if (h1Line) setJobTitle(h1Line.replace(/^# /, ""));
        setEstimate(buffer);
      }

      setSaved(true);
    } catch (err) {
      setSaved(false);
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Check your connection and try again."
      );
    } finally {
      setGenerating(false);
    }
  }

  function handleBack() {
    setView("form");
  }

  function handleNewEstimate() {
    setView("form");
    setJobDescription("");
    setCustomerName("");
    setCustomerPhone("");
    setCustomerEmail("");
    setJobAddress("");
    setEstimate("");
    setError("");
    setSaved(false);
    setSavedEstimateId(null);
    setJobTitle("");
    setCustomerDetailsSaved(false);
  }

  if (view === "estimate") {
    return (
      <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
        <header className="px-5 pt-10 pb-4 shrink-0" />

        <main className="flex-1 px-5 pb-52 overflow-auto">
          {generating && !estimate && (
            <div className="flex items-center gap-3 text-zinc-500 mt-4">
              <Spinner className="w-5 h-5 text-amber-500" />
              <span className="text-sm">Writing your estimate...</span>
            </div>
          )}

          {error && (
            <div className="mt-4 bg-red-950 border border-red-800 rounded-xl px-4 py-3.5 text-red-300 text-sm">
              {error}
            </div>
          )}

          {estimate && saved && !generating && !error && needsProfileSetup && (
            <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-4">
              <p className="text-sm font-semibold text-amber-400">Make this look more professional</p>
              <p className="mt-1 text-sm text-zinc-300">
                Add your company details so your next estimate includes your name, logo, and contact info.
              </p>
              <Link
                href={savedEstimateId ? `/profile?next=/estimates/${savedEstimateId}` : "/profile"}
                className="mt-3 flex w-full items-center justify-center rounded-xl bg-amber-500 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400"
              >
                Add Company Details
              </Link>
            </div>
          )}

          {estimate && (
            <div className="mt-2 pb-2">
              <div className="bg-white rounded-2xl p-5 mt-2">
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mb-3">
                  {logoUrl && (
                    <Image
                      src={logoUrl}
                      alt="Company logo"
                      width={160}
                      height={60}
                      className="object-contain"
                      unoptimized
                    />
                  )}
                  {businessName && (
                    <span className="text-lg font-semibold text-zinc-700">{businessName}</span>
                  )}
                </div>
                <span className="mt-3 inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-500">
                  Estimate
                </span>
                {jobTitle && (
                  <h1 className="mt-1 text-3xl font-bold tracking-tight leading-tight text-zinc-900 break-words">
                    {jobTitle}
                  </h1>
                )}
                <CustomerDetailsBlock
                  estimateId={savedEstimateId}
                  initialName={customerName}
                  initialPhone={customerPhone}
                  initialEmail={customerEmail}
                  initialAddress={jobAddress}
                  preparedBy={preparedBy}
                  companyName={businessName || undefined}
                  businessEmail={businessEmail || undefined}
                  dateStr={new Date().toISOString()}
                />
                {savedEstimateId ? (
                  <EditableEstimateBody
                    summary={estimate}
                    estimateId={savedEstimateId}
                  />
                ) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ children }) => (
                        <h1 className="text-xl font-bold text-zinc-900 mt-6 mb-2 first:mt-0">
                          {children}
                        </h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="text-base font-bold text-zinc-900 mt-6 mb-2 uppercase tracking-wide">
                          {children}
                        </h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-base font-semibold text-zinc-700 mt-4 mb-1.5">
                          {children}
                        </h3>
                      ),
                      p: ({ children }) => (
                        <p className="text-zinc-700 text-sm leading-relaxed mb-3">{children}</p>
                      ),
                      ul: ({ children }) => <ul className="mb-3 space-y-1 pl-1">{children}</ul>,
                      ol: ({ children }) => (
                        <ol className="mb-3 space-y-1 pl-1 list-decimal list-inside">{children}</ol>
                      ),
                      li: ({ children }) => (
                        <li className="text-zinc-700 text-sm leading-relaxed flex gap-2">
                          <span className="text-amber-500 mt-0.5 shrink-0">•</span>
                          <span>{children}</span>
                        </li>
                      ),
                      strong: ({ children }) => (
                        <strong className="font-semibold text-zinc-900">{children}</strong>
                      ),
                      table: ({ children }) => (
                        <div className="mb-4 overflow-x-auto rounded-lg border border-zinc-200">
                          <table className="w-full text-sm">{children}</table>
                        </div>
                      ),
                      thead: ({ children }) => <thead className="bg-zinc-100">{children}</thead>,
                      th: ({ children, style }) => (
                        <th
                          className="px-3 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide"
                          style={{ textAlign: style?.textAlign ?? "left" }}
                        >
                          {children}
                        </th>
                      ),
                      td: ({ children, style }) => (
                        <td
                          className="px-3 py-2.5 text-zinc-700 border-t border-zinc-200"
                          style={{ textAlign: style?.textAlign ?? "left" }}
                        >
                          {children}
                        </td>
                      ),
                      hr: () => <hr className="border-zinc-200 my-4" />,
                      blockquote: ({ children }) => (
                        <blockquote className="text-zinc-400 text-xs leading-relaxed mb-4 not-italic">
                          {children}
                        </blockquote>
                      ),
                    }}
                  >
                    {estimate
                      .split("\n")
                      .filter((l) => !l.startsWith("# "))
                      .join("\n")}
                  </ReactMarkdown>
                )}
                {saved && !generating && !error && (
                  <p className="mt-4 text-xs text-zinc-400 flex items-center gap-1.5">
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      className="w-3.5 h-3.5 text-green-500 shrink-0"
                      aria-hidden="true"
                    >
                      <path
                        d="M3 8l3.5 3.5L13 4.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Estimate saved
                  </p>
                )}
              </div>
            </div>
          )}
        </main>

        <div className="fixed bottom-0 left-0 right-0">
          <div className="px-5 pb-3 pt-4 bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent pointer-events-none flex flex-col gap-3">
            {generating && (
              <div className="flex items-center justify-center gap-2 text-zinc-400 text-sm pointer-events-none">
                <Spinner className="w-4 h-4 text-amber-500" />
                <span>Writing estimate...</span>
              </div>
            )}
            {!generating && (
              <button
                type="button"
                onClick={handleBack}
                className="w-full pointer-events-auto bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
              >
                Edit job
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSendSheet(true)}
              disabled={generating || !saved}
              className="w-full pointer-events-auto bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Send Estimate
            </button>
          </div>
          <BottomNav onNewClick={handleNewEstimate} />
        </div>

        <SendEstimateSheet
          isOpen={showSendSheet}
          onClose={() => setShowSendSheet(false)}
          estimateId={savedEstimateId ?? undefined}
          customerPhone={customerPhone}
          customerEmail={customerEmail}
          title={jobTitle || undefined}
          summary={estimate || undefined}
          businessName={businessName || undefined}
          logoUrl={logoUrl}
        />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
      <header className="px-5 pt-10 pb-6 shrink-0">
        <Logo />
      </header>

      <main className="flex-1 px-5 pb-52 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          {isFirstTime && (
            <p className="text-sm text-zinc-400 mb-2">
              Try it now. Describe any job, real or made up.
            </p>
          )}
          <textarea
            className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3.5 text-white placeholder-zinc-500 text-base leading-relaxed resize-none focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-40"
            placeholder={jobPlaceholders[placeholderIndex]}
            rows={6}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            autoFocus
          />
          <p className="text-xs text-zinc-500">
            A sentence or two is enough. The more detail you give, the better the estimate.
          </p>
        </div>

        <p className="text-sm text-zinc-400">Customer details</p>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-400">Customer name</label>
            <input
              type="text"
              className={inputClass}
              placeholder="Jane Smith"
              value={customerName}
              onChange={(e) => {
                setCustomerName(e.target.value);
                setCustomerDetailsSaved(false);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-400">Phone</label>
            <input
              type="tel"
              className={inputClass}
              placeholder="000-000-0000"
              value={customerPhone}
              onChange={(e) => {
                setCustomerPhone(formatPhoneInput(e.target.value));
                setCustomerDetailsSaved(false);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-400">Email</label>
            <input
              type="email"
              className={inputClass}
              placeholder="customer@example.com"
              value={customerEmail}
              onChange={(e) => {
                setCustomerEmail(e.target.value);
                setCustomerDetailsSaved(false);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-400">Job address</label>
            <input
              type="text"
              className={inputClass}
              placeholder="123 Main St, Suburb"
              value={jobAddress}
              onChange={(e) => {
                setJobAddress(e.target.value);
                setCustomerDetailsSaved(false);
              }}
            />
          </div>

          {saved && (
            <button
              type="button"
              onClick={() => {
                setCustomerDetailsSaved(true);
                setTimeout(() => setCustomerDetailsSaved(false), 3000);
              }}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-sm rounded-xl py-3 transition-colors min-h-[44px] flex items-center justify-center gap-2"
            >
              {customerDetailsSaved ? (
                <>
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    className="w-4 h-4 text-green-400"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 8l3.5 3.5L13 4.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="text-green-400">Details saved</span>
                </>
              ) : (
                "Save Details"
              )}
            </button>
          )}
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0">
        <div className="px-5 pt-8 pb-3 bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent pointer-events-none flex flex-col gap-3">
          {saved && (
            <button
              type="button"
              onClick={() => setView("estimate")}
              className="w-full pointer-events-auto bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Back to Estimate
            </button>
          )}
          <button
            type="button"
            disabled={!jobDescription.trim()}
            onClick={handleGenerate}
            className="w-full pointer-events-auto bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
          >
            {saved ? "Regenerate Estimate" : "Generate Estimate"}
          </button>
        </div>
        <BottomNav />
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense>
      <NewPageInner />
    </Suspense>
  );
}
