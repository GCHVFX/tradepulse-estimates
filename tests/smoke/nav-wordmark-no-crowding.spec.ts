import { test, expect } from "@playwright/test";

/**
 * Regression lock for a Production bug: at 320-375px wide, the nav's
 * "TradePulse Estimates" wordmark had zero gap to the "Start Free" CTA --
 * touching, not just close -- with the CTA and hamburger button themselves
 * flex-shrunk narrower than their own padding wants (measured: CTA 77.3px
 * vs its natural 98.9px at 320px). The existing mobile-only 17px font
 * shrink (`.nav-lockup span` in app/page.tsx, see homepage-pricing.spec.ts'
 * hero-spacing test for a sibling regression on this same nav) wasn't
 * enough on its own below ~390px, since the bar has no explicit gap
 * between the wordmark and the right-hand CTA/hamburger group -- it's
 * entirely dependent on `justify-between` leaving slack, and there wasn't
 * any left at these widths.
 *
 * Fixed by also dropping "Estimates" (back to just the icon + "TradePulse")
 * below 390px, a second `@media (max-width: 389px)` rule in app/page.tsx
 * targeting WordmarkText's second inner span structurally, not a class on
 * wordmark.tsx (shared by every other RowLockup usage sitewide). 390px and
 * up already had a comfortable natural gap with nothing compressed, so the
 * full wordmark is untouched there -- checked here too, so a future change
 * to that breakpoint can't quietly widen the truncation range.
 */

const CROWDED_WIDTHS = [320, 360, 375];
const COMFORTABLE_WIDTHS = [390, 412];

// Real breathing room, not just "not touching" -- the reported bug was
// exactly 0px, so this only needs to be comfortably above that, not tuned
// to the exact measured value (which varies per width).
const MIN_GAP_PX = 8;

for (const width of CROWDED_WIDTHS) {
  test(`at ${width}px the wordmark doesn't crowd the Start Free button`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/");

    const lockup = page.locator(".nav-lockup");
    const cta = page.locator("nav.fixed").getByRole("link", { name: "Start Free" });
    await expect(cta).toBeVisible();

    const lockupBox = await lockup.boundingBox();
    const ctaBox = await cta.boundingBox();
    expect(lockupBox).not.toBeNull();
    expect(ctaBox).not.toBeNull();
    if (!lockupBox || !ctaBox) return;

    const gap = ctaBox.x - (lockupBox.x + lockupBox.width);
    expect(gap, `gap between wordmark and CTA at ${width}px`).toBeGreaterThanOrEqual(MIN_GAP_PX);

    // The squeeze symptom: the CTA's own text wrapping onto two lines
    // because its box was flex-shrunk narrower than its padding wants.
    const ctaLines = await cta.evaluate((el) => el.getClientRects().length);
    expect(ctaLines, `CTA line count at ${width}px`).toBe(1);

    // This width is exactly where "Estimates" is meant to drop.
    await expect(lockup.getByText("Estimates", { exact: true })).toBeHidden();
  });
}

for (const width of COMFORTABLE_WIDTHS) {
  test(`at ${width}px the full wordmark still shows, unchanged`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/");

    const lockup = page.locator(".nav-lockup");
    const cta = page.locator("nav.fixed").getByRole("link", { name: "Start Free" });
    await expect(cta).toBeVisible();
    await expect(lockup.getByText("Estimates", { exact: true })).toBeVisible();

    const lockupBox = await lockup.boundingBox();
    const ctaBox = await cta.boundingBox();
    expect(lockupBox).not.toBeNull();
    expect(ctaBox).not.toBeNull();
    if (!lockupBox || !ctaBox) return;

    const gap = ctaBox.x - (lockupBox.x + lockupBox.width);
    expect(gap, `gap between wordmark and CTA at ${width}px`).toBeGreaterThanOrEqual(MIN_GAP_PX);
  });
}
