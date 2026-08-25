"use client";

import { generateEstimatePDF } from "@/lib/generate-pdf";
import type { Currency } from "@/lib/currency";

interface DownloadPdfButtonProps {
  title: string;
  summary: string;
  businessName?: string;
  logoUrl?: string | null;
  photoUrls?: string[];
  /** The estimate's snapshot currency. Required. */
  currency: Currency;
}

export function DownloadPdfButton({
  title,
  summary,
  businessName,
  logoUrl,
  photoUrls,
  currency,
}: DownloadPdfButtonProps) {
  return (
    <button
      type="button"
      onClick={() =>
        generateEstimatePDF(title, summary, {
          businessName,
          logoUrl,
          photoUrls,
          currency,
        })
      }
      className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
    >
      Download PDF
    </button>
  );
}
