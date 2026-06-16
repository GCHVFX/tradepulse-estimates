"use client";

import { generateEstimatePDF } from "@/lib/generate-pdf";

interface DownloadPdfButtonProps {
  title: string;
  summary: string;
  businessName?: string;
  logoUrl?: string | null;
  photoUrls?: string[];
}

export function DownloadPdfButton({
  title,
  summary,
  businessName,
  logoUrl,
  photoUrls,
}: DownloadPdfButtonProps) {
  return (
    <button
      type="button"
      onClick={() => generateEstimatePDF(title, summary, { businessName, logoUrl, photoUrls })}
      className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
    >
      Download PDF
    </button>
  );
}
