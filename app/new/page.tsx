"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CompanyEstimateHeader } from "@/app/components/company-estimate-header";
import { EstimateMarkdown } from "@/app/components/estimate-markdown";
import { stripTitleHeading } from "@/lib/estimate-prose";
import { STARTER_MONTHLY_PHOTO_LIMIT } from "@/lib/rate-limit";
import { formatPhoneInput } from "@/lib/format-phone";
import { Logo } from "@/app/components/logo";
import { BottomNav } from "@/app/components/bottom-nav";
import { PhotoSourceSheet } from "@/app/components/photo-source-sheet";
import { CustomerDetailsBlock } from "@/app/components/customer-details-block";
import {
  ContractorPricingEditor,
  type ContractorPricingEditorHandle,
  type ContractorPricingEditorState,
  type ContractorPricingSaveStatus,
} from "@/app/components/contractor-pricing-editor";
import type { ContractorPricing } from "@/lib/contractor-pricing";
import type { BusinessPricingDefaults, ContractorPricingRowInput, EstimateTaxSnapshot } from "@/lib/contractor-pricing-form";
import type { PriceBookSuggestion } from "@/lib/pricebook-suggestions";
import { currencyOrDefault, type Currency } from "@/lib/currency";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { useBusinessProfile } from "@/lib/hooks/use-business-profile";
import { Spinner } from "@/app/components/spinner";
import { usePostHog } from "posthog-js/react";

/**
 * The one authoritative source /new's same-page pricing editor initializes
 * from: GET /api/estimates/{id}/pricing, the estimate's own persisted rows
 * and snapshots (specs/contractor-owned-pricing.md's authority rule, the
 * exact same values the detail page's server component reads). `defaults`
 * is the only business-level piece here -- an offered starting point for a
 * still-empty labour or materials row, never a substitute for the
 * estimate's own currency, tax or deposit. Fetched once per estimate id,
 * never reconstructed from the current business Rates or from prose.
 */
interface PricingInit {
  currency: Currency;
  isDelivered: boolean;
  initialRows: ContractorPricingRowInput[];
  initialTax: EstimateTaxSnapshot;
  initialPricing: ContractorPricing;
  defaults: BusinessPricingDefaults;
  depositPercent: number | null;
  depositThresholdDollars: number | null;
  /**
   * Saved-item suggestions matched against the contractor's own typed job
   * description only, never photoAnalysis (Phase 2 slice 4). Only /new can
   * supply this: it is the one surface still holding that text in session.
   */
  suggestions: PriceBookSuggestion[];
}

type PricingLoadState = "idle" | "loading" | "ready" | "error" | "legacy" | "delivered";

/**
 * Client-side cap on the job text sent as the jobText match query param,
 * applied before it is placed in the query string (the truncation point).
 * The route applies its own defensive 2000-char cap server-side; this is a
 * separate, smaller, deliberate limit on what a legitimate client ever sends.
 */
const MATCH_JOB_TEXT_MAX_LENGTH = 1000;

const inputClass =
  "w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3.5 text-white placeholder-zinc-600 text-base focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]";

const PREFILLS: Record<string, string> = {
  "water-heater": "Replace 50-gallon water heater, Bradford White natural gas unit, new expansion tank, about 3 hours labour.",
  "panel-upgrade": "Upgrade 100A panel to 200A, pull permit, new Square D 200A panel, reconnect all circuits, about 6 hours labour.",
  "drain-cleaning": "Clear blocked main drain, camera inspection, hydro jet if needed.",
  "leak-repair": "Locate and repair pipe leak under kitchen sink, replace shutoff valves, check surrounding connections.",
};

const EXAMPLE_CHIPS = [
  { label: "Water Heater Replacement", text: "Replace 50-gallon gas water heater. New unit, expansion tank, about 3 hours labour." },
  { label: "Electrical Panel Upgrade", text: "Upgrade 100A panel to 200A. Pull permit, new Square D panel, reconnect all circuits, about 6 hours." },
] as const;

const PHOTO_LIMIT_REACHED_MESSAGE = `You've used your ${STARTER_MONTHLY_PHOTO_LIMIT} free AI photo estimates this month. Upgrade to Pro for unlimited AI photo estimates.`;

const jobPlaceholders = [
  "Replace hot water tank in basement",
  "Install 200 amp electrical panel",
  "Fix leaking pipe under kitchen sink",
  "Install exhaust fan in upstairs bathroom",
  "Repair roof leak over garage",
];

// Reject oversized files before the browser tries to decode them at native
// resolution -- that decode happens before any downscaling and can freeze or
// crash the tab on a very large source image
const MAX_PHOTO_FILE_BYTES = 20 * 1024 * 1024;

// Downscale to keep camera photos under the API image size limit
async function resizePhotoToJpeg(file: File): Promise<{ dataUrl: string; base64: string }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that photo. Try a JPEG or PNG."));
      el.src = objectUrl;
    });
    const maxEdge = 1568;
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process the photo on this device.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { dataUrl, base64: dataUrl.split(",")[1] };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

interface PhotoEntry {
  id: string;
  base64: string;
  preview: string;
  note: string;
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M3 8.5a2 2 0 012-2h1.4l1.2-1.8a1.5 1.5 0 011.25-.7h6.3a1.5 1.5 0 011.25.7l1.2 1.8H19a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2V8.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Longest a dictation can run before it auto-stops and transcribes
const MAX_RECORDING_SECONDS = 120;

function pickAudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not process the recording."));
    reader.readAsDataURL(blob);
  });
}

function formatRecordingTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

interface EstimateViewProps {
  generating: boolean;
  estimateStarted: boolean;
  estimate: string;
  error: string;
  saved: boolean;
  savedEstimateId: string | null;
  needsProfileSetup: boolean;
  logoUrl: string | null;
  businessName: string;
  showCompanyNameBelowLogo: boolean;
  businessEmail: string;
  preparedBy: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  jobAddress: string;
  jobTitle: string;
  pricingLoadState: PricingLoadState;
  pricingInit: PricingInit | null;
  pricingComplete: boolean;
  /**
   * Called with the editor's own resolved send-readiness (pricing.complete
   * AND not dirty since that save) after every change. This is the one
   * write path for pricingComplete once the editor has mounted -- a pure
   * mirror of what the editor reports, never a value this page infers on
   * its own from separate signals.
   */
  onPricingCompleteChange: (complete: boolean) => void;
  onRetryPricingInit: () => void;
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
  needsProfileSetup: boolean;
  isPro: boolean;
  aiPhotoEstimatesRemaining: number | null;
  error: string;
  photos: PhotoEntry[];
  setPhotos: React.Dispatch<React.SetStateAction<PhotoEntry[]>>;
  photoError: string;
  setPhotoError: (v: string) => void;
  photoAnalysing: boolean;
  onGenerate: () => void;
  onViewEstimate: () => void;
}

function EstimateView({
  generating,
  estimateStarted,
  estimate,
  error,
  saved,
  savedEstimateId,
  needsProfileSetup,
  logoUrl,
  businessName,
  showCompanyNameBelowLogo,
  businessEmail,
  preparedBy,
  customerName,
  customerPhone,
  customerEmail,
  jobAddress,
  jobTitle,
  pricingLoadState,
  pricingInit,
  pricingComplete,
  onPricingCompleteChange,
  onRetryPricingInit,
  onBack,
  onNewEstimate,
}: EstimateViewProps) {
  const estimateScrollRef = useRef<HTMLElement | null>(null);
  // The editor's own imperative handle, so the sticky Save Pricing CTA can
  // call the exact same save() its (now hidden) inline button would.
  const pricingEditorRef = useRef<ContractorPricingEditorHandle>(null);
  // True once the contractor has explicitly entered pricing this mount
  // (tapped Add Pricing). Local to this component on purpose: EstimateView
  // itself fully unmounts on "Back to Description" (NewPageInner renders a
  // different top-level component, FormView, in its place) and on every
  // generate/regenerate cycle (which always starts from FormView), so this
  // resets to false for free on both without any explicit reset call.
  const [pricingEntered, setPricingEntered] = useState(false);
  // Mirrors only what ContractorPricingEditor reports via onStateChange --
  // never independently inferred. pricingComplete (sendReady) is reported
  // through the same callback but owned one level up in NewPageInner, since
  // it must survive this component's own unmount/remount (see its prop
  // comment above).
  const [pricingEditorState, setPricingEditorState] = useState<{
    status: ContractorPricingSaveStatus;
    isDirty: boolean;
  }>({ status: "idle", isDirty: false });

  function handlePricingEditorStateChange(state: ContractorPricingEditorState) {
    setPricingEditorState({ status: state.status, isDirty: state.isDirty });
    onPricingCompleteChange(state.sendReady);
  }

  function handleStickySavePricing() {
    pricingEditorRef.current?.save();
  }

  // Same-page pricing: no navigation, so /new can scroll to its own already-
  // mounted pricing editor synchronously on tap, unlike the detail page's
  // hash-based fallback (ec57bcb), which exists for a real route transition
  // and stays untouched -- and is reused below as the exceptional fallback
  // if this page's own authoritative pricing read fails.
  function scrollToPricing() {
    setPricingEntered(true);
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("pricing")?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }

  const pricingReady = saved && savedEstimateId && !generating && !error && pricingLoadState === "ready" && pricingInit;

  useEffect(() => {
    if (!generating) return;

    const frame = requestAnimationFrame(() => {
      const el = estimateScrollRef.current;
      if (el && el.scrollHeight > el.clientHeight) {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      } else {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [estimate, generating]);

  // When generation finishes, jump back to the top so the contractor sees the
  // start of the estimate, not the middle of a wall of text.
  useEffect(() => {
    if (generating || !estimate || error) return;

    const frame = requestAnimationFrame(() => {
      const el = estimateScrollRef.current;
      if (el) {
        el.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [generating, estimate, error]);

  return (
    <div className="h-dvh bg-zinc-950 text-white flex flex-col">
      <header className="px-5 pt-10 pb-4 shrink-0" />

      <main ref={estimateScrollRef} className="flex-1 min-h-0 px-5 pb-52 overflow-y-auto">
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
              <CompanyEstimateHeader
                logoUrl={logoUrl}
                businessName={businessName}
                showCompanyNameBelowLogo={showCompanyNameBelowLogo}
                preparedBy={preparedBy}
              />
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
                companyName={businessName || undefined}
                businessEmail={businessEmail || undefined}
                dateStr={new Date().toISOString()}
              />
              {/* The job wording, and nothing else. A generated estimate
                  carries no prices at all now: the contractor enters those
                  in the pricing editor on the saved record, so this screen
                  renders no money and needs no currency or tax.

                  While the stream is open this is the live buffer, which is
                  a progress view and is never saved from here. The moment
                  the server sends the saved record back (__SAVED__), the
                  buffer is thrown away and replaced by it, so sentences the
                  price-safety filter removed cannot stay on screen and
                  cannot be written back on a later save. */}
              <EstimateMarkdown content={stripTitleHeading(estimate)} />
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
              {saved && savedEstimateId && !generating && !error && pricingLoadState === "loading" && (
                <p className="mt-4 text-sm text-zinc-500">Loading pricing...</p>
              )}
              {saved && savedEstimateId && !generating && !error && pricingLoadState === "error" && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5">
                  <p className="text-sm text-red-700">
                    Pricing could not be loaded on this page.
                  </p>
                  <div className="mt-3 flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={onRetryPricingInit}
                      className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 min-h-[44px]"
                    >
                      Retry
                    </button>
                    {/* The exceptional fallback: a real route transition to
                        the detail page, kept safe only because pricing
                        could not be confirmed authoritative here -- never
                        used on the healthy path. */}
                    <Link
                      href={`/estimates/${savedEstimateId}#pricing`}
                      className="flex items-center justify-center rounded-lg border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 min-h-[44px]"
                    >
                      Add Pricing on the estimate page
                    </Link>
                  </div>
                </div>
              )}
              {/* Legacy: not a transient failure, so no Retry -- there is
                  nothing to retry. This estimate never gets an inline
                  pricing editor at all. */}
              {saved && savedEstimateId && !generating && !error && pricingLoadState === "legacy" && (
                <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3.5">
                  <p className="text-sm text-zinc-700">
                    This estimate uses the previous pricing system and cannot be repriced here.
                  </p>
                  <Link
                    href={`/estimates/${savedEstimateId}`}
                    className="mt-3 flex w-full items-center justify-center rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 min-h-[44px]"
                  >
                    View Estimate
                  </Link>
                </div>
              )}
              {/* Delivered: defensive only. The generate/regenerate route
                  already refuses a delivered estimate, so this should be
                  unreachable in normal use -- no new workflow, no repricing
                  UI, just a way off this page if it is ever reached. */}
              {saved && savedEstimateId && !generating && !error && pricingLoadState === "delivered" && (
                <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3.5">
                  <p className="text-sm text-zinc-700">
                    This estimate has already gone to the customer and cannot be repriced.
                  </p>
                  <Link
                    href={`/estimates/${savedEstimateId}`}
                    className="mt-3 flex w-full items-center justify-center rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 min-h-[44px]"
                  >
                    View Estimate
                  </Link>
                </div>
              )}
              {pricingReady && pricingInit && (
                <div className="mt-6">
                  <ContractorPricingEditor
                    ref={pricingEditorRef}
                    key={savedEstimateId}
                    estimateId={savedEstimateId}
                    currency={pricingInit.currency}
                    initialRows={pricingInit.initialRows}
                    initialTax={pricingInit.initialTax}
                    initialPricing={pricingInit.initialPricing}
                    defaults={pricingInit.defaults}
                    isDelivered={pricingInit.isDelivered}
                    depositPercent={pricingInit.depositPercent}
                    depositThresholdDollars={pricingInit.depositThresholdDollars}
                    suggestions={pricingInit.suggestions}
                    onStateChange={handlePricingEditorStateChange}
                    hideInlineSaveButton
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0">
        <div className="px-5 pb-6 pt-4 bg-zinc-950 border-t border-zinc-800 flex flex-col gap-3">
          {generating && !estimateStarted && (
            <div className="flex items-center justify-center gap-2 text-zinc-400 text-sm">
              <Spinner className="w-4 h-4 text-amber-500" />
              <span>Writing estimate...</span>
            </div>
          )}
          {!generating && (
            <button
              type="button"
              onClick={onBack}
              className="w-full flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
                <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back to Description
            </button>
          )}
          {/* One primary action at a time:
                - not yet saved, or pricing still loading: disabled
                - authoritative pricing failed to load: the exceptional
                  route-transition fallback, so the contractor is never
                  trapped
                - legacy (previous pricing system) or delivered (already
                  sent -- defensive only, should be unreachable in normal
                  use): a plain View Estimate link, no pricing action at all
                - loaded, not yet entered: Add Pricing scrolls to the editor
                  on this same page (no navigation) and marks pricing entered
                - loaded, entered, not yet sendReady (never saved, saved but
                  incomplete, or dirty since the last save): Save Pricing
                  invokes the editor's own save() through its imperative
                  handle -- never a second save implementation
                - loaded and sendReady (saved, complete, and no edit since):
                  Continue to Send, the only place this screen hands off to
                  the detail page's own Send flow
              Never two of these at once. */}
          {!saved || !savedEstimateId ? (
            <button
              type="button"
              disabled
              className="w-full bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Add Pricing
            </button>
          ) : pricingLoadState === "loading" ? (
            <button
              type="button"
              disabled
              className="w-full bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Loading pricing...
            </button>
          ) : pricingLoadState === "error" ? (
            <Link
              href={`/estimates/${savedEstimateId}#pricing`}
              className="w-full flex items-center justify-center bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Add Pricing
            </Link>
          ) : pricingLoadState === "legacy" || pricingLoadState === "delivered" ? (
            <Link
              href={`/estimates/${savedEstimateId}`}
              className="w-full flex items-center justify-center bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              View Estimate
            </Link>
          ) : pricingComplete ? (
            <Link
              href={`/estimates/${savedEstimateId}`}
              className="w-full flex items-center justify-center bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Continue to Send
            </Link>
          ) : pricingEntered ? (
            <button
              type="button"
              onClick={handleStickySavePricing}
              disabled={pricingEditorState.status === "saving"}
              className="w-full flex items-center justify-center bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-50 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              {pricingEditorState.status === "saving" ? "Saving..." : "Save Pricing"}
            </button>
          ) : (
            <button
              type="button"
              onClick={scrollToPricing}
              className="w-full flex items-center justify-center bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Add Pricing
            </button>
          )}
        </div>
        <BottomNav onNewClick={onNewEstimate} />
      </div>
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
  needsProfileSetup,
  isPro,
  aiPhotoEstimatesRemaining,
  error,
  photos,
  setPhotos,
  photoError,
  setPhotoError,
  photoAnalysing,
  onGenerate,
  onViewEstimate,
}: FormViewProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const [showPhotoSourceSheet, setShowPhotoSourceSheet] = useState(false);
  // Treat an unknown remaining count (still loading, or a Pro account where
  // it's always null) as "let them tap" -- the server is the real gate per
  // the /api/analyze-photo check, this is only ever a proactive UI hint.
  const canUsePhotos = isPro || (aiPhotoEstimatesRemaining ?? 1) > 0;

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [dictationError, setDictationError] = useState("");
  // Regenerating rewrites the wording on an estimate that is already saved,
  // so it asks first. The pricing on that estimate is not touched, and the
  // confirmation says so.
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
    };
  }, []);

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
    recordTimerRef.current = null;
    autoStopTimerRef.current = null;
    setRecording(false);
  }

  async function handleRecordingStopped(mimeType: string) {
    setTranscribing(true);
    try {
      const blob = new Blob(audioChunksRef.current, { type: mimeType });
      audioChunksRef.current = [];
      const audioBase64 = await blobToBase64(blob);
      const res = await fetch("/api/transcribe-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64, mimeType: mimeType.split(";")[0] }),
      });
      const data = (await res.json().catch(() => null)) as
        | { transcription?: string; error?: string }
        | null;
      if (!res.ok || !data?.transcription) {
        throw new Error(data?.error || "Could not transcribe that recording. Try again.");
      }
      const trimmed = jobDescription.trim();
      setJobDescription(trimmed ? `${trimmed} ${data.transcription}` : data.transcription);
    } catch (err) {
      setDictationError(
        err instanceof Error ? err.message : "Could not transcribe that recording. Try again."
      );
    } finally {
      setTranscribing(false);
    }
  }

  async function startRecording() {
    setDictationError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setDictationError("This browser doesn't support microphone recording. Try updating it or use a different browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        void handleRecordingStopped(recorder.mimeType || mimeType || "audio/webm");
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
      autoStopTimerRef.current = setTimeout(stopRecording, MAX_RECORDING_SECONDS * 1000);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setDictationError(
          "Microphone access is blocked for this site. Tap the icon next to the address bar, allow microphone access, then tap the mic again. No need to reload."
        );
      } else if (name === "NotFoundError") {
        setDictationError("No microphone found on this device.");
      } else if (name === "NotReadableError") {
        setDictationError("Your microphone is being used by another app. Close it and try again.");
      } else {
        setDictationError("Could not access the microphone. Try again.");
      }
    }
  }

  const posthog = usePostHog();
  useEffect(() => {
    if (isFirstTime) {
      const supabase = createSupabaseBrowserClient();
      supabase.auth.getUser().then(({ data }) => {
        if (data.user) {
          posthog.identify(data.user.id, { email: data.user.email });
        }
      });
    }
  }, [isFirstTime, posthog]);

  async function handlePhotoAdded(file: File) {
    if (photos.length >= 5) return;
    setPhotoError("");
    if (file.size > MAX_PHOTO_FILE_BYTES) {
      setPhotoError("That photo is too large. Try a smaller one.");
      return;
    }
    try {
      const { dataUrl, base64 } = await resizePhotoToJpeg(file);
      setPhotos((prev) =>
        prev.length >= 5
          ? prev
          : [...prev, { id: crypto.randomUUID(), base64, preview: dataUrl, note: "" }]
      );
    } catch (err) {
      setPhotoError(
        err instanceof Error ? err.message : "Could not read that photo. Try again."
      );
    }
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
      <header className="px-5 pt-10 pb-6 shrink-0">
        <Logo />
        {isFirstTime && (
          <p className="text-zinc-400 text-sm mt-3">Try it with any job description, or tap a preset below.</p>
        )}
      </header>

      <main className="flex-1 px-5 pb-52 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          {(!isFirstTime || recording || transcribing) && (
            <p className={`text-xs ${recording ? "text-red-400" : "text-zinc-300"}`}>
              {recording
                ? `Recording... ${formatRecordingTime(recordSeconds)} · tap mic to stop`
                : transcribing
                ? "Transcribing..."
                : "Describe the job."}
            </p>
          )}
          <div className="relative pb-6">
            <textarea
              ref={textareaRef}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3.5 text-white placeholder-zinc-400 text-base leading-relaxed resize-none focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-40"
              placeholder={placeholders[placeholderIndex]}
              rows={6}
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              autoFocus
            />
            <div className="absolute right-2.5 bottom-0 flex gap-3">
              <button
                type="button"
                disabled={transcribing}
                onClick={recording ? stopRecording : startRecording}
                aria-label={recording ? "Stop recording" : "Dictate job description"}
                className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                  recording ? "bg-red-500 text-white animate-pulse" : "bg-amber-500 text-zinc-950 hover:bg-amber-400"
                }`}
              >
                {transcribing ? <Spinner className="w-5 h-5" /> : <MicIcon className="w-6 h-6" />}
              </button>
              <button
                type="button"
                disabled={photoAnalysing || photos.length >= 5}
                onClick={() =>
                  canUsePhotos
                    ? setShowPhotoSourceSheet(true)
                    : setPhotoError(PHOTO_LIMIT_REACHED_MESSAGE)
                }
                aria-label="Add photos for AI analysis"
                className="relative w-12 h-12 rounded-full flex items-center justify-center bg-amber-500 text-zinc-950 hover:bg-amber-400 shadow-lg disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                <CameraIcon className="w-6 h-6" />
              </button>
            </div>
          </div>
          {!isPro && aiPhotoEstimatesRemaining !== null && aiPhotoEstimatesRemaining > 0 && (
            <p className="text-xs text-zinc-400">
              {aiPhotoEstimatesRemaining} of {STARTER_MONTHLY_PHOTO_LIMIT} AI photo estimates left this month
            </p>
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handlePhotoAdded(file);
            }}
          />
          <input
            ref={libraryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handlePhotoAdded(file);
            }}
          />
          {dictationError && <p className="text-red-400 text-sm">{dictationError}</p>}
          {photos.length > 0 && (
            <p className="text-xs text-zinc-400 pt-1">Photos ({photos.length}/5)</p>
          )}
          {photos.length > 0 && (
            <div className="flex flex-col gap-3">
              {photos.map((photo) => (
                <div key={photo.id} className="flex items-start gap-3">
                  <div className="relative shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.preview}
                      alt="Job site photo"
                      className="h-20 w-20 rounded-xl border border-zinc-700 object-cover"
                    />
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => {
                        setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
                      }}
                      className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-zinc-600 bg-zinc-800 text-zinc-300 hover:text-white transition-colors"
                    >
                      <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3" aria-hidden="true">
                        <path
                          d="M2.5 2.5l7 7M9.5 2.5l-7 7"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                  <input
                    type="text"
                    maxLength={200}
                    placeholder="Add a note..."
                    value={photo.note}
                    onChange={(e) =>
                      setPhotos((prev) =>
                        prev.map((p) =>
                          p.id === photo.id ? { ...p, note: e.target.value } : p
                        )
                      )
                    }
                    className="flex-1 min-w-0 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]"
                  />
                </div>
              ))}
            </div>
          )}
          {photoError && (
            <p className="text-red-400 text-sm">
              {photoError === PHOTO_LIMIT_REACHED_MESSAGE ? (
                <>
                  You&apos;ve used your {STARTER_MONTHLY_PHOTO_LIMIT} free AI photo estimates this month.{" "}
                  <Link href="/subscribe" className="underline hover:text-red-300">
                    Upgrade to Pro
                  </Link>{" "}
                  for unlimited AI photo estimates.
                </>
              ) : (
                photoError
              )}
            </p>
          )}
          {isFirstTime && (
            <div className="flex flex-col gap-1.5 mt-1">
              <p className="text-xs text-zinc-300">Try:</p>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_CHIPS.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => {
                      setJobDescription(chip.text);
                      requestAnimationFrame(() => {
                        const el = textareaRef.current;
                        if (el) {
                          el.focus();
                          el.setSelectionRange(chip.text.length, chip.text.length);
                        }
                      });
                    }}
                    className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}

        {saved && confirmRegenerate && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-4">
            <p className="text-sm text-zinc-200">
              Regenerate replaces the current job wording. Your pricing will stay the same.
            </p>
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmRegenerate(false)}
                className="flex-1 rounded-xl bg-zinc-800 py-3 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmRegenerate(false);
                  onGenerate();
                }}
                className="flex-1 rounded-xl bg-amber-500 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 min-h-[44px]"
              >
                Regenerate
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={(!jobDescription.trim() && photos.length === 0) || photoAnalysing}
          onClick={() => (saved ? setConfirmRegenerate(true) : onGenerate())}
          className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
        >
          {photoAnalysing ? (
            <>
              <Spinner className="w-4 h-4" />
              <span>Reading photos...</span>
            </>
          ) : (
            <span>{saved ? "Regenerate Estimate" : "Generate Estimate"}</span>
          )}
        </button>

        {needsProfileSetup && (
          <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">Complete your profile</p>
              <p className="text-xs text-zinc-400 mt-0.5">Add your business details so your estimates look professional.</p>
            </div>
            <Link
              href="/profile"
              className="shrink-0 text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors min-h-[44px] flex items-center"
            >
              Open Profile
            </Link>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-zinc-800" />
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">Customer details</p>
          <div className="h-px flex-1 bg-zinc-800" />
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-400">Customer name</label>
            <input
              type="text"
              className={inputClass}
              placeholder="David Miller"
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
            <label className="text-sm font-medium text-zinc-400">Email <span className="font-normal text-zinc-500 text-xs">(Optional)</span></label>
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
            <label className="text-sm font-medium text-zinc-400">Job address <span className="font-normal text-zinc-500 text-xs">(Optional)</span></label>
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
        {saved && (
          <div className="px-5 pt-4 pb-6 bg-zinc-950 border-t border-zinc-800">
            <button
              type="button"
              onClick={onViewEstimate}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Back to Estimate
            </button>
          </div>
        )}
        <BottomNav />
      </div>

      <PhotoSourceSheet
        isOpen={showPhotoSourceSheet}
        onClose={() => setShowPhotoSourceSheet(false)}
        onTakePhoto={() => {
          setShowPhotoSourceSheet(false);
          photoInputRef.current?.click();
        }}
        onChooseFromLibrary={() => {
          setShowPhotoSourceSheet(false);
          libraryInputRef.current?.click();
        }}
      />
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
  const [estimateStarted, setEstimateStarted] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [savedEstimateId, setSavedEstimateId] = useState<string | null>(null);
  const [customerDetailsSaved, setCustomerDetailsSaved] = useState(false);
  // The estimate's own authoritative pricing state, fetched once per
  // savedEstimateId from GET /api/estimates/{id}/pricing -- never
  // reconstructed from current business Rates or from prose.
  const [pricingLoadState, setPricingLoadState] = useState<PricingLoadState>("idle");
  const [pricingInit, setPricingInit] = useState<PricingInit | null>(null);
  const [pricingRetryToken, setPricingRetryToken] = useState(0);
  // The contractor's own typed job description ONLY (jobDescription.trim(),
  // set once at the top of handleGenerate) -- deliberately never
  // photoAnalysis, which is AI-generated prose, not contractor-authored
  // text, and must not be used to match saved items. Empty when the
  // contractor used photo-only input, which correctly yields no jobText and
  // zero suggestions. The only surface where this text is still available
  // once pricing loads. Used only to ask for suggestions on the pricing-init
  // fetch below; never displayed and never sent anywhere else.
  const [generationJobText, setGenerationJobText] = useState("");
  // Persisted-pricing completeness (send-readiness) for the estimate
  // currently shown. Initialized from the same authoritative fetch below,
  // then kept current exclusively through EstimateView's
  // onPricingCompleteChange prop, which forwards ContractorPricingEditor's
  // own resolved `sendReady` after every change (complete AND not dirty
  // since the last save) -- never a value this page infers from separate
  // signals on its own. Reset whenever a genuinely new estimate replaces
  // the current one.
  const [pricingComplete, setPricingComplete] = useState(false);
  const { logoUrl, businessName, showCompanyNameBelowLogo, businessEmail, preparedBy, isPro, aiPhotoEstimatesRemaining, isLoading: profileLoading } = useBusinessProfile();
  const [jobTitle, setJobTitle] = useState("");
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  // Photos live here, not in FormView, so they survive the switch to the
  // estimate view and back. Only sending or starting a new estimate clears them.
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [photoError, setPhotoError] = useState("");
  const [photoAnalysing, setPhotoAnalysing] = useState(false);
  const photoAnalysisRef = useRef<{ signature: string; description: string } | null>(null);

  // Only needed while FormView's empty-textarea placeholder is on screen.
  // Left running unconditionally, this re-renders EstimateView too (same
  // component's return path), which used to recreate the inline ref callbacks
  // on every textarea in the old markdown editor and re-run their auto-resize
  // measurement every 3s with no user input, the source of the post-
  // generation scroll drift.
  useEffect(() => {
    if (view !== "form") return;
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % jobPlaceholders.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [view]);

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

  // The one authoritative read for /new's own-page pricing editor: the
  // estimate's own persisted rows and snapshots, reused unmodified from
  // GET /api/estimates/{id}/pricing (the same route PUT already lives on).
  // Runs once per estimate id -- not on a regenerate, which keeps the same
  // id and never touches pricing, so the already-loaded state is still
  // exactly correct -- and again only if pricingRetryToken changes, which
  // only the contractor's own Retry tap does.
  //
  // Stale-response protection: `cancelled` is the smallest structural
  // guard against a response for a since-replaced estimate id overwriting
  // the current one (id A's fetch resolving after the id has already moved
  // to B). This is not exercised by an automated test -- this repo has no
  // component harness that can drive two overlapping async effects and
  // observe which one wins; the guard's correctness rests on this being a
  // standard, well-understood React cleanup pattern, not on test coverage.
  useEffect(() => {
    if (!savedEstimateId) {
      setPricingLoadState("idle");
      setPricingInit(null);
      return;
    }

    let cancelled = false;
    setPricingLoadState("loading");
    setPricingInit(null);

    type PricingInitResponse = {
      estimate?: {
        currency?: string;
        isDelivered?: boolean;
        taxLabel?: string | null;
        taxRate?: number | null;
        depositPercent?: number | null;
        depositThreshold?: number | null;
      };
      rows?: ContractorPricingRowInput[];
      pricing?: ContractorPricing;
      suggestions?: PriceBookSuggestion[];
      defaults?: { labourRate?: number; markupPercent?: number };
    };

    // Phase 2 slice 4: ask the estimate's own pricing-init route for
    // suggestions too, using the contractor's own typed job text -- the one
    // surface where that text is still available. No job text (photo-only
    // input) simply means no suggestions, the same as the detail page,
    // which never has this text at all. Capped here, client-side, before it
    // ever enters the query string -- this is the truncation point.
    const matchJobText = generationJobText.trim().slice(0, MATCH_JOB_TEXT_MAX_LENGTH);
    const pricingInitUrl = matchJobText
      ? `/api/estimates/${savedEstimateId}/pricing?jobText=${encodeURIComponent(matchJobText)}`
      : `/api/estimates/${savedEstimateId}/pricing`;

    fetch(pricingInitUrl)
      .then(async (res) => {
        // A legacy (non contractor_pricing) estimate is refused with this
        // distinct, documented code -- never a transient failure, and never
        // collapsed into the generic error state below.
        if (res.status === 409) {
          const body = (await res.json().catch(() => null)) as { code?: string } | null;
          if (body?.code === "ESTIMATE_READ_ONLY") return { kind: "legacy" as const };
        }
        if (!res.ok) throw new Error(`pricing init failed: ${res.status}`);
        return { kind: "ok" as const, body: (await res.json()) as PricingInitResponse };
      })
      .then((result) => {
        if (cancelled) return;
        if (result.kind === "legacy") {
          setPricingLoadState("legacy");
          return;
        }

        const d = result.body;
        const est = d?.estimate;
        if (!est || !d.pricing) throw new Error("pricing init: unreadable response");

        // Defensive only: the generate/regenerate route already refuses a
        // delivered estimate, so this should be unreachable during normal
        // use. Never pretend isDelivered is false if the estimate's own
        // authoritative state says otherwise.
        if (est.isDelivered) {
          setPricingLoadState("delivered");
          return;
        }

        setPricingInit({
          currency: currencyOrDefault(est.currency),
          isDelivered: false,
          initialRows: d.rows ?? [],
          initialTax: { label: est.taxLabel ?? null, rate: est.taxRate ?? null },
          initialPricing: d.pricing,
          defaults: {
            labourRate: d.defaults?.labourRate ?? 0,
            markupPercent: d.defaults?.markupPercent ?? 0,
          },
          depositPercent: est.depositPercent ?? null,
          depositThresholdDollars: est.depositThreshold ?? null,
          suggestions: d.suggestions ?? [],
        });
        // Initializes from the persisted response itself, not only from a
        // later Save -- a regenerated estimate that was already saved
        // complete must show Continue to Send immediately, not wait for
        // another save.
        setPricingComplete(d.pricing.complete);
        setPricingLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setPricingLoadState("error");
      });

    return () => {
      cancelled = true;
    };
    // generationJobText is deliberately excluded: it is read once, at the
    // moment savedEstimateId actually changes, via this render's closure --
    // adding it here would refetch the whole pricing-init payload (rows,
    // pricing, defaults) on every regenerate, which the comment above this
    // effect already establishes must not happen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedEstimateId, pricingRetryToken]);

  function retryPricingInit() {
    setPricingRetryToken((t) => t + 1);
  }

  const needsProfileSetup = !profileLoading && !logoUrl && !businessName && !preparedBy && !businessEmail;

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function clearPhotos() {
    setPhotos([]);
    setPhotoError("");
    photoAnalysisRef.current = null;
  }

  // Photos and their notes are what the vision call sees, so the analysis is
  // only stale when one of those changes.
  function photoSignature(entries: PhotoEntry[]): string {
    return entries.map((p) => `${p.id}:${p.note}`).join("|");
  }

  async function analysePhotos(): Promise<string> {
    const signature = photoSignature(photos);
    const cached = photoAnalysisRef.current;
    if (cached && cached.signature === signature) return cached.description;

    setPhotoAnalysing(true);
    try {
      const res = await fetch("/api/analyze-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photos: photos.map((p) => ({ base64: p.base64, mediaType: "image/jpeg", note: p.note })),
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { description?: string; error?: string; message?: string }
        | null;
      if (!res.ok || !data?.description) {
        // photo_limit_reached carries a human-readable message alongside the
        // machine-readable error code; every other error just uses `error`
        // as the message directly, same as before.
        throw new Error(data?.message || data?.error || "Could not analyse the photos. Try again.");
      }
      photoAnalysisRef.current = { signature, description: data.description };
      return data.description;
    } finally {
      setPhotoAnalysing(false);
    }
  }

  async function handleGenerate() {
    setPhotoError("");

    let photoAnalysis = "";
    if (photos.length > 0) {
      try {
        photoAnalysis = await analysePhotos();
      } catch (err) {
        setPhotoError(
          err instanceof Error ? err.message : "Could not analyse the photos. Try again."
        );
        return;
      }
    }

    const description = jobDescription.trim() || photoAnalysis;
    if (!description) return;
    // Match source is the contractor's own typed text only -- never
    // photoAnalysis, which is generated prose. Empty here (photo-only input)
    // correctly means no jobText is sent below and zero suggestions return.
    setGenerationJobText(jobDescription.trim());

    // Regenerate replaces the wording on the estimate that already exists.
    // Its id is kept, so the server updates that row instead of inserting a
    // second one, and its pricing rows and snapshots are never touched.
    const regenerateId = saved && savedEstimateId ? savedEstimateId : null;

    setView("estimate");
    setGenerating(true);
    setEstimate("");
    setError("");
    setSaved(false);
    if (!regenerateId) {
      setSavedEstimateId(null);
      // A genuinely new estimate id is coming; the old one's pricing
      // completeness must never carry over onto it.
      setPricingComplete(false);
    }
    setJobTitle("");

    try {
      const res = await fetch("/api/generate-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobDescription: description,
          photoAnalysis: photoAnalysis && photoAnalysis !== description ? photoAnalysis : undefined,
          customerName: customerName || undefined,
          customerPhone: customerPhone || undefined,
          customerEmail: customerEmail || undefined,
          jobAddress: jobAddress || undefined,
          estimateId: regenerateId || undefined,
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
      let createdEstimateId: string | null = null;
      // The saved, sanitized prose the server sends back once the estimate
      // row is written. The moment it arrives it replaces the stream buffer
      // on screen: from then on this view shows the record, not the raw
      // model text, so a sentence the price-safety filter removed cannot
      // reappear here or be written back on a later save.
      let savedProse: string | null = null;

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

        // __ID__ is emitted first and __SAVED__ last, so the id is what
        // sits between them and everything after __SAVED__ is the prose.
        const idMarkerIndex = buffer.indexOf("\n__ID__:");
        const savedMarkerIndex = buffer.indexOf("\n__SAVED__:");

        if (idMarkerIndex !== -1) {
          const idEnd = savedMarkerIndex === -1 ? buffer.length : savedMarkerIndex;
          const id = buffer.slice(idMarkerIndex + "\n__ID__:".length, idEnd).trim();
          if (id) {
            createdEstimateId = id;
            setSavedEstimateId(id);
          }
        }

        if (savedMarkerIndex !== -1) {
          savedProse = buffer.slice(savedMarkerIndex + "\n__SAVED__:".length);
        }

        // The saved record wins the moment it exists. Until then this is
        // the live stream, shown as progress only and never saved from here.
        const visible =
          savedProse !== null
            ? savedProse
            : idMarkerIndex !== -1
              ? buffer.slice(0, idMarkerIndex)
              : buffer;

        const h1Line = visible.split("\n").find((l) => l.startsWith("# "));
        if (h1Line) setJobTitle(h1Line.replace(/^# /, ""));
        setEstimateStarted(true);
        setEstimate(visible);
      }

      // Save any job photos onto the estimate (Pro only). They stay hidden
      // until the contractor turns them on from the estimate view.
      if (isPro && !regenerateId && createdEstimateId && photos.length > 0) {
        try {
          await fetch(`/api/estimates/${createdEstimateId}/photos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              photos: photos.map((p) => ({ base64: p.base64, note: p.note })),
            }),
          });
        } catch {
          // Photos are optional; never block the estimate on a failed upload.
        }
      }

      setSaved(true);
      setIsFirstTime(false);
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
      setEstimateStarted(false);
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
    setPricingComplete(false);
    setJobTitle("");
    setCustomerDetailsSaved(false);
    clearPhotos();
  }

  if (view === "estimate") {
    return (
      <EstimateView
        generating={generating}
        estimateStarted={estimateStarted}
        estimate={estimate}
        error={error}
        saved={saved}
        savedEstimateId={savedEstimateId}
        needsProfileSetup={needsProfileSetup}
        logoUrl={logoUrl}
        businessName={businessName}
        showCompanyNameBelowLogo={showCompanyNameBelowLogo}
        businessEmail={businessEmail}
        preparedBy={preparedBy}
        customerName={customerName}
        customerPhone={customerPhone}
        customerEmail={customerEmail}
        jobAddress={jobAddress}
        jobTitle={jobTitle}
        pricingLoadState={pricingLoadState}
        pricingInit={pricingInit}
        pricingComplete={pricingComplete}
        onPricingCompleteChange={setPricingComplete}
        onRetryPricingInit={retryPricingInit}
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
      needsProfileSetup={needsProfileSetup}
      isPro={isPro}
      aiPhotoEstimatesRemaining={aiPhotoEstimatesRemaining}
      error={error}
      photos={photos}
      setPhotos={setPhotos}
      photoError={photoError}
      setPhotoError={setPhotoError}
      photoAnalysing={photoAnalysing}
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
