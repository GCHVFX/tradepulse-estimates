/**
 * Which pricing model an estimate belongs to
 * (specs/contractor-owned-pricing.md section 2).
 *
 * Ordered rules, evaluated top down, failing closed:
 *
 * 1. `pricing_source = 'contractor_pricing'` is the new authoritative model.
 * 2. `source = 'website_quote'` with `status = 'needs_review'` is unpriced
 *    inbound intake.
 * 3. Everything else is legacy and read-only.
 *
 * Never classify on `pricing_source` alone, on `source` alone, or on
 * delivery. Historical values are deliberately not enumerated: rule 3 catches
 * whatever was not anticipated, including `pricing_source = 'structured'`,
 * which is the old AI-priced model and not contractor pricing, however many
 * `tpe_estimate_items` rows it happens to have.
 *
 * Classification runs before any completeness check or rendering decision. A
 * legacy estimate has no contractor pricing rows, so a completeness check
 * evaluated first would wrongly refuse every legacy customer document.
 */

export type EstimatePricingClass = "contractor_pricing" | "website_quote_intake" | "legacy";

export interface EstimateClassificationInput {
  pricing_source: string | null;
  source: string | null;
  status: string | null;
}

export function classifyEstimate(estimate: EstimateClassificationInput): EstimatePricingClass {
  if (estimate.pricing_source === "contractor_pricing") return "contractor_pricing";
  if (estimate.source === "website_quote" && estimate.status === "needs_review") {
    return "website_quote_intake";
  }
  return "legacy";
}
