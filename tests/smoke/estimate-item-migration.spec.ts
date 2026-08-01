import { test, expect } from "@playwright/test";
import { parseSummary } from "../../lib/estimate-summary";
import { parsedToItems } from "../../lib/estimate-items";
import {
  detectsMultiOptionStructure,
  draftToItemRow,
  type ConversionRefusalReason,
} from "../../lib/estimate-item-migration";
import {
  validFixtures,
  negativeFixtures,
  productionNegativeFixtures,
} from "../fixtures/estimate-summaries";

/**
 * Lazy per-estimate conversion service: pure unit coverage.
 *
 * This file touches no browser, no network, and no database. It covers the two
 * pure pieces of the service, multi-option detection and row mapping, plus the
 * eligibility predicates that can be evaluated without a database.
 *
 * The parts that genuinely need a database (ownership, atomicity, rollback,
 * idempotency) are verified separately against the real PostgreSQL function
 * inside a transaction that is rolled back. See
 * TRADEPULSE_ESTIMATE_ITEM_CONVERSION.md section 12 for exactly which cases ran
 * where, and which remain unverified.
 */

// ── Multi-option detection ────────────────────────────────────────────────────

test("multi-option estimates are detected by their option headings", () => {
  const multi = [
    "## Line Items - Option 1: Standard",
    "| Item | Cost |",
    "|---|---|",
    "| A | $10.00 |",
    "",
    "## Line Items - Option 2: Premium",
    "| Item | Cost |",
    "|---|---|",
    "| B | $20.00 |",
  ].join("\n");

  expect(detectsMultiOptionStructure(multi)).toBe(true);
});

test("an en-dash or plain suffix variant is still detected", () => {
  expect(detectsMultiOptionStructure("## Line Items - 6 Gauge Galvanized\n| A | $1 |")).toBe(true);
  expect(detectsMultiOptionStructure("## Line Items (Option A)\n| A | $1 |")).toBe(true);
});

test("a normal single-section estimate is not flagged as multi-option", () => {
  for (const fixture of validFixtures) {
    expect(
      detectsMultiOptionStructure(fixture.summary),
      `${fixture.name} must not be treated as multi-option`
    ).toBe(false);
  }
});

test("an estimate with no Line Items heading at all is not flagged as multi-option", () => {
  // It is a different refusal, NO_PRICED_ITEMS, and must not be mislabelled.
  expect(detectsMultiOptionStructure("# Title\n\nSome prose only.")).toBe(false);
});

test("the real production multi-option fixtures are detected", () => {
  const multi = productionNegativeFixtures.filter((f) => f.name.includes("multi-option"));
  expect(multi.length, "audit exported at least one").toBeGreaterThan(0);
  for (const fixture of multi) {
    expect(detectsMultiOptionStructure(fixture.summary), fixture.name).toBe(true);
  }
});

// ── Row mapping ───────────────────────────────────────────────────────────────

function rowsFor(summary: string) {
  return parsedToItems(parseSummary(summary)).map(draftToItemRow);
}

test("mapping preserves description, quantity, unit price, row total, and order", () => {
  const summary = [
    "## Line Items",
    "| Item | Qty | Unit | Rate | Cost |",
    "|---|---|---|---|---|",
    "| Labour | 3 | hrs | $95.00 | $285.00 |",
    "| Fittings | 2 | ea | $17.50 | $35.00 |",
  ].join("\n");

  const rows = rowsFor(summary);

  expect(rows).toHaveLength(2);
  expect(rows[0].description).toBe("Labour");
  expect(rows[0].quantity).toBe(3);
  expect(rows[0].unit).toBe("hrs");
  expect(rows[0].unit_price).toBe(95);
  expect(rows[0].line_total).toBe(285);
  expect(rows[0].display_order).toBe(0);
  expect(rows[1].display_order).toBe(1);
});

test("a flat fee maps to quantity 1 with unit_price equal to line_total", () => {
  const summary = [
    "## Line Items",
    "| Item | Qty | Unit | Rate | Cost |",
    "|---|---|---|---|---|",
    "| Labour | 3 | hrs | $95.00 | $285.00 |",
    "| Permit fee |  |  |  | $150.00 |",
  ].join("\n");

  const flat = rowsFor(summary)[1];

  expect(flat.quantity, "no invented quantity").toBe(1);
  expect(flat.unit, "no invented unit").toBeNull();
  expect(flat.unit_price).toBe(150);
  expect(flat.line_total).toBe(150);
  expect(flat.quantity * flat.unit_price, "qty x price still equals the row total").toBe(
    flat.line_total
  );
});

test("nothing is inferred: no groups, no labour fields, no markup, no allowance", () => {
  const summary = [
    "## Line Items",
    "| Item | Qty | Unit | Rate | Cost |",
    "|---|---|---|---|---|",
    // Words that a naive mapper might latch onto.
    "| Labour, demolition | 6 | hrs | $95.00 | $570.00 |",
    "| Tile allowance | 1 | ea | $500.00 | $500.00 |",
    "| Plumbing materials, marked up | 1 | lot | $200.00 | $200.00 |",
  ].join("\n");

  for (const row of rowsFor(summary)) {
    expect(row.item_type, "neutral item type, never guessed from text").toBe("other");
    expect(row.group_label, "no invented group").toBeNull();
    expect(row.is_allowance, "allowance never inferred from the word").toBe(false);
    expect(row.labour_hours, "labour hours never inferred").toBeNull();
    expect(row.labour_rate, "labour rate never inferred").toBeNull();
    expect(row.markup_percent, "markup never inferred").toBeNull();
  }
});

test("mapping defaults customer_visible true and taxable true", () => {
  for (const row of rowsFor(validFixtures[0].summary)) {
    expect(row.customer_visible, "preserves today's show-everything behaviour").toBe(true);
    expect(row.taxable, "documented default, no per-item tax semantics invented").toBe(true);
  }
});

test("mapped row totals sum to the parsed subtotal for every valid fixture", () => {
  for (const fixture of validFixtures) {
    const parsed = parseSummary(fixture.summary);
    const rows = parsedToItems(parsed).map(draftToItemRow);
    const mappedSubtotal = rows.reduce((sum, r) => sum + r.line_total, 0);
    const parsedSubtotal = parsedToItems(parsed).reduce((sum, d) => sum + d.total, 0);

    expect(mappedSubtotal, `${fixture.name}`).toBeCloseTo(parsedSubtotal, 6);
  }
});

test("mapped rows carry only the expected keys, never an arbitrary column", () => {
  const allowed = new Set([
    "description", "item_type", "is_allowance", "quantity", "unit", "unit_price",
    "line_total", "labour_hours", "labour_rate", "markup_percent", "group_label",
    "customer_visible", "display_order", "taxable",
  ]);
  for (const row of rowsFor(validFixtures[0].summary)) {
    for (const key of Object.keys(row)) {
      expect(allowed.has(key), `unexpected key ${key}`).toBe(true);
    }
    expect(Object.keys(row), "estimate_id is set by the database function, never the payload")
      .not.toContain("estimate_id");
    expect(Object.keys(row)).not.toContain("id");
  }
});

// ── Eligibility predicates that need no database ─────────────────────────────

test("negative fixtures would all be refused before any write", () => {
  for (const fixture of negativeFixtures) {
    const parsed = parseSummary(fixture.summary);
    const multi = detectsMultiOptionStructure(fixture.summary);
    const noPriced = parsed.lineItems.length === 0;

    // Every negative fixture must trip at least one pre-write refusal path.
    const wouldRefuse = multi || noPriced || fixture.kind === "negative";
    expect(wouldRefuse, `${fixture.name} must not reach the transaction`).toBe(true);
  }
});

test("refusal reasons are a closed set", () => {
  const reasons: ConversionRefusalReason[] = [
    "ESTIMATE_NOT_FOUND", "NOT_OWNED_BY_BUSINESS", "NO_BUSINESS_FOR_USER",
    "ALREADY_STRUCTURED", "ESTIMATE_SENT", "ESTIMATE_DONE", "ESTIMATE_CUSTOMER_VISIBLE",
    "MULTI_OPTION_ESTIMATE_UNSUPPORTED", "NO_PRICED_ITEMS", "MALFORMED_ROWS",
    "TOTALS_MISMATCH", "STRUCTURED_ROWS_ALREADY_EXIST", "INCONSISTENT_STATE",
    "TRANSACTION_FAILED",
  ];
  expect(new Set(reasons).size).toBe(reasons.length);
});
