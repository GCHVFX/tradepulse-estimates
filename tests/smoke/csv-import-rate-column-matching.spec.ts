import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { normalizeHeader, matchColumns } from "../../lib/csv-column-match";
import { findSingleHourlyLabourRate, isHourlyLabourRow } from "../../lib/csv-labour";

/**
 * Regression lock for a real production bug: a Rates CSV import with
 * headers "Unit" and "Rate (CAD)" imported 21 items with correct names
 * and categories but every price at $0.00. Root cause was normalizeHeader()
 * stripping non-alphanumerics BEFORE the trailing "(CAD)" was removed,
 * folding it into the token as "_cad" and silently preventing the match --
 * combined with no fallback other than defaulting the price to 0 when a
 * required column wasn't found.
 *
 * Deliberately pure-function only, no signUpFreshAccount()/live browser
 * account here (unlike new-circle-no-button-overlap.spec.ts's pattern) --
 * this project's local dev stack currently runs on a live-mode Stripe key
 * (see smoke-safety.ts: "A previous run leaked 19 live Stripe customers
 * this way"), and matchColumns()/normalizeHeader() are pure and fully
 * exercise the exact bug without needing a real account at all.
 */

test("normalizeHeader strips a trailing parenthetical before collapsing the rest", () => {
  expect(normalizeHeader("Rate (CAD)")).toBe("rate");
  expect(normalizeHeader("Price ($)")).toBe("price");
  expect(normalizeHeader("Unit Price")).toBe("unit_price");
});

test("matchColumns resolves Rate (CAD) and Unit, and reports Name/Rate complete", () => {
  const { columns, isComplete } = matchColumns(["Name", "Category", "Unit", "Rate (CAD)"]);
  expect(columns.name).toBe("Name");
  expect(columns.rate).toBe("Rate (CAD)");
  expect(columns.category).toBe("Category");
  expect(columns.unit).toBe("Unit");
  expect(isComplete).toBe(true);
});

test("matchColumns reports incomplete for a file with no recognizable headers", () => {
  const { isComplete } = matchColumns(["Foo", "Bar", "Baz"]);
  expect(isComplete).toBe(false);
});

test("one clear hourly labour row becomes the labour rate and leaves other items", () => {
  const rows = [
    { name: "Electrician labour", category: "Labour", unit: "hour", price: 125 },
    { name: "Copper wire", category: "Materials", unit: "each", price: 18 },
  ];
  const match = findSingleHourlyLabourRate(rows);
  expect(match).toEqual({ index: 0, rate: 125 });
  expect(rows.filter((_row, index) => index !== match?.index).map((row) => row.name)).toEqual(["Copper wire"]);
});

test("fixed labour-looking charges are not hourly labour rates", () => {
  expect(isHourlyLabourRow("Installation labour", "Labour", "job")).toBe(false);
  expect(findSingleHourlyLabourRate([
    { name: "Installation labour", category: "Labour", unit: "job", price: 450 },
  ])).toBeNull();
});

test("multiple hourly labour rows are preserved instead of selecting one", () => {
  expect(findSingleHourlyLabourRate([
    { name: "Electrician labour", category: "Labour", unit: "hr", price: 125 },
    { name: "Apprentice labour", category: "Labour", unit: "hours", price: 75 },
  ])).toBeNull();
});

test("Rates uses the corrected deposit threshold label and import wiring", () => {
  const source = readFileSync(path.resolve(__dirname, "../../app/components/price-book.tsx"), "utf8");
  expect(source).toContain("Deposit required over");
  expect(source).not.toContain("Minimum job amount");
  expect(source).toContain("setRates((current) => ({ ...current, labour_rate: importLabourRate }))");
});
