"use client";

import { useState, useEffect } from "react";
import { SendEstimateSheet } from "./send-estimate-sheet";
import { MarkJobDoneSheet } from "./mark-job-done-sheet";
import { InvoiceSheet } from "./invoice-sheet";
import { Spinner } from "./spinner";

interface EstimateActionsProps {
  estimateId: string;
  title: string;
  summary: string;
  status?: string | null;
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
}

export function EstimateActions({
  estimateId,
  title,
  summary,
  status,
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
}: EstimateActionsProps) {
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
  // One-time confirmation after marking invoiced; shown once per session
  const [showInvoiceNudge, setShowInvoiceNudge] = useState(false);
  const [invoiceNudgeVisible, setInvoiceNudgeVisible] = useState(false);

  useEffect(() => {
    if (showInvoiceNudge) {
      const frame = requestAnimationFrame(() => setInvoiceNudgeVisible(true));
      return () => cancelAnimationFrame(frame);
    }
  }, [showInvoiceNudge]);

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

  return (
    <>
      <div className="fixed bottom-[72px] left-0 right-0 px-5 pb-4 pt-4 bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent flex flex-col gap-3 z-30">
        <a
          href="/new"
          className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center"
        >
          New Estimate
        </a>

        {isDone ? (
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
              onClick={() => setShowSendSheet(true)}
              className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Send Estimate
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setShowSendSheet(true)}
            className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
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
            Mark as Invoiced
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

        {hasInvoice && localPaymentStatus === "paid" && (
          <div className="w-full flex items-center justify-center gap-2 min-h-[56px] rounded-xl border border-green-800/50 bg-green-950/40">
            <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-green-400 shrink-0" aria-hidden="true">
              <path d="M4 10l4.5 4.5L16 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-green-400 font-semibold text-base">Invoice Paid</span>
          </div>
        )}

        {showInvoiceNudge && (
          <div
            className={`relative w-full rounded-xl border border-green-800/50 bg-green-950/40 px-4 py-3 pr-12 transition-all duration-300 ${
              invoiceNudgeVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
            }`}
          >
            <p className="text-green-400 font-semibold text-sm">Payment reminders are on.</p>
            <p className="text-zinc-300 text-xs mt-0.5">
              We&apos;ll follow up with your customer automatically until they pay.
            </p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                setShowInvoiceNudge(false);
                setInvoiceNudgeVisible(false);
              }}
              className="absolute top-1.5 right-1.5 w-9 h-9 flex items-center justify-center text-green-400/70 hover:text-green-300 transition-colors"
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
        onClose={() => setShowSendSheet(false)}
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
