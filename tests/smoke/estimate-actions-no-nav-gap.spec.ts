import { test, expect } from "@playwright/test";
import { signUpFreshAccount, cleanupTestAccount } from "./helpers";

/**
 * Regression lock: EstimateActions (the fixed action bar on the estimate
 * detail page) used to sit at bottom-[102px], 8.5px above where BottomNav
 * actually starts (measured at 93.5px tall). That gap exposed the scrolling
 * estimate content behind both fixed bars -- visible on a live phone as
 * estimate text bleeding through the strip between the "Send Estimate"
 * button and the nav row.
 *
 * This asserts the invariant directly (no visible gap between the two fixed
 * elements) rather than a specific offset value, so a legitimate future
 * change to either bar's height doesn't break this test as long as someone
 * keeps them touching.
 */
test("no visible gap between the estimate action bar and the bottom nav", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const account = await signUpFreshAccount(page);

  try {
    await page.goto("/new");
    await page
      .locator("textarea")
      .first()
      .fill("Replace 50-gallon gas water heater. New unit, expansion tank, about 3 hours labour.");
    await page.getByRole("button", { name: /generate estimate/i }).click();
    await expect(page.getByRole("button", { name: /send estimate/i })).toBeVisible({ timeout: 30000 });

    // The estimate is saved asynchronously at the end of the stream, so poll
    // for it rather than assuming it's queryable the instant the UI updates.
    // This test uses a real AI call (unlike most of this suite), so the DB
    // insert can occasionally take a bit longer than a fixed short window.
    let estimateId: string | undefined;
    for (let i = 0; i < 20 && !estimateId; i++) {
      const listRes = await page.request.get("/api/estimates");
      const listBody = (await listRes.json()) as { estimates?: Array<{ id: string }> };
      estimateId = listBody.estimates?.[0]?.id;
      if (!estimateId) await page.waitForTimeout(500);
    }
    if (!estimateId) throw new Error("No estimate found after generation");

    // The bug only reproduces on the real detail page: /new keeps the
    // freshly generated estimate inline using its own bottom bar, not
    // EstimateActions.
    await page.goto(`/estimates/${estimateId}`);
    await expect(page.getByRole("button", { name: /send estimate/i })).toBeVisible();

    const gap = await page.evaluate(() => {
      const nav = document.querySelector("nav");
      const actionsDiv = Array.from(document.querySelectorAll("div.fixed")).find((el) =>
        el.className.includes("z-30")
      );
      if (!nav || !actionsDiv) return null;
      return nav.getBoundingClientRect().top - actionsDiv.getBoundingClientRect().bottom;
    });

    expect(gap).not.toBeNull();
    // A negative or zero value means the action bar's bottom edge reaches at
    // or past the nav's top edge (touching or overlapping). Any positive
    // value is a gap that exposes the page behind both bars.
    expect(gap as number).toBeLessThanOrEqual(0);
  } finally {
    await cleanupTestAccount(account.userId);
  }
});
