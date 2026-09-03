import { test, expect } from "@playwright/test";

/**
 * Regression lock for a real usability issue found in review: the
 * horizontal-scroll fix for the trade tabs (see
 * trade-tabs-mobile-overflow.spec.ts) worked technically, but at rest the
 * row just showed a tab abruptly clipped mid-rectangle at the right edge,
 * with no signal that more content exists -- indistinguishable from a
 * layout bug.
 *
 * Fixed with a fade-out gradient overlay at each edge that currently has
 * hidden content (transparent to the section's own page background,
 * #EADCC0): right-only at rest (nothing scrolled past yet), both once
 * scrolled partway, left-only once scrolled all the way to Painting
 * (nothing left to reveal on the right). A fade on an edge with nothing
 * hidden behind it would itself be misleading. No chevron/arrow was
 * added: this only applies at narrow phone widths, a touch-swipe context
 * where horizontal swipe is already the expected gesture on a chip/tab
 * row.
 *
 * A first pass only faded the right edge -- scrolling away from the
 * start left a hard, fade-free cut on the tab exiting to the left. Fixed
 * by tracking canScrollLeft alongside canScrollRight and rendering a
 * left fade with its own opacity.
 */

function fades(page: import("@playwright/test").Page) {
  const tablist = page.getByRole("tablist", { name: "Trade examples" });
  const wrapper = tablist.locator("xpath=..");
  return {
    tablist,
    left: wrapper.locator("div[aria-hidden='true'].left-0"),
    right: wrapper.locator("div[aria-hidden='true'].right-0"),
  };
}

test("at rest, only the right fade is visible", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");

  const { left, right } = fades(page);
  // Let the mount effect (and its document.fonts.ready recheck) settle.
  await expect
    .poll(async () => parseFloat(await left.evaluate((el) => getComputedStyle(el).opacity)))
    .toBeLessThan(0.1);
  await expect
    .poll(async () => parseFloat(await right.evaluate((el) => getComputedStyle(el).opacity)))
    .toBeGreaterThan(0.5);
});

test("scrolled all the way to the end, only the left fade is visible", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");

  const { tablist, left, right } = fades(page);
  await tablist.evaluate((el) => { el.scrollLeft = el.scrollWidth; });

  await expect
    .poll(async () => parseFloat(await left.evaluate((el) => getComputedStyle(el).opacity)))
    .toBeGreaterThan(0.5);
  await expect
    .poll(async () => parseFloat(await right.evaluate((el) => getComputedStyle(el).opacity)))
    .toBeLessThan(0.1);
});

test("scrolled partway, both fades are visible at once", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");

  const { tablist, left, right } = fades(page);
  await tablist.evaluate((el) => {
    // A real finger holds an arbitrary mid-drag position while still in
    // contact; scroll-snap-proximity only pulls back on release, not
    // while a touch is live. Suspend snap for this one programmatic
    // write so the check reflects that real in-drag state rather than
    // the proximity snap a plain instant scrollLeft write would trigger.
    el.style.scrollSnapType = "none";
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  });

  await expect
    .poll(async () => parseFloat(await left.evaluate((el) => getComputedStyle(el).opacity)))
    .toBeGreaterThan(0.5);
  await expect
    .poll(async () => parseFloat(await right.evaluate((el) => getComputedStyle(el).opacity)))
    .toBeGreaterThan(0.5);
});

test("at a comfortable width, neither fade is rendered visibly", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");

  const { left, right } = fades(page);
  await expect(left).toBeHidden();
  await expect(right).toBeHidden();
});

test("the fade does not block taps on the tab it overlaps", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");

  // Painting is the tab partially under the right fade at rest -- confirm
  // tapping it still works, not just tapping a tab elsewhere in the row.
  await page.getByRole("tab", { name: /Painting/ }).click();
  await expect(page.getByRole("tab", { name: /Painting/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("living room and hallway")).toBeVisible();
});
