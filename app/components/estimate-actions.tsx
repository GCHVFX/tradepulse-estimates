"use client";

import { useState } from "react";
import { SendEstimateSheet } from "./send-estimate-sheet";
import { MarkJobDoneSheet } from "./mark-job-done-sheet";

interface EstimateActionsProps {
  estimateId: string;
  title: string;
  summary: string;
  status?: string | null;
  customerPhone?: string;
  customerEmail?: string;
  customerName?: string;
  businessName?: string;
  logoUrl?: string | null;
  isPro: boolean;
  googleReviewLink: string | null;
  reviewRequestedAt?: string | null;
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
  logoUrl,
  isPro,
  googleReviewLink,
  reviewRequestedAt,
}: EstimateActionsProps) {
  const [showSendSheet, setShowSendSheet] = useState(false);
  const [showDoneSheet, setShowDoneSheet] = useState(false);
  const [localStatus, setLocalStatus] = useState(status ?? "");
  const [localCustomerPhone, setLocalCustomerPhone] = useState(customerPhone ?? "");
  const [isDone, setIsDone] = useState(status === "done");

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
          <div className="w-full flex items-center justify-center gap-2 min-h-[56px] rounded-xl border border-green-800/50 bg-green-950/40">
            <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-green-400 shrink-0" aria-hidden="true">
              <path d="M4 10l4.5 4.5L16 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-green-400 font-semibold text-base">Job Done</span>
          </div>
        ) : localStatus === "sent" ? (
          <>
            {isPro && googleReviewLink && (
              <div className="flex items-center justify-center gap-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-amber-400 text-xs font-semibold">
                ⭐ Review Request Ready
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowDoneSheet(true)}
              className="w-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Mark Job Done
            </button>
          </>
        ) : null}

        <button
          type="button"
          onClick={() => setShowSendSheet(true)}
          className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
        >
          Send Estimate
        </button>
      </div>

      <SendEstimateSheet
        isOpen={showSendSheet}
        onClose={() => setShowSendSheet(false)}
        onSent={(phone) => {
          setLocalStatus("sent");
          if (phone) setLocalCustomerPhone(phone);
        }}
        estimateId={estimateId}
        customerPhone={customerPhone}
        customerEmail={customerEmail}
        title={title}
        summary={summary}
        businessName={businessName}
        logoUrl={logoUrl}
      />

      <MarkJobDoneSheet
        isOpen={showDoneSheet}
        onClose={() => setShowDoneSheet(false)}
        onDone={() => setIsDone(true)}
        estimateId={estimateId}
        isPro={isPro}
        googleReviewLink={googleReviewLink}
        customerPhone={localCustomerPhone}
        customerName={customerName ?? ""}
        businessName={businessName ?? ""}
        reviewRequestedAt={reviewRequestedAt ?? null}
      />
    </>
  );
}
