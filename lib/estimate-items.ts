// Pure conversion layer between the current markdown estimate format and the
// structured line-item representation described in
// TRADEPULSE_GROUPED_PRICING_ARCHITECTURE.md.
//
// Slice 2 of that plan. NOTHING IN THE APPLICATION USES THIS MODULE YET.
// Markdown remains the authoritative store for line items. The drafts produced
// here are temporary conversion output: they are never persisted, never dual
// written, and no estimate is marked structured.
//
// The point of this slice is to prove one invariant before any schema work:
// existing estimates can be converted into structured items and rendered back
// without changing totals, line-item meaning, ordering, or customer-visible
// output.
//
// Pure functions only. No React, no network, no database, no file system, no
// global mutable state, no side effects.

import {
  computeTotals,
  isQuantityItem,
  lineItemCost,
  lineItemsBlock,
  parseCost,
  parseQuantity,
  type LineItem,
  type ParsedSummary,
} from "./estimate-summary";
import type { Currency } from "./currency";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The cells exactly as they appeared in the parsed estimate, before any
 * arithmetic. Kept verbatim because `lineItemsBlock()` echoes several of them
 * back unchanged (a flat fee's Cost cell is emitted raw, not reformatted), so
 * byte-identical rendering is only possible if the original text survives.
 *
 * `null` means the cell is genuinely absent, which is how a flat fee is encoded
 * and how legacy two-column estimates store every row.
 */
export interface EstimateItemSource {
  description: string;
  quantityText: string | null;
  unitText: string | null;
  unitCostText: string | null;
  amountText: string;
}

/**
 * One priced row, mid-conversion.
 *
 * Three distinct kinds of field, deliberately not blended:
 *   - `source`  : parsed from the existing estimate, verbatim
 *   - `quantity`, `unitCost`, `total` : calculated from those parsed values
 *   - `groupLabel`, `sortOrder`, `tempId` : metadata reserved for later
 *     structured storage
 *
 * Fields from the proposed future schema that cannot be derived safely from
 * today's markdown are deliberately absent. There is no `isAllowance` and no
 * `customerVisible`, because nothing in the current format records them and
 * inventing a value would be a silent product decision.
 */
export interface EstimateItemDraft {
  /**
   * Conversion-run identifier. NOT stable: two parses of the same markdown
   * produce different values, exactly like the `id` on `LineItem`. Never use
   * it as a key for anything durable.
   */
  tempId: string;
  /** Position in the table. This is the ordering contract. */
  sortOrder: number;
  /**
   * `quantity` means quantity times unit cost; `flat` means one typed amount.
   * Carried across from `LineItem.quantityBased`, never re-derived. See the
   * comment on `isQuantityItem()` in estimate-summary.ts for why re-deriving
   * this from current field values is a bug.
   */
  kind: "quantity" | "flat";
  source: EstimateItemSource;
  /** Calculated. `null` for flat fees. */
  quantity: number | null;
  /** Calculated. `null` for flat fees. */
  unitCost: number | null;
  /** Calculated. The authoritative amount for this row, same rule as `lineItemCost()`. */
  total: number;
  /**
   * Reserved for grouped pricing. Always `null` in this slice: the current
   * markdown format records no grouping, and a neutral null is the only honest
   * value. Never invent a category here.
   */
  groupLabel: string | null;
}

export type MalformedRowReason =
  | "reserved-total-row"
  | "empty-description"
  | "unparseable-amount"
  | "unparseable-quantity"
  | "unparseable-unit-cost"
  | "non-finite-value"
  | "negative-amount"
  | "pipe-in-cell";

export interface MalformedRow {
  sortOrder: number;
  description: string;
  reason: MalformedRowReason;
  detail: string;
  /** Whether this alone is enough to refuse migration of the estimate. */
  blocking: boolean;
}

export interface ConversionValidation {
  ok: boolean;

  originalSubtotal: number;
  convertedSubtotal: number;
  subtotalDifference: number;

  originalTax: number;
  convertedTax: number;
  taxDifference: number;

  originalGrandTotal: number;
  convertedGrandTotal: number;
  grandTotalDifference: number;

  originalDepositAmount: number;
  convertedDepositAmount: number;
  depositDifference: number;

  itemCount: number;
  originalRowCount: number;

  /** True when the re-rendered block is byte-for-byte the authoritative one. */
  lineItemBlockByteIdentical: boolean;

  malformedRows: MalformedRow[];
  unsupportedStructures: string[];
  warnings: string[];
  /** Non-empty means do not migrate this estimate. */
  abortReasons: string[];
}

export class EstimateConversionError extends Error {
  readonly validation: ConversionValidation;
  constructor(validation: ConversionValidation) {
    super(`Estimate conversion refused: ${validation.abortReasons.join("; ")}`);
    this.name = "EstimateConversionError";
    this.validation = validation;
  }
}

// ── Numeric rules ─────────────────────────────────────────────────────────────
//
// These mirror lib/estimate-summary.ts exactly. This slice preserves the
// current monetary model, it does not introduce a new one. In particular:
//
//   - money text is read by parseCost(): strips CA$/US$/$ , and *, then parseFloat,
//     falling back to 0. So "$1,234.50" is 1234.5.
//   - quantity text is read by parseQuantity(): strips everything except
//     digits, dot, and minus, then parseFloat, falling back to 0.
//   - a quantity row's amount is ALWAYS quantity times unit cost. Any explicit
//     Cost cell on such a row is discarded. That discard already happens
//     upstream in parseSummary() via withComputedCost(), before this module
//     sees the data, so by construction this layer cannot reintroduce it.
//   - subtotal is an unrounded sum of row amounts.
//   - tax is Math.round(subtotal * rate / 100). This is the only rounding
//     boundary in the pipeline, and it is applied to the whole subtotal, not
//     per row.
//   - deposit is Math.round(total * depositPercent / 100).
//
// Integer cents are deliberately NOT introduced here. Doing so would move the
// rounding boundary and change existing customer-visible amounts, which this
// slice must not do. Preservation, not cleanup.

/** Whether money text is something parseCost can read without silently yielding 0. */
function isParseableMoney(text: string): boolean {
  const cleaned = text.replace(/(?:CA|US)?\$/g, "").replace(/[,*]/g, "").trim();
  if (cleaned === "") return false;
  return /^-?\d*\.?\d+$/.test(cleaned);
}

/** Whether quantity text is something parseQuantity can read without silently yielding 0. */
function isParseableQuantity(text: string): boolean {
  const cleaned = text.replace(/[^0-9.\-]/g, "").trim();
  if (cleaned === "") return false;
  return /^-?\d*\.?\d+$/.test(cleaned);
}

/**
 * Row labels that must never be treated as priced line items. The generation
 * prompt forbids the model from putting these in the Line Items table, but
 * nothing enforces it, and when one slips through the current parser accepts it
 * as an ordinary item and double counts it into the subtotal. Detecting it is a
 * hard requirement of this slice.
 */
// Anchored at BOTH ends. A totals row is the reserved word essentially alone,
// optionally bolded, optionally carrying a parenthetical such as "(GST 5%)" or
// "(30%)", optionally with one of a small set of known suffixes. Matching on a
// prefix alone produced false positives on real line items: "Total station
// rental" (a surveying instrument) and "Taxi to supplier" are priced items, not
// totals, and must convert normally.
const RESERVED_ROW_LABELS =
  /^\s*\**\s*(sub\s*-?\s*total|grand\s+total|total|tax(?:es)?|gst|hst|pst|qst|vat|deposit|balance|amount\s+due)\b(\s+(required|due|owing|payable|on\s+completion|to\s+date))?\s*(\([^)]*\))?\s*\**\s*:?\s*$/i;

export function isReservedTotalLabel(label: string): boolean {
  return RESERVED_ROW_LABELS.test(label);
}

// ── Conversion ────────────────────────────────────────────────────────────────

let tempCounter = 0;
function nextTempId(): string {
  // Deliberately non-deterministic across runs, matching newId() in
  // estimate-summary.ts, so nothing can mistake it for a durable key.
  tempCounter += 1;
  return `draft-${Math.random().toString(36).slice(2, 9)}-${tempCounter}`;
}

/**
 * Convert one already-parsed line item into a draft. Faithful: it never skips,
 * never repairs, and never invents. Problems are reported separately by
 * `findMalformedRows()` so nothing is silently dropped.
 */
export function lineItemToDraft(item: LineItem, sortOrder: number): EstimateItemDraft {
  const quantityBased = isQuantityItem(item);
  return {
    tempId: nextTempId(),
    sortOrder,
    kind: quantityBased ? "quantity" : "flat",
    source: {
      description: item.label,
      quantityText: quantityBased ? (item.quantity ?? "") : null,
      unitText: quantityBased ? (item.unit ?? "") : null,
      unitCostText: quantityBased ? (item.rate ?? "") : null,
      amountText: item.cost,
    },
    quantity: quantityBased ? parseQuantity(item.quantity) : null,
    unitCost: quantityBased ? parseCost(item.rate ?? "") : null,
    total: lineItemCost(item),
    groupLabel: null,
  };
}

/** Convert every priced row of a parsed estimate, in table order. */
export function parsedToItems(parsed: ParsedSummary): EstimateItemDraft[] {
  return parsed.lineItems.map((item, i) => lineItemToDraft(item, i));
}

/** Inverse of `lineItemToDraft`, reproducing the shape the serializer expects. */
export function draftToLineItem(draft: EstimateItemDraft): LineItem {
  if (draft.kind === "quantity") {
    return {
      id: draft.tempId,
      label: draft.source.description,
      quantity: draft.source.quantityText ?? "",
      unit: draft.source.unitText ?? "",
      rate: draft.source.unitCostText ?? "",
      cost: draft.source.amountText,
      quantityBased: true,
    };
  }
  // Flat fees and legacy two-column rows both land here. quantityBased is left
  // undefined rather than set to false, matching exactly what parseSummary()
  // produces for a legacy row, so the serializer branches identically.
  return {
    id: draft.tempId,
    label: draft.source.description,
    cost: draft.source.amountText,
  };
}

/**
 * Render drafts back into the stored `## Line Items` block.
 *
 * Delegates to the one authoritative serializer, `lineItemsBlock()` in
 * estimate-summary.ts, rather than reimplementing the table. That is what makes
 * byte-identical output provable instead of merely intended, and it means this
 * module cannot drift from the editor, PDF, or share page.
 *
 * Emits only the current representation: no group column, no grouped totals, no
 * customer summary rows, no identifiers, no metadata, no subtotal or tax or
 * deposit rows.
 */
export function itemsToLineItemsBlock(
  items: EstimateItemDraft[],
  currency: Currency
): string {
  return lineItemsBlock(items.map(draftToLineItem), currency);
}

export function calculateItemTotal(item: EstimateItemDraft): number {
  // Same rule as lineItemCost(): quantity rows multiply, flat fees are trusted.
  if (item.kind === "quantity") {
    return (item.quantity ?? 0) * (item.unitCost ?? 0);
  }
  return parseCost(item.source.amountText);
}

export function calculateItemsSubtotal(items: EstimateItemDraft[]): number {
  return items.reduce((sum, i) => sum + calculateItemTotal(i), 0);
}

/** Group drafts by `groupLabel`, preserving table order. Ungrouped rows key on null. */
export function groupItems(items: EstimateItemDraft[]): Map<string | null, EstimateItemDraft[]> {
  const groups = new Map<string | null, EstimateItemDraft[]>();
  for (const item of items) {
    const existing = groups.get(item.groupLabel);
    if (existing) existing.push(item);
    else groups.set(item.groupLabel, [item]);
  }
  return groups;
}

// ── Validation ────────────────────────────────────────────────────────────────

export function findMalformedRows(items: EstimateItemDraft[]): MalformedRow[] {
  const found: MalformedRow[] = [];

  for (const item of items) {
    const { description, amountText, quantityText, unitCostText } = item.source;
    const at = (reason: MalformedRowReason, detail: string, blocking: boolean) =>
      found.push({ sortOrder: item.sortOrder, description, reason, detail, blocking });

    if (isReservedTotalLabel(description)) {
      at(
        "reserved-total-row",
        `"${description}" is a totals row, not a priced line item. The current parser counts it as one, inflating the subtotal.`,
        true
      );
    }

    if (description.trim() === "") {
      at("empty-description", "Row has no description.", true);
    }

    if (description.includes("|")) {
      at(
        "pipe-in-cell",
        "Description contains a pipe character, which would break the rendered table.",
        true
      );
    }

    if (!isParseableMoney(amountText)) {
      at(
        "unparseable-amount",
        `Amount cell ${JSON.stringify(amountText)} is not readable as money. parseCost() would silently yield 0.`,
        true
      );
    }

    if (item.kind === "quantity") {
      if (!isParseableQuantity(quantityText ?? "")) {
        at(
          "unparseable-quantity",
          `Quantity cell ${JSON.stringify(quantityText)} is not readable as a number.`,
          true
        );
      }
      if (!isParseableMoney(unitCostText ?? "")) {
        at(
          "unparseable-unit-cost",
          `Unit cost cell ${JSON.stringify(unitCostText)} is not readable as money.`,
          true
        );
      }
    }

    const total = calculateItemTotal(item);
    if (!Number.isFinite(total)) {
      at("non-finite-value", `Row total is ${String(total)}.`, true);
    } else if (total < 0) {
      // Negative amounts do parse and do arithmetic correctly today, so this is
      // reported but does not block. Flagged because it is almost always a typo
      // and because a discount row is a product decision nobody has made.
      at("negative-amount", `Row total is negative (${total}).`, false);
    }
  }

  return found;
}

/**
 * Full invariant check for one estimate.
 *
 * Takes the whole `ParsedSummary`, not just the items, because tax, grand
 * total, and deposit are not owned by the line-item block: tax rate and deposit
 * percent live in the Pricing Summary section and are recovered from there.
 * Line items alone cannot reconstruct them, and this function does not pretend
 * otherwise.
 */
// `currency` only decides which prefix both sides of the byte-identity check
// are rendered with. The comparison itself is currency-invariant, but the
// serializer requires a real one, so the caller passes the estimate snapshot.
export function validateConversionTotals(
  parsed: ParsedSummary,
  currency: Currency
): ConversionValidation {
  const items = parsedToItems(parsed);

  const originalTotals = computeTotals(parsed.lineItems, parsed.taxRate);
  const convertedLineItems = items.map(draftToLineItem);
  const convertedTotals = computeTotals(convertedLineItems, parsed.taxRate);

  const convertedSubtotal = calculateItemsSubtotal(items);

  const originalDeposit = Math.round((originalTotals.total * parsed.depositPercent) / 100);
  const convertedDeposit = Math.round((convertedTotals.total * parsed.depositPercent) / 100);

  const expectedBlock = lineItemsBlock(parsed.lineItems, currency);
  const actualBlock = itemsToLineItemsBlock(items, currency);
  const byteIdentical = expectedBlock === actualBlock;

  const malformedRows = findMalformedRows(items);
  const unsupportedStructures: string[] = [];
  const warnings: string[] = [];
  const abortReasons: string[] = [];

  if (parsed.lineItems.length === 0) {
    unsupportedStructures.push("Estimate has no priced line items.");
  }

  // Mixed shapes: a table where only some rows carry quantities re-serializes
  // fine, but it is worth surfacing because the two shapes came from different
  // eras of the format.
  const quantityRows = items.filter((i) => i.kind === "quantity").length;
  if (quantityRows > 0 && quantityRows < items.length) {
    warnings.push(
      `Mixed table: ${quantityRows} quantity rows and ${items.length - quantityRows} flat rows.`
    );
  }
  if (quantityRows === 0 && items.length > 0) {
    warnings.push(
      "No quantity rows. This estimate serializes to the legacy two-column table, which is expected for older estimates and for tables made entirely of flat fees."
    );
  }

  const duplicateDescriptions = findDuplicateDescriptions(items);
  if (duplicateDescriptions.length > 0) {
    // Not an error. Two identical rows are legitimate, and sortOrder keeps them
    // distinct. Flagged because it defeats description-based matching later.
    warnings.push(
      `Duplicate descriptions present (${duplicateDescriptions.join(", ")}). Match rows on sortOrder, never on description.`
    );
  }

  const subtotalDifference = round2(convertedSubtotal - originalTotals.subtotal);
  const taxDifference = convertedTotals.tax - originalTotals.tax;
  const grandTotalDifference = round2(convertedTotals.total - originalTotals.total);
  const depositDifference = convertedDeposit - originalDeposit;

  if (subtotalDifference !== 0) {
    abortReasons.push(`Subtotal changed by ${subtotalDifference}.`);
  }
  if (taxDifference !== 0) {
    abortReasons.push(`Tax changed by ${taxDifference}.`);
  }
  if (grandTotalDifference !== 0) {
    abortReasons.push(`Grand total changed by ${grandTotalDifference}.`);
  }
  if (depositDifference !== 0) {
    abortReasons.push(`Deposit changed by ${depositDifference}.`);
  }
  if (!byteIdentical) {
    abortReasons.push("Re-rendered line-item block is not byte-identical to the authoritative one.");
  }
  if (items.length !== parsed.lineItems.length) {
    abortReasons.push(
      `Row count changed: ${parsed.lineItems.length} parsed, ${items.length} converted.`
    );
  }
  for (const row of malformedRows) {
    if (row.blocking) {
      abortReasons.push(`Row ${row.sortOrder} (${row.reason}): ${row.detail}`);
    }
  }
  for (const structure of unsupportedStructures) {
    abortReasons.push(structure);
  }

  return {
    ok: abortReasons.length === 0,
    originalSubtotal: originalTotals.subtotal,
    convertedSubtotal,
    subtotalDifference,
    originalTax: originalTotals.tax,
    convertedTax: convertedTotals.tax,
    taxDifference,
    originalGrandTotal: originalTotals.total,
    convertedGrandTotal: convertedTotals.total,
    grandTotalDifference,
    originalDepositAmount: originalDeposit,
    convertedDepositAmount: convertedDeposit,
    depositDifference,
    itemCount: items.length,
    originalRowCount: parsed.lineItems.length,
    lineItemBlockByteIdentical: byteIdentical,
    malformedRows,
    unsupportedStructures,
    warnings,
    abortReasons,
  };
}

/**
 * Strict variant. Throws `EstimateConversionError` carrying the full validation
 * when the estimate must not be migrated. This is the call a future backfill
 * should use, so a bad estimate fails loudly and is left on the markdown path.
 */
export function assertConversionSafe(
  parsed: ParsedSummary,
  currency: Currency
): EstimateItemDraft[] {
  const validation = validateConversionTotals(parsed, currency);
  if (!validation.ok) throw new EstimateConversionError(validation);
  return parsedToItems(parsed);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findDuplicateDescriptions(items: EstimateItemDraft[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const i of items) {
    const key = i.source.description.trim().toLowerCase();
    if (seen.has(key)) dupes.add(i.source.description.trim());
    else seen.add(key);
  }
  return [...dupes];
}

/**
 * Collapse binary floating point dust before comparing two money values.
 * Two decimals is the precision the format itself uses. This is a comparison
 * aid only: no stored or displayed amount is rounded by it.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
