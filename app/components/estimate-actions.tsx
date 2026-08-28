"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { SendEstimateSheet } from "./send-estimate-sheet";
import { MarkJobDoneSheet } from "./mark-job-done-sheet";
import { InvoiceSheet } from "./invoice-sheet";
import { Spinner } from "./spinner";
import { matchTemplate, buildDraftSummary } from "@/lib/quote-templates";
import type { PricebookItem } from "@/lib/quote-templates";
import { CANONICAL_URL } from "@/lib/site-url";

interface EstimateActionsProps {
  estimateId: string;
  title: string;
  summary: string;
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
  businessHasPaymentLink?: boolean;
  justSent?: boolean;
  hasPhotos?: boolean;
  /** True when the customer's phone has replied STOP. Suppresses nothing
   * about the invoice itself; only changes what this component shows and
   * whether automated SMS reminders keep going out (enforced server-side
   * in app/api/cron/payment-reminders/route.ts, not here). */
  smsOptedOut?: boolean;
}

export function EstimateActions({
  estimateId,
  title,
  summary,
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
  businessHasPaymentLink,
  justSent,
  hasPhotos,
  smsOptedOut,
}: EstimateActionsProps) {
  const router = useRouter();
  const isQuoteRequest = status === "needs_review" && source === "website_quote";
  const [isConverting, setIsConverting] = useState(false);
  const [convertError, setConvertError] = useState("");
  const [liveTotal, setLiveTotal] = useState(estimateTotal ?? 0);
  const [sendSheetInitialPanel, setSendSheetInitialPanel] = useState<"menu" | "email">("menu");

  useEffect(() => {
    function handleTotalChange(e: Event) {
      setLiveTotal((e as CustomEvent<number>).detail);
    }
    window.addEventListener('estimate-total-change', handleTotalChange);
    return () => window.removeEventListener('estimate-total-change', handleTotalChange);
  }, []);

  const isZeroTotal = !liveTotal || liveTotal <= 0;

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
  const actionBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = actionBarRef.current;
    if (!el) return;
    const publishHeight = () => {
      document.documentElement.style.setProperty("--tp-estimate-action-bar-height", `${el.offsetHeight}px`);
    };
    publishHeight();
    const observer = new ResizeObserver(publishHeight);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--tp-estimate-action-bar-height");
    };
  }, []);

  const [showSendSheet, setShowSendSheet] = useState(false);
  const [showDoneSheet, setShowDoneSheet] = useState(false);
  const [doneSheetInitialPanel, setDoneSheetInitialPanel] = useState<"review-ready" | "needs-link">("review-ready");
  const [localStatus, setLocalStatus] = useState(status ?? "");
  const [localCustomerPhone, setLocalCustomerPhone] = useState(customerPhone ?? "");
  const [isDone, setIsDone] = useState(status === "done");
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
          summary: buildDraftSummary(template, customerDesc, pricebookItems, taxLabel, taxRate, photoNotes || undefined),
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
      {/* BottomNav was redesigned to a flat grid-cols-4 bar (2026-08) and now
          renders at 87px tall (measured via getBoundingClientRect at
          375-412px widths, no safe-area inset), not the ~93.5px an earlier
          version of this comment assumed for the older floating-circle nav.
          That drift silently turned the old bottom-[90px]'s intended ~3.5px
          overlap into a 3px *gap* -- through which the scrolling white
          estimate card behind this bar became visible as a thin strip,
          since the gap fell inside this div's own top-fade gradient where
          neither element paints a solid background. bottom-[84px] restores
          a small deliberate overlap (87-84=3px) against the nav's current
          height. Both bars are solid zinc-950 here, so the overlap itself
          is invisible. If BottomNav's height changes again, remeasure and
          update this number -- this is exactly the failure mode that
          reopened once already. */}
      <div
        ref={actionBarRef}
        className="fixed bottom-[84px] left-0 right-0 px-5 pb-7 pt-4 bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent flex flex-col gap-3 z-30"
      >
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
            {isPro && googleReviewLink && status === "sent" && (
              <p className="text-center text-xs text-zinc-400 -mt-1">Review request available after completion.</p>
            )}
            <button
              type="button"
              onClick={handleSendClick}
              className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Send Estimate
            </button>
          </>
        ) : (
          <>
            {isZeroTotal && (
              <p className="text-amber-400 text-xs text-center">Add pricing to your line items before sending.</p>
            )}
            <button
              type="button"
              disabled={isZeroTotal}
              onClick={handleSendClick}
              className={`w-full font-bold text-base rounded-xl py-4 transition-colors min-h-[56px] ${
                isZeroTotal
                  ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                  : "bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950"
              }`}
            >
              Send Estimate
            </button>
          </>
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
