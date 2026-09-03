import { test, expect } from "@playwright/test";

/**
 * Regression lock for a real production bug: on the homepage's "See what
 * TradePulse creates" section, the three trade tabs (Plumbing/Electrical/
 * Painting) overflowed the viewport at mobile widths. Measured via
 * getBoundingClientRect(), not guessed: the three pills need 376.6px
 * unbroken, and a plain `flex justify-center` row clips against the
 * viewport below that -- not just Painting on the right as originally
 * reported, but Plumbing on the left too (centering an overflowing flex
 * row clips symmetrically on both sides).
 *
 * Fixed with a horizontal-scroll fallback below a precisely measured
 * custom breakpoint (`max-[379px]:`, a few px above the exact 376.6px
 * threshold) rather than the generic `sm:` (640px) utility -- an earlier
 * pass here used `sm:` and caught its own mistake in review: that
 * unnecessarily put 390-412px (already fine before this fix) into scroll
 * mode too. `justify-start` while scrollable is deliberate: `justify-center`
 * on a scrollable overflowing row makes the first tab unreachable by
 * scroll (the browser clamps negative scroll offset to 0, permanently
 * hiding whatever centering pushed left of it).
 */

const OVERFLOW_WIDTHS = [320, 360, 375];
const COMFORTABLE_WIDTHS = [390, 412];

test.describe("trade tabs at widths where the row must scroll", () => {
  for (const width of OVERFLOW_WIDTHS) {
    test(`at ${width}px the row scrolls and the first tab isn't clipped`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");

      const tablist = page.getByRole("tablist", { name: "Trade examples" });
      const plumbing = page.getByRole("tab", { name: /Plumbing/ });
      await expect(plumbing).toBeVisible();

      const box = await plumbing.boundingBox();
      expect(box, `Plumbing tab bounding box at ${width}px`).not.toBeNull();
      if (!box) return;
      // The exact bug: this went negative (clipped off the left edge) at
      // every width in this range before the fix.
      expect(box.x, `Plumbing tab left edge at ${width}px`).toBeGreaterThanOrEqual(-0.5);

      const overflowX = await tablist.evaluate((el) => getComputedStyle(el).overflowX);
      expect(overflowX, `tab row overflow-x at ${width}px`).toBe("auto");
      const isScrollable = await tablist.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(isScrollable, `tab row scrollable at ${width}px`).toBe(true);

      // Scrolling to the end must actually reveal Painting, not just move
      // the scrollbar -- confirms justify-start, not justify-center, is
      // in effect (justify-center would clamp scroll before reaching it).
      await tablist.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      const painting = page.getByRole("tab", { name: /Painting/ });
      const paintingBox = await painting.boundingBox();
      expect(paintingBox, `Painting tab bounding box at ${width}px after scroll`).not.toBeNull();
      if (!paintingBox) return;
      expect(paintingBox.x, `Painting left edge at ${width}px after scroll`).toBeGreaterThanOrEqual(-0.5);
      expect(paintingBox.x + paintingBox.width, `Painting right edge at ${width}px after scroll`).toBeLessThanOrEqual(width + 0.5);
    });
  }
});

test.describe("trade tabs at widths that were already fine, unaffected by the fix", () => {
  for (const width of COMFORTABLE_WIDTHS) {
    test(`at ${width}px all three tabs are visible with no scrolling, exactly as before`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");

      const tablist = page.getByRole("tablist", { name: "Trade examples" });
      for (const name of [/Plumbing/, /Electrical/, /Painting/]) {
        const tab = page.getByRole("tab", { name });
        const box = await tab.boundingBox();
        expect(box, `${name} bounding box at ${width}px`).not.toBeNull();
        if (!box) continue;
        expect(box.x, `${name} left edge at ${width}px`).toBeGreaterThanOrEqual(-0.5);
        expect(box.x + box.width, `${name} right edge at ${width}px`).toBeLessThanOrEqual(width + 0.5);
      }

      // scrollWidth > clientWidth alone isn't a valid "is scrolling"
      // signal: it stays true even with overflow:visible, since the
      // content still extends past clientWidth, just unclipped rather
      // than scrollable. The real signal is the computed overflow-x.
      const overflowX = await tablist.evaluate((el) => getComputedStyle(el).overflowX);
      expect(overflowX, `tab row overflow-x at ${width}px`).toBe("visible");
    });
  }
});

test("tapping a tab still switches the active example, at a width where the row scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");

  await page.getByRole("tab", { name: /Electrical/ }).click();
  await expect(page.getByRole("tab", { name: /Electrical/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /Plumbing/ })).toHaveAttribute("aria-selected", "false");
  await expect(page.getByText("home office")).toBeVisible();
});
