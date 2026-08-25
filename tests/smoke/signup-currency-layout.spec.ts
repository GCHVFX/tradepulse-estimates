/**
 * Layout regression tests for the signup currency control.
 *
 * The defect: at phone width the signup screen rendered the trial-price line
 * twice, once under the heading and once inside the fixed bottom bar. The
 * second copy, stacked with the `Change currency` control above the CTA, made
 * that bar tall enough to sit on top of the Terms of Service text.
 *
 * These are source-level assertions, matching bottom-nav.spec.ts. The unit
 * config runs in plain Node with no browser project, and the browser-backed
 * smoke config points at Production by default, so a rendered-pixel check
 * cannot live in either suite. The geometry is instead asserted from the
 * Tailwind spacing classes, which is what actually decides the overlap.
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { trialCopy } from "../../lib/currency";

const FORM = "app/signup/signup-form.tsx";

/** Source with comments removed, so a comment can neither satisfy nor fail an assertion. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

test("the signup screen renders exactly one trial-price line", () => {
  const form = code(FORM);

  expect(occurrences(form, "trialCopy(")).toBe(1);
  expect(occurrences(form, "formatMonthlyPlanPrice(")).toBe(1);
});

test("the Change currency control and its selector each render once", () => {
  const form = code(FORM);

  expect(occurrences(form, "Change currency")).toBe(1);
  expect(occurrences(form, "CURRENCIES.map")).toBe(1);
  expect(occurrences(form, "setShowCurrency(true)")).toBe(1);
});

test("the currency control sits under the price line and above the email field", () => {
  const form = code(FORM);

  const priceLine = form.indexOf("trialCopy(");
  const selector = form.indexOf("CURRENCIES.map");
  const changeCurrency = form.indexOf("Change currency");
  const emailField = form.indexOf('id="email"');

  expect(priceLine, "price line must exist").toBeGreaterThan(-1);
  expect(emailField, "email field must exist").toBeGreaterThan(-1);

  expect(selector, "expanded selector belongs below the price line").toBeGreaterThan(priceLine);
  expect(changeCurrency, "collapsed trigger belongs below the price line").toBeGreaterThan(priceLine);
  expect(emailField, "selector belongs above the email field").toBeGreaterThan(selector);
  expect(emailField, "trigger belongs above the email field").toBeGreaterThan(changeCurrency);
});

test("the fixed bottom bar holds the CTA and nothing else", () => {
  const form = code(FORM);
  const bar = form.slice(form.indexOf("fixed bottom-0"));

  expect(bar).toContain("Create Account");
  expect(bar, "the duplicate price line must not come back").not.toContain("trialCopy(");
  expect(bar, "the currency trigger belongs above the email field").not.toContain("Change currency");
  expect(bar, "the currency selector belongs above the email field").not.toContain("CURRENCIES.map");
});

test("Terms render inside main and main reserves more room than the bar occupies", () => {
  const form = code(FORM);

  const terms = form.indexOf("Terms of Service");
  const mainEnd = form.indexOf("</main>");
  const barStart = form.indexOf("fixed bottom-0");

  expect(terms, "Terms must exist").toBeGreaterThan(-1);
  expect(terms, "Terms belong inside main, not in the fixed bar").toBeLessThan(mainEnd);
  expect(mainEnd, "the fixed bar comes after main").toBeLessThan(barStart);

  // Derived from the classes rather than hardcoded, so growing the bar fails
  // this test until main's bottom padding grows with it. Tailwind spacing is
  // 4px per step.
  //
  // This reserve governs the SCROLLED-TO-BOTTOM case only. Padding placed
  // under the Terms cannot move the Terms, so it has no effect at all on
  // initial paint. The initial-paint clearance is guarded by the two tests
  // below instead. Measuring proved this: raising the reserve from pb-32 to
  // pb-40 moved scroll-bottom clearance from 16px to 48px and left the
  // initial-paint gap at exactly its previous value.
  const bar = form.slice(barStart);
  const barTop = Number(bar.match(/\bpt-(\d+)\b/)![1]) * 4;
  const barBottom = Number(bar.match(/\bpb-(\d+)\b/)![1]) * 4;
  const ctaHeight = Number(bar.match(/min-h-\[(\d+)px\]/)![1]);
  const mainClearance = Number(form.match(/<main[^>]*className="[^"]*\bpb-(\d+)\b/)![1]) * 4;

  expect(
    mainClearance,
    `main reserves ${mainClearance}px but the bar occupies ${barTop + ctaHeight + barBottom}px`
  ).toBeGreaterThanOrEqual(barTop + ctaHeight + barBottom);
});

test("the space above the Terms stays tight enough to clear the bar at initial paint", () => {
  const form = code(FORM);

  // Initial-paint clearance is decided by the height of everything ABOVE the
  // Terms, not by the reserve below them. These three values were chosen by
  // measuring, and together they reclaimed 32px:
  //
  //   header pt-8 + pb-4   48px of chrome, down from pt-10 + pb-6 (64px)
  //   main   gap-5         20px between five children, down from gap-6 (24px)
  //
  // Measured result at 1280x720 with the selector expanded, the worst of the
  // six required states: the Terms went from 8px UNDER the bar to 24px clear
  // of it. Loosening any of these spends that clearance.
  const header = form.match(/<header[^>]*className="([^"]*)"/)![1];
  const headerTop = Number(header.match(/\bpt-(\d+)\b/)![1]) * 4;
  const headerBottom = Number(header.match(/\bpb-(\d+)\b/)![1]) * 4;
  const mainGap = Number(form.match(/<main[^>]*className="[^"]*\bgap-(\d+)\b/)![1]) * 4;

  expect(headerTop + headerBottom, "header chrome above the form").toBeLessThanOrEqual(48);
  expect(mainGap, "gap between main's children").toBeLessThanOrEqual(20);
});

test("the expanded currency selector stays at the 44px tap target and no taller", () => {
  const form = code(FORM);

  // Expanding swaps a 24px text trigger for 44px buttons, so the expanded
  // state sits about 20px lower than the collapsed one and is the binding
  // case for initial-paint clearance. 44px is the project's minimum tap
  // target, so this is a floor and a ceiling at once: shrinking it breaks the
  // tap target, growing it eats the clearance measured above.
  const selectorHeight = Number(form.match(/min-h-\[(\d+)px\] rounded-lg border/)![1]);
  expect(selectorHeight).toBe(44);
});

test("both currency states render the same single price line", () => {
  const form = code(FORM);

  // The price line and the selector read the same `currency` state, so
  // choosing USD swaps the price in place instead of adding a second line.
  expect(form).toContain('trialCopy("starter", currency)');
  expect(form).toContain("currency === c");

  expect(trialCopy("starter", "cad")).toBe("14-day free trial, then CA$29/month");
  expect(trialCopy("starter", "usd")).toBe("14-day free trial, then US$19/month");
});
