"use client";

import { useState, useEffect, useMemo } from "react";
import { Spinner } from "@/app/components/spinner";

type Panel = "review-ready" | "needs-link";

interface MarkJobDoneSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onReviewSent?: () => void;
  estimateId: string;
  googleReviewLink: string | null;
  customerPhone: string;
  customerName: string;
  businessName: string;
  businessPhone: string;
  reviewRequestedAt: string | null;
  initialPanel?: Panel;
}

export function MarkJobDoneSheet({
  isOpen,
  onClose,
  onReviewSent,
  estimateId,
  googleReviewLink,
  customerPhone,
  customerName,
  businessName,
  businessPhone,
  reviewRequestedAt,
  initialPanel,
}: MarkJobDoneSheetProps) {
  const [panel, setPanel] = useState<Panel>("review-ready");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewSent, setReviewSent] = useState(false);
  const [reviewConfirming, setReviewConfirming] = useState(false);
  const [messageBody, setMessageBody] = useState("");

  const defaultReviewMessage = useMemo(() => {
    const name = businessName || "us";
    if (businessPhone) {
      return `Thanks for choosing ${name}.\n\nIf anything wasn't right, text or call us at ${businessPhone} and we'll make it right.\n\nIf you have a moment, we'd appreciate a Google review.`;
    }
    return `Thanks for choosing ${name}.\n\nIf anything wasn't right, contact us directly and we'll make it right.\n\nIf you have a moment, we'd appreciate a Google review.`;
  }, [businessName, businessPhone]);

  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setReviewError("");
        setReviewSent(false);
        setReviewConfirming(false);
        setMessageBody("");
      }, 300);
      return () => clearTimeout(t);
    }

    if (initialPanel === "needs-link") {
      setPanel("needs-link");
    } else {
      setPanel("review-ready");
      setMessageBody(defaultReviewMessage);
    }
  }, [isOpen, initialPanel, defaultReviewMessage]);

  async function handleSendReview(force: boolean) {
    setReviewLoading(true);
    setReviewError("");
    try {
      const res = await fetch(`/api/estimates/${estimateId}/review-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageBody,
          ...(force && { force: true }),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setReviewError((data as { error?: string }).error ?? `Server error ${res.status}`);
        return;
      }
      setReviewConfirming(false);
      setReviewSent(true);
      onReviewSent?.();
    } finally {
      setReviewLoading(false);
    }
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className={`fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 rounded-t-2xl transition-transform duration-300 ease-out ${
          isOpen ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex justify-center pt-3">
          <div className="w-10 h-1 rounded-full bg-zinc-700" />
        </div>

        <div className="flex items-center justify-between px-5 pt-3 pb-2 min-h-[52px]">
          <span className="text-white font-semibold text-base">Job Marked Done</span>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {panel === "review-ready" && (
          <div className="px-5 pb-10 pt-2 flex flex-col gap-4">
            {reviewSent ? (
              <>
                <div className="flex items-center gap-3 bg-green-950/40 border border-green-800/50 rounded-xl px-4 py-3.5">
                  <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-green-400 shrink-0" aria-hidden="true">
                    <path d="M4 10l4.5 4.5L16 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div>
                    <p className="text-white text-sm font-medium">Review request sent</p>
                    {customerPhone && (
                      <p className="text-zinc-400 text-xs mt-0.5">Text sent to {customerPhone}</p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
                >
                  Done
                </button>
              </>
            ) : reviewConfirming ? (
              <>
                <p className="text-zinc-400 text-sm leading-relaxed">
                  Send another review request to {customerPhone || "this customer"}?
                </p>
                <textarea
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  disabled={reviewLoading}
                  rows={4}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-300 text-sm leading-relaxed resize-none focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 disabled:opacity-50 min-h-[96px]"
                />
                <p className="text-zinc-400 text-xs px-1">Your Google review link will be attached automatically.</p>
                {reviewError && (
                  <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-red-300 text-sm">
                    {reviewError}
                  </div>
                )}
                <button
                  type="button"
                  disabled={reviewLoading}
                  onClick={() => handleSendReview(true)}
                  className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center gap-2"
                >
                  {reviewLoading && <Spinner className="w-5 h-5 text-zinc-950" />}
                  {reviewLoading ? "Sending..." : "Confirm Send"}
                </button>
                <button
                  type="button"
                  onClick={() => setReviewConfirming(false)}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
                >
                  Cancel
                </button>
              </>
            ) : reviewRequestedAt ? (
              <>
                <div className="flex items-center gap-3 bg-green-950/40 border border-green-800/50 rounded-xl px-4 py-3.5">
                  <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-green-400 shrink-0" aria-hidden="true">
                    <path d="M4 10l4.5 4.5L16 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div>
                    <p className="text-white text-sm font-medium">Review request sent</p>
                    <p className="text-zinc-400 text-xs mt-0.5">
                      {(() => {
                        const d = new Date(reviewRequestedAt);
                        const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                        const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
                        return `${date} at ${time}`;
                      })()}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReviewConfirming(true)}
                  className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
                >
                  Send Again
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <div className="bg-zinc-800 rounded-xl overflow-hidden">
                  <p className="text-zinc-400 text-xs font-medium uppercase tracking-wide px-4 pt-3 pb-1.5">Message</p>
                  <textarea
                    value={messageBody}
                    onChange={(e) => setMessageBody(e.target.value)}
                    disabled={reviewLoading}
                    rows={4}
                    className="w-full bg-transparent px-4 pb-3 text-zinc-300 text-sm leading-relaxed resize-none focus:outline-none disabled:opacity-50 min-h-[80px]"
                  />
                </div>
                <p className="text-zinc-400 text-xs px-1">Your Google review link will be attached automatically.</p>
                {reviewError && (
                  <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-red-300 text-sm">
                    {reviewError}
                  </div>
                )}
                <button
                  type="button"
                  disabled={reviewLoading}
                  onClick={() => handleSendReview(false)}
                  className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center gap-2"
                >
                  {reviewLoading && <Spinner className="w-5 h-5 text-zinc-950" />}
                  {reviewLoading ? "Sending..." : "Send Review Request"}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
                >
                  Skip
                </button>
              </>
            )}
          </div>
        )}

        {panel === "needs-link" && (
          <div className="px-5 pb-10 pt-2 flex flex-col gap-4">
            <div>
              <p className="text-white font-semibold text-sm mb-1">Google review link missing</p>
              <p className="text-zinc-400 text-sm leading-relaxed">
                Add your Google review link to send review requests after jobs.
              </p>
            </div>
            <a
              href="/profile?section=reviews"
              className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center"
            >
              Add Review Link
            </a>
            <button
              type="button"
              onClick={onClose}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Skip
            </button>
          </div>
        )}
      </div>
    </>
  );
}
