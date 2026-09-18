/**
 * The contractor pricing editor's state, kept out of React so the rules that
 * matter can be tested directly (specs/contractor-owned-pricing.md sections 5,
 * 6, 7, 11 and 12).
 *
 * Pure. No React, no network, no database, no markdown. It never calculates a
 * price: every figure the contractor sees comes from the backend's
 * calculateContractorPricing() result.
 *
 * BLANK IS NOT ZERO. Every money field is held as the text the contractor
 * actually typed. An empty field means unknown and produces no row; "0" means
 * they entered zero and produces a real row worth nothing. Parsing early, or
 * defaulting a blank to 0, would erase that difference and quietly turn an
 * unanswered question into a priced answer.
 */

import {
  toCanonicalRows,
  type ChargeInput,
  type ContractorPricingRequest,
  type LabourInput,
  type MaterialsInput,
} from "./contractor-pricing-request";
import { calculateContractorPricing, type ContractorPricing, type PricingGap } from "./contractor-pricing";

export type LabourMethod = "hourly" | "fixed";

export interface ChargeFieldState {
  /** Local only, for React keys and removal. Never sent. */
  id: string;
  description: string;
  amount: string;
}

export interface ContractorPricingFormState {
  /** null until the contractor picks one. Never defaulted. */
  labourMethod: LabourMethod | null;
  hours: string;
  hourlyRate: string;
  fixedAmount: string;
  materialsCost: string;
  markupPercent: string;
  charges: ChargeFieldState[];
  taxLabel: string;
  taxRate: string;
  /** True only after the contractor edits tax in this session. */
  taxEdited: boolean;
}

/** A stored row, as the save route returns it. */
export interface ContractorPricingRowInput {
  item_type: string;
  unit: string | null;
  quantity: number;
  unit_price: number;
  markup_percent: number | null;
  description: string;
  display_order: number;
}

export interface EstimateTaxSnapshot {
  label: string | null;
  rate: number | null;
}

export interface BusinessPricingDefaults {
  /** tpe_businesses.labour_rate. 0 means not configured. */
  labourRate: number;
  /** tpe_businesses.markup_percent. 0 is a real, valid markup. */
  markupPercent: number;
}

let chargeCounter = 0;
function nextChargeId(): string {
  chargeCounter += 1;
  return `charge-${chargeCounter}`;
}

/** The text for a stored number. Trailing zeros are not invented. */
function toField(value: number): string {
  return String(value);
}

/** Trimmed text as a number, or null when blank or unreadable. */
function numberOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function isHourlyRow(row: ContractorPricingRowInput): boolean {
  return (row.unit ?? "").trim().toLowerCase() === "hr";
}

/**
 * Build the form from what is stored. A missing row stays missing: nothing
 * here invents a labour method, a cost or a rate.
 */
export function initContractorPricingForm(
  rows: readonly ContractorPricingRowInput[],
  tax: EstimateTaxSnapshot,
  defaults: BusinessPricingDefaults
): ContractorPricingFormState {
  const labourRow = rows.find((row) => row.item_type === "labour");
  const materialsRow = rows.find((row) => row.item_type === "material");
  const chargeRows = rows.filter((row) => row.item_type === "other");

  const hourly = labourRow ? isHourlyRow(labourRow) : false;

  return {
    labourMethod: labourRow ? (hourly ? "hourly" : "fixed") : null,
    hours: labourRow && hourly ? toField(labourRow.quantity) : "",
    hourlyRate: labourRow && hourly ? toField(labourRow.unit_price) : "",
    fixedAmount: labourRow && !hourly ? toField(labourRow.unit_price) : "",
    materialsCost: materialsRow ? toField(materialsRow.unit_price) : "",
    // A stored markup of 0 shows as "0", not blank. With no materials row yet,
    // the business default is offered, which is a suggestion the contractor can
    // change and not a row: a markup alone never creates one.
    markupPercent: materialsRow
      ? toField(materialsRow.markup_percent ?? 0)
      : toField(defaults.markupPercent),
    charges: chargeRows.map((row) => ({
      id: nextChargeId(),
      description: row.description,
      amount: toField(row.unit_price),
    })),
    taxLabel: tax.label ?? "",
    taxRate: tax.rate === null ? "" : toField(tax.rate),
    taxEdited: false,
  };
}

/**
 * Choosing a method replaces the previous labour input rather than keeping
 * both, so an estimate can never carry two labour rows. A new hourly input is
 * offered the business rate when there is one; a business rate of 0 means the
 * contractor has none configured, so the field stays blank and blocking.
 */
export function chooseLabourMethod(
  state: ContractorPricingFormState,
  method: LabourMethod,
  defaults: BusinessPricingDefaults
): ContractorPricingFormState {
  if (method === state.labourMethod) return state;
  if (method === "hourly") {
    return {
      ...state,
      labourMethod: "hourly",
      hours: "",
      hourlyRate: defaults.labourRate > 0 ? toField(defaults.labourRate) : "",
      fixedAmount: "",
    };
  }
  return { ...state, labourMethod: "fixed", hours: "", hourlyRate: "", fixedAmount: "" };
}

export function addCharge(state: ContractorPricingFormState): ContractorPricingFormState {
  return { ...state, charges: [...state.charges, { id: nextChargeId(), description: "", amount: "" }] };
}

export function removeCharge(state: ContractorPricingFormState, id: string): ContractorPricingFormState {
  return { ...state, charges: state.charges.filter((charge) => charge.id !== id) };
}

export function updateCharge(
  state: ContractorPricingFormState,
  id: string,
  field: "description" | "amount",
  value: string
): ContractorPricingFormState {
  return {
    ...state,
    charges: state.charges.map((charge) => (charge.id === id ? { ...charge, [field]: value } : charge)),
  };
}

/** Any tax change marks the estimate's tax as explicitly edited. */
export function editTax(
  state: ContractorPricingFormState,
  field: "taxLabel" | "taxRate",
  value: string
): ContractorPricingFormState {
  return { ...state, [field]: value, taxEdited: true };
}

function labourPayload(state: ContractorPricingFormState): LabourInput | null {
  if (state.labourMethod === "hourly") {
    const hours = numberOrNull(state.hours);
    if (hours === null) return null;
    // Hours typed with no rate yet: the hours are kept and the save reports
    // labour-rate-missing, rather than throwing away what was typed. This is
    // the one place a blank becomes 0, and only because the contractor has
    // already committed to hourly and entered the hours.
    return { method: "hourly", hours, rate: numberOrNull(state.hourlyRate) ?? 0 };
  }
  if (state.labourMethod === "fixed") {
    const amount = numberOrNull(state.fixedAmount);
    if (amount === null) return null;
    return { method: "fixed", amount };
  }
  return null;
}

function materialsPayload(state: ContractorPricingFormState): MaterialsInput | null {
  const cost = numberOrNull(state.materialsCost);
  if (cost === null) return null;
  return { cost, markupPercent: numberOrNull(state.markupPercent) ?? 0 };
}

function chargesPayload(state: ContractorPricingFormState): ChargeInput[] {
  const charges: ChargeInput[] = [];
  for (const charge of state.charges) {
    const description = charge.description.trim();
    // A half-typed row is not a charge. It stays on screen and is simply not
    // sent, so a blank description can never be persisted.
    if (description === "") continue;
    charges.push({ description, amount: numberOrNull(charge.amount) ?? 0 });
  }
  return charges;
}

/**
 * The full-state PUT body. labour, materials and charges are always present,
 * because the request replaces everything; tax appears only when this session
 * actually changed it, where absent means "keep the estimate's snapshot".
 */
export function toPricingRequestPayload(state: ContractorPricingFormState): ContractorPricingRequest {
  const payload: ContractorPricingRequest = {
    labour: labourPayload(state),
    materials: materialsPayload(state),
    charges: chargesPayload(state),
    tax: null,
  };

  if (!state.taxEdited) return payload;
  return { ...payload, tax: { label: state.taxLabel.trim(), rate: numberOrNull(state.taxRate) ?? 0 } };
}

/** The estimate's own resolved tax and deposit snapshot, as Save would use them. */
export interface PricingPreviewSnapshots {
  taxRatePercent: number | null;
  depositPercent: number | null;
  depositThresholdDollars: number | null;
}

/**
 * The one place that decides what pricing figures the contractor is shown.
 * Delivered: the persisted, saved pricing -- a draft edit must never claim
 * the customer already sees it. Undelivered: a live preview of what Save
 * would produce right now, computed through the exact same pipeline Save
 * uses (toPricingRequestPayload -> toCanonicalRows -> calculateContractorPricing),
 * so nothing here is a second definition of the arithmetic. The tax rate
 * follows the same rule the PUT payload already encodes: this session's edit
 * when there is one, the estimate's own snapshot otherwise.
 */
export function resolveContractorPricingPreview(
  state: ContractorPricingFormState,
  options: {
    isDelivered: boolean;
    persistedPricing: ContractorPricing;
    snapshots: PricingPreviewSnapshots;
  }
): ContractorPricing {
  if (options.isDelivered) return options.persistedPricing;

  const payload = toPricingRequestPayload(state);
  return calculateContractorPricing(toCanonicalRows(payload), {
    taxRatePercent: payload.tax ? payload.tax.rate : options.snapshots.taxRatePercent,
    depositPercent: options.snapshots.depositPercent,
    depositThresholdDollars: options.snapshots.depositThresholdDollars,
  });
}

/** What the contractor is told is still missing. Backend reasons only. */
const MISSING_LABELS: Record<PricingGap, string> = {
  "labour-missing": "Add labour",
  "labour-rate-missing": "Add your hourly rate",
  "materials-missing": "Add materials, or enter 0",
  "tax-snapshot-missing": "Set the tax rate",
};

export function missingLabels(missing: readonly PricingGap[]): string[] {
  return missing.map((reason) => MISSING_LABELS[reason]);
}

/**
 * What the contractor is told about sending, as one derived value instead of
 * three independent displays reading three different sources.
 *
 * "none": nothing to show; existing Send behaviour continues normally.
 * "missing-items": specific gaps to fill in, before Save.
 * "save-to-send": the draft is already complete, but Save has not run yet --
 * Send stays governed by the last saved state regardless, so this is
 * guidance, not a promise.
 */
export type ContractorPricingGuidance =
  | { kind: "none" }
  | { kind: "missing-items"; labels: string[] }
  | { kind: "save-to-send" };

/**
 * Delivered: guidance is persisted pricing only, on the same `isDelivered`
 * flag the pricing flow already carries (no second delivered definition).
 * An unsaved draft edit can never surface here -- a delivered estimate
 * cannot be repriced, so "save-to-send" would be actively wrong advice, and
 * this branch never returns it. A delivered estimate is complete by
 * construction (every delivery path gates on persisted completeness before
 * writing delivery state, and repricing after delivery is rejected, so
 * nothing in the app can un-complete it afterward) -- the missing-items arm
 * below is defensive against that invariant ever being violated, not a
 * reachable case today.
 *
 * Undelivered: the live draft is checked first. A previously-saved-complete
 * estimate that has since been edited into an incomplete draft must show
 * that incompleteness, not silently claim nothing is wrong because the last
 * save happened to be complete.
 */
export function resolveContractorPricingGuidance(options: {
  isDelivered: boolean;
  preview: ContractorPricing;
  persistedPricing: ContractorPricing;
}): ContractorPricingGuidance {
  if (options.isDelivered) {
    return options.persistedPricing.missing.length > 0
      ? { kind: "missing-items", labels: missingLabels(options.persistedPricing.missing) }
      : { kind: "none" };
  }

  if (options.preview.missing.length > 0) {
    return { kind: "missing-items", labels: missingLabels(options.preview.missing) };
  }
  if (options.persistedPricing.missing.length > 0) return { kind: "save-to-send" };
  return { kind: "none" };
}

/** Cents to dollars, for display only. No pricing decision is made here. */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

/**
 * Not a pricing rule -- the one decision behind the Add Pricing anchor
 * fallback (app/components/contractor-pricing-editor.tsx). Plain browser
 * hash navigation to `/estimates/{id}#pricing` proved unreliable on Android
 * Chrome for this client-rendered section, so the editor checks this itself
 * on mount and scrolls there directly when the hash asked for it.
 */
export function shouldScrollToPricing(hash: string | undefined): boolean {
  return hash === "#pricing";
}
