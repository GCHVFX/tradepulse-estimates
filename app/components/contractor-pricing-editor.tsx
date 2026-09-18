"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCentsAsCurrency, type Currency } from "@/lib/currency";
import type { ContractorPricing } from "@/lib/contractor-pricing";
import { PRICING_CHANGE_EVENT } from "@/app/components/estimate-actions";
import {
  addCharge,
  chooseLabourMethod,
  editTax,
  initContractorPricingForm,
  removeCharge,
  resolveContractorPricingGuidance,
  resolveContractorPricingPreview,
  toPricingRequestPayload,
  updateCharge,
  type BusinessPricingDefaults,
  type ContractorPricingFormState,
  type ContractorPricingRowInput,
  type EstimateTaxSnapshot,
} from "@/lib/contractor-pricing-form";

/**
 * The contractor pricing editor (specs/contractor-owned-pricing.md sections 5
 * to 12). Four things in the order a contractor thinks about them: labour,
 * materials, anything extra, tax.
 *
 * It holds no pricing rules of its own. Every field rule lives in
 * lib/contractor-pricing-form.ts and every figure comes back from the save
 * route, which calculates through lib/contractor-pricing.ts. Nothing here
 * parses markdown.
 */

const INPUT =
  "w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-base text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[48px]";
const LABEL = "text-sm font-medium text-zinc-600";

export function ContractorPricingEditor({
  estimateId,
  currency,
  initialRows,
  initialTax,
  initialPricing,
  defaults,
  isDelivered,
  depositPercent,
  depositThresholdDollars,
}: {
  estimateId: string;
  /** The estimate's own snapshot, never the business setting. */
  currency: Currency;
  initialRows: ContractorPricingRowInput[];
  initialTax: EstimateTaxSnapshot;
  initialPricing: ContractorPricing;
  defaults: BusinessPricingDefaults;
  /** Once delivered, displayed pricing must stay the persisted figures. */
  isDelivered: boolean;
  /** The estimate's own deposit snapshot, the same values Save resolves against. */
  depositPercent: number | null;
  depositThresholdDollars: number | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState<ContractorPricingFormState>(() =>
    initContractorPricingForm(initialRows, initialTax, defaults)
  );
  const [pricing, setPricing] = useState<ContractorPricing>(initialPricing);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // The one place that decides what figures are on screen: a live preview of
  // what Save would produce while undelivered, the persisted figures once
  // delivered. Never the saved-vs-draft mix the display used to read
  // directly off `pricing` for every field regardless of what was typed.
  const preview = resolveContractorPricingPreview(form, {
    isDelivered,
    persistedPricing: pricing,
    snapshots: { taxRatePercent: initialTax.rate, depositPercent, depositThresholdDollars },
  });

  // What the contractor is told about sending -- one derived value, bound to
  // by every guidance display below, never recomputed a second way.
  const guidance = resolveContractorPricingGuidance({ isDelivered, preview, persistedPricing: pricing });

  const money = (cents: number) => formatCentsAsCurrency(cents, currency, true);

  async function save() {
    setStatus("saving");
    setErrorMessage("");
    try {
      const response = await fetch(`/api/estimates/${estimateId}/pricing`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPricingRequestPayload(form)),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        pricing?: ContractorPricing;
      };
      if (!response.ok || !data.pricing) {
        throw new Error(data.error ?? "Could not save pricing");
      }

      // The saved figures replace the displayed ones, so what is on screen is
      // what the server actually holds. Tax is no longer a pending edit.
      setPricing(data.pricing);
      setForm((current) => ({ ...current, taxEdited: false }));
      setStatus("saved");

      // EstimateActions lives as a sibling on this same page, not a parent,
      // so its Send button learns about a save through this event rather
      // than a prop -- and only ever this event: router.refresh() below
      // re-renders the server components with fresh data, but a mounted
      // client component's own state does not reinitialize from a changed
      // prop without remounting, so EstimateActions would otherwise keep
      // showing the send-gating state from before this save. `complete`
      // here is the server's own field from this exact response, not a
      // value recomputed from the total.
      window.dispatchEvent(
        new CustomEvent(PRICING_CHANGE_EVENT, { detail: { complete: data.pricing.complete } })
      );
      router.refresh();
    } catch (error) {
      // Nothing is marked saved here: the contractor keeps their typed values
      // and is told the save failed.
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Could not save pricing");
    }
  }

  return (
    <div id="pricing" className="mb-4 flex flex-col gap-6 scroll-mt-6">
      {/* Labour */}
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-bold text-zinc-900">Labour</h3>

        {form.labourMethod === null ? (
          <div className="grid grid-cols-2 gap-3">
            {(["hourly", "fixed"] as const).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setForm(chooseLabourMethod(form, method, defaults))}
                className="min-h-[56px] rounded-xl border border-zinc-200 text-base font-semibold text-zinc-700 hover:border-amber-500 hover:text-zinc-900"
              >
                {method === "hourly" ? "Hourly" : "Fixed price"}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-zinc-900">
                {form.labourMethod === "hourly" ? "Hourly" : "Fixed price"}
              </span>
              <button
                type="button"
                onClick={() =>
                  setForm(chooseLabourMethod(form, form.labourMethod === "hourly" ? "fixed" : "hourly", defaults))
                }
                className="text-sm font-medium text-amber-600 hover:text-amber-500 min-h-[44px]"
              >
                Switch to {form.labourMethod === "hourly" ? "fixed price" : "hourly"}
              </button>
            </div>

            {form.labourMethod === "hourly" ? (
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className={LABEL}>Hours</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={INPUT}
                    placeholder="8"
                    value={form.hours}
                    onChange={(event) => setForm({ ...form, hours: event.target.value })}
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className={LABEL}>Rate ($/hr)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={INPUT}
                    placeholder="95"
                    value={form.hourlyRate}
                    onChange={(event) => setForm({ ...form, hourlyRate: event.target.value })}
                  />
                </label>
              </div>
            ) : (
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Labour amount</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className={INPUT}
                  placeholder="760"
                  value={form.fixedAmount}
                  onChange={(event) => setForm({ ...form, fixedAmount: event.target.value })}
                />
              </label>
            )}
          </>
        )}
      </section>

      {/* Materials */}
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-bold text-zinc-900">Materials</h3>
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className={LABEL}>Your cost</span>
            <input
              type="text"
              inputMode="decimal"
              className={INPUT}
              placeholder="1,150"
              value={form.materialsCost}
              onChange={(event) => setForm({ ...form, materialsCost: event.target.value })}
            />
          </label>
          <label className="flex w-28 flex-col gap-1.5">
            <span className={LABEL}>Markup %</span>
            <input
              type="text"
              inputMode="decimal"
              className={INPUT}
              placeholder="20"
              value={form.markupPercent}
              onChange={(event) => setForm({ ...form, markupPercent: event.target.value })}
            />
          </label>
        </div>
        <p className="text-xs text-zinc-500">
          Customer sees {money(preview.materialsCents)} at {form.markupPercent.trim() === "" ? "0" : form.markupPercent}% markup
        </p>
      </section>

      {/* Optional charges */}
      <section className="flex flex-col gap-3">
        {form.charges.length > 0 && <h3 className="text-base font-bold text-zinc-900">Other charges</h3>}
        {form.charges.map((charge) => (
          <div key={charge.id} className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className={LABEL}>Description</span>
              <input
                type="text"
                className={INPUT}
                placeholder="Permit"
                value={charge.description}
                onChange={(event) => setForm(updateCharge(form, charge.id, "description", event.target.value))}
              />
            </label>
            <label className="flex w-28 flex-col gap-1.5">
              <span className={LABEL}>Amount</span>
              <input
                type="text"
                inputMode="decimal"
                className={INPUT}
                placeholder="150"
                value={charge.amount}
                onChange={(event) => setForm(updateCharge(form, charge.id, "amount", event.target.value))}
              />
            </label>
            <button
              type="button"
              aria-label={`Remove ${charge.description || "charge"}`}
              onClick={() => setForm(removeCharge(form, charge.id))}
              className="min-h-[48px] px-2 text-red-400 hover:text-red-600"
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setForm(addCharge(form))}
          className="self-start text-sm font-medium text-amber-600 hover:text-amber-500 min-h-[44px]"
        >
          Add charge
        </button>
      </section>

      {/* Tax */}
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-bold text-zinc-900">Tax</h3>
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className={LABEL}>Label</span>
            <input
              type="text"
              className={INPUT}
              placeholder="GST"
              value={form.taxLabel}
              onChange={(event) => setForm(editTax(form, "taxLabel", event.target.value))}
            />
          </label>
          <label className="flex w-28 flex-col gap-1.5">
            <span className={LABEL}>Rate %</span>
            <input
              type="text"
              inputMode="decimal"
              className={INPUT}
              placeholder="5"
              value={form.taxRate}
              onChange={(event) => setForm(editTax(form, "taxRate", event.target.value))}
            />
          </label>
        </div>
      </section>

      {/* Totals. A live preview of what Save would produce while undelivered
          (see `preview` above); the persisted figures once delivered. */}
      <section className="rounded-xl border border-zinc-200">
        <dl className="divide-y divide-zinc-200 text-sm">
          <Row label="Labour" value={money(preview.labourCents)} />
          <Row label="Materials" value={money(preview.materialsCents)} />
          {preview.chargesCents > 0 && <Row label="Other charges" value={money(preview.chargesCents)} />}
          <Row label="Subtotal" value={money(preview.subtotalCents)} />
          <Row label="Tax" value={money(preview.taxCents)} />
          <Row label="Total" value={formatCentsAsCurrency(preview.totalCents, currency, false)} strong />
          {preview.depositCents > 0 && (
            <>
              <Row label="Deposit required" value={money(preview.depositCents)} />
              <Row label="Balance on completion" value={money(preview.balanceCents)} />
            </>
          )}
        </dl>
      </section>

      {guidance.kind !== "none" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          {guidance.kind === "missing-items" ? (
            <>
              <p className="text-sm font-medium text-amber-800">Still needed before you can send this:</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-amber-800">
                {guidance.labels.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm font-medium text-amber-800">Save pricing to enable sending.</p>
          )}
        </div>
      )}

      {/* Column on mobile, row on sm+ (matching the previous desktop look
          exactly). A long server-rejection message ("This estimate has
          already gone to the customer and cannot be repriced") in a plain
          flex row with no shrink protection squeezed the button down to a
          narrow, wrapped-text shape on a phone -- shrink-0 plus the column
          layout below the button removes that pressure entirely, and puts
          the message where it reads best next to a full-width mobile
          button: underneath it, not beside it. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={save}
          disabled={status === "saving"}
          className="min-h-[48px] shrink-0 whitespace-nowrap rounded-xl bg-amber-500 px-5 text-base font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {status === "saving" ? "Saving..." : "Save pricing"}
        </button>
        <span aria-live="polite" className="text-sm">
          {status === "saved" && <span className="text-zinc-500">Saved</span>}
          {status === "error" && <span className="text-red-600">{errorMessage}</span>}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <dt className={strong ? "font-semibold text-zinc-900" : "text-zinc-700"}>{label}</dt>
      <dd className={strong ? "font-semibold text-zinc-900" : "text-zinc-700"}>{value}</dd>
    </div>
  );
}
