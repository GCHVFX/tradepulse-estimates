import { test, expect } from "@playwright/test";
import { matchTemplate, buildDraftSummary } from "../../lib/quote-templates";

/**
 * The one hard-coded estimate-content word in the website-quote-to-draft
 * templates ("Repair or replacement labour", in the water heater template)
 * must follow the same currency-derived spelling as everywhere else, not
 * stay hard-coded to Canadian English.
 */
test("the water heater template's labour/labor line follows the estimate's currency", () => {
  const template = matchTemplate("no hot water, tank is leaking");
  expect(template.title).toBe("Water heater service estimate");

  const cadSummary = buildDraftSummary(template, "no hot water", undefined, "GST", 5, undefined, "cad");
  expect(cadSummary).toContain("Repair or replacement labour");
  expect(cadSummary).not.toContain("Repair or replacement labor");

  const usdSummary = buildDraftSummary(template, "no hot water", undefined, "GST", 5, undefined, "usd");
  expect(usdSummary).toContain("Repair or replacement labor");
  expect(usdSummary).not.toContain("Repair or replacement labour");
});

test("currency defaults to cad when omitted, preserving prior behaviour", () => {
  const template = matchTemplate("no hot water");
  const summary = buildDraftSummary(template, "no hot water");
  expect(summary).toContain("Repair or replacement labour");
});

test("templates with no 'labour' wording are byte-identical across currencies -- pricing is untouched", () => {
  const template = matchTemplate("toilet needs replacing");
  const cad = buildDraftSummary(template, "toilet needs replacing", undefined, "GST", 5, undefined, "cad");
  const usd = buildDraftSummary(template, "toilet needs replacing", undefined, "GST", 5, undefined, "usd");
  expect(cad).toBe(usd);
});
