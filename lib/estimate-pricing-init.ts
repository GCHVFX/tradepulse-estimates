/**
 * The one authoritative read /new's same-page pricing editor initializes
 * from (GET /api/estimates/[id]/pricing), ownership first.
 *
 * Mirrors lib/estimate-deletion.ts's deleteOwnedEstimate(): pure
 * orchestration over injected dependencies, so the refusal ordering is
 * testable without a database. Nothing about pricing, currency, tax or
 * deposit is loaded or computed until the estimate is confirmed to belong
 * to the caller's own business, and a legacy (non contractor_pricing)
 * estimate is refused before its rows are ever read, since they are not in
 * the shape this editor expects and are frozen read-only by design.
 */

import { isDelivered } from "./estimate-delivery";
import { calculateContractorPricing, type ContractorPricing, type PricingRow, type PricingSnapshots } from "./contractor-pricing";
import { currencyOrDefault, type Currency } from "./currency";
import { suggestPriceBookItems, type PriceBookSuggestion, type PriceBookSuggestionItem } from "./pricebook-suggestions";

/** One stored contractor-pricing row, as the editor needs it. */
export interface PricingInitRow {
  item_type: string;
  unit: string | null;
  quantity: number;
  unit_price: number;
  markup_percent: number | null;
  description: string;
  display_order: number;
  taxable: boolean;
}

/** The estimate row fields this needs, exactly as stored -- never business Rates. */
export interface OwnedEstimateForPricingInit {
  id: string;
  pricing_source: string;
  status: string;
  sent_at: string | null;
  copied_at: string | null;
  currency: string | null;
  tax_label_snapshot: string | null;
  tax_rate_snapshot: number | null;
  deposit_percent_snapshot: number | null;
  deposit_threshold_snapshot: number | null;
}

export interface EstimatePricingInitDependencies {
  /** The estimate, only if it belongs to this business. */
  findOwnedEstimate(estimateId: string, businessId: string): Promise<OwnedEstimateForPricingInit | null>;
  /** Only ever called once ownership and pricing_source have both passed. */
  loadRows(estimateId: string): Promise<PricingInitRow[]>;
  /**
   * Phase 2 slice 4: price-free saved-item candidates for this business, only
   * ever called when the caller supplied non-blank job text. The matcher's
   * own input type (PriceBookSuggestionItem) cannot carry a price field, so
   * this dependency structurally cannot leak money into a suggestion either.
   * Optional so every existing caller/test that predates slice 4 keeps
   * working unchanged.
   */
  loadSuggestionCandidates?(businessId: string): Promise<PriceBookSuggestionItem[]>;
}

export const ESTIMATE_NOT_FOUND_OR_DENIED = "Estimate not found or access denied";
export const ESTIMATE_READ_ONLY_MESSAGE = "This estimate uses the previous pricing system and is read-only";
export const ESTIMATE_READ_ONLY_CODE = "ESTIMATE_READ_ONLY";

export type EstimatePricingInitResult =
  | {
      ok: true;
      estimate: {
        id: string;
        pricingSource: string;
        currency: Currency;
        isDelivered: boolean;
        taxLabel: string | null;
        taxRate: number | null;
        depositPercent: number | null;
        depositThreshold: number | null;
      };
      rows: PricingInitRow[];
      pricing: ContractorPricing;
      /**
       * Inert saved-item suggestions for the job text supplied to this call.
       * Always [] when no job text was supplied, or when the business has no
       * candidates scoring above the matcher's own floor -- both valid,
       * non-error states (specs/contractor-owned-pricing.md Phase 2 slice 4).
       */
      suggestions: PriceBookSuggestion[];
    }
  | { ok: false; status: 404; error: string }
  | { ok: false; status: 409; error: string; code: typeof ESTIMATE_READ_ONLY_CODE };

export async function loadEstimatePricingInit(
  estimateId: string,
  businessId: string,
  deps: EstimatePricingInitDependencies,
  /** The contractor's own job text, when the caller has it. See the field
   * comment on EstimatePricingInitDependencies.loadSuggestionCandidates. */
  jobText?: string
): Promise<EstimatePricingInitResult> {
  const owned = await deps.findOwnedEstimate(estimateId, businessId);

  // The whole point: refuse before rows, currency or snapshots are read.
  if (!owned) {
    return { ok: false, status: 404, error: ESTIMATE_NOT_FOUND_OR_DENIED };
  }

  // Legacy estimates are intentionally frozen read-only -- not a transient
  // failure, and never treated as one by the caller.
  if (owned.pricing_source !== "contractor_pricing") {
    return { ok: false, status: 409, error: ESTIMATE_READ_ONLY_MESSAGE, code: ESTIMATE_READ_ONLY_CODE };
  }

  const rows = await deps.loadRows(owned.id);
  const snapshots: PricingSnapshots = {
    taxRatePercent: owned.tax_rate_snapshot,
    depositPercent: owned.deposit_percent_snapshot,
    depositThresholdDollars: owned.deposit_threshold_snapshot,
  };
  const pricingRows: PricingRow[] = rows.map((row) => ({
    item_type: row.item_type,
    unit: row.unit,
    quantity: row.quantity,
    unit_price: row.unit_price,
    markup_percent: row.markup_percent,
    taxable: row.taxable,
  }));

  // The one arithmetic implementation. Never duplicated here or in SQL.
  const pricing = calculateContractorPricing(pricingRows, snapshots);

  // Suggestions never gate or fail this read: a missing dependency or blank
  // job text both simply mean no suggestions, never an error the rest of
  // this response would need to be withheld for. Isolated in its own
  // try/catch too -- an exception thrown by loadSuggestionCandidates (a
  // network failure, not just a query-error response) must degrade to an
  // empty suggestion list, not take down rows/pricing/currency/tax/deposit
  // with it, since nothing calls this with its own try/catch above it.
  const trimmedJobText = jobText?.trim() ?? "";
  let suggestions: PriceBookSuggestion[] = [];
  if (trimmedJobText && deps.loadSuggestionCandidates) {
    try {
      suggestions = suggestPriceBookItems(trimmedJobText, await deps.loadSuggestionCandidates(businessId));
    } catch (error) {
      console.error("[estimate-pricing-init] suggestion loading failed, degrading to empty", error);
    }
  }

  return {
    ok: true,
    suggestions,
    estimate: {
      id: owned.id,
      pricingSource: owned.pricing_source,
      currency: currencyOrDefault(owned.currency),
      isDelivered: isDelivered(owned),
      taxLabel: owned.tax_label_snapshot,
      taxRate: owned.tax_rate_snapshot,
      depositPercent: owned.deposit_percent_snapshot,
      depositThreshold: owned.deposit_threshold_snapshot,
    },
    rows,
    pricing,
  };
}
