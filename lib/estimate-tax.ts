import { isDelivered, type EstimateDeliveryState } from "./estimate-delivery";

// Tax authority for estimates (tax hotfix, spec Appendix A).
//
// The generation model used to write the tax label and rate into the Pricing
// Summary, and the app read them back out of that text, falling back to a
// hard-coded GST 5% whenever the row was missing. Neither was ever an
// authority. From this change:
//
//   - An undelivered estimate always uses the business's Rates settings
//     (tpe_businesses.tax_label / tax_rate). Whatever the stored text says is
//     ignored.
//   - A delivered estimate keeps rendering what the customer was given: the
//     tax row stored in its own summary. Only when that stored summary has no
//     tax row at all does it fall back to Rates, never to a constant.
//
// Phase 1 replaces the delivered branch with per-estimate tax snapshots.

export interface EstimateTax {
  label: string;
  /** Whole-number percent, e.g. 5 for 5%. */
  rate: number;
}

export type TaxAuthority =
  | { kind: "rates"; tax: EstimateTax }
  // `fallback` is null when the business row could not be read. A delivered
  // estimate does not need it: its own stored tax row is the authority, which
  // is what keeps a delivered estimate rendering when that read fails.
  | { kind: "stored"; fallback: EstimateTax | null };

/** Same label treatment the parser has always applied to a stored tax row. */
export function normalizeTaxLabel(label: string): string {
  return label.replace(/[a-zA-Z]+/g, (word) => word.toUpperCase()).trim();
}

export function businessTax(business: { tax_label: string; tax_rate: number }): EstimateTax {
  const rate = Number(business.tax_rate);
  if (!Number.isFinite(rate)) {
    throw new Error("Business tax rate is not a number");
  }
  return { label: normalizeTaxLabel(business.tax_label), rate };
}

/**
 * `rates` may be null only when the business row could not be read. A
 * delivered estimate still resolves, from its own stored tax row. An
 * undelivered estimate cannot: Rates is its only authority, and pricing it
 * against a guessed tax is the bug this hotfix removes.
 */
export function taxAuthorityFor(estimate: EstimateDeliveryState, rates: EstimateTax | null): TaxAuthority {
  if (isDelivered(estimate)) return { kind: "stored", fallback: rates };
  if (!rates) {
    throw new Error("An undelivered estimate cannot be priced without its business Rates tax");
  }
  return { kind: "rates", tax: rates };
}

export function resolveEstimateTax(storedTax: EstimateTax | null, authority: TaxAuthority): EstimateTax {
  if (authority.kind === "rates") return authority.tax;
  const tax = storedTax ?? authority.fallback;
  if (!tax) {
    // Delivered, no tax row in its own stored summary, and no business row to
    // fall back to. Nothing is left that could honestly name the rate.
    throw new Error("A delivered estimate with no stored tax row needs its business Rates tax");
  }
  return tax;
}

// /new has no business row of its own, so the generate route reports the Rates
// tax it saved the estimate with in response headers, the same way it already
// reports the currency snapshot.
export const TAX_LABEL_HEADER = "X-Estimate-Tax-Label";
export const TAX_RATE_HEADER = "X-Estimate-Tax-Rate";

export function taxHeaders(tax: EstimateTax): Record<string, string> {
  return {
    [TAX_LABEL_HEADER]: encodeURIComponent(tax.label),
    [TAX_RATE_HEADER]: String(tax.rate),
  };
}

/** null when either header is missing or unreadable. Never a default. */
export function parseTaxHeaders(label: string | null, rate: string | null): EstimateTax | null {
  if (label === null || rate === null || rate.trim() === "") return null;
  const parsedRate = Number(rate);
  if (!Number.isFinite(parsedRate)) return null;
  try {
    return { label: decodeURIComponent(label), rate: parsedRate };
  } catch {
    return null;
  }
}
