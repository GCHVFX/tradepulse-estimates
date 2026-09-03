import { test, expect } from "@playwright/test";

/**
 * Regression lock for a real usability issue found in review: the
 * horizontal-scroll fix for the trade tabs (see
 * trade-tabs-mobile-overflow.spec.ts) worked technically, but at rest the
 * row just showed a tab abruptly clipped mid-rectangle at the right edge,
 * with no signal that more content exists -- indistinguishable from a
 * layout bug.
 *
 * Fixed with a fade-out gradient overlay at the right edge of the
 * scrollable row (transparent to the section's own page background,
 * #EADCC0), shown only while there's actually more to scroll to and faded
 * out once the row is scrolled all the way -- a fade that stayed visible
 * after Painting is fully in view would itself be misleading. No
 * chevron/arrow was added: this only applies at narrow phone widths, a
 * touch-swipe context where horizontal swipe is already the expected
 * gesture on a chip/tab row.
 */

test("at a scrollable width, the fade is visible at rest and fades out once scrolled to the end", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");

  const tablist = page.getByRole("tablist", { name: "Trade examples" });
  const wrapper = tablist.locator("xpath=..");
  const fade = wrapper.locator("div[aria-hidden='true']");

  await expect(fade).toBeVisible();
  // Let the mount effect (and its document.fonts.ready recheck) settle.
  await expect
    .poll(async () => parseFloat(await fade.evaluate((el) => getComputedStyle(el).opacity)))
    .toBeGreaterThan(0.5);

  await tablist.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await expect
    .poll(async () => parseFloat(await fade.evaluate((el) => getComputedStyle(el).opacity)))
    .toBeLessThan(0.1);
});

test("at a comfortable width, the fade is not rendered visibly", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/");

  const tablist = page.getByRole("tablist", { name: "Trade examples" });
  const wrapper = tablist.locator("xpath=..");
  const fade = wrapper.locator("div[aria-hidden='true']");

  await expect(fade).toBeHidden();
});

test("the fade does not block taps on the tab it overlaps", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");

  // Painting is the tab partially under the fade at rest -- confirm tapping
  // it still works, not just tapping a tab elsewhere in the row.
  await page.getByRole("tab", { name: /Painting/ }).click();
  await expect(page.getByRole("tab", { name: /Painting/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("living room and hallway")).toBeVisible();
});
