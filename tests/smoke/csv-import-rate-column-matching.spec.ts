import { test, expect } from "@playwright/test";
import { normalizeHeader, matchColumns } from "../../lib/csv-column-match";

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
