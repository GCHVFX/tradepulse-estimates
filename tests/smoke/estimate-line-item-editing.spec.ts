import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseSummary, serializeSummary } from "../../lib/estimate-summary";

const root = path.resolve(__dirname, "../..");

test("an edited estimate copy keeps its changed description and price", () => {
  const summary = "## Line Items\n\n| Item | Cost |\n| --- | ---: |\n| 200A panel and breaker package | $1,650.00 |";
  const parsed = parseSummary(summary);
  parsed.lineItems[0].label = "200A panel and 40-space breaker package";
  parsed.lineItems[0].cost = "$1,750.00";

  const saved = parseSummary(
    serializeSummary(parsed.preamble, parsed.scopeItems, parsed.lineItems, parsed.depositPercent, parsed.beforePricingSections, parsed.afterPricingSections, parsed.taxLabel, parsed.taxRate, "cad")
  );
  expect(saved.lineItems[0].label).toBe("200A panel and 40-space breaker package");
  expect(saved.lineItems[0].cost).toContain("1,750");
});

test("structured estimate edits use estimate-item storage and do not update the price book", () => {
  const editor = readFileSync(path.join(root, "app/components/editable-estimate-body.tsx"), "utf8");
  const estimateRoute = readFileSync(path.join(root, "app/api/estimates/route.ts"), "utf8");
  const pricingServer = readFileSync(path.join(root, "lib/estimate-pricing-server.ts"), "utf8");

  expect(editor).toContain("structured_items: structuredItems");
  expect(editor).toContain("description: item.label");
  expect(estimateRoute).toContain('.from("tpe_estimate_items")');
  expect(estimateRoute).toContain("description: item.description");
  expect(estimateRoute).toContain("unit_price: item.unit_price");
  expect(estimateRoute).not.toContain("tpe_pricebook_items");
  expect(pricingServer).toContain("loadStructuredPricingItems");
});
