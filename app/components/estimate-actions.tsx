"use client";

import { useState } from "react";
import { SendEstimateSheet } from "./send-estimate-sheet";

interface EstimateActionsProps {
  estimateId: string;
  title: string;
  summary: string;
  customerPhone?: string;
  customerEmail?: string;
  businessName?: string;
  logoUrl?: string | null;
}

export function EstimateActions({
  estimateId,
  title,
  summary,
  customerPhone,
  customerEmail,
  businessName,
  logoUrl,
}: EstimateActionsProps) {
  const [showSheet, setShowSheet] = useState(false);

  return (
    <>
      <div className="fixed bottom-[72px] left-0 right-0 px-5 pb-4 pt-4 bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent flex flex-col gap-3 z-30">
        <a
          href="/new"
          className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center"
        >
          New Estimate
        </a>
        <button
          type="button"
          onClick={() => setShowSheet(true)}
          className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
        >
          Send Estimate
        </button>
      </div>

      <SendEstimateSheet
        isOpen={showSheet}
        onClose={() => setShowSheet(false)}
        estimateId={estimateId}
        customerPhone={customerPhone}
        customerEmail={customerEmail}
        title={title}
        summary={summary}
        businessName={businessName}
        logoUrl={logoUrl}
      />
    </>
  );
}
