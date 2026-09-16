/**
 * What a generated estimate sends to the model, and what it writes to the
 * database (specs/contractor-owned-pricing.md sections 9 and 3).
 *
 * Both shapes live here, away from the streaming route, because both are
 * rules rather than plumbing: the model must receive nothing that lets it
 * decide a selling price, and a generated estimate must classify as
 * contractor pricing from the moment it is saved rather than inheriting a
 * column default.
 */

import type { Database } from "@/lib/database.types";
import type { Currency } from "@/lib/currency";
import { estimateCurrencyPatch } from "@/lib/currency-db";
import type { EstimateTax } from "@/lib/estimate-tax";

type EstimateInsert = Database["public"]["Tables"]["tpe_estimates"]["Insert"];

/**
 * Everything the model is allowed to see. There is no field here for a
 * labour rate, a markup, a price book entry, a tax rate, a deposit rule or
 * any contractor-entered amount, which is the point: a price-driving value
 * cannot reach the model by accident because there is nowhere to put it.
 */
export interface GenerationContext {
  jobDescription: string;
  photoAnalysis?: string;
  businessName?: string;
  /** Context only. The model is told not to write these back out. */
  customerName?: string;
  customerPhone?: string;
  jobAddress?: string;
}

export function buildGenerationUserMessage(context: GenerationContext): string {
  const lines: string[] = [context.jobDescription.trim()];

  if (context.photoAnalysis?.trim()) {
    lines.push(`What the job site photos show: ${context.photoAnalysis.trim()}`);
  }
  if (context.businessName?.trim()) {
    lines.push(`Business name: ${context.businessName.trim()}`);
  }
  if (context.customerName?.trim()) {
    lines.push(`Customer name (for context only, do not include in output): ${context.customerName.trim()}`);
  }
  if (context.customerPhone?.trim()) {
    lines.push(`Customer phone (for context only, do not include in output): ${context.customerPhone.trim()}`);
  }
  if (context.jobAddress?.trim()) {
    lines.push(`Job address (for context only, do not include in output): ${context.jobAddress.trim()}`);
  }

  return lines.join("\n");
}

/** The business columns a generated estimate snapshots at creation. */
export interface GeneratedEstimateBusiness {
  id: string;
  prepared_by: string | null;
  deposit_percent: number | null;
  deposit_threshold: number | null;
}

export interface NewGeneratedEstimateInput {
  title: string;
  /** Already sanitized prose. Never the raw model text. */
  summary: string;
  business: GeneratedEstimateBusiness;
  /** The Rates tax this estimate is snapshotted with. */
  tax: EstimateTax;
  currency: Currency;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  jobAddress: string;
}

/**
 * The insert for a newly generated estimate.
 *
 * `source`, `status` and `pricing_source` are all written explicitly. The
 * column defaults are `website_quote` / `needs_review` / `markdown`, which
 * would classify every generated estimate as legacy inbound intake.
 *
 * The tax and deposit snapshots are copied from the business here so a later
 * change to Rates cannot move an estimate that already exists. No pricing
 * rows are written: the AI authors no number, so a new estimate starts with
 * zero rows and is incomplete until the contractor prices it.
 */
export function newGeneratedEstimateInsert(input: NewGeneratedEstimateInput): EstimateInsert {
  return {
    title: input.title,
    summary: input.summary,
    status: "draft",
    source: "ai_generated",
    pricing_source: "contractor_pricing",
    business_id: input.business.id,
    customer_name: input.customerName,
    customer_phone: input.customerPhone,
    customer_email: input.customerEmail,
    job_address: input.jobAddress,
    description: input.jobAddress,
    service_type: "estimate",
    location: "",
    urgency: "flexible",
    prepared_by: input.business.prepared_by ?? "",
    deposit_amount: null,
    tax_label_snapshot: input.tax.label,
    tax_rate_snapshot: input.tax.rate,
    deposit_percent_snapshot: input.business.deposit_percent,
    deposit_threshold_snapshot: input.business.deposit_threshold,
    // Immutable snapshot. Changing the business estimate currency later must
    // never move an estimate that is already saved.
    ...estimateCurrencyPatch(input.currency),
  };
}

/**
 * Regenerate replaces the job wording on the estimate that already exists.
 *
 * These two columns are the entire write. Pricing rows, tax and deposit
 * snapshots, currency, customer details and photos all live elsewhere and are
 * untouched, so regenerating cannot move a price. No row is inserted, so no
 * orphan estimate is left behind either.
 */
export function regeneratedEstimateUpdate(
  title: string,
  summary: string
): { title: string; summary: string } {
  return { title, summary };
}
