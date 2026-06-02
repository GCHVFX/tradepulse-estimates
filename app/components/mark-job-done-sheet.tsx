"use client";

import { useState, useEffect } from "react";
import { Spinner } from "@/app/components/spinner";

type Panel = "confirm" | "upgrade" | "review-ready" | "needs-link";

interface MarkJobDoneSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onDone: () => void;
  estimateId: string;
  isPro: boolean;
  googleReviewLink: string | null;
}

export function MarkJobDoneSheet({
  isOpen,
  onClose,
  onDone,
  estimateId,
  isPro,
  googleReviewLink,
}: MarkJobDoneSheetProps) {
  const [panel, setPanel] = useState<Panel>("confirm");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => setPanel("confirm"), 300);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  async function handleMarkDone() {
    setIsLoading(true);
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

      if (!res.ok) return;

      onDone();

      if (!isPro) {
        setPanel("upgrade");
      } else if (googleReviewLink) {
        setPanel("review-ready");
      } else {
        setPanel("needs-link");
      }
    } finally {
      setIsLoading(false);
    }
  }

  const headerTitle =
    panel === "confirm"
      ? "Mark Job Done"
      : panel === "upgrade"
      ? "Upgrade to Pro"
      : "Job Marked Done";

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 ${
          isOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
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
          <span className="text-white font-semibold text-base">{headerTitle}</span>
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

        {/* Confirm */}
        {panel === "confirm" && (
          <div className="px-5 pb-10 pt-2 flex flex-col gap-4">
            <p className="text-zinc-400 text-sm leading-relaxed">
              Mark this job as complete. The estimate stays on file and can still be shared.
            </p>
            <button
              type="button"
              disabled={isLoading}
              onClick={handleMarkDone}
              className="w-full bg-green-600 hover:bg-green-500 active:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center gap-2"
            >
              {isLoading && <Spinner className="w-5 h-5" />}
              {isLoading ? "Saving..." : "Mark Job Done"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Upgrade upsell (Starter users) */}
        {panel === "upgrade" && (
          <div className="px-5 pb-10 pt-2 flex flex-col gap-4">
            <p className="text-zinc-400 text-sm leading-relaxed">
              Pro unlocks automated follow-ups that get you more reviews and paid faster.
            </p>
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-3 bg-zinc-800 rounded-xl px-4 py-3.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0 mt-0.5">
                  <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-amber-400" aria-hidden="true">
                    <path d="M8 1.5l1.6 3.3 3.6.5-2.6 2.5.6 3.6L8 9.7l-3.2 1.7.6-3.6L2.8 5.3l3.6-.5L8 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <p className="text-white text-sm font-medium">Review Requests</p>
                  <p className="text-zinc-500 text-xs mt-0.5">Send a Google review request when a job is done.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-zinc-800 rounded-xl px-4 py-3.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0 mt-0.5">
                  <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-amber-400" aria-hidden="true">
                    <rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M5 7.5h6M5 9.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </div>
                <div>
                  <p className="text-white text-sm font-medium">Payment Reminders</p>
                  <p className="text-zinc-500 text-xs mt-0.5">Follow up automatically until the invoice is paid.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-zinc-800 rounded-xl px-4 py-3.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0 mt-0.5">
                  <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-amber-400" aria-hidden="true">
                    <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M5 1v2M11 1v2M2 6h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    <circle cx="8" cy="10" r="1.5" fill="currentColor" />
                  </svg>
                </div>
                <div>
                  <p className="text-white text-sm font-medium">Follow-Up Reminders</p>
                  <p className="text-zinc-500 text-xs mt-0.5">Schedule outreach for repeat work and maintenance.</p>
                </div>
              </div>
            </div>
            <a
              href="/subscribe"
              className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center"
            >
              Upgrade to Pro
            </a>
            <button
              type="button"
              onClick={onClose}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Not now
            </button>
          </div>
        )}

        {/* Pro + has review link */}
        {panel === "review-ready" && (
          <div className="px-5 pb-10 pt-2 flex flex-col gap-4">
            <p className="text-zinc-400 text-sm leading-relaxed">
              Ready to send a Google review request to your customer.
            </p>
            {/* Phase 3: wire Send Review Request to SMS/email */}
            <button
              type="button"
              onClick={onClose}
              className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Send Review Request
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Skip
            </button>
          </div>
        )}

        {/* Pro + no review link */}
        {panel === "needs-link" && (
          <div className="px-5 pb-10 pt-2 flex flex-col gap-4">
            <p className="text-zinc-400 text-sm leading-relaxed">
              Add your Google Review Link in Profile to send review requests after completing jobs.
            </p>
            <a
              href="/profile"
              className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center"
            >
              Open Profile
            </a>
            <button
              type="button"
              onClick={onClose}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </>
  );
}
