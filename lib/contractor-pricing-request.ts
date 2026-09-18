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

/**
 * A contractor-confirmed saved line item (Phase 2 slice 3A). These are the
 * values as the contractor confirmed them, not a live reference: no
 * price-book ID travels with this shape. A matcher suggestion owns no money;
 * once the contractor taps and confirms one, its description, quantity and
 * unit prices become this estimate's own draft, same as anything else on the
 * request.
 */
export interface ConfirmedLineItemInput {
  description: string;
  quantity: number;
  labourUnitPrice: number;
  materialUnitPrice: number;
  /**
   * Required, never defaulted. A saved price-book item's taxable flag applies
   * to both rows this item becomes (Phase 2 slice 3B) -- there is no separate
   * labour/material taxability for a saved item. Omitting this on a future
   * accepted price-book item could silently overcharge or undercharge tax, so
   * a missing value is rejected rather than assumed.
   */
  taxable: boolean;
}

export interface ContractorPricingRequest {
  labour: LabourInput | null;
  materials: MaterialsInput | null;
  charges: ChargeInput[];
  /** Present only when the contractor explicitly changed the tax. */
  tax: TaxInput | null;
  /**
   * Confirmed saved line items (Phase 2 slice 3A). The one backward-compatible
   * newly-added field: an existing client's payload never sends this key, and
   * omitting it still parses -- normalized to an empty array, meaning no
   * confirmed Phase 2 items, not "unknown". A non-empty list is mutually
   * exclusive with `labour` and `materials` (Option C: saved line items and
   * the generic Labour/Materials inputs never coexist on one estimate).
   */
  lineItems: ConfirmedLineItemInput[];
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
  /** Every newly encoded row carries a real boolean -- never left to the database default. */
  taxable: boolean;
}

export type ParseResult =
  | { ok: true; value: ContractorPricingRequest }
  | { ok: false; error: string };

/** The fixed descriptions. The column is NOT NULL with a not-blank CHECK. */
export const LABOUR_DESCRIPTION = "Labour";
export const MATERIALS_DESCRIPTION = "Materials";

/**
 * The unit written on both rows of a confirmed line item's pair. Deliberately
 * not 'hr': `isHourly()` in lib/contractor-pricing.ts only ever treats a
 * literal 'hr' as hourly labour, so 'ea' reads as a quantity-based flat
 * per-item amount -- semantically accurate for a saved flat-rate item -- and
 * never risks being multiplied as hours.
 */
export const LINE_ITEM_UNIT = "ea";

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

/**
 * Finite and strictly greater than zero. A confirmed line item's quantity is
 * never inferred and never zero -- the contractor removes an item instead of
 * pricing zero units, so 0 is rejected here rather than accepted as a
 * deliberate value the way a $0 price is.
 */
function isPositiveQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function parseLineItem(
  raw: unknown,
  index: number
): { ok: true; value: ConfirmedLineItemInput } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: `lineItems[${index}] must be an object` };

  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (description === "") return { ok: false, error: `lineItems[${index}] needs a description` };

  if (!isPositiveQuantity(raw.quantity)) {
    return { ok: false, error: `lineItems[${index}] quantity must be a number greater than zero` };
  }
  if (!isMoney(raw.labourUnitPrice)) {
    return { ok: false, error: `lineItems[${index}] labourUnitPrice must be a number of zero or more` };
  }
  if (!isMoney(raw.materialUnitPrice)) {
    return { ok: false, error: `lineItems[${index}] materialUnitPrice must be a number of zero or more` };
  }
  // Required, actual boolean only. Not defaulted: a missing or malformed
  // taxable flag on a confirmed line item must never silently become taxable
  // or non-taxable, so it is rejected outright.
  if (typeof raw.taxable !== "boolean") {
    return { ok: false, error: `lineItems[${index}] taxable must be true or false` };
  }

  return {
    ok: true,
    value: {
      description,
      quantity: raw.quantity,
      labourUnitPrice: raw.labourUnitPrice,
      materialUnitPrice: raw.materialUnitPrice,
      taxable: raw.taxable,
    },
  };
}

function parseLineItems(
  raw: unknown
): { ok: true; value: ConfirmedLineItemInput[] } | { ok: false; error: string } {
  // Omitted or null both mean "no confirmed Phase 2 items" -- the
  // backward-compatible reading an existing client's payload relies on.
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "lineItems must be a list" };

  const items: ConfirmedLineItemInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const parsed = parseLineItem(raw[i], i);
    if (!parsed.ok) return parsed;
    items.push(parsed.value);
  }
  return { ok: true, value: items };
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
  // `lineItems` is not a required key -- see the field comment on
  // ContractorPricingRequest for why an omitted key must keep parsing.
  const lineItems = parseLineItems(body.lineItems);
  if (!lineItems.ok) return lineItems;

  // Option C: confirmed saved line items and the generic Labour/Materials
  // inputs never coexist on one estimate. Rejecting the combination here is
  // what actually prevents double-counting; a later UI slice is responsible
  // for never letting the contractor reach this state in the first place.
  if (lineItems.value.length > 0 && labour.value !== null) {
    return { ok: false, error: "confirmed line items cannot be combined with generic labour" };
  }
  if (lineItems.value.length > 0 && materials.value !== null) {
    return { ok: false, error: "confirmed line items cannot be combined with generic materials" };
  }

  return {
    ok: true,
    value: {
      labour: labour.value,
      materials: materials.value,
      charges: charges.value,
      tax: tax.value,
      lineItems: lineItems.value,
    },
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
      // Generic Phase 1 labour has no taxability control; it is taxable.
      taxable: true,
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
      // Generic Phase 1 materials has no taxability control; it is taxable.
      taxable: true,
    });
  }

  // Confirmed Phase 2 line items, each as its own adjacent labour/material
  // pair, in the order the contractor confirmed them. No hidden grouping
  // field: the pair is identified later by adjacent display_order, matching
  // description, unit 'ea', and labour immediately followed by material.
  for (const item of request.lineItems) {
    rows.push({
      description: item.description,
      item_type: "labour",
      quantity: item.quantity,
      unit: LINE_ITEM_UNIT,
      unit_price: item.labourUnitPrice,
      markup_percent: null,
      line_total: round2(item.quantity * item.labourUnitPrice),
      display_order: rows.length,
      // Both rows of a confirmed item share one taxability flag -- no
      // separate labour/material taxability for a saved item.
      taxable: item.taxable,
    });
    rows.push({
      description: item.description,
      item_type: "material",
      quantity: item.quantity,
      unit: LINE_ITEM_UNIT,
      unit_price: item.materialUnitPrice,
      // Explicit numeric zero, not null: tpe_pricebook_items.material_price
      // is already a final customer-facing price, so no markup is ever
      // applied on top of a confirmed line item's material component. This
      // row is written even when materialUnitPrice is 0 -- a deliberate $0
      // component is not the same as a missing one.
      markup_percent: 0,
      line_total: round2(item.quantity * item.materialUnitPrice),
      display_order: rows.length,
      taxable: item.taxable,
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
      // Generic Phase 1 charges have no taxability control; taxable.
      taxable: true,
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
