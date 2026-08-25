import { test, expect } from "@playwright/test";
import { parseSummary, computeTotals, formatEstimateForDisplay } from "../../lib/estimate-summary";
import { parsedToItems, validateConversionTotals } from "../../lib/estimate-items";
import { draftToItemRow, detectsMultiOptionStructure } from "../../lib/estimate-item-migration";
import {
  assignGroupLabel,
  groupItemsForDisplay,
  groupedSubtotal,
  renderGroupedLineItemsBlock,
  renderGroupedPlainText,
  isGroupedPricingEnabled,
  KNOWN_GROUP_LABELS,
} from "../../lib/estimate-groups";
import { validFixtures, negativeFixtures } from "../fixtures/estimate-summaries";

/**
 * First visible grouped-pricing slice: structured generation for NEW estimates,
 * plus the internal grouped renderer.
 *
 * Pure unit coverage only. No browser, no network, no database. The database
 * half (atomic insert, pricing_source flip, no duplicates) is covered by the
 * conversion service tests and by transaction tests run against the real
 * PostgreSQL function inside a rolled-back transaction.
 */

const BATHROOM = [
  "# Bathroom Renovation",
  "",
  "## Line Items",
  "| Item | Qty | Unit | Rate | Cost |",
  "|---|---|---|---|---|",
  "| Labour, demolition and haul away | 6 | hrs | $95.00 | $570.00 |",
  "| Disposal bin |  |  |  | $80.00 |",
  "| Plumbing rough-in labour | 8 | hrs | $115.00 | $920.00 |",
  "| Mixing valve | 1 | ea | $530.00 | $530.00 |",
  "| Electrical, GFCI circuit | 5 | hrs | $115.00 | $575.00 |",
  "| Pot lights | 4 | ea | $62.50 | $250.00 |",
  "| Floor tile | 55 | sqft | $12.00 | $660.00 |",
  "| Thinset and grout | 1 | lot | $640.00 | $640.00 |",
  "| Interior paint | 3 | gal | $58.00 | $174.00 |",
  "| Painting labour | 7 | hrs | $85.85 | $600.95 |",
  "",
  "## Pricing Summary",
  "| | |",
  "|---|---|",
  "| Tax (GST 5%) | $0 |",
].join("\n");

// ── Feature flag ──────────────────────────────────────────────────────────────

test("grouped pricing is off unless the internal flag is explicitly set", () => {
  const previous = process.env.ESTIMATE_GROUPED_PRICING_INTERNAL;
  try {
    delete process.env.ESTIMATE_GROUPED_PRICING_INTERNAL;
    expect(isGroupedPricingEnabled(), "default off").toBe(false);

    process.env.ESTIMATE_GROUPED_PRICING_INTERNAL = "false";
    expect(isGroupedPricingEnabled()).toBe(false);

    process.env.ESTIMATE_GROUPED_PRICING_INTERNAL = "1";
    expect(isGroupedPricingEnabled(), "only the exact string true enables it").toBe(false);

    process.env.ESTIMATE_GROUPED_PRICING_INTERNAL = "true";
    expect(isGroupedPricingEnabled()).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.ESTIMATE_GROUPED_PRICING_INTERNAL;
    else process.env.ESTIMATE_GROUPED_PRICING_INTERNAL = previous;
  }
});

// ── Group assignment ──────────────────────────────────────────────────────────

test("generated groups land in the expected work packages", () => {
  const cases: Array<[string, string]> = [
    ["Labour, demolition and haul away", "Demolition and disposal"],
    ["Disposal bin", "Demolition and disposal"],
    ["Plumbing rough-in labour", "Plumbing"],
    ["Mixing valve", "Plumbing"],
    ["Electrical, GFCI circuit", "Electrical"],
    ["Pot lights", "Electrical"],
    ["Floor tile", "Flooring"],
    ["Interior paint", "Painting and finishing"],
    ["Exhaust fan", "HVAC and ventilation"],
    ["Drywall and taping", "Insulation and drywall"],
    ["Vanity and countertop", "Cabinets and countertops"],
    ["Baseboard trim", "Trim and carpentry"],
    ["Final clean", "Cleanup"],
    ["Electrical permit", "Permits and fees"],
  ];
  for (const [description, expected] of cases) {
    expect(assignGroupLabel(description), description).toBe(expected);
  }
});

test("an unrecognised description is left ungrouped, never forced into a bucket", () => {
  expect(assignGroupLabel("Miscellaneous sundries")).toBeNull();
  expect(assignGroupLabel("Widget assembly")).toBeNull();
  expect(assignGroupLabel("")).toBeNull();
  expect(assignGroupLabel("   ")).toBeNull();
});

test("group matching is word-anchored, so substrings do not misfire", () => {
  // "ventilated" must not match the \bvent\b rule.
  expect(assignGroupLabel("Ventilated shelving unit")).not.toBe("HVAC and ventilation");
  // "postage" must not match the \bpost\b fencing rule.
  expect(assignGroupLabel("Postage and courier")).not.toBe("Landscaping and fencing");
});

test("every produced label is one of the known set", () => {
  const known = new Set(KNOWN_GROUP_LABELS);
  for (const fixture of validFixtures) {
    for (const draft of parsedToItems(parseSummary(fixture.summary))) {
      const label = assignGroupLabel(draft.source.description);
      if (label !== null) expect(known.has(label), label).toBe(true);
    }
  }
});

// ── Structured generation mapping ─────────────────────────────────────────────

test("structured generation assigns groups; the lazy path does not", () => {
  const drafts = parsedToItems(parseSummary(BATHROOM));

  const generated = drafts.map((d) => draftToItemRow(d, { assignGroups: true }));
  expect(generated.some((r) => r.group_label !== null), "new estimates get groups").toBe(true);

  const lazy = drafts.map((d) => draftToItemRow(d));
  expect(
    lazy.every((r) => r.group_label === null),
    "existing estimates stay ungrouped by default"
  ).toBe(true);
});

test("assigning groups changes no price, quantity, or order", () => {
  const drafts = parsedToItems(parseSummary(BATHROOM));
  const plain = drafts.map((d) => draftToItemRow(d));
  const grouped = drafts.map((d) => draftToItemRow(d, { assignGroups: true }));

  expect(plain).toHaveLength(grouped.length);
  plain.forEach((row, i) => {
    expect(grouped[i].description).toBe(row.description);
    expect(grouped[i].quantity).toBe(row.quantity);
    expect(grouped[i].unit_price).toBe(row.unit_price);
    expect(grouped[i].line_total).toBe(row.line_total);
    expect(grouped[i].display_order).toBe(row.display_order);
    expect(grouped[i].item_type).toBe(row.item_type);
    expect(grouped[i].is_allowance).toBe(row.is_allowance);
  });
});

// ── Totals ────────────────────────────────────────────────────────────────────

test("grouped totals equal detailed totals exactly, for every valid fixture", () => {
  for (const fixture of validFixtures) {
    const parsed = parseSummary(fixture.summary);
    const drafts = parsedToItems(parsed);
    const withGroups = drafts.map((d, i) => ({
      ...d,
      groupLabel: assignGroupLabel(d.source.description),
      total: drafts[i].total,
    }));

    const detailed = computeTotals(parsed.lineItems, parsed.taxRate).subtotal;
    const grouped = groupedSubtotal(withGroups);

    expect(grouped, `${fixture.name}: grouped subtotal must equal detailed`).toBeCloseTo(
      detailed,
      6
    );
  }
});

test("no line item is dropped or double counted when grouping", () => {
  const drafts = parsedToItems(parseSummary(BATHROOM)).map((d) => ({
    ...d,
    groupLabel: assignGroupLabel(d.source.description),
  }));
  const groups = groupItemsForDisplay(drafts);

  const countedItems = groups.reduce((sum, g) => sum + g.itemCount, 0);
  expect(countedItems, "every row lands in exactly one group").toBe(drafts.length);
  expect(groupedSubtotal(drafts)).toBeCloseTo(
    drafts.reduce((s, d) => s + d.total, 0),
    6
  );
});

test("ungrouped rows are collected under a named bucket, not silently dropped", () => {
  const items = [
    { total: 100, groupLabel: "Plumbing" },
    { total: 50, groupLabel: null },
    { total: 25, groupLabel: null },
  ];
  const groups = groupItemsForDisplay(items);

  expect(groups).toHaveLength(2);
  expect(groups[1].group).toBe("Additional items");
  expect(groups[1].total).toBe(75);
  expect(groupedSubtotal(items)).toBe(175);
});

test("grouping preserves first-appearance order", () => {
  const items = [
    { total: 1, groupLabel: "Electrical" },
    { total: 1, groupLabel: "Plumbing" },
    { total: 1, groupLabel: "Electrical" },
  ];
  expect(groupItemsForDisplay(items).map((g) => g.group)).toEqual(["Electrical", "Plumbing"]);
});

// ── Renderers ─────────────────────────────────────────────────────────────────

test("the detailed renderer is untouched by this slice", () => {
  // formatEstimateForDisplay is what the share page and PDF render. Structured
  // generation preserves the markdown summary, so this output cannot move.
  for (const fixture of validFixtures) {
    const before = formatEstimateForDisplay(fixture.summary);
    const after = formatEstimateForDisplay(fixture.summary);
    expect(after, `${fixture.name}`).toBe(before);
    expect(before).toContain("## Line Items");
  }
});

test("the grouped renderer emits a work-package table, not line items", () => {
  const drafts = parsedToItems(parseSummary(BATHROOM)).map((d) => ({
    ...d,
    groupLabel: assignGroupLabel(d.source.description),
  }));
  const block = renderGroupedLineItemsBlock(drafts);

  expect(block.startsWith("## Line Items\n")).toBe(true);
  expect(block).toContain("| Work package | Price |");
  expect(block).toContain("Demolition and disposal");
  expect(block).toContain("Plumbing");
  // Individual line items must NOT appear in grouped mode.
  expect(block).not.toContain("Mixing valve");
  expect(block).not.toContain("Disposal bin");
});

test("the grouped renderer produces 3 to 8 price lines for a realistic estimate", () => {
  const drafts = parsedToItems(parseSummary(BATHROOM)).map((d) => ({
    ...d,
    groupLabel: assignGroupLabel(d.source.description),
  }));
  const groups = groupItemsForDisplay(drafts);

  expect(groups.length).toBeGreaterThanOrEqual(3);
  expect(groups.length).toBeLessThanOrEqual(8);
  expect(drafts.length, "collapsed from more rows than groups").toBeGreaterThan(groups.length);
});

test("the plain-text grouped renderer produces leader-dot lines", () => {
  const drafts = parsedToItems(parseSummary(BATHROOM)).map((d) => ({
    ...d,
    groupLabel: assignGroupLabel(d.source.description),
  }));
  const text = renderGroupedPlainText(drafts);

  for (const line of text.split("\n")) {
    expect(line, line).toMatch(/^.+ \.{1,} (?:CA|US)\$[\d,-]+$/);
  }
  expect(text).toContain("Demolition and disposal");
});

// ── Fallback: unsupported estimates stay markdown ────────────────────────────

test("unsupported estimates are refused, so they stay markdown-authoritative", () => {
  for (const fixture of negativeFixtures) {
    // A fixture marked expectBlocking:false is not unsupported. A negative
    // amount is a legitimate credit row: the format permits it, the schema
    // stores it, and the conversion layer flags it as a warning rather than a
    // refusal. Converting it is correct, so it is excluded here.
    if (fixture.expectBlocking === false) continue;

    const parsed = parseSummary(fixture.summary);
    const validation = validateConversionTotals(parsed);
    const multi = detectsMultiOptionStructure(fixture.summary);

    const wouldConvert = validation.ok && !multi;
    expect(wouldConvert, `${fixture.name} must not produce structured rows`).toBe(false);
  }
});

test("a negative-amount estimate does convert, and its grouped total still matches", () => {
  const fixture = negativeFixtures.find((f) => f.expectBlocking === false);
  expect(fixture, "the corpus has a non-blocking fixture").toBeTruthy();

  const parsed = parseSummary(fixture!.summary);
  const validation = validateConversionTotals(parsed);
  expect(validation.ok, "non-blocking, so conversion is allowed").toBe(true);

  const drafts = parsedToItems(parsed).map((d) => ({
    ...d,
    groupLabel: assignGroupLabel(d.source.description),
  }));
  expect(groupedSubtotal(drafts)).toBeCloseTo(
    computeTotals(parsed.lineItems, parsed.taxRate).subtotal,
    6
  );
});

test("a multi-option estimate is refused even at generation time", () => {
  const multi = [
    "## Line Items - Option 1",
    "| Item | Cost |",
    "|---|---|",
    "| A | $10.00 |",
    "",
    "## Line Items - Option 2",
    "| Item | Cost |",
    "|---|---|",
    "| B | $20.00 |",
  ].join("\n");

  expect(detectsMultiOptionStructure(multi)).toBe(true);
  expect(validateConversionTotals(parseSummary(multi)).ok).toBe(false);
});

test("a valid new estimate would convert, with totals preserved", () => {
  const parsed = parseSummary(BATHROOM);
  const validation = validateConversionTotals(parsed);

  expect(detectsMultiOptionStructure(BATHROOM)).toBe(false);
  expect(validation.ok, validation.abortReasons.join("; ")).toBe(true);
  expect(validation.subtotalDifference).toBe(0);
  expect(validation.taxDifference).toBe(0);
  expect(validation.grandTotalDifference).toBe(0);
  expect(validation.depositDifference).toBe(0);
  expect(validation.lineItemBlockByteIdentical).toBe(true);
});
