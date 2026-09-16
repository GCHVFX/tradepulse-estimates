import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import {
  buildGenerationUserMessage,
  newGeneratedEstimateInsert,
  regeneratedEstimateUpdate,
} from "../../lib/generated-estimate";
import { calculateContractorPricing } from "../../lib/contractor-pricing";

/**
 * Phase 1 slice 4: generation and the new-estimate flow
 * (specs/contractor-owned-pricing.md sections 3, 9, 10 and 12).
 *
 * No browser, no network, no database, and no AI call. Everything the slice
 * changed is either a pure function or a rule that reads off the source of the
 * route that has to follow it.
 */

const root = path.join(__dirname, "../..");
const code = (file: string) => readFileSync(path.join(root, file), "utf8");

const BUSINESS = {
  id: "11111111-1111-1111-1111-111111111111",
  prepared_by: "Dan",
  deposit_percent: 25,
  deposit_threshold: 500,
};

const GST_5 = { label: "GST", rate: 5 };

function insertFor(overrides: Partial<Parameters<typeof newGeneratedEstimateInsert>[0]> = {}) {
  return newGeneratedEstimateInsert({
    title: "Water Heater Replacement",
    summary: "# Water Heater Replacement\n\n## Job Summary\nSwap the failed tank.",
    business: BUSINESS,
    tax: GST_5,
    currency: "cad",
    customerName: "Sam",
    customerPhone: "6045551234",
    customerEmail: "sam@example.com",
    jobAddress: "12 Maple St",
    ...overrides,
  });
}

// 1. Classification -----------------------------------------------------

test("a generated estimate is written as contractor_pricing, never left to the column defaults", () => {
  const insert = insertFor();

  expect(insert.pricing_source).toBe("contractor_pricing");
  expect(insert.source).toBe("ai_generated");
  expect(insert.status).toBe("draft");

  // The defaults this is protecting against: website_quote / needs_review /
  // markdown, which would classify every generated estimate as legacy inbound
  // intake under section 2.
  const generate = code("app/api/generate-estimate/route.ts");
  expect(generate).toContain("newGeneratedEstimateInsert({");
  expect(generate).not.toContain('pricing_source: "markdown"');
});

// 2. Snapshots ----------------------------------------------------------

test("creation snapshots the business tax and deposit settings onto the estimate", () => {
  const insert = insertFor();

  expect(insert.tax_label_snapshot).toBe("GST");
  expect(insert.tax_rate_snapshot).toBe(5);
  expect(insert.deposit_percent_snapshot).toBe(25);
  expect(insert.deposit_threshold_snapshot).toBe(500);
  expect(insert.currency).toBe("cad");
});

test("a business with no deposit rule snapshots nulls, not zeroes", () => {
  const insert = insertFor({
    business: { ...BUSINESS, deposit_percent: null, deposit_threshold: null },
  });

  expect(insert.deposit_percent_snapshot).toBeNull();
  expect(insert.deposit_threshold_snapshot).toBeNull();
  // Still a fully classified contractor_pricing estimate.
  expect(insert.pricing_source).toBe("contractor_pricing");
});

test("the route loads the snapshot columns it writes, and no price-driving ones", () => {
  const generate = code("app/api/generate-estimate/route.ts");
  const select = generate.slice(generate.indexOf(".select(`id, name"), generate.indexOf(".eq(\"owner_user_id\""));

  expect(select).toContain("deposit_percent");
  expect(select).toContain("deposit_threshold");
  expect(select).toContain("tax_label");
  expect(select).toContain("tax_rate");
  expect(select).not.toContain("labour_rate");
  expect(select).not.toContain("markup_percent");
});

// 3. Nothing price-driving reaches the model ----------------------------

test("the generation input carries no contractor pricing values", () => {
  const message = buildGenerationUserMessage({
    jobDescription: "Replace the water heater",
    photoAnalysis: "Old tank, corroded fittings",
    businessName: "Circuit & Co",
    customerName: "Sam",
    customerPhone: "6045551234",
    jobAddress: "12 Maple St",
  });

  expect(message).toContain("Replace the water heater");
  expect(message).toContain("Old tank, corroded fittings");
  expect(message).toContain("Circuit & Co");

  // Nothing that could let the model decide a selling price.
  expect(message).not.toContain("$");
  expect(message).not.toMatch(/labour rate/i);
  expect(message).not.toMatch(/markup/i);
  expect(message).not.toMatch(/price book/i);
  expect(message).not.toMatch(/deposit/i);
  expect(message).not.toMatch(/tax/i);
  expect(message).not.toMatch(/\d+%/);
});

test("the route never reads the price book or injects a rate, markup or deposit rule", () => {
  const generate = code("app/api/generate-estimate/route.ts");

  expect(generate).not.toContain("tpe_pricebook_items");
  expect(generate).not.toContain("Labour rate:");
  expect(generate).not.toContain("Materials markup:");
  expect(generate).not.toContain("Deposit rule:");
  expect(generate).not.toContain("priceItems");
  expect(generate).not.toContain("labour_price");
  // The tax is read for the snapshot only, and the model is never told it.
  expect(generate).toContain("const tax = businessTax(business);");
  expect(generate).toContain("It is never sent to the model.");
});

test("the prompt asks for prose only, with no pricing sections left in it", () => {
  const generate = code("app/api/generate-estimate/route.ts");

  expect(generate).not.toContain("Line Items");
  expect(generate).not.toContain("Pricing Summary");
  expect(generate).not.toContain("Estimated total");
  expect(generate).not.toContain("Estimate labour hours");
  expect(generate).toContain(
    "Never write currency amounts, prices, rates, or percentages of cost."
  );
  expect(generate).toContain("Never mention a deposit");
  expect(generate).toContain("3. Scope of Work");
  expect(generate).toContain("4. Assumptions and Exclusions");
  expect(generate).toContain("5. Payment Terms");
});

// 4. No AI-authored pricing rows ---------------------------------------

test("generating an estimate writes no pricing rows of any kind", () => {
  const insert = insertFor() as Record<string, unknown>;

  // The insert is one row in tpe_estimates and nothing else. There is no
  // field here that could become a priced item.
  expect(Object.keys(insert)).not.toContain("items");
  expect(insert.deposit_amount).toBeNull();

  const generate = code("app/api/generate-estimate/route.ts");
  expect(generate).not.toContain("tpe_estimate_items");
  expect(generate).not.toContain("convertEstimateToStructuredItems");
  expect(generate).not.toContain("tpe_convert_estimate_to_structured");
  expect(generate).not.toContain("applyDeterministicDeposit");
});

// 7. Regenerate ---------------------------------------------------------

test("regenerate writes the wording and nothing else", () => {
  const update = regeneratedEstimateUpdate("New Title", "# New Title\n\nNew wording.");

  expect(Object.keys(update).sort()).toEqual(["summary", "title"]);
  expect(update.title).toBe("New Title");
  expect(update.summary).toBe("# New Title\n\nNew wording.");

  // Nothing that would move a price, a snapshot, a customer detail or a photo
  // can be written by an object with only these two keys.
  const keys = Object.keys(update);
  for (const preserved of [
    "pricing_source",
    "tax_label_snapshot",
    "tax_rate_snapshot",
    "deposit_percent_snapshot",
    "deposit_threshold_snapshot",
    "currency",
    "customer_name",
    "customer_phone",
    "customer_email",
    "job_address",
    "include_photos",
    "status",
  ]) {
    expect(keys).not.toContain(preserved);
  }
});

test("regenerate updates the estimate that exists instead of inserting a second one", () => {
  const generate = code("app/api/generate-estimate/route.ts");

  expect(generate).toContain(".update(regeneratedEstimateUpdate(title, summary))");
  expect(generate).toContain('.eq("id", regenerateId)');
  expect(generate).toContain('.eq("business_id", business.id)');
  // Refused for anything that is not an undelivered contractor_pricing
  // estimate this business owns, both before the stream and in the filter on
  // the update itself.
  expect(generate).toContain('existing.pricing_source !== "contractor_pricing"');
  expect(generate).toContain("isDelivered(existing)");
  expect(generate).toContain('.eq("pricing_source", "contractor_pricing")');
  expect(generate).toContain('.is("sent_at", null)');
  expect(generate).toContain('.is("copied_at", null)');
});

test("the new-estimate screen confirms before it regenerates, and never re-uploads photos", () => {
  const newPage = code("app/new/page.tsx");

  expect(newPage).toContain(
    "Regenerate replaces the current job wording. Your pricing will stay the same."
  );
  expect(newPage).toContain("estimateId: regenerateId || undefined,");
  expect(newPage).toContain("const regenerateId = saved && savedEstimateId ? savedEstimateId : null;");
  expect(newPage).toContain("if (!regenerateId) setSavedEstimateId(null);");
  expect(newPage).toContain("if (isPro && !regenerateId && createdEstimateId && photos.length > 0) {");
});

// F1: /new shows the saved record, not the stream buffer -----------------

test("the server hands back the saved prose and /new renders that, not its own buffer", () => {
  const generate = code("app/api/generate-estimate/route.ts");
  expect(generate).toContain("const summary = sanitized.prose;");
  expect(generate).toContain("__SAVED__:${summary}");

  const newPage = code("app/new/page.tsx");
  expect(newPage).toContain('const savedMarkerIndex = buffer.indexOf("\\n__SAVED__:");');
  expect(newPage).toContain("savedProse = buffer.slice(savedMarkerIndex");
  expect(newPage).toContain("savedProse !== null");
  expect(newPage).toContain("setEstimate(visible);");

  // The old markdown pricing editor is gone from this screen. Keeping it is
  // what let removed sentences be written back on the next save.
  expect(newPage).not.toContain("EditableEstimateBody");
  expect(newPage).not.toContain("formatEstimateForDisplay");
});

// 8. Legacy classification is unchanged ---------------------------------

test("legacy and inbound-quote classification still read exactly as they did", () => {
  const page = code("app/estimates/[id]/page.tsx");

  expect(page).toContain(
    'const isQuoteRequest = estimate.status === "needs_review" && estimate.source === "website_quote";'
  );
  expect(page).toContain('const isContractorPricing = estimate.pricing_source === "contractor_pricing";');
  // Everything that is not contractor_pricing keeps the editor it has today,
  // including the old AI-priced 'structured' estimates.
  expect(page).toContain('structuredPricing={estimate.pricing_source === "structured"}');
  expect(page).toContain("<EstimatePricingEditor");
});

test("nothing in this slice changes the pricing_source default a website quote relies on", () => {
  const generate = code("app/api/generate-estimate/route.ts");
  const actions = code("app/components/estimate-actions.tsx");
  const quoteTemplates = code("lib/quote-templates.ts");

  // Only the generated-estimate insert names contractor_pricing. The inbound
  // website-quote path still omits pricing_source entirely, so it keeps the
  // markdown default and stays unpriced intake, which is section 15's work
  // and not this slice's.
  expect(generate).not.toContain('source: "website_quote"');
  expect(actions).not.toContain("pricing_source");
  expect(quoteTemplates).not.toContain("contractor_pricing");
});

// 10. The new normal: a generated estimate starts unpriced ---------------

test("a newly generated contractor_pricing estimate has no pricing rows and is incomplete", () => {
  const insert = insertFor();

  const pricing = calculateContractorPricing([], {
    taxRatePercent: insert.tax_rate_snapshot as number,
    depositPercent: insert.deposit_percent_snapshot as number,
    depositThresholdDollars: insert.deposit_threshold_snapshot as number,
  });

  expect(pricing.complete).toBe(false);
  expect(pricing.missing.sort()).toEqual(["labour-missing", "materials-missing"]);
  expect(pricing.subtotalCents).toBe(0);
  expect(pricing.totalCents).toBe(0);
  expect(pricing.depositCents).toBe(0);

  // The tax snapshot is present from creation, so "tax-snapshot-missing" is
  // never one of the reasons a freshly generated estimate is incomplete.
  expect(pricing.missing).not.toContain("tax-snapshot-missing");
});
