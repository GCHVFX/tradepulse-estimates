"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EditableEstimateBody } from "@/app/components/editable-estimate-body";
import { CompanyEstimateHeader } from "@/app/components/company-estimate-header";
import { EstimateMarkdown } from "@/app/components/estimate-markdown";
import { formatPhoneInput } from "@/lib/format-phone";
import { Logo } from "@/app/components/logo";
import { BottomNav } from "@/app/components/bottom-nav";
import { SendEstimateSheet } from "@/app/components/send-estimate-sheet";
import { CustomerDetailsBlock } from "@/app/components/customer-details-block";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { useBusinessProfile } from "@/lib/hooks/use-business-profile";
import { Spinner } from "@/app/components/spinner";

const inputClass =
  "w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3.5 text-white placeholder-zinc-600 text-base focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]";

const PREFILLS: Record<string, string> = {
  "water-heater": "Replace 50-gallon water heater, Bradford White natural gas unit, new expansion tank, about 3 hours labour.",
  "panel-upgrade": "Upgrade 100A panel to 200A, pull permit, new Square D 200A panel, reconnect all circuits, about 6 hours labour.",
  "drain-cleaning": "Clear blocked main drain, camera inspection, hydro jet if needed.",
  "leak-repair": "Locate and repair pipe leak under kitchen sink, replace shutoff valves, check surrounding connections.",
};

const jobPlaceholders = [
  "Replace hot water tank in basement",
  "Install 200 amp electrical panel",
  "Fix leaking pipe under kitchen sink",
  "Install exhaust fan in upstairs bathroom",
  "Repair roof leak over garage",
];

interface EstimateViewProps {
  generating: boolean;
  estimate: string;
  error: string;
  saved: boolean;
  savedEstimateId: string | null;
  needsProfileSetup: boolean;
  logoUrl: string | null;
  businessName: string;
  businessEmail: string;
  preparedBy: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  jobAddress: string;
  jobTitle: string;
  showSendSheet: boolean;
  setShowSendSheet: (v: boolean) => void;
  onBack: () => void;
  onNewEstimate: () => void;
}

interface FormViewProps {
  jobDescription: string;
  setJobDescription: (v: string) => void;
  customerName: string;
  setCustomerName: (v: string) => void;
  customerPhone: string;
  setCustomerPhone: (v: string) => void;
  customerEmail: string;
  setCustomerEmail: (v: string) => void;
  jobAddress: string;
  setJobAddress: (v: string) => void;
  customerDetailsSaved: boolean;
  setCustomerDetailsSaved: (v: boolean) => void;
  saved: boolean;
  jobPlaceholders: string[];
  placeholderIndex: number;
  isFirstTime: boolean;
  error: string;
  onGenerate: () => void;
  onViewEstimate: () => void;
}

function EstimateView({
  generating,
  estimate,
  error,
  saved,
  savedEstimateId,
  needsProfileSetup,
  logoUrl,
  businessName,
  businessEmail,
  preparedBy,
  customerName,
  customerPhone,
  customerEmail,
  jobAddress,
  jobTitle,
  showSendSheet,
  setShowSendSheet,
  onBack,
  onNewEstimate,
}: EstimateViewProps) {
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
              <CompanyEstimateHeader logoUrl={logoUrl} businessName={businessName} />
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
                  key={savedEstimateId ?? "default"}
                  summary={estimate}
                  estimateId={savedEstimateId}
                />
              ) : (
                <EstimateMarkdown
                  content={estimate
                    .split("\n")
                    .filter((l) => !l.startsWith("# "))
                    .join("\n")}
                />
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
              onClick={onBack}
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
        <BottomNav onNewClick={onNewEstimate} />
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

function FormView({
  jobDescription,
  setJobDescription,
  customerName,
  setCustomerName,
  customerPhone,
  setCustomerPhone,
  customerEmail,
  setCustomerEmail,
  jobAddress,
  setJobAddress,
  customerDetailsSaved,
  setCustomerDetailsSaved,
  saved,
  jobPlaceholders: placeholders,
  placeholderIndex,
  isFirstTime,
  error,
  onGenerate,
  onViewEstimate,
}: FormViewProps) {
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
            placeholder={placeholders[placeholderIndex]}
            rows={6}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            autoFocus
          />
          <p className="text-xs text-zinc-500">
            A sentence or two is enough. The more detail you give, the better the estimate.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-zinc-800" />
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Customer details</p>
          <div className="h-px flex-1 bg-zinc-800" />
        </div>

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
              onClick={onViewEstimate}
              className="w-full pointer-events-auto bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Back to Estimate
            </button>
          )}
          {error && (
            <p className="text-red-400 text-sm text-center pointer-events-auto">{error}</p>
          )}
          <button
            type="button"
            disabled={!jobDescription.trim()}
            onClick={onGenerate}
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
  const [customerDetailsSaved, setCustomerDetailsSaved] = useState(false);
  const { logoUrl, businessName, businessEmail, preparedBy, isLoading: profileLoading } = useBusinessProfile();
  const [jobTitle, setJobTitle] = useState("");
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

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

  const needsProfileSetup = !profileLoading && !logoUrl && !businessName && !preparedBy && !businessEmail;

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
      setView("form");
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
      <EstimateView
        generating={generating}
        estimate={estimate}
        error={error}
        saved={saved}
        savedEstimateId={savedEstimateId}
        needsProfileSetup={needsProfileSetup}
        logoUrl={logoUrl}
        businessName={businessName}
        businessEmail={businessEmail}
        preparedBy={preparedBy}
        customerName={customerName}
        customerPhone={customerPhone}
        customerEmail={customerEmail}
        jobAddress={jobAddress}
        jobTitle={jobTitle}
        showSendSheet={showSendSheet}
        setShowSendSheet={setShowSendSheet}
        onBack={handleBack}
        onNewEstimate={handleNewEstimate}
      />
    );
  }

  return (
    <FormView
      jobDescription={jobDescription}
      setJobDescription={setJobDescription}
      customerName={customerName}
      setCustomerName={setCustomerName}
      customerPhone={customerPhone}
      setCustomerPhone={setCustomerPhone}
      customerEmail={customerEmail}
      setCustomerEmail={setCustomerEmail}
      jobAddress={jobAddress}
      setJobAddress={setJobAddress}
      customerDetailsSaved={customerDetailsSaved}
      setCustomerDetailsSaved={setCustomerDetailsSaved}
      saved={saved}
      jobPlaceholders={jobPlaceholders}
      placeholderIndex={placeholderIndex}
      isFirstTime={isFirstTime}
      error={error}
      onGenerate={handleGenerate}
      onViewEstimate={() => setView("estimate")}
    />
  );
}

export default function Home() {
  return (
    <Suspense>
      <NewPageInner />
    </Suspense>
  );
}
