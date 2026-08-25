import { test, expect } from "@playwright/test";
import {
  parseSummary,
  computeTotals,
  lineItemsBlock,
} from "../../lib/estimate-summary";
import {
  parsedToItems,
  draftToLineItem,
  itemsToLineItemsBlock,
  calculateItemTotal,
  calculateItemsSubtotal,
  validateConversionTotals,
  assertConversionSafe,
  findMalformedRows,
  isReservedTotalLabel,
  groupItems,
  EstimateConversionError,
} from "../../lib/estimate-items";
import {
  validFixtures,
  negativeFixtures,
  allFixtures,
  syntheticValidFixtures,
  syntheticNegativeFixtures,
  productionFixtures,
  productionValidFixtures,
  productionNegativeFixtures,
} from "../fixtures/estimate-summaries";

/**
 * Slice 2 of the grouped-pricing architecture: the pure conversion layer.
 *
 * These tests touch no browser, no network, and no database. They import pure
 * functions only. Nothing here signs up an account, calls Anthropic, Stripe,
 * Twilio, or Resend, or reads production data.
 *
 * The invariant under test: existing estimate content converts into structured
 * line items and renders back without changing totals, line-item meaning,
 * ordering, or customer-visible output.
 *
 * COMPARISON KINDS, stated explicitly because the two are not interchangeable:
 *
 *   BYTE-IDENTICAL: `itemsToLineItemsBlock(parsedToItems(parsed), "cad")` must equal
 *   `lineItemsBlock(parsed.lineItems, "cad")` exactly, character for character. The
 *   architecture document requires the round trip to stay compatible with the
 *   current authoritative formatter, so this one is strict.
 *
 *   SEMANTIC: full-document markdown is NOT compared byte for byte. The current
 *   serializer legitimately normalises formatting, and it drops the H1 title on
 *   the first save. Requiring byte equality on the whole document would assert
 *   a property the shipped code does not have. Totals, row count, descriptions,
 *   quantities, prices, and order are compared instead.
 */

// ── Parsing ───────────────────────────────────────────────────────────────────

test("parsedToItems produces one draft per priced row, in table order", () => {
  const parsed = parseSummary(validFixtures[0].summary);
  const items = parsedToItems(parsed);

  expect(items).toHaveLength(parsed.lineItems.length);
  items.forEach((item, i) => {
    expect(item.sortOrder, "sortOrder is the ordering contract").toBe(i);
    expect(item.source.description).toBe(parsed.lineItems[i].label);
  });
});

test("parsedToItems separates parsed source text from calculated numbers", () => {
  const parsed = parseSummary(
    ["## Line Items", "| Item | Qty | Unit | Rate | Cost |", "|---|---|---|---|---|", "| Labour | 3 | hrs | $95.00 | $285.00 |"].join("\n")
  );
  const [item] = parsedToItems(parsed);

  expect(item.kind).toBe("quantity");
  expect(item.source.quantityText, "raw text preserved verbatim").toBe("3");
  expect(item.source.unitText).toBe("hrs");
  expect(item.source.unitCostText).toBe("$95.00");
  expect(item.quantity, "calculated").toBe(3);
  expect(item.unitCost, "calculated").toBe(95);
  expect(item.total, "calculated").toBe(285);
});

test("flat fees carry null quantity and unit cost, never a fabricated 1", () => {
  const parsed = parseSummary(
    ["## Line Items", "| Item | Qty | Unit | Rate | Cost |", "|---|---|---|---|---|", "| Labour | 3 | hrs | $95.00 | $285.00 |", "| Permit fee |  |  |  | $150.00 |"].join("\n")
  );
  const flat = parsedToItems(parsed)[1];

  expect(flat.kind).toBe("flat");
  expect(flat.quantity).toBeNull();
  expect(flat.unitCost).toBeNull();
  expect(flat.source.quantityText).toBeNull();
  expect(flat.total).toBe(150);
});

test("groupLabel is a neutral null everywhere, never an invented category", () => {
  for (const fixture of validFixtures) {
    const items = parsedToItems(parseSummary(fixture.summary));
    for (const item of items) {
      expect(item.groupLabel, `${fixture.name} must not invent a group`).toBeNull();
    }
  }
});

test("temp identifiers are not stable across separate parses", () => {
  const summary = validFixtures[0].summary;
  const first = parsedToItems(parseSummary(summary));
  const second = parsedToItems(parseSummary(summary));

  expect(first.map((i) => i.tempId)).not.toEqual(second.map((i) => i.tempId));
  expect(first.map((i) => i.sortOrder), "ordering IS stable").toEqual(
    second.map((i) => i.sortOrder)
  );
});

test("legacy two-column rows convert as flat fees", () => {
  const fixture = validFixtures.find((f) => f.name === "23-legacy-two-column")!;
  const items = parsedToItems(parseSummary(fixture.summary));

  expect(items).toHaveLength(3);
  expect(items.every((i) => i.kind === "flat")).toBe(true);
});

// ── Rendering ─────────────────────────────────────────────────────────────────

test("itemsToLineItemsBlock emits the current five-column table unchanged", () => {
  const parsed = parseSummary(validFixtures[0].summary);
  const block = itemsToLineItemsBlock(parsedToItems(parsed), "cad");

  expect(block.startsWith("## Line Items\n")).toBe(true);
  expect(block).toContain("| Item | Qty | Unit | Rate | Cost |");
  expect(block).toContain("|------|-----|------|------|------|");
});

test("rendered block adds no totals rows and no metadata", () => {
  for (const fixture of validFixtures) {
    const parsed = parseSummary(fixture.summary);
    const block = itemsToLineItemsBlock(parsedToItems(parsed), "cad");
    const body = block.split("\n").slice(1).join("\n");

    expect(body, `${fixture.name}: no subtotal row`).not.toMatch(/^\|\s*\**\s*Subtotal/im);
    expect(body, `${fixture.name}: no tax row`).not.toMatch(/^\|\s*\**\s*Tax\b/im);
    expect(body, `${fixture.name}: no total row`).not.toMatch(/^\|\s*\**\s*Total\b/im);
    expect(body, `${fixture.name}: no deposit row`).not.toMatch(/^\|\s*\**\s*Deposit/im);
    expect(body, `${fixture.name}: no group column`).not.toContain("Group");
    expect(body, `${fixture.name}: no HTML comment`).not.toContain("<!--");
    expect(body, `${fixture.name}: no JSON blob`).not.toContain("{\"");
    expect(body, `${fixture.name}: no extra heading`).not.toMatch(/^##/m);
    expect(body, `${fixture.name}: no identifiers leaked`).not.toContain("draft-");
  }
});

test("a table of only flat fees renders as the legacy two-column form", () => {
  const fixture = validFixtures.find((f) => f.name === "03-materials-only")!;
  const block = itemsToLineItemsBlock(parsedToItems(parseSummary(fixture.summary)), "cad");

  expect(block).toContain("| Item | Cost |");
  expect(block).not.toContain("| Qty |");
});

// ── Round trip: BYTE-IDENTICAL line-item block ────────────────────────────────

test("BYTE-IDENTICAL: every valid fixture re-renders to the authoritative block", () => {
  for (const fixture of validFixtures) {
    const parsed = parseSummary(fixture.summary);
    const expected = lineItemsBlock(parsed.lineItems, "cad");
    const actual = itemsToLineItemsBlock(parsedToItems(parsed), "cad");

    expect(actual, `${fixture.name}: block must be byte-identical`).toBe(expected);
  }
});

test("draftToLineItem is the exact inverse of lineItemToDraft for rendering", () => {
  for (const fixture of validFixtures) {
    const parsed = parseSummary(fixture.summary);
    const rebuilt = parsedToItems(parsed).map(draftToLineItem);

    expect(lineItemsBlock(rebuilt, "cad"), `${fixture.name}`).toBe(lineItemsBlock(parsed.lineItems, "cad"));
  }
});

// ── Round trip: SEMANTIC document comparison ──────────────────────────────────

test("SEMANTIC: reparsing the rendered block preserves rows, descriptions, and amounts", () => {
  for (const fixture of validFixtures) {
    const parsed = parseSummary(fixture.summary);
    const block = itemsToLineItemsBlock(parsedToItems(parsed), "cad");
    const reparsed = parseSummary(block);

    expect(reparsed.lineItems, `${fixture.name}: row count`).toHaveLength(parsed.lineItems.length);
    reparsed.lineItems.forEach((item, i) => {
      expect(item.label, `${fixture.name} row ${i}: description`).toBe(parsed.lineItems[i].label);
    });
    expect(
      computeTotals(reparsed.lineItems, parsed.taxRate).subtotal,
      `${fixture.name}: subtotal survives a reparse`
    ).toBe(computeTotals(parsed.lineItems, parsed.taxRate).subtotal);
  }
});

// ── Totals invariant ──────────────────────────────────────────────────────────

test("TOTALS INVARIANT: subtotal, tax, grand total, and deposit are preserved", () => {
  for (const fixture of validFixtures) {
    const v = validateConversionTotals(parseSummary(fixture.summary), "cad");

    expect(v.subtotalDifference, `${fixture.name}: subtotal`).toBe(0);
    expect(v.taxDifference, `${fixture.name}: tax`).toBe(0);
    expect(v.grandTotalDifference, `${fixture.name}: grand total`).toBe(0);
    expect(v.depositDifference, `${fixture.name}: deposit`).toBe(0);
    expect(v.itemCount, `${fixture.name}: row count`).toBe(v.originalRowCount);
    expect(v.lineItemBlockByteIdentical, `${fixture.name}: byte identity`).toBe(true);
    expect(v.ok, `${fixture.name}: aborts ${v.abortReasons.join("; ")}`).toBe(true);
  }
});

test("declared per-fixture totals match", () => {
  for (const fixture of validFixtures) {
    if (!fixture.expect) continue;
    const v = validateConversionTotals(parseSummary(fixture.summary), "cad");
    if (fixture.expect.itemCount !== undefined) expect(v.itemCount, fixture.name).toBe(fixture.expect.itemCount);
    if (fixture.expect.subtotal !== undefined) expect(v.originalSubtotal, fixture.name).toBe(fixture.expect.subtotal);
    if (fixture.expect.tax !== undefined) expect(v.originalTax, fixture.name).toBe(fixture.expect.tax);
    if (fixture.expect.grandTotal !== undefined) expect(v.originalGrandTotal, fixture.name).toBe(fixture.expect.grandTotal);
  }
});

test("calculateItemsSubtotal matches the shipped computeTotals subtotal", () => {
  for (const fixture of validFixtures) {
    const parsed = parseSummary(fixture.summary);
    const items = parsedToItems(parsed);
    expect(calculateItemsSubtotal(items), fixture.name).toBeCloseTo(
      computeTotals(parsed.lineItems, parsed.taxRate).subtotal,
      6
    );
  }
});

test("validation reports tax and deposit from the surrounding summary, not from items alone", () => {
  const fixture = validFixtures.find((f) => f.name === "10-deposit-percentage")!;
  const parsed = parseSummary(fixture.summary);
  const v = validateConversionTotals(parsed, "cad");

  expect(parsed.depositPercent, "deposit percent comes from the Pricing Summary section").toBe(30);
  expect(v.originalDepositAmount).toBeGreaterThan(0);
  expect(v.originalDepositAmount).toBe(v.convertedDepositAmount);
});

test("a fixed-amount deposit is not modelled by the current format", () => {
  // Recorded as a limitation, not a defect of this layer. parseSummary only
  // recovers a deposit percentage, so a dollar-only deposit reads as 0 percent.
  const fixture = validFixtures.find((f) => f.name === "11-deposit-fixed-amount-not-supported")!;
  const parsed = parseSummary(fixture.summary);

  expect(parsed.depositPercent).toBe(0);
  expect(validateConversionTotals(parsed, "cad").ok).toBe(true);
});

// ── Numeric handling ──────────────────────────────────────────────────────────

test("currency with commas and decimal quantities parse under the existing rules", () => {
  const parsed = parseSummary(
    ["## Line Items", "| Item | Qty | Unit | Rate | Cost |", "|---|---|---|---|---|", "| Labour | 2.5 | hrs | $1,234.50 | $3,086.25 |"].join("\n")
  );
  const [item] = parsedToItems(parsed);

  expect(item.quantity).toBe(2.5);
  expect(item.unitCost).toBe(1234.5);
  expect(item.total).toBe(3086.25);
});

test("a quantity row's explicit total is discarded in favour of quantity times rate", () => {
  // This is existing behaviour, applied upstream by parseSummary via
  // withComputedCost. The stated rule is: quantity times unit cost wins. This
  // layer preserves it and does not reintroduce the discarded figure.
  const parsed = parseSummary(
    ["## Line Items", "| Item | Qty | Unit | Rate | Cost |", "|---|---|---|---|---|", "| Labour | 3 | hrs | $95.00 | $999.99 |"].join("\n")
  );
  const [item] = parsedToItems(parsed);

  expect(item.total, "3 x 95, not the stated 999.99").toBe(285);
  expect(validateConversionTotals(parsed, "cad").ok).toBe(true);
});

test("tax rounds once on the whole subtotal, not per row", () => {
  const fixture = validFixtures.find((f) => f.name === "21-rounding-sensitive")!;
  const parsed = parseSummary(fixture.summary);
  const v = validateConversionTotals(parsed, "cad");

  expect(v.originalTax).toBe(Math.round(v.originalSubtotal * (parsed.taxRate / 100)));
  expect(v.taxDifference).toBe(0);
});

test("a zero-value line item is permitted and preserved", () => {
  const fixture = validFixtures.find((f) => f.name === "20-zero-value-line-item")!;
  const v = validateConversionTotals(parseSummary(fixture.summary), "cad");

  expect(v.ok).toBe(true);
  expect(v.itemCount).toBe(3);
});

// ── Known parser defect regressions ───────────────────────────────────────────

test("DEFECT 1: a stray Subtotal row is rejected, not absorbed as a priced item", () => {
  const raw = [
    "## Line Items",
    "| Item | Qty | Unit | Rate | Cost |",
    "|---|---|---|---|---|",
    "| Labour | 3 | hrs | $95.00 | $285.00 |",
    "| Subtotal |  |  |  | $285.00 |",
  ].join("\n");
  const parsed = parseSummary(raw);

  // The shipped parser still absorbs it and doubles the subtotal. That
  // production behaviour is deliberately unchanged by this slice.
  expect(computeTotals(parsed.lineItems, 0).subtotal, "existing parser double counts").toBe(570);

  // The conversion layer refuses it.
  const v = validateConversionTotals(parsed, "cad");
  expect(v.ok).toBe(false);
  expect(v.malformedRows.some((r) => r.reason === "reserved-total-row" && r.blocking)).toBe(true);
  expect(() => assertConversionSafe(parsed, "cad")).toThrow(EstimateConversionError);
});

test("DEFECT 1: reserved totals labels are recognised in their common spellings", () => {
  for (const label of ["Subtotal", "Sub-total", "TOTAL", "Tax (GST 5%)", "Deposit required (30%)", "Balance on completion", "**Total**", "GST", "Grand Total"]) {
    expect(isReservedTotalLabel(label), label).toBe(true);
  }
  for (const label of ["Labour", "Subfloor repair", "Total station rental", "Taxi to supplier", "Depositing gravel"]) {
    expect(isReservedTotalLabel(label), label).toBe(false);
  }
});

test("DEFECT 2: the round trip does not claim full-document byte preservation", () => {
  // parseSummary strips the H1 and serializeSummary never re-emits it, so the
  // stored title is lost on the first edit. This slice does not fix that and
  // must not pretend otherwise: only the line-item BLOCK is byte-stable.
  const fixture = validFixtures[0];
  expect(fixture.summary, "fixture has an H1").toContain("# Kitchen Tap Replacement");

  const parsed = parseSummary(fixture.summary);
  const block = itemsToLineItemsBlock(parsedToItems(parsed), "cad");

  expect(block, "the block carries no title").not.toContain("# Kitchen Tap Replacement");
  expect(block, "and IS byte-identical to the authoritative block").toBe(
    lineItemsBlock(parsed.lineItems, "cad")
  );
});

// ── Negative cases ────────────────────────────────────────────────────────────

test("every negative fixture produces its expected explicit finding", () => {
  for (const fixture of negativeFixtures) {
    const v = validateConversionTotals(parseSummary(fixture.summary), "cad");
    const findings = [
      ...v.abortReasons,
      ...v.malformedRows.map((r) => `${r.reason} ${r.detail}`),
      ...v.unsupportedStructures,
    ]
      .join(" | ")
      .toLowerCase();

    expect(findings, `${fixture.name}: expected ${fixture.expectFailureContaining}`).toContain(
      (fixture.expectFailureContaining ?? "").toLowerCase()
    );

    const shouldBlock = fixture.expectBlocking !== false;
    expect(v.ok, `${fixture.name}: blocking expectation`).toBe(!shouldBlock);
    if (shouldBlock) {
      expect(() => assertConversionSafe(parseSummary(fixture.summary), "cad")).toThrow(
        EstimateConversionError
      );
    }
  }
});

test("an empty estimate is refused rather than migrated as a no-op", () => {
  const v = validateConversionTotals(parseSummary("## Line Items\n\n## Pricing Summary\n"), "cad");
  expect(v.ok).toBe(false);
  expect(v.unsupportedStructures.join(" ")).toContain("no priced line items");
});

test("a non-finite value is caught", () => {
  const rows = findMalformedRows([
    {
      tempId: "t", sortOrder: 0, kind: "quantity",
      source: { description: "Bad", quantityText: "1e999", unitText: "ea", unitCostText: "1e999", amountText: "$1.00" },
      quantity: Infinity, unitCost: Infinity, total: Infinity, groupLabel: null,
    },
  ]);
  expect(rows.some((r) => r.reason === "non-finite-value" && r.blocking)).toBe(true);
});

test("the error carries the full validation for inspection", () => {
  const parsed = parseSummary(
    ["## Line Items", "| Item | Qty | Unit | Rate | Cost |", "|---|---|---|---|---|", "| Subtotal |  |  |  | $10.00 |"].join("\n")
  );
  try {
    assertConversionSafe(parsed, "cad");
    throw new Error("should have thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(EstimateConversionError);
    expect((err as EstimateConversionError).validation.malformedRows.length).toBeGreaterThan(0);
  }
});

// ── Corpus harness ────────────────────────────────────────────────────────────

test("the corpus is enumerable, so a real-data export can be added without rewriting tests", () => {
  expect(allFixtures.length).toBe(validFixtures.length + negativeFixtures.length);
  for (const fixture of allFixtures) {
    expect(fixture.name, "every fixture is named").toBeTruthy();
    expect(fixture.summary.length, `${fixture.name} has content`).toBeGreaterThan(0);
    expect(["valid", "negative"]).toContain(fixture.kind);
  }
});

// ── Sanitised production corpus ───────────────────────────────────────────────
//
// Added after the 2026-07-31 read-only production audit. These are real stored
// shapes, sanitised. See TRADEPULSE_ESTIMATE_FORMAT_AUDIT.md.

test("PRODUCTION: every expected-pass fixture preserves all totals", () => {
  expect(productionValidFixtures.length, "corpus is present").toBeGreaterThan(0);

  for (const fixture of productionValidFixtures) {
    const v = validateConversionTotals(parseSummary(fixture.summary), "cad");

    expect(v.subtotalDifference, `${fixture.name}: subtotal`).toBe(0);
    expect(v.taxDifference, `${fixture.name}: tax`).toBe(0);
    expect(v.grandTotalDifference, `${fixture.name}: grand total`).toBe(0);
    expect(v.depositDifference, `${fixture.name}: deposit`).toBe(0);
    expect(v.lineItemBlockByteIdentical, `${fixture.name}: byte identity`).toBe(true);
    expect(v.ok, `${fixture.name}: ${v.abortReasons.join("; ")}`).toBe(true);
  }
});

test("PRODUCTION: every expected-failure fixture fails for its recorded reason", () => {
  for (const fixture of productionNegativeFixtures) {
    const v = validateConversionTotals(parseSummary(fixture.summary), "cad");
    const findings = [
      ...v.abortReasons,
      ...v.malformedRows.map((r) => r.reason),
      ...v.unsupportedStructures,
    ]
      .join(" | ")
      .toLowerCase();

    expect(v.ok, `${fixture.name} must not silently pass`).toBe(false);
    expect(findings, `${fixture.name}`).toContain(
      (fixture.expectFailureContaining ?? "").toLowerCase()
    );
  }
});

test("PRODUCTION: multi-option estimates are refused, not silently migrated", () => {
  // Real finding: some generated estimates carry several "## Line Items -
  // Option N" headings instead of one bare "## Line Items". parseSummary()
  // matches the heading exactly, so it finds no priced rows and the estimate
  // totals zero. Those must never be auto-migrated. This is a pre-existing app
  // behaviour, recorded here, not changed by this slice.
  const multi = productionNegativeFixtures.filter((f) => f.name.includes("multi-option"));
  expect(multi.length, "the audit found at least one").toBeGreaterThan(0);

  for (const fixture of multi) {
    const parsed = parseSummary(fixture.summary);
    expect(parsed.lineItems, `${fixture.name}: parser finds no priced rows`).toHaveLength(0);
    expect(validateConversionTotals(parsed, "cad").ok).toBe(false);
    expect(() => assertConversionSafe(parsed, "cad")).toThrow(EstimateConversionError);
  }
});

test("PRODUCTION: fixtures carry no personal information or production identifiers", () => {
  for (const fixture of productionFixtures) {
    const text = fixture.summary;

    // Anything left that looks like contact detail is a sanitisation failure.
    const emails = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [];
    expect(emails.every((e) => e === "customer@example.test"), `${fixture.name}: emails`).toBe(true);

    const urls = text.match(/https?:\/\/\S+/g) ?? [];
    expect(urls.every((u) => u.startsWith("https://example.test")), `${fixture.name}: urls`).toBe(true);

    const phones = text.match(/\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/g) ?? [];
    expect(phones.every((p) => p === "604-555-0100"), `${fixture.name}: phones`).toBe(true);

    // No raw production UUID may appear anywhere.
    expect(text, `${fixture.name}: uuid`).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
    expect(fixture.name, `${fixture.name}: local id only`).toMatch(/^prod-\d{2}-/);
  }
});

test("the synthetic corpus is preserved alongside the production corpus", () => {
  expect(syntheticValidFixtures.length).toBe(24);
  expect(syntheticNegativeFixtures.length).toBe(13);
  expect(validFixtures.length).toBe(syntheticValidFixtures.length + productionValidFixtures.length);
});

test("groupItems keeps table order and keys ungrouped rows on null", () => {
  const items = parsedToItems(parseSummary(validFixtures[0].summary));
  const groups = groupItems(items);

  expect(groups.size).toBe(1);
  expect(groups.has(null)).toBe(true);
  expect(groups.get(null)!.map((i) => i.sortOrder)).toEqual([0, 1]);
});

test("calculateItemTotal agrees with the draft total on every fixture row", () => {
  for (const fixture of validFixtures) {
    for (const item of parsedToItems(parseSummary(fixture.summary))) {
      expect(calculateItemTotal(item), `${fixture.name} row ${item.sortOrder}`).toBe(item.total);
    }
  }
});
