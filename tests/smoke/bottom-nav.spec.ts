import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { NEW_ESTIMATE_PATH } from "../../app/components/bottom-nav";

test("bottom navigation retains one primary New estimate action", () => {
  const source = readFileSync("app/components/bottom-nav.tsx", "utf8");
  expect(NEW_ESTIMATE_PATH).toBe("/new");
  expect(source.match(/onClick=\{handleNew\}/g)).toHaveLength(1);
  expect(source).toContain('aria-label="New estimate"');
  expect(source).toContain("min-h-11");
  expect(source).toContain("safe-area-inset-bottom");
});

test("Estimates has no duplicate header New estimate control", () => {
  const source = readFileSync("app/estimates/page.tsx", "utf8");
  expect(source).not.toContain("New Estimate");
  expect(source).toContain('href="/new"');
});
