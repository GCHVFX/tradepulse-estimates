/**
 * The semantic contractor-pricing request, and its conversion into the
 * canonical `tpe_estimate_items` rows (specs/contractor-owned-pricing.md
 * sections 4 and 12).
 *
 * Pure. No database, no network, no dates, no randomness, so the whole
 * validation and encoding contract is unit-testable without a database.
 *
 * A PUT carries the estimate's whole current pricing state, not a patch:
 * whatever is absent is absent, and the save replaces every row.
 */

export interface HourlyLabourInput {
  method: "hourly";
  hours: number;
  rate: number;
}

export interface FixedLabourInput {
  method: "fixed";
  amount: number;
}

export type LabourInput = HourlyLabourInput | FixedLabourInput;

export interface MaterialsInput {
  cost: number;
  markupPercent: number;
}

export interface ChargeInput {
  description: string;
  amount: number;
}

export interface TaxInput {
  label: string;
  rate: number;
}

export interface ContractorPricingRequest {
  labour: LabourInput | null;
  materials: MaterialsInput | null;
  charges: ChargeInput[];
  /** Present only when the contractor explicitly changed the tax. */
  tax: TaxInput | null;
}

/** One row exactly as it is stored. Dollars, never the calculator's cents. */
export interface CanonicalPricingRow {
  description: string;
  item_type: "labour" | "material" | "other";
  quantity: number;
  unit: string | null;
  unit_price: number;
  markup_percent: number | null;
  line_total: number;
  display_order: number;
}

export type ParseResult =
  | { ok: true; value: ContractorPricingRequest }
  | { ok: false; error: string };

/** The fixed descriptions. The column is NOT NULL with a not-blank CHECK. */
export const LABOUR_DESCRIPTION = "Labour";
export const MATERIALS_DESCRIPTION = "Materials";

/** Matches the tpe_estimate_items_markup_percent_range CHECK. */
const MAX_MARKUP_PERCENT = 1000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Finite and not negative. Rejects NaN, Infinity, strings and nulls. */
function isMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseLabour(raw: unknown): { ok: true; value: LabourInput | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (Array.isArray(raw)) return { ok: false, error: "labour must be a single entry, not a list" };
  if (!isPlainObject(raw)) return { ok: false, error: "labour must be an object" };

  if (raw.method === "hourly") {
    if (!isMoney(raw.hours)) return { ok: false, error: "labour hours must be a number of zero or more" };
    if (!isMoney(raw.rate)) return { ok: false, error: "labour rate must be a number of zero or more" };
    // A rate of 0 saves. It reports labour-rate-missing and is what stops
    // delivery later, so an interrupted contractor keeps the hours they typed.
    return { ok: true, value: { method: "hourly", hours: raw.hours, rate: raw.rate } };
  }

  if (raw.method === "fixed") {
    if (!isMoney(raw.amount)) return { ok: false, error: "labour amount must be a number of zero or more" };
    return { ok: true, value: { method: "fixed", amount: raw.amount } };
  }

  return { ok: false, error: 'labour method must be "hourly" or "fixed"' };
}

function parseMaterials(raw: unknown): { ok: true; value: MaterialsInput | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (Array.isArray(raw)) return { ok: false, error: "materials must be a single entry, not a list" };
  if (!isPlainObject(raw)) return { ok: false, error: "materials must be an object" };
  if (!isMoney(raw.cost)) return { ok: false, error: "materials cost must be a number of zero or more" };
  if (!isMoney(raw.markupPercent)) {
    return { ok: false, error: "materials markup must be a number of zero or more" };
  }
  if (raw.markupPercent > MAX_MARKUP_PERCENT) {
    return { ok: false, error: `materials markup must be ${MAX_MARKUP_PERCENT}% or less` };
  }
  return { ok: true, value: { cost: raw.cost, markupPercent: raw.markupPercent } };
}

function parseCharges(raw: unknown): { ok: true; value: ChargeInput[] } | { ok: false; error: string } {
  // No null shorthand: an empty list is how "no charges" is said.
  if (!Array.isArray(raw)) return { ok: false, error: "charges must be a list" };

  const charges: ChargeInput[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) return { ok: false, error: "each charge must be an object" };
    const description = typeof entry.description === "string" ? entry.description.trim() : "";
    if (description === "") return { ok: false, error: "each charge needs a description" };
    if (!isMoney(entry.amount)) return { ok: false, error: "each charge amount must be a number of zero or more" };
    charges.push({ description, amount: entry.amount });
  }
  return { ok: true, value: charges };
}

function parseTax(raw: unknown): { ok: true; value: TaxInput | null } | { ok: false; error: string } {
  // Absent means "unchanged". It never means "clear the snapshot", and a tax
  // change is never inferred from anything else in the request.
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!isPlainObject(raw)) return { ok: false, error: "tax must be an object" };
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (label === "") return { ok: false, error: "tax label is required when changing tax" };
  if (!isMoney(raw.rate)) return { ok: false, error: "tax rate must be a number of zero or more" };
  return { ok: true, value: { label, rate: raw.rate } };
}

export function parseContractorPricingRequest(body: unknown): ParseResult {
  if (!isPlainObject(body)) return { ok: false, error: "Invalid request body" };

  // A PUT carries the whole current pricing state, so all three inputs are
  // required keys. Their values may be empty (null, null, []), but an omitted
  // key is malformed, never a silent clear. That is the difference between
  // "this contractor has no materials" and "the client forgot to send
  // materials", and only one of those may delete a materials row.
  if (!("labour" in body)) {
    return { ok: false, error: "labour is required; send null when it is unknown" };
  }
  if (!("materials" in body)) {
    return { ok: false, error: "materials is required; send null when it is unknown" };
  }
  if (!("charges" in body)) {
    return { ok: false, error: "charges is required; send an empty list when there are none" };
  }

  const labour = parseLabour(body.labour);
  if (!labour.ok) return labour;
  const materials = parseMaterials(body.materials);
  if (!materials.ok) return materials;
  const charges = parseCharges(body.charges);
  if (!charges.ok) return charges;
  const tax = parseTax(body.tax);
  if (!tax.ok) return tax;

  return {
    ok: true,
    value: { labour: labour.value, materials: materials.value, charges: charges.value, tax: tax.value },
  };
}

/**
 * Semantic input to stored rows.
 *
 * `line_total` is written only because the existing schema requires it (the
 * column is NOT NULL). No Phase 1 consumer may read it as pricing authority,
 * and nothing in this slice reads it back: all derived pricing comes from
 * lib/contractor-pricing.ts. It is written deterministically as quantity times
 * unit price, pre-markup for a material row, so it can never disagree with the
 * inputs beside it.
 */
export function toCanonicalRows(request: ContractorPricingRequest): CanonicalPricingRow[] {
  const rows: CanonicalPricingRow[] = [];

  const labour = request.labour;
  if (labour) {
    const quantity = labour.method === "hourly" ? labour.hours : 1;
    const unitPrice = labour.method === "hourly" ? labour.rate : labour.amount;
    rows.push({
      description: LABOUR_DESCRIPTION,
      item_type: "labour",
      quantity,
      // 'hr' is what makes a labour row hourly, here and at every read site.
      unit: labour.method === "hourly" ? "hr" : null,
      unit_price: unitPrice,
      markup_percent: null,
      line_total: round2(quantity * unitPrice),
      display_order: rows.length,
    });
  }

  if (request.materials) {
    rows.push({
      description: MATERIALS_DESCRIPTION,
      item_type: "material",
      quantity: 1,
      unit: null,
      unit_price: request.materials.cost,
      markup_percent: request.materials.markupPercent,
      line_total: round2(request.materials.cost),
      display_order: rows.length,
    });
  }

  for (const charge of request.charges) {
    rows.push({
      description: charge.description,
      item_type: "other",
      quantity: 1,
      unit: null,
      unit_price: charge.amount,
      markup_percent: null,
      line_total: round2(charge.amount),
      display_order: rows.length,
    });
  }

  return rows;
}

/**
 * The rate to offer as the business default, or null. Only an hourly rate
 * above zero is a candidate; whether it is actually written depends on the
 * business still having no rate, which only the save transaction can decide.
 */
export function firstHourlyRateCandidate(request: ContractorPricingRequest): number | null {
  if (!request.labour || request.labour.method !== "hourly") return null;
  return request.labour.rate > 0 ? request.labour.rate : null;
}
