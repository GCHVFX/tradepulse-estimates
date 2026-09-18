/**
 * The customer-safe view of a contractor-priced estimate
 * (specs/contractor-owned-pricing.md sections 11 and 13).
 *
 * Pure and isomorphic. Every figure comes from calculateContractorPricing();
 * nothing here adds, multiplies, rounds or applies a percentage. This module
 * only decides what a customer is allowed to see, and formats it.
 *
 * WHAT LEAVES THIS MODULE. A labour selling amount, a materials selling
 * amount, each optional charge's description and amount, subtotal, tax, total,
 * deposit and balance. Nothing else.
 *
 * WHAT NEVER LEAVES IT. Labour hours, the hourly rate, the contractor's
 * material cost, the markup percentage, whether labour was hourly or fixed,
 * and the raw pricing rows. The input rows carry all of that; the output types
 * have no field that could hold any of it. That matters beyond the visible
 * page: whatever a server component hands to a client component is serialized
 * into the page payload, so the payload is only as safe as the object passed.
 */

import {
  calculateContractorPricing,
  type PricingGap,
  type PricingRow,
  type PricingSnapshots,
} from "./contractor-pricing";
import { formatCentsAsCurrency as money, type Currency } from "./currency";
import { stripTitleHeading } from "./estimate-prose";

/** A stored pricing row plus the one text field a charge needs. Server-side only. */
export interface CustomerPricingSourceRow extends PricingRow {
  description: string;
}

export interface CustomerPricingLine {
  label: string;
  amountCents: number;
}

/** Everything a customer document may show. Selling amounts only. */
export interface CustomerPricing {
  /** Labour, then Materials, then each optional charge in row order. */
  lines: CustomerPricingLine[];
  subtotalCents: number;
  /** The tax as the customer sees it, for example "GST 5%". */
  taxLabel: string;
  taxCents: number;
  totalCents: number;
  depositCents: number;
  balanceCents: number;
}

export type CustomerPricingResult =
  | { ready: true; pricing: CustomerPricing }
  | { ready: false; missing: PricingGap[] };

/** Only the fields the calculation reads. The description never reaches it. */
function toPricingRow(row: CustomerPricingSourceRow): PricingRow {
  return {
    item_type: row.item_type,
    unit: row.unit,
    quantity: row.quantity,
    unit_price: row.unit_price,
    markup_percent: row.markup_percent,
    taxable: row.taxable,
  };
}

function customerTaxLabel(labelSnapshot: string | null, ratePercent: number): string {
  const label = labelSnapshot?.trim() || "Tax";
  return `${label} ${parseFloat(ratePercent.toFixed(2))}%`;
}

/**
 * Project stored contractor pricing into what a customer may see.
 *
 * An incomplete estimate has no customer projection at all: it returns the
 * gaps and nothing priced, so a caller cannot render a partially priced
 * document by accident.
 */
export function toCustomerPricing(
  rows: readonly CustomerPricingSourceRow[],
  snapshots: PricingSnapshots,
  taxLabelSnapshot: string | null
): CustomerPricingResult {
  const pricing = calculateContractorPricing(rows.map(toPricingRow), snapshots);
  if (!pricing.complete || snapshots.taxRatePercent === null) {
    return { ready: false, missing: pricing.missing };
  }

  // Charges are listed in the same order calculateContractorPricing saw them,
  // which is the order chargeLineCents is in.
  const chargeDescriptions = rows
    .filter((row) => row.item_type === "other")
    .map((row) => row.description.trim());

  const lines: CustomerPricingLine[] = [
    { label: "Labour", amountCents: pricing.labourCents },
    { label: "Materials", amountCents: pricing.materialsCents },
    ...pricing.chargeLineCents.map((amountCents, index) => ({
      label: chargeDescriptions[index] ?? "",
      amountCents,
    })),
  ];

  return {
    ready: true,
    pricing: {
      lines,
      subtotalCents: pricing.subtotalCents,
      taxLabel: customerTaxLabel(taxLabelSnapshot, snapshots.taxRatePercent),
      taxCents: pricing.taxCents,
      totalCents: pricing.totalCents,
      depositCents: pricing.depositCents,
      balanceCents: pricing.balanceCents,
    },
  };
}

/**
 * A pipe inside a table cell would split the row. Both renderers split cells
 * on `|` (the PDF renderer naively), so neutralize it the same way for both
 * rather than escaping it in a way only one of them honours.
 */
function cellText(text: string): string {
  return text.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

/**
 * The pricing block, in the same pipe-table shape customers already get: a
 * blank header row, intermediate rows in bare `$`, and only the Total naming
 * its currency. Every amount is to the cent, because contractor pricing is
 * cent-exact and whole-dollar rows would not visibly add up.
 *
 * Deposit and balance rows appear only when a deposit applies. With no
 * deposit the balance is the total, and a row saying so adds nothing.
 */
export function customerPricingBlock(pricing: CustomerPricing, currency: Currency): string {
  const rows = [
    "## Pricing Summary",
    "| | |",
    "|---|---|",
    ...pricing.lines.map((line) => `| ${cellText(line.label)} | ${money(line.amountCents, currency, true)} |`),
    `| Subtotal | ${money(pricing.subtotalCents, currency, true)} |`,
    `| ${cellText(pricing.taxLabel)} | ${money(pricing.taxCents, currency, true)} |`,
    `| **Total** | **${money(pricing.totalCents, currency, false)}** |`,
  ];
  if (pricing.depositCents > 0) {
    rows.push(`| Deposit required | ${money(pricing.depositCents, currency, true)} |`);
    rows.push(`| Balance on completion | ${money(pricing.balanceCents, currency, true)} |`);
  }
  return rows.join("\n");
}

/**
 * The whole customer document for a contractor-priced estimate: the saved
 * prose without its title, with the pricing block placed where the PDF
 * renderer's own section order expects it (after Assumptions and Exclusions,
 * before Notes). The share page and the PDF both render exactly this string,
 * which is what makes them agree.
 */
export function buildCustomerDocument(prose: string, pricing: CustomerPricing, currency: Currency): string {
  const body = stripTitleHeading(prose).replace(/\s+$/, "");
  const block = customerPricingBlock(pricing, currency);

  const lines = body.split("\n");
  const notesIndex = lines.findIndex((line) => /^ {0,3}##\s+notes\b/i.test(line));
  if (notesIndex === -1) {
    return body ? `${body}\n\n${block}` : block;
  }

  const before = lines.slice(0, notesIndex).join("\n").replace(/\s+$/, "");
  const after = lines.slice(notesIndex).join("\n");
  return before ? `${before}\n\n${block}\n\n${after}` : `${block}\n\n${after}`;
}

/** The stored estimate fields a customer document is built from. */
export interface ContractorEstimateForCustomer {
  summary: string | null;
  tax_label_snapshot: string | null;
  tax_rate_snapshot: number | null;
  deposit_percent_snapshot: number | null;
  deposit_threshold_snapshot: number | null;
}

export type ContractorCustomerDocument =
  | { ready: true; document: string; totalCents: number }
  | { ready: false; missing: PricingGap[] };

/**
 * One call from a stored contractor-priced estimate to the document a
 * customer receives. It reads only persisted rows, the estimate's own
 * snapshots and its currency, never the live business settings, so a later
 * change to Rates cannot move a document already produced.
 *
 * The result holds a finished markdown string and a total. Neither contains a
 * row, an hour, a rate, a cost or a markup, so it is safe to hand to a client
 * component.
 */
export function contractorCustomerDocument(
  estimate: ContractorEstimateForCustomer,
  rows: readonly CustomerPricingSourceRow[],
  currency: Currency
): ContractorCustomerDocument {
  const result = toCustomerPricing(
    rows,
    {
      taxRatePercent: estimate.tax_rate_snapshot,
      depositPercent: estimate.deposit_percent_snapshot,
      depositThresholdDollars: estimate.deposit_threshold_snapshot,
    },
    estimate.tax_label_snapshot
  );
  if (!result.ready) return result;

  return {
    ready: true,
    document: buildCustomerDocument(estimate.summary ?? "", result.pricing, currency),
    totalCents: result.pricing.totalCents,
  };
}
