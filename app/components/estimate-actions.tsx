"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { SendEstimateSheet } from "./send-estimate-sheet";
import { MarkJobDoneSheet } from "./mark-job-done-sheet";
import { InvoiceSheet } from "./invoice-sheet";
import { Spinner } from "./spinner";
import { matchTemplate, buildDraftSummary } from "@/lib/quote-templates";
import type { PricebookItem } from "@/lib/quote-templates";
import { CANONICAL_URL } from "@/lib/site-url";
import type { Currency } from "@/lib/currency";

interface EstimateActionsProps {
  estimateId: string;
  title: string;
  summary: string;
  /** The estimate's own immutable currency snapshot -- the same value that
   * already distinguishes the Canadian and US markets -- used to pick the
   * matching English spelling when converting a website-quote draft. */
  currency: Currency;
  status?: string | null;
  source?: string | null;
  description?: string | null;
  customerPhone?: string;
  customerEmail?: string;
  customerName?: string;
  businessName?: string;
  businessPhone?: string;
  logoUrl?: string | null;
  isPro: boolean;
  googleReviewLink: string | null;
  reviewRequestedAt?: string | null;
  paymentStatus?: string | null;
  invoiceAmount?: number | null;
  estimateTotal?: number;
  /** The authoritative send-readiness signal at page load: for contractor
   * pricing, calculateContractorPricing's own `complete` (never a client
   * guess from the total); for legacy, the same total-is-nonzero check this
   * component has always used for it. Kept live after a pricing save by the
   * `estimate-total-change` event ContractorPricingEditor dispatches with
   * the server's own response -- see the effect below. */
  estimateComplete?: boolean;
  businessHasPaymentLink?: boolean;
  justSent?: boolean;
  hasPhotos?: boolean;
  /** True when the customer's phone has replied STOP. Suppresses nothing
   * about the invoice itself; only changes what this component shows and
   * whether automated SMS reminders keep going out (enforced server-side
   * in app/api/cron/payment-reminders/route.ts, not here). */
  smsOptedOut?: boolean;
  /** True when the page is showing this estimate's contractor pricing
   * locked, i.e. contractor_pricing AND isDelivered(estimate), as
   * app/estimates/[id]/page.tsx already derives it. Only used to seed the
   * action status below; never recomputed here. */
  pricingLocked?: boolean;
}

/** The event ContractorPricingEditor dispatches whenever its resolved send
 * readiness changes, and this component listens for. One name, shared by
 * both files. */
export const PRICING_CHANGE_EVENT = "estimate-total-change";

/**
 * Pulls the authoritative `complete` flag out of a dispatched
 * estimate-total-change event. Deliberately hook-free and exported so its
 * exact runtime behaviour -- not just its presence in the source -- can be
 * exercised against a real EventTarget/CustomEvent dispatch in
 * tests/smoke/estimate-actions-send-state-sync.spec.ts, without a DOM or a
 * React renderer. It reads nothing but `.complete`: a total on the same
 * detail object, present or not, never changes what this returns.
 */
export function readPricingComplete(event: Event): boolean {
  return (event as CustomEvent<{ complete: boolean }>).detail.complete;
}

/**
 * The status this component's actions start from. Normally the stored
 * status. The one exception: a stored status of "draft" on an estimate whose
 * pricing the page is already showing as locked (a delivery marker, sent_at
 * or copied_at, is set). PATCH /api/estimates can leave that combination --
 * a first delivery sent as copied_at alone, or status moved back to "draft"
 * while a marker keeps it delivered -- and the draft branch would then offer
 * Send Estimate beside locked pricing. Treating it as "sent" gives it the
 * same actions as any other delivered estimate (Resend, Mark Job Done).
 * Hook-free and exported so the decision itself is tested.
 */
export function initialActionStatus(status: string | null | undefined, pricingLocked: boolean): string {
  const stored = status ?? "";
  return pricingLocked && stored === "draft" ? "sent" : stored;
}

/**
 * Whether the sticky action bar should render at all. The bar exists only
 * when it is actionable: a plain, undelivered contractor_pricing draft that
 * is still incomplete has nothing to do there (Send can't be used yet, and
 * the missing-inputs guidance already lives inline with the pricing editor),
 * so it renders nothing rather than a disabled button plus a warning that
 * duplicates that guidance and permanently occupies screen space. Every
 * other state this covers -- a website-quote conversion, a done job, an
 * already-sent estimate -- is either not contractor_pricing or already
 * delivered, and delivery requires having passed this same completeness
 * gate, so none of them can coincide with `sendBlocked`.
 *
 * Deliberately hook-free and exported, the same as readPricingComplete
 * above, so the actual show/hide decision -- not just its presence in the
 * source -- can be exercised as real logic in
 * tests/smoke/estimate-actions-send-state-sync.spec.ts.
 */
export function shouldShowStickyActionBar(state: {
  isQuoteRequest: boolean;
  isDone: boolean;
  localStatus: string;
  sendBlocked: boolean;
}): boolean {
  return state.isQuoteRequest || state.isDone || state.localStatus === "sent" || !state.sendBlocked;
}

export function EstimateActions({
  estimateId,
  title,
  summary,
  currency,
  status,
  source,
  description,
  customerPhone,
  customerEmail,
  customerName,
  businessName,
  businessPhone,
  logoUrl,
  isPro,
  googleReviewLink,
  reviewRequestedAt,
  paymentStatus,
  invoiceAmount,
  estimateTotal,
  estimateComplete,
  businessHasPaymentLink,
  justSent,
  hasPhotos,
  smsOptedOut,
  pricingLocked = false,
}: EstimateActionsProps) {
  const router = useRouter();
  const isQuoteRequest = status === "needs_review" && source === "website_quote";
  const [isConverting, setIsConverting] = useState(false);
  const [convertError, setConvertError] = useState("");
  const [liveComplete, setLiveComplete] = useState(estimateComplete ?? false);
  const [sendSheetInitialPanel, setSendSheetInitialPanel] = useState<"menu" | "email">("menu");

  // ContractorPricingEditor dispatches this whenever its resolved send
  // readiness changes (isPricingSendReady: the server's own `complete` from
  // the last save or page load, AND no unsaved edit, AND no save in flight).
  // Nothing here recomputes completeness from a total; `complete` is taken
  // exactly as the editor resolved it, so this Send and the draft editor's
  // Save Pricing bar can never show together. estimateTotal
  // itself (used below for the invoice prefill) needs no live counterpart:
  // it is a prop, not mirrored into state, so it already refreshes with the
  // rest of this page's server data on the editor's router.refresh().
  useEffect(() => {
    function handlePricingChange(e: Event) {
      setLiveComplete(readPricingComplete(e));
    }
    window.addEventListener(PRICING_CHANGE_EVENT, handlePricingChange);
    return () => window.removeEventListener(PRICING_CHANGE_EVENT, handlePricingChange);
  }, []);

  const sendBlocked = !liveComplete;

  // This fixed bar's content is genuinely variable height: it can be one
  // 56px button or several stacked blocks (Job Done card, review-request
  // panel, SMS-opted-out banner, Mark as Paid) well over 400px tall,
  // depending on the estimate's state. app/estimates/[id]/page.tsx's <main>
  // needs to reserve exactly that much bottom padding -- not a guessed
  // constant -- or a tall state either shows a gap (padding too generous)
  // or hides real content behind the bar (padding too small, measured up to
  // 410px in the worst realistic combination during this fix, nearly double
  // the previous static pb-[14rem]/224px). Measuring the real height here
  // and publishing it as a CSS custom property is what makes that padding
  // correct for every state without page.tsx needing to know this
  // component's internals.
  //
  // A callback ref, not useRef+useEffect: the bar is now conditionally
  // rendered at all (see the render condition below), and an effect with an
  // empty dependency array only runs once at this component's own mount --
  // it would never re-observe a bar that mounts *later*, when pricing goes
  // from incomplete to complete without a page reload. A callback ref fires
  // on every actual DOM attach and detach, so the observer (and the
  // published height) always matches whether the bar currently exists.
  //
  // The null branch sets the variable to "0px" rather than clearing it.
  // page.tsx's fallback (200px) exists only to avoid a flash of
  // insufficient padding for a bar that *will* render, before this ref has
  // fired even once -- it is not a stand-in for "no bar", and leaving the
  // property unset here would fall through to that same 200px, reserving
  // clearance for a bar that this render deliberately does not show.
  const actionBarObserverRef = useRef<ResizeObserver | null>(null);
  const actionBarRef = useCallback((el: HTMLDivElement | null) => {
    actionBarObserverRef.current?.disconnect();
    actionBarObserverRef.current = null;
    if (!el) {
      document.documentElement.style.setProperty("--tp-estimate-action-bar-height", "0px");
      return;
    }
    const publishHeight = () => {
      document.documentElement.style.setProperty("--tp-estimate-action-bar-height", `${el.offsetHeight}px`);
    };
    publishHeight();
    const observer = new ResizeObserver(publishHeight);
    observer.observe(el);
    actionBarObserverRef.current = observer;
  }, []);
  useEffect(() => {
    return () => {
      actionBarObserverRef.current?.disconnect();
      document.documentElement.style.removeProperty("--tp-estimate-action-bar-height");
    };
  }, []);

  const [showSendSheet, setShowSendSheet] = useState(false);
  const [showDoneSheet, setShowDoneSheet] = useState(false);
  const [doneSheetInitialPanel, setDoneSheetInitialPanel] = useState<"review-ready" | "needs-link">("review-ready");
  const [localStatus, setLocalStatus] = useState(() => initialActionStatus(status, pricingLocked));
  const [localCustomerPhone, setLocalCustomerPhone] = useState(customerPhone ?? "");
  const [isDone, setIsDone] = useState(status === "done");

  // Guarantees --tp-estimate-action-bar-height is 0 whenever the sticky bar
  // is absent, independent of whether the callback ref above has ever run.
  // A callback ref only fires on an actual DOM attach or detach -- if this
  // estimate loads directly into the state the bar is hidden for (the
  // common case: a fresh contractor_pricing draft loads incomplete), the
  // bar's <div> never mounts even once, the callback ref is never invoked
  // at all, and the property is left permanently unset. page.tsx's
  // fallback for an unset property is 200px (a transitional placeholder for
  // a bar that *will* render, not a stand-in for "no bar"), so without this
  // effect the page silently reserves ~200px of dead clearance for a bar
  // that was never even attempted -- the actual cause of the large empty
  // gap above BottomNav on an incomplete estimate.
  const showStickyActionBar = shouldShowStickyActionBar({ isQuoteRequest, isDone, localStatus, sendBlocked });
  useEffect(() => {
    if (!showStickyActionBar) {
      document.documentElement.style.setProperty("--tp-estimate-action-bar-height", "0px");
    }
  }, [showStickyActionBar]);

  const [localReviewRequestedAt, setLocalReviewRequestedAt] = useState(reviewRequestedAt ?? null);
  const [isMarkingDone, setIsMarkingDone] = useState(false);
  const [markDoneError, setMarkDoneError] = useState("");
  const [showInvoiceSheet, setShowInvoiceSheet] = useState(false);
  const [localPaymentStatus, setLocalPaymentStatus] = useState(paymentStatus ?? null);
  const [hasInvoice, setHasInvoice] = useState(invoiceAmount !== null && invoiceAmount !== undefined);
  const [confirmingPaid, setConfirmingPaid] = useState(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [markPaidError, setMarkPaidError] = useState("");
  const [confirmingReminder, setConfirmingReminder] = useState(false);
  const [isSendingReminder, setIsSendingReminder] = useState(false);
  const [reminderResult, setReminderResult] = useState<string | null>(null);
  const [reminderResultIsError, setReminderResultIsError] = useState(false);
  // One-time confirmation after marking invoiced; shown once per session
  const [showInvoiceNudge, setShowInvoiceNudge] = useState(false);
  const [invoiceNudgeVisible, setInvoiceNudgeVisible] = useState(false);

  useEffect(() => {
    if (showInvoiceNudge) {
      const frame = requestAnimationFrame(() => setInvoiceNudgeVisible(true));
      return () => cancelAnimationFrame(frame);
    }
  }, [showInvoiceNudge]);

  // Referral nudge after a successful send, triggered by ?sent=1 on the redirect
  const [showReferralNudge, setShowReferralNudge] = useState(justSent ?? false);
  const [referralNudgeVisible, setReferralNudgeVisible] = useState(false);

  useEffect(() => {
    if (showReferralNudge) {
      // Strip the query param so a refresh does not re-trigger the nudge
      if (window.location.search.includes("sent=1")) {
        window.history.replaceState(null, "", window.location.pathname);
      }
      const frame = requestAnimationFrame(() => setReferralNudgeVisible(true));
      return () => cancelAnimationFrame(frame);
    }
  }, [showReferralNudge]);

  async function handleMarkPaid() {
    setIsMarkingPaid(true);
    setMarkPaidError("");
    try {
      const res = await fetch(`/api/estimates/${estimateId}/mark-paid`, {
        method: "PATCH",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMarkPaidError((data as { error?: string }).error ?? `Server error ${res.status}`);
        return;
      }
      setLocalPaymentStatus("paid");
      setConfirmingPaid(false);
    } finally {
      setIsMarkingPaid(false);
    }
  }

  async function handleSendReminder() {
    if (isSendingReminder) return;
    setIsSendingReminder(true);
    setReminderResult(null);
    setReminderResultIsError(false);
    try {
      const res = await fetch(`/api/estimates/${estimateId}/send-reminder`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReminderResult((data as { error?: string }).error ?? "Reminder could not be sent");
        setReminderResultIsError(true);
        return;
      }
      const { smsOutcome, emailOutcome } = data as { smsOutcome: string; emailOutcome: string };
      let message: string;
      if (smsOutcome === "sent" && emailOutcome === "sent") {
        message = "Reminder sent by text and email";
      } else if (smsOutcome === "sent") {
        message = "Reminder sent by text";
      } else if (emailOutcome === "sent" && smsOutcome === "suppressed") {
        message = "SMS opted out. Reminder sent by email.";
      } else if (emailOutcome === "sent") {
        message = "Reminder sent by email";
      } else if (smsOutcome === "suppressed" && emailOutcome === "no_email") {
        message = "SMS opted out. No email address available.";
      } else if (smsOutcome === "no_phone" && emailOutcome === "no_email") {
        message = "No customer contact method available.";
      } else {
        message = "Reminder could not be sent";
      }
      setReminderResult(message);
      setReminderResultIsError(message === "Reminder could not be sent");
    } catch {
      setReminderResult("Reminder could not be sent");
      setReminderResultIsError(true);
    } finally {
      setIsSendingReminder(false);
      setConfirmingReminder(false);
    }
  }

  async function handleMarkDone() {
    setIsMarkingDone(true);
    setMarkDoneError("");
    try {
      const res = await fetch("/api/estimates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: estimateId,
          status: "done",
          completed_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMarkDoneError((data as { error?: string }).error ?? `Server error ${res.status}`);
        return;
      }
      setIsDone(true);
      const panel = googleReviewLink ? "review-ready" : "needs-link";
      setDoneSheetInitialPanel(panel);
      setShowDoneSheet(true);
    } finally {
      setIsMarkingDone(false);
    }
  }

  async function handleCreateEstimate() {
    setIsConverting(true);
    setConvertError("");
    try {
      const customerDesc = description ?? "";
      let photoNotes = "";

      if (hasPhotos) {
        try {
          const photoRes = await fetch(`/api/estimates/${estimateId}/analyze-photos`, { method: "POST" });
          if (photoRes.ok) {
            const photoData = await photoRes.json() as { description?: string };
            if (photoData.description) {
              photoNotes = photoData.description
                .replace(/^#{1,3}\s+.*$/gm, "")
                .replace(/^[A-Za-z ]+:\s*$/gm, "")
                .replace(/\n{3,}/g, "\n\n")
                .trim();
            }
          }
        } catch { /* photo analysis failure is non-fatal */ }
      }

      const desc = photoNotes ? `${customerDesc}\n\n${photoNotes}` : customerDesc;
      const template = matchTemplate(desc);

      let pricebookItems: PricebookItem[] = [];
      let taxLabel = 'GST';
      let taxRate = 5;
      try {
        const pbRes = await fetch("/api/price-book");
        if (pbRes.ok) {
          const pbData = await pbRes.json() as { rates?: { tax_label?: string; tax_rate?: number }; items?: Array<{ name: string; description?: string; unit_price: number }> };
          pricebookItems = (pbData.items ?? []).map((i) => ({
            name: i.name,
            description: i.description ?? "",
            price: i.unit_price,
          }));
          if (pbData.rates?.tax_label) taxLabel = pbData.rates.tax_label;
          if (pbData.rates?.tax_rate !== undefined) taxRate = pbData.rates.tax_rate;
        }
      } catch { /* pricebook fetch failure is non-fatal */ }

      const res = await fetch("/api/estimates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: estimateId,
          title: template.title,
          summary: buildDraftSummary(template, customerDesc, pricebookItems, taxLabel, taxRate, photoNotes || undefined, currency),
          status: "draft",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setConvertError((data as { error?: string }).error ?? `Server error ${res.status}`);
        return;
      }
      router.refresh();
    } finally {
      setIsConverting(false);
    }
  }

  function handleSendClick() {
    setShowSendSheet(true);
  }

  return (
    <>
      {/* The sticky bar exists only when it is actionable. A plain
          undelivered contractor_pricing draft that is still incomplete has
          nothing to do here: Send can't be used yet, and the detailed
          "Still needed before you can send this" guidance already lives
          inline with the pricing editor (app/components/contractor-
          pricing-editor.tsx), where a contractor can actually read it
          alongside the fields it refers to. A disabled Send button plus a
          second, shorter warning duplicated that message and permanently
          occupied screen space -- on a real phone, enough of it to cover
          the bottom of the pricing summary. Every other branch below
          (isQuoteRequest, isDone, already sent) represents a state that is
          either not contractor_pricing or is already delivered -- delivery
          requires having passed this same completeness gate -- so none of
          them can coincide with sendBlocked, and hiding the bar only for
          that one case cannot hide an action any other branch needs. */}
      {showStickyActionBar && (
      <div
        ref={actionBarRef}
        className="fixed left-0 right-0 px-5 pb-7 pt-4 bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent flex flex-col gap-3 z-30"
        style={{ bottom: "calc(var(--tp-bottom-nav-height, 87px) - 3px)" }}
      >
        {/* BottomNav was redesigned to a flat grid-cols-4 bar (2026-08),
            measured at 87px tall on a device with no safe-area inset -- but
            its own bottom padding is `env(safe-area-inset-bottom)`-driven,
            so a phone with a safe-area inset (most current iPhones, many
            Android browsers) renders it taller than that. A hardcoded
            `bottom-[84px]` here assumed the no-inset figure, so on an
            inset device this bar floated above a real gap over BottomNav,
            and (more importantly) app/estimates/[id]/page.tsx's bottom-
            padding formula -- built from that same assumption -- reserved
            too little space, so scrolled content ended up behind this bar
            instead of above it on those phones. `--tp-bottom-nav-height`
            (published by BottomNav itself, see bottom-nav.tsx) is
            BottomNav's real measured height on whatever device this
            renders on, so this bar's position tracks it instead of
            guessing. `- 3px` keeps the same small deliberate overlap as
            before (87 - 84 = 3) so the two solid zinc-950 bars still meet
            with no visible seam. */}
        {isQuoteRequest ? (
          <>
            {convertError && (
              <p className="text-red-400 text-xs text-center">{convertError}</p>
            )}
            <button
              type="button"
              disabled={isConverting}
              onClick={handleCreateEstimate}
              className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center gap-2"
            >
              {isConverting && <Spinner className="w-5 h-5" />}
              {isConverting ? "Creating..." : "Create Estimate"}
            </button>
          </>
        ) : isDone ? (
          <>
            <div className="w-full flex items-center justify-center gap-2 min-h-[56px] rounded-xl border border-green-800/50 bg-green-950/40">
              <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-green-400 shrink-0" aria-hidden="true">
                <path d="M4 10l4.5 4.5L16 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-green-400 font-semibold text-base">Job Done</span>
            </div>
            {isPro && googleReviewLink && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
                {localReviewRequestedAt ? (
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-zinc-300 text-xs font-medium">Review request sent</p>
                      <p className="text-zinc-400 text-xs mt-0.5">
                        {(() => {
                          const d = new Date(localReviewRequestedAt);
                          const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                          const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
                          return `${date} at ${time}`;
                        })()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setDoneSheetInitialPanel("review-ready"); setShowDoneSheet(true); }}
                      className="text-amber-400 text-xs font-semibold hover:text-amber-300 transition-colors min-h-[32px] shrink-0"
                    >
                      Send Again
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setDoneSheetInitialPanel("review-ready"); setShowDoneSheet(true); }}
                    className="w-full text-amber-400 text-sm font-semibold hover:text-amber-300 transition-colors min-h-[32px] text-center"
                  >
                    Send review request
                  </button>
                )}
              </div>
            )}
          </>
        ) : localStatus === "sent" ? (
          <>
            {isPro && (
              <>
                {markDoneError && (
                  <p className="text-red-400 text-xs text-center">{markDoneError}</p>
                )}
                <button
                  type="button"
                  disabled={isMarkingDone}
                  onClick={handleMarkDone}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center gap-2"
                >
                  {isMarkingDone && <Spinner className="w-5 h-5" />}
                  {isMarkingDone ? "Saving..." : "Mark Job Done"}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleSendClick}
              className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Resend Estimate
            </button>
          </>
        ) : (
          // Reached only when !sendBlocked -- the wrapping condition above
          // hides this whole bar for the incomplete case, so there is no
          // disabled state to render here and nothing left to warn about.
          // The missing-inputs message lives once, inline with the pricing
          // editor, not duplicated here.
          <button
            type="button"
            disabled={sendBlocked}
            onClick={handleSendClick}
            className={`w-full font-bold text-base rounded-xl py-4 transition-colors min-h-[56px] ${
              sendBlocked
                ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                : "bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950"
            }`}
          >
            Send Estimate
          </button>
        )}

        {isDone && !hasInvoice && (localPaymentStatus === null || localPaymentStatus === "unpaid") && (
          <button
            type="button"
            onClick={() => setShowInvoiceSheet(true)}
            className="w-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
          >
            Invoice This Job
          </button>
        )}

        {hasInvoice && localPaymentStatus === "unpaid" && (
          <>
            {markPaidError && (
              <p className="text-red-400 text-xs text-center">{markPaidError}</p>
            )}
            <button
              type="button"
              disabled={isMarkingPaid}
              onClick={() => {
                if (confirmingPaid) {
                  handleMarkPaid();
                } else {
                  setConfirmingPaid(true);
                }
              }}
              className="w-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center gap-2"
            >
              {isMarkingPaid && <Spinner className="w-5 h-5" />}
              {isMarkingPaid
                ? "Saving..."
                : confirmingPaid
                ? "Confirm -- mark as paid?"
                : "Mark as Paid"}
            </button>
          </>
        )}

        {hasInvoice && localPaymentStatus === "unpaid" && isPro && (
          <>
            {reminderResult && (
              <p className={`text-xs text-center ${reminderResultIsError ? "text-red-400" : "text-zinc-400"}`}>
                {reminderResult}
              </p>
            )}
            <button
              type="button"
              disabled={isSendingReminder}
              onClick={() => {
                if (confirmingReminder) {
                  handleSendReminder();
                } else {
                  setReminderResult(null);
                  setConfirmingReminder(true);
                }
              }}
              className="w-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center gap-2"
            >
              {isSendingReminder && <Spinner className="w-5 h-5" />}
              {isSendingReminder
                ? "Sending..."
                : confirmingReminder
                ? "Confirm -- send reminder now?"
                : "Send Reminder Now"}
            </button>
          </>
        )}

        {hasInvoice && localPaymentStatus === "unpaid" && smsOptedOut && (
          <div className="w-full rounded-xl border border-amber-800/50 bg-amber-950/40 px-4 py-3.5">
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-amber-400 shrink-0" aria-hidden="true">
                <path d="M10 6.5v4M10 13.2v.05" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <span className="text-amber-400 font-semibold text-sm">SMS opted out</span>
            </div>
            <p className="text-zinc-400 text-xs mt-1.5">
              Customer opted out of text reminders. Follow up another way. The invoice is still unpaid, this does not change the balance.
            </p>
            {customerEmail?.trim() ? (
              <button
                type="button"
                onClick={() => {
                  setSendSheetInitialPanel("email");
                  setShowSendSheet(true);
                }}
                className="mt-3 w-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white font-semibold text-sm rounded-xl py-3 transition-colors min-h-[44px]"
              >
                Email Customer
              </button>
            ) : (
              <p className="text-zinc-500 text-xs mt-2.5">
                No email on file. Follow up by phone or in person.
              </p>
            )}
          </div>
        )}

        {hasInvoice && localPaymentStatus === "paid" && (
          <div className="w-full flex items-center justify-center gap-2 min-h-[56px] rounded-xl border border-green-800/50 bg-green-950/40">
            <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-green-400 shrink-0" aria-hidden="true">
              <path d="M4 10l4.5 4.5L16 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-green-400 font-semibold text-base">Invoice Paid</span>
          </div>
        )}

        {showReferralNudge && (
          <div
            className={`relative w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3.5 pr-12 transition-all duration-300 ${
              referralNudgeVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
            }`}
          >
            <p className="text-zinc-400 text-sm text-center">
              Know a contractor who&apos;d find this useful?
            </p>
            <button
              type="button"
              onClick={() => {
                const url = CANONICAL_URL;
                if (navigator.share) {
                  navigator.share({ title: "TradePulse", url }).catch(() => {});
                } else {
                  navigator.clipboard.writeText(url).catch(() => {});
                }
              }}
              className="mt-2 w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-3 transition-colors min-h-[44px]"
            >
              Share TradePulse
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                setShowReferralNudge(false);
                setReferralNudgeVisible(false);
              }}
              className="absolute top-1.5 right-1.5 w-9 h-9 flex items-center justify-center text-zinc-500 hover:text-white transition-colors"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        {showInvoiceNudge && (
          <div
            className={`relative w-full rounded-xl bg-green-600 px-4 py-3.5 pr-12 transition-all duration-300 ${
              invoiceNudgeVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
            }`}
          >
            <p className="text-white text-sm font-semibold">Reminders are on.</p>
            <p className="text-white/90 text-xs mt-0.5">
              We&apos;ll send your customer a reminder 2 days before the due date, then follow
              up at 1 day, 5 days, and every week after until they pay.
            </p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                setShowInvoiceNudge(false);
                setInvoiceNudgeVisible(false);
              }}
              className="absolute top-1.5 right-1.5 w-9 h-9 flex items-center justify-center text-white/80 hover:text-white transition-colors"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
      </div>
      )}

      <SendEstimateSheet
        isOpen={showSendSheet}
        onClose={() => {
          setShowSendSheet(false);
          setSendSheetInitialPanel("menu");
        }}
        onSent={(phone) => {
          setLocalStatus("sent");
          if (phone) setLocalCustomerPhone(phone);
        }}
        estimateId={estimateId}
        currentStatus={localStatus}
        customerPhone={customerPhone}
        customerEmail={customerEmail}
        title={title}
        summary={summary}
        businessName={businessName}
        logoUrl={logoUrl}
        initialPanel={sendSheetInitialPanel}
      />

      <MarkJobDoneSheet
        isOpen={showDoneSheet}
        onClose={() => {
          setShowDoneSheet(false);
          setDoneSheetInitialPanel("review-ready");
        }}
        onReviewSent={() => setLocalReviewRequestedAt(new Date().toISOString())}
        estimateId={estimateId}
        googleReviewLink={googleReviewLink}
        customerPhone={localCustomerPhone}
        customerName={customerName ?? ""}
        businessName={businessName ?? ""}
        businessPhone={businessPhone ?? ""}
        reviewRequestedAt={localReviewRequestedAt}
        initialPanel={doneSheetInitialPanel}
      />

      <InvoiceSheet
        isOpen={showInvoiceSheet}
        onClose={() => setShowInvoiceSheet(false)}
        onInvoiced={() => {
          setHasInvoice(true);
          setLocalPaymentStatus("unpaid");
          setShowInvoiceNudge(true);
        }}
        estimateId={estimateId}
        customerName={customerName ?? ""}
        customerPhone={localCustomerPhone}
        customerEmail={customerEmail ?? ""}
        existingAmount={
          invoiceAmount !== null && invoiceAmount !== undefined
            ? String(invoiceAmount)
            : estimateTotal && estimateTotal > 0
              ? String(estimateTotal)
              : ""
        }
        businessHasPaymentLink={businessHasPaymentLink ?? false}
      />
    </>
  );
}
