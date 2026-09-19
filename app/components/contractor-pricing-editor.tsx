"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCentsAsCurrency, type Currency } from "@/lib/currency";
import type { ContractorPricing } from "@/lib/contractor-pricing";
import type { PriceBookSuggestion } from "@/lib/pricebook-suggestions";
import { PRICING_CHANGE_EVENT } from "@/app/components/estimate-actions";
import {
  acceptSuggestedItem,
  addCharge,
  chooseLabourMethod,
  editTax,
  formSnapshot,
  hasEnteredGenericPricing,
  hasUnsavedPricingChanges,
  initContractorPricingEditorState,
  isPricingSendReady,
  removeCharge,
  removeConfirmedItem,
  resolveContractorPricingGuidance,
  resolveContractorPricingPreview,
  shouldRevealSaveFeedback,
  shouldScrollToPricing,
  toPricingRequestPayload,
  updateCharge,
  updateConfirmedItem,
  type BusinessPricingDefaults,
  type ContractorPricingFormState,
  type ContractorPricingRowInput,
  type EstimateTaxSnapshot,
} from "@/lib/contractor-pricing-form";

/** What save() is doing right now. Owned here; a caller never sets this. */
export type ContractorPricingSaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * The read-only projection a parent (/new, and ContractorPricingDraftEditor on
 * /estimates/[id]) may mirror to decide its own sticky call-to-action. The
 * editor computes every field itself -- a parent must never derive
 * `sendReady` from a combination of other signals on its own, so there is
 * exactly one place this logic lives.
 */
export interface ContractorPricingEditorState {
  status: ContractorPricingSaveStatus;
  /** True while the draft differs from the persisted pricing (the loaded rows, or the last save this mount). */
  isDirty: boolean;
  /** Persisted pricing is complete, nothing has been edited since, and no
   * save is in flight -- the fully-resolved "safe to hand off to Send"
   * signal (isPricingSendReady). */
  sendReady: boolean;
}

/** Imperative handle so a parent can trigger the exact same save() a Save
 * button inside this component would -- never a second save implementation. */
export interface ContractorPricingEditorHandle {
  save: () => Promise<void>;
}

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
// A delivered estimate's pricing, shown as the record it now is: full-contrast
// values on a quiet background, no focus ring, and not tabbable, so nothing
// suggests a value can still change.
const INPUT_LOCKED =
  "w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-base text-zinc-900 focus:outline-none cursor-default min-h-[48px]";
const LABEL = "text-sm font-medium text-zinc-600";

export interface ContractorPricingEditorProps {
  estimateId: string;
  /** The estimate's own snapshot, never the business setting. */
  currency: Currency;
  initialRows: ContractorPricingRowInput[];
  initialTax: EstimateTaxSnapshot;
  initialPricing: ContractorPricing;
  defaults: BusinessPricingDefaults;
  /** Once delivered, displayed pricing must stay the persisted figures, and
   * nothing that changes pricing is editable or rendered: the server refuses
   * every pricing write for a delivered estimate. */
  isDelivered: boolean;
  /** The estimate's own deposit snapshot, the same values Save resolves against. */
  depositPercent: number | null;
  depositThresholdDollars: number | null;
  /**
   * Saved-item suggestions matched against the contractor's own job text
   * (Phase 2 slice 4). Omitted wherever that text is not available for this
   * page load (e.g. the detail page's own server render, which has no
   * session job text and must not fall back to generated prose) -- absent or
   * empty is the same valid "no suggestions" state either way.
   */
  suggestions?: PriceBookSuggestion[];
  /**
   * A read-only projection of save status, dirty and send-readiness,
   * reported after every change so a parent (/new) can choose its own
   * sticky call-to-action without owning any of this state itself. Never
   * called with a value this component has not itself computed.
   */
  onStateChange?: (state: ContractorPricingEditorState) => void;
  /**
   * Set where a sticky Save Pricing action owns Save -- /new, and
   * ContractorPricingDraftEditor for an undelivered draft on /estimates/[id]
   * -- so the inline button would be a duplicate. The status/error text
   * beside it still renders -- this only ever hides the button. Omitted
   * (default false) for a delivered estimate on /estimates/[id], unchanged.
   */
  hideInlineSaveButton?: boolean;
}

export const ContractorPricingEditor = forwardRef<ContractorPricingEditorHandle, ContractorPricingEditorProps>(
  function ContractorPricingEditor(
    {
      estimateId,
      currency,
      initialRows,
      initialTax,
      initialPricing,
      defaults,
      isDelivered,
      depositPercent,
      depositThresholdDollars,
      suggestions: initialSuggestions,
      onStateChange,
      hideInlineSaveButton,
    },
    ref
  ) {
  const router = useRouter();
  // Built once: the form from the persisted rows, and that same form's
  // snapshot as the dirty baseline, since the loaded rows are the last saved
  // state (see initContractorPricingEditorState).
  const [initialEditorState] = useState(() =>
    initContractorPricingEditorState(initialRows, initialTax, defaults)
  );
  const [form, setForm] = useState<ContractorPricingFormState>(initialEditorState.form);
  const [pricing, setPricing] = useState<ContractorPricing>(initialPricing);
  const [status, setStatus] = useState<ContractorPricingSaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  // Snapshot of the draft as last persisted: the loaded rows at mount, then
  // each successful save. isDirty is fully derived from it, so there is
  // nothing to reset by hand when a new save succeeds or the form changes --
  // see hasUnsavedPricingChanges().
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string>(initialEditorState.savedSnapshot);
  const isDirty = hasUnsavedPricingChanges(form, lastSavedSnapshot);
  // Scroll target for a save that did not leave pricing sendable: the
  // guidance and the status/error text together, so the reason is visible
  // even when save was triggered from /new's sticky CTA while scrolled
  // elsewhere.
  const saveFeedbackRef = useRef<HTMLDivElement>(null);

  // Suggestions (Phase 2 slice 4). Local state so an accepted suggestion can
  // be removed from the visible list immediately -- the only mechanism that
  // prevents the same saved item being accepted twice.
  const [suggestions, setSuggestions] = useState<PriceBookSuggestion[]>(initialSuggestions ?? []);
  const [pendingSuggestionId, setPendingSuggestionId] = useState<string | null>(null);
  const [resolvingSuggestionId, setResolvingSuggestionId] = useState<string | null>(null);
  const [suggestionError, setSuggestionError] = useState("");

  /**
   * Tap order (specs/contractor-owned-pricing.md's "acceptance order around
   * confirmation"): ask for the destructive mode-switch confirmation first,
   * when one is needed, before ever calling the resolve endpoint. This
   * avoids an authoritative-price request the contractor is only going to
   * cancel.
   */
  function handleTapSuggestion(suggestion: PriceBookSuggestion) {
    setSuggestionError("");
    if (form.confirmedItems.length === 0 && hasEnteredGenericPricing(form)) {
      setPendingSuggestionId(suggestion.id);
      return;
    }
    void acceptSuggestion(suggestion);
  }

  /**
   * Resolve the item's current authoritative values, then -- only on success
   * -- clear generic pricing and add the confirmed item in one atomic form
   * update. A resolve failure never touches `form`, so generic pricing can
   * never be destroyed by a failed lookup (the "no partial destructive
   * switch" rule).
   */
  async function acceptSuggestion(suggestion: PriceBookSuggestion) {
    setPendingSuggestionId(null);
    setResolvingSuggestionId(suggestion.id);
    setSuggestionError("");
    try {
      const response = await fetch(`/api/price-book-items/${suggestion.id}`);
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        item?: {
          description: string;
          labourUnitPrice: number;
          materialUnitPrice: number;
          taxable: boolean;
        };
      };
      if (!response.ok || !data.item) {
        // 404 means the item is now inactive or gone -- it will never
        // resolve again, so it comes off the visible list here too, not
        // just on success. Every other failure (network, 401, 500) leaves
        // it in place, since a retry of the same tap could still succeed.
        if (response.status === 404) {
          setSuggestions((current) => current.filter((candidate) => candidate.id !== suggestion.id));
        }
        throw new Error(data.error ?? "Could not add this saved item. Try again.");
      }

      setForm((current) => acceptSuggestedItem(current, data.item!));
      setSuggestions((current) => current.filter((candidate) => candidate.id !== suggestion.id));
    } catch (error) {
      setSuggestionError(error instanceof Error ? error.message : "Could not add this saved item. Try again.");
    } finally {
      setResolvingSuggestionId(null);
    }
  }

  function cancelPendingSuggestion() {
    setPendingSuggestionId(null);
  }

  // Add Pricing on /new links here as /estimates/{id}#pricing, but plain
  // browser hash navigation to this client-rendered section proved
  // unreliable on Android Chrome. Scroll there directly on mount instead --
  // once only, so a later form edit, re-render or Save can never yank the
  // contractor back down to pricing.
  const pricingRef = useRef<HTMLDivElement>(null);
  const hasScrolledToPricingRef = useRef(false);
  useEffect(() => {
    if (hasScrolledToPricingRef.current) return;
    hasScrolledToPricingRef.current = true;
    if (shouldScrollToPricing(window.location.hash)) {
      pricingRef.current?.scrollIntoView({ block: "start" });
    }
  }, []);

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

  // Delivered: the server refuses every pricing write (the same isDelivered
  // predicate, in PUT /api/estimates/[id]/pricing and in
  // tpe_save_contractor_pricing), so every field is read-only and no control
  // that changes pricing is rendered.
  const fieldProps = isDelivered
    ? { readOnly: true, tabIndex: -1, className: INPUT_LOCKED }
    : { className: INPUT };

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
      // The draft just sent is, by definition, no longer dirty. Captured
      // from `form` (pre-taxEdited-reset) rather than after the setForm
      // above: formSnapshot() already excludes taxEdited, so the two are
      // equivalent, and this avoids waiting on a second render. Anything
      // typed while this request was in flight differs from it, so it
      // correctly stays dirty.
      setLastSavedSnapshot(formSnapshot(form));
      // Send readiness is published by the effect below from the committed
      // state, not dispatched from here: a direct dispatch of the server's
      // `complete` would re-enable Send over edits typed during the save.
      router.refresh();
    } catch (error) {
      // Nothing is marked saved here: the contractor keeps their typed values
      // and is told the save failed.
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Could not save pricing");
    }
  }

  // Brings the save feedback into view after React has committed it, so the
  // error text or the missing-items guidance is already in the DOM when the
  // scroll runs. Keyed on status and pricing: every save attempt changes
  // status, and a successful one also replaces pricing. block "start" keeps
  // the feedback clear of a fixed bottom bar (/new's sticky CTA and
  // BottomNav) instead of centring it behind one.
  useEffect(() => {
    if (!shouldRevealSaveFeedback(status, pricing.complete)) return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    saveFeedbackRef.current?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [status, pricing]);

  // The one imperative surface a parent may use: exactly the same save()
  // above a Save button inside this component would call. Never a second
  // save implementation.
  useImperativeHandle(ref, () => ({ save }));

  // Fully resolved here (persisted complete, not dirty, not saving) so a
  // parent never combines these signals itself -- see isPricingSendReady().
  const sendReady = isPricingSendReady({ status, isDirty, persistedComplete: pricing.complete });

  // Reports status/isDirty/sendReady to a parent after every change, via a
  // ref so an inline arrow function passed as onStateChange does not retrigger
  // this effect on every render.
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  });
  useEffect(() => {
    onStateChangeRef.current?.({ status, isDirty, sendReady });
  }, [status, isDirty, sendReady]);

  // The one publisher of send readiness to EstimateActions, a sibling on
  // /estimates/[id] that can only hear this through a window event (a mounted
  // client component does not reinitialize from a changed server prop, even
  // after router.refresh()). Fires whenever sendReady changes, in both
  // directions: the first edit, a save starting, a save finishing complete
  // or incomplete, and an edit back to exactly the persisted values. Not on
  // mount: EstimateActions is already seeded with the same server value.
  const publishedSendReadyRef = useRef(sendReady);
  useEffect(() => {
    // A delivered estimate has no draft readiness to publish, and must never
    // flip EstimateActions' Send gating.
    if (isDelivered) return;
    if (publishedSendReadyRef.current === sendReady) return;
    publishedSendReadyRef.current = sendReady;
    window.dispatchEvent(new CustomEvent(PRICING_CHANGE_EVENT, { detail: { complete: sendReady } }));
  }, [sendReady, isDelivered]);

  // Defensive only (specs/contractor-owned-pricing.md's "defensive reload
  // rule"): persisted 'ea' rows that could not be reliably reconstructed
  // into confirmed items. No editable pricing draft is shown -- this is not
  // a recovery flow, just the smallest existing attention pattern applied to
  // a state that should not occur from normal use of this app.
  if (form.pricingAttentionNeeded) {
    return (
      <div id="pricing" ref={pricingRef} className="mb-4 scroll-mt-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3.5">
          <p className="text-sm font-medium text-red-800">Pricing needs attention</p>
          <p className="mt-1 text-sm text-red-700">
            This estimate&apos;s saved pricing could not be read reliably. Contact support before pricing this
            estimate.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div id="pricing" ref={pricingRef} className="mb-4 flex flex-col gap-6 scroll-mt-6">
      {/* Saved-item suggestions (Phase 2 slice 4). Independent of mode: shown
          whenever there are candidates left, whether or not the contractor
          has already accepted one -- accepting removes it from this list. */}
      {!isDelivered && suggestions.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-base font-bold text-zinc-900">Saved items</h3>
          <div className="flex flex-col gap-2">
            {suggestions.map((suggestion) => (
              <div key={suggestion.id} className="rounded-lg border border-zinc-200 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-zinc-900">{suggestion.name}</span>
                  <button
                    type="button"
                    onClick={() => handleTapSuggestion(suggestion)}
                    disabled={resolvingSuggestionId === suggestion.id}
                    className="min-h-[44px] shrink-0 whitespace-nowrap rounded-lg border border-amber-500 px-3 text-sm font-semibold text-amber-600 hover:bg-amber-50 disabled:opacity-50"
                  >
                    {resolvingSuggestionId === suggestion.id ? "Adding..." : "Add"}
                  </button>
                </div>
                {pendingSuggestionId === suggestion.id && (
                  <div className="mt-2.5 rounded-lg bg-amber-50 px-3 py-2.5">
                    <p className="text-sm text-amber-800">
                      Use saved line items instead? This will replace your current Labour and Materials values.
                      Other charges and tax will stay.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void acceptSuggestion(suggestion)}
                        className="min-h-[40px] rounded-lg bg-amber-500 px-3 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
                      >
                        Use saved line items
                      </button>
                      <button
                        type="button"
                        onClick={cancelPendingSuggestion}
                        className="min-h-[40px] rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {suggestionError && <p className="text-sm text-red-600">{suggestionError}</p>}
        </section>
      )}

      {form.confirmedItems.length > 0 ? (
        /* Saved line items (Phase 2 slice 4). Replaces generic Labour and
            Materials entirely while any confirmed item exists (Option C).
            Taxability is copied from the saved item and is not editable
            here. */
        <section className="flex flex-col gap-3">
          <h3 className="text-base font-bold text-zinc-900">Saved line items</h3>
          {form.confirmedItems.map((item) => (
            <div key={item.id} className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Description</span>
                <input
                  type="text"
                  {...fieldProps}
                  value={item.description}
                  onChange={(event) =>
                    setForm(updateConfirmedItem(form, item.id, "description", event.target.value))
                  }
                />
              </label>
              <div className="flex gap-3">
                <label className="flex w-24 flex-col gap-1.5">
                  <span className={LABEL}>Qty</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    {...fieldProps}
                    value={item.quantity}
                    onChange={(event) =>
                      setForm(updateConfirmedItem(form, item.id, "quantity", event.target.value))
                    }
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className={LABEL}>Labour</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    {...fieldProps}
                    value={item.labourUnitPrice}
                    onChange={(event) =>
                      setForm(updateConfirmedItem(form, item.id, "labourUnitPrice", event.target.value))
                    }
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className={LABEL}>Materials</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    {...fieldProps}
                    value={item.materialUnitPrice}
                    onChange={(event) =>
                      setForm(updateConfirmedItem(form, item.id, "materialUnitPrice", event.target.value))
                    }
                  />
                </label>
              </div>
              {!isDelivered && (
                <button
                  type="button"
                  aria-label={`Remove ${item.description || "line item"}`}
                  onClick={() => setForm(removeConfirmedItem(form, item.id))}
                  className="self-start text-sm font-medium text-red-500 hover:text-red-600 min-h-[44px]"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </section>
      ) : (
        <>
      {/* Labour */}
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-bold text-zinc-900">Labour</h3>

        {form.labourMethod === null ? (
          isDelivered ? null : <div className="grid grid-cols-2 gap-3">
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
              {!isDelivered && (
                <button
                  type="button"
                  onClick={() =>
                    setForm(chooseLabourMethod(form, form.labourMethod === "hourly" ? "fixed" : "hourly", defaults))
                  }
                  className="text-sm font-medium text-amber-600 hover:text-amber-500 min-h-[44px]"
                >
                  Switch to {form.labourMethod === "hourly" ? "fixed price" : "hourly"}
                </button>
              )}
            </div>

            {form.labourMethod === "hourly" ? (
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1.5">
                  <span className={LABEL}>Hours</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    {...fieldProps}
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
                    {...fieldProps}
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
                  {...fieldProps}
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
              {...fieldProps}
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
              {...fieldProps}
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
        </>
      )}

      {/* Optional charges */}
      {(!isDelivered || form.charges.length > 0) && (
      <section className="flex flex-col gap-3">
        {form.charges.length > 0 && <h3 className="text-base font-bold text-zinc-900">Other charges</h3>}
        {form.charges.map((charge) => (
          <div key={charge.id} className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className={LABEL}>Description</span>
              <input
                type="text"
                {...fieldProps}
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
                {...fieldProps}
                placeholder="150"
                value={charge.amount}
                onChange={(event) => setForm(updateCharge(form, charge.id, "amount", event.target.value))}
              />
            </label>
            {!isDelivered && (
              <button
                type="button"
                aria-label={`Remove ${charge.description || "charge"}`}
                onClick={() => setForm(removeCharge(form, charge.id))}
                className="min-h-[48px] px-2 text-red-400 hover:text-red-600"
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {!isDelivered && (
          <button
            type="button"
            onClick={() => setForm(addCharge(form))}
            className="self-start text-sm font-medium text-amber-600 hover:text-amber-500 min-h-[44px]"
          >
            Add charge
          </button>
        )}
      </section>
      )}

      {/* Tax */}
      <section className="flex flex-col gap-3">
        <h3 className="text-base font-bold text-zinc-900">Tax</h3>
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className={LABEL}>Label</span>
            <input
              type="text"
              {...fieldProps}
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
              {...fieldProps}
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

      {/* Save feedback: the guidance and the status/error text, the one
          element a finished save scrolls into view (see the effect above).
          Same gap-6 spacing the editor's own column uses, so wrapping them
          changes nothing on screen. */}
      <div ref={saveFeedbackRef} className="flex flex-col gap-6 scroll-mt-6">
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
      {isDelivered ? (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
          <p className="text-sm font-medium text-zinc-900">Pricing is locked because this estimate has been sent.</p>
          <p className="mt-1 text-sm text-zinc-700">Create a new estimate to change pricing.</p>
        </div>
      ) : (
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        {!hideInlineSaveButton && (
          <button
            type="button"
            onClick={save}
            disabled={status === "saving"}
            className="min-h-[48px] shrink-0 whitespace-nowrap rounded-xl bg-amber-500 px-5 text-base font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {status === "saving" ? "Saving..." : "Save pricing"}
          </button>
        )}
        <span aria-live="polite" className="text-sm">
          {status === "saved" && <span className="text-zinc-500">Saved</span>}
          {status === "error" && <span className="text-red-600">{errorMessage}</span>}
        </span>
      </div>
      )}
      </div>
    </div>
  );
  }
);

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <dt className={strong ? "font-semibold text-zinc-900" : "text-zinc-700"}>{label}</dt>
      <dd className={strong ? "font-semibold text-zinc-900" : "text-zinc-700"}>{value}</dd>
    </div>
  );
}
