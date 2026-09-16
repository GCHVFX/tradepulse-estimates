import type { ParsedSummary } from "../../lib/estimate-summary";
import { resolveEstimateTax, type EstimateTax, type TaxAuthority } from "../../lib/estimate-tax";

/** A business Rates tax matching the tax row most fixtures carry. */
export const GST_5: EstimateTax = { label: "GST", rate: 5 };

/** An undelivered estimate on a GST 5% business: Rates is the authority. */
export const RATES_GST_5: TaxAuthority = { kind: "rates", tax: GST_5 };

/** A delivered estimate: its own stored tax row, Rates only if it has none. */
export const STORED_GST_5: TaxAuthority = { kind: "stored", fallback: GST_5 };

/**
 * The tax a fixture's own stored Pricing Summary declares, with GST 5% named
 * explicitly for fixtures written without a tax row. Before the tax hotfix the
 * parser substituted that 5% silently; tests that only exercise conversion or
 * rendering invariants now say so out loud. App code never uses a fixed
 * fallback like this: it resolves tax through a real TaxAuthority.
 */
export function fixtureTax(parsed: ParsedSummary): EstimateTax {
  return resolveEstimateTax(parsed.storedTax, STORED_GST_5);
}
