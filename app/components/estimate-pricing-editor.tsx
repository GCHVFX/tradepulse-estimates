"use client";

import type { Currency } from "@/lib/currency";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EditableEstimateBody } from "./editable-estimate-body";
import { EstimateMarkdown } from "./estimate-markdown";
import type { CustomerPricingMode } from "@/lib/estimate-pricing-mode";

export function EstimatePricingEditor({
  estimateId,
  summary,
  detailedSummary,
  groupedSummary,
  initialMode,
  structuredPricing,
  canEditMode,
  pricingError,
  currency,
}: {
  estimateId: string;
  summary: string;
  /** The estimate's persisted snapshot, not the business setting. Required. */
  currency: Currency;
  detailedSummary: string;
  groupedSummary: string;
  initialMode: CustomerPricingMode;
  structuredPricing: boolean;
  canEditMode: boolean;
  pricingError: boolean;
}) {
  const router = useRouter();
  const [selectedMode, setSelectedMode] = useState<CustomerPricingMode>(initialMode);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function selectMode(nextMode: CustomerPricingMode) {
    if (nextMode === selectedMode || saveStatus === "saving") return;

    const previousMode = selectedMode;
    setSelectedMode(nextMode);
    setSaveStatus("saving");
    setErrorMessage("");

    try {
      const response = await fetch(`/api/estimates/${estimateId}/pricing-mode`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save customer pricing");

      setSaveStatus("idle");
      router.refresh();
    } catch (error) {
      setSelectedMode(previousMode);
      setSaveStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Could not save customer pricing"
      );
    }
  }

  return (
    <>
      {canEditMode && (
        <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="px-1 text-sm font-medium text-zinc-700">Customer pricing</span>
            <div className="grid grid-cols-2 rounded-lg bg-zinc-200 p-1" role="group" aria-label="Customer pricing">
              {(["detailed", "grouped"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={selectedMode === mode}
                  disabled={saveStatus === "saving"}
                  onClick={() => selectMode(mode)}
                  className={`min-h-[44px] min-w-[92px] rounded-md px-3 text-sm font-semibold capitalize transition-colors disabled:cursor-wait ${
                    selectedMode === mode
                      ? "bg-white text-zinc-900 shadow-sm"
                      : "text-zinc-600 hover:text-zinc-900"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-5 px-1 pt-1" aria-live="polite">
            {saveStatus === "saving" && <p className="text-xs text-zinc-500">Saving...</p>}
            {saveStatus === "error" && <p className="text-xs text-red-600">{errorMessage}</p>}
          </div>
        </div>
      )}

      {pricingError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-700">
            Customer pricing could not be verified. Detailed pricing is shown.
          </p>
        </div>
      )}

      {selectedMode === "grouped" ? (
        <EstimateMarkdown content={groupedSummary} />
      ) : canEditMode || initialMode === "detailed" ? (
        <EditableEstimateBody
          summary={structuredPricing ? detailedSummary : summary}
          estimateId={estimateId}
          lineItemsReadOnly={structuredPricing}
          currency={currency}
        />
      ) : (
        <EstimateMarkdown content={detailedSummary} />
      )}
    </>
  );
}
