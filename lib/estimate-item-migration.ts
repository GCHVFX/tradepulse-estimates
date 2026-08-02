// Lazy per-estimate conversion from markdown-authoritative pricing to
// structured rows in tpe_estimate_items.
//
// SERVER ONLY. This module uses supabaseAdmin and must never be imported by a
// client component. New estimate generation invokes it as a best-effort step;
// the lazy conversion entry point remains available but is not customer-facing.
//
// The contract it upholds, from TRADEPULSE_GROUPED_PRICING_ARCHITECTURE.md:
// exactly one authoritative pricing representation per estimate, flipped one
// way, and never while a customer could already have seen the estimate.

import { supabaseAdmin } from "./supabase-server";
import { parseSummary, computeTotals } from "./estimate-summary";
import { assignGroupLabel } from "./estimate-groups";
import {
  parsedToItems,
  validateConversionTotals,
  type EstimateItemDraft,
  type ConversionValidation,
} from "./estimate-items";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConversionRefusalReason =
  | "ESTIMATE_NOT_FOUND"
  | "NOT_OWNED_BY_BUSINESS"
  | "NO_BUSINESS_FOR_USER"
  | "ALREADY_STRUCTURED"
  | "ESTIMATE_SENT"
  | "ESTIMATE_DONE"
  | "ESTIMATE_CUSTOMER_VISIBLE"
  | "MULTI_OPTION_ESTIMATE_UNSUPPORTED"
  | "NO_PRICED_ITEMS"
  | "MALFORMED_ROWS"
  | "TOTALS_MISMATCH"
  | "STRUCTURED_ROWS_ALREADY_EXIST"
  | "INCONSISTENT_STATE"
  | "TRANSACTION_FAILED";

export interface ConvertEstimateInput {
  estimateId: string;
  /**
   * The authenticated user. The business is resolved from this, never accepted
   * from the caller, so a client-supplied business id cannot be used to reach
   * someone else's estimate.
   */
  userId: string;
  /** When true, everything is computed and validated but nothing is written. */
  dryRun?: boolean;
  /**
   * Assign a work-package group to each row via the keyword classifier in
   * lib/estimate-groups.ts.
   *
   * Default false, so the lazy conversion path for EXISTING estimates keeps
   * writing group_label null and changes nothing about them. Only brand-new
   * estimate generation opts in, where labelling a row we are creating right
   * now is safe: it changes no price and no arithmetic, and an unrecognised
   * description is left ungrouped rather than forced into a wrong bucket.
   */
  assignGroups?: boolean;
}

export interface ConversionResult {
  success: boolean;
  dryRun: boolean;
  estimateId: string;
  previousPricingSource: string | null;
  resultingPricingSource: string | null;
  itemCount: number;
  originalSubtotal: number;
  convertedSubtotal: number;
  originalTax: number;
  convertedTax: number;
  originalTotal: number;
  convertedTotal: number;
  originalDeposit: number;
  convertedDeposit: number;
  warnings: string[];
  refusalReason: ConversionRefusalReason | null;
  /** True only when a real database transaction committed. */
  transactionApplied: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyResult(
  estimateId: string,
  dryRun: boolean,
  refusalReason: ConversionRefusalReason,
  previousPricingSource: string | null = null,
  warnings: string[] = []
): ConversionResult {
  return {
    success: false,
    dryRun,
    estimateId,
    previousPricingSource,
    resultingPricingSource: previousPricingSource,
    itemCount: 0,
    originalSubtotal: 0,
    convertedSubtotal: 0,
    originalTax: 0,
    convertedTax: 0,
    originalTotal: 0,
    convertedTotal: 0,
    originalDeposit: 0,
    convertedDeposit: 0,
    warnings,
    refusalReason,
    transactionApplied: false,
  };
}

/**
 * A multi-option estimate carries several "## Line Items - Option N" headings
 * and no bare "## Line Items". The production audit found two. parseSummary()
 * matches the heading by exact equality, so it reports zero priced rows and the
 * estimate silently totals nothing. Detecting this explicitly, rather than
 * letting it fall through as "no priced items", is what makes the refusal
 * honest: the estimate has prices, this converter just cannot represent them.
 */
export function detectsMultiOptionStructure(summary: string): boolean {
  const headings = summary.match(/^##\s+Line Items\b.*$/gim) ?? [];
  if (headings.length === 0) return false;
  const hasExact = headings.some((h) => /^##\s+Line Items\s*$/i.test(h.trim()));
  return !hasExact || headings.length > 1;
}

/**
 * Map one parsed draft onto a tpe_estimate_items row.
 *
 * Deliberately conservative. Pricing semantics are never inferred from
 * description text: item_type stays the neutral 'other' rather than guessing
 * labour versus material, is_allowance stays false, and the labour and markup
 * columns stay null because the current markdown format does not record them
 * per row. Inventing any of those would be making a product decision nobody
 * has taken.
 *
 * group_label is the one exception, and only when `assignGroups` is set, which
 * happens solely for a brand-new estimate. A group is presentational: it moves
 * no money and changes no arithmetic, and an unrecognised description stays
 * ungrouped rather than being forced into a wrong bucket.
 *
 * unit_price rule: a quantity row carries its parsed unit rate. A flat fee has
 * no unit rate in the source, so quantity stays 1 and unit_price equals the row
 * total, which keeps quantity times unit_price equal to line_total for every
 * row without inventing a rate.
 */
export type EstimateItemRowPayload = {
  description: string;
  item_type: string;
  is_allowance: boolean;
  quantity: number;
  unit: string | null;
  unit_price: number;
  line_total: number;
  labour_hours: number | null;
  labour_rate: number | null;
  markup_percent: number | null;
  group_label: string | null;
  customer_visible: boolean;
  display_order: number;
  taxable: boolean;
};

export function draftToItemRow(
  draft: EstimateItemDraft,
  options: { assignGroups?: boolean } = {}
): EstimateItemRowPayload {
  const isQuantity = draft.kind === "quantity";
  return {
    description: draft.source.description,
    item_type: "other",
    is_allowance: false,
    quantity: isQuantity ? (draft.quantity ?? 1) : 1,
    unit: isQuantity ? (draft.source.unitText?.trim() || null) : null,
    unit_price: isQuantity ? (draft.unitCost ?? 0) : draft.total,
    line_total: draft.total,
    labour_hours: null,
    labour_rate: null,
    markup_percent: null,
    // Null unless this is a brand-new estimate opting in. Never back-filled
    // onto an existing estimate.
    group_label: options.assignGroups ? assignGroupLabel(draft.source.description) : null,
    customer_visible: true,
    display_order: draft.sortOrder,
    taxable: true,
  };
}

/** Maps a refusal raised by the database function onto a typed reason. */
function mapDatabaseRefusal(message: string): ConversionRefusalReason {
  const known: ConversionRefusalReason[] = [
    "ALREADY_STRUCTURED",
    "STRUCTURED_ROWS_ALREADY_EXIST",
    "NO_PRICED_ITEMS",
    "ESTIMATE_CUSTOMER_VISIBLE",
  ];
  for (const reason of known) {
    if (message.includes(reason)) return reason;
  }
  if (message.includes("ESTIMATE_NOT_FOUND_OR_NOT_OWNED")) return "NOT_OWNED_BY_BUSINESS";
  return "TRANSACTION_FAILED";
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Convert one eligible estimate. Loads the authoritative record itself: the
 * caller never supplies markdown, totals, or a business id.
 *
 * Refuses rather than partially converting. On any failure inside the database
 * function, every insert and the pricing-source flip roll back together,
 * because the function body is a single transaction.
 */
export async function convertEstimateToStructuredItems(
  input: ConvertEstimateInput
): Promise<ConversionResult> {
  const { estimateId, userId } = input;
  const dryRun = input.dryRun ?? true; // safe by default
  const assignGroups = input.assignGroups ?? false; // existing estimates stay ungrouped

  // 1. Resolve the business from the authenticated user. Ownership is derived,
  //    never accepted from the caller.
  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id")
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (!business) return emptyResult(estimateId, dryRun, "NO_BUSINESS_FOR_USER");

  // 2. Load the estimate, scoped to that business. A foreign estimate reads as
  //    not found rather than leaking its existence.
  const { data: estimate } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id, business_id, status, sent_at, summary, pricing_source")
    .eq("id", estimateId)
    .eq("business_id", business.id)
    .maybeSingle();

  if (!estimate) return emptyResult(estimateId, dryRun, "ESTIMATE_NOT_FOUND");

  const previous = estimate.pricing_source;

  // 3. Eligibility, cheapest and most decisive checks first.
  if (previous !== "markdown") {
    return emptyResult(estimateId, dryRun, "ALREADY_STRUCTURED", previous);
  }
  if (estimate.sent_at !== null) {
    return emptyResult(estimateId, dryRun, "ESTIMATE_CUSTOMER_VISIBLE", previous);
  }
  if (estimate.status === "sent") {
    return emptyResult(estimateId, dryRun, "ESTIMATE_SENT", previous);
  }
  if (estimate.status === "done") {
    return emptyResult(estimateId, dryRun, "ESTIMATE_DONE", previous);
  }

  const summary = estimate.summary ?? "";

  if (detectsMultiOptionStructure(summary)) {
    return emptyResult(estimateId, dryRun, "MULTI_OPTION_ESTIMATE_UNSUPPORTED", previous);
  }

  // 4. An estimate marked markdown that already has structured rows is an
  //    inconsistent state. Refuse and say so rather than adding more rows.
  const { count: existingRows } = await supabaseAdmin
    .from("tpe_estimate_items")
    .select("id", { count: "exact", head: true })
    .eq("estimate_id", estimateId);

  if ((existingRows ?? 0) > 0) {
    return emptyResult(estimateId, dryRun, "INCONSISTENT_STATE", previous, [
      `${existingRows} structured rows already exist while pricing_source is still markdown.`,
    ]);
  }

  // 5. Parse, convert, validate. The same functions the invariant suite covers.
  const parsed = parseSummary(summary);
  const validation: ConversionValidation = validateConversionTotals(parsed);
  const items = parsedToItems(parsed);

  const totals = buildTotals(validation, parsed.taxRate, items);

  if (validation.unsupportedStructures.some((s) => s.includes("no priced line items"))) {
    return emptyResult(estimateId, dryRun, "NO_PRICED_ITEMS", previous, validation.warnings);
  }
  if (validation.malformedRows.some((r) => r.blocking)) {
    return {
      ...totals,
      success: false,
      dryRun,
      estimateId,
      previousPricingSource: previous,
      resultingPricingSource: previous,
      warnings: validation.warnings,
      refusalReason: "MALFORMED_ROWS",
      transactionApplied: false,
    };
  }
  if (!validation.ok) {
    const totalsChanged =
      validation.subtotalDifference !== 0 ||
      validation.taxDifference !== 0 ||
      validation.grandTotalDifference !== 0 ||
      validation.depositDifference !== 0;
    return {
      ...totals,
      success: false,
      dryRun,
      estimateId,
      previousPricingSource: previous,
      resultingPricingSource: previous,
      warnings: validation.warnings,
      refusalReason: totalsChanged ? "TOTALS_MISMATCH" : "MALFORMED_ROWS",
      transactionApplied: false,
    };
  }

  // 6. Dry run stops here, having done every check and produced a full result.
  if (dryRun) {
    return {
      ...totals,
      success: true,
      dryRun: true,
      estimateId,
      previousPricingSource: previous,
      resultingPricingSource: previous, // unchanged: nothing was written
      warnings: validation.warnings,
      refusalReason: null,
      transactionApplied: false,
    };
  }

  // 7. Real conversion, atomically, in the database.
  const { data, error } = await supabaseAdmin.rpc("tpe_convert_estimate_to_structured", {
    p_estimate_id: estimateId,
    p_business_id: business.id,
    p_items: items.map((d) => draftToItemRow(d, { assignGroups })),
    p_expected_count: items.length,
    p_expected_subtotal: validation.convertedSubtotal,
  });

  if (error) {
    // The function raised, so the whole transaction rolled back: no rows were
    // inserted and pricing_source is still markdown. The raw database error is
    // logged server-side and never returned to a caller.
    console.error("[estimate-item-migration] conversion refused:", error.message);
    return {
      ...totals,
      success: false,
      dryRun: false,
      estimateId,
      previousPricingSource: previous,
      resultingPricingSource: previous,
      warnings: validation.warnings,
      refusalReason: mapDatabaseRefusal(error.message),
      transactionApplied: false,
    };
  }

  const applied = (data ?? {}) as { inserted_count?: number; pricing_source?: string };

  return {
    ...totals,
    success: true,
    dryRun: false,
    estimateId,
    previousPricingSource: previous,
    resultingPricingSource: applied.pricing_source ?? "structured",
    itemCount: applied.inserted_count ?? items.length,
    warnings: validation.warnings,
    refusalReason: null,
    transactionApplied: true,
  };
}

/** Shared totals block, so every return path reports the same numbers. */
function buildTotals(
  validation: ConversionValidation,
  taxRate: number,
  items: EstimateItemDraft[]
): Pick<
  ConversionResult,
  | "itemCount"
  | "originalSubtotal"
  | "convertedSubtotal"
  | "originalTax"
  | "convertedTax"
  | "originalTotal"
  | "convertedTotal"
  | "originalDeposit"
  | "convertedDeposit"
> {
  void taxRate;
  return {
    itemCount: items.length,
    originalSubtotal: validation.originalSubtotal,
    convertedSubtotal: validation.convertedSubtotal,
    originalTax: validation.originalTax,
    convertedTax: validation.convertedTax,
    originalTotal: validation.originalGrandTotal,
    convertedTotal: validation.convertedGrandTotal,
    originalDeposit: validation.originalDepositAmount,
    convertedDeposit: validation.convertedDepositAmount,
  };
}

/** Re-exported for tests and for a future batch caller. */
export { computeTotals };
