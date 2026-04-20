"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteEstimateButton({ estimateId }: { estimateId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(true);
    await fetch(`/api/estimates?id=${estimateId}`, { method: "DELETE" });
    router.refresh();
  }

  function handleConfirmClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setConfirming(true);
  }

  function handleCancel(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setConfirming(false);
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.preventDefault()}>
        <button
          type="button"
          onClick={handleCancel}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors min-h-[44px] px-2"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="text-xs font-semibold text-red-400 hover:text-red-300 transition-colors min-h-[44px] px-2"
        >
          {deleting ? "..." : "Delete"}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleConfirmClick}
      className="text-zinc-600 hover:text-red-400 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
      aria-label="Delete estimate"
    >
      <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
        <path d="M3 4h10M6 4V3h4v1M4.5 4l.5 9h6l.5-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
