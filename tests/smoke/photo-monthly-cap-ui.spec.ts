import { test, expect } from "@playwright/test";
import { signUpFreshAccount, cleanupTestAccount } from "./helpers";

/**
 * Client-side UX for the Starter AI photo estimate cap: the proactive
 * remaining-count label (requirement: show it before the wall, not just
 * after) and the blocked-state message with an upgrade link. Stubs
 * /api/profile rather than exhausting a real cap, since the server-side
 * enforcement itself is covered end-to-end (with real Anthropic calls) in
 * photo-monthly-cap-server-enforced.spec.ts -- this file is only about what
 * the UI does with a given remaining count, not about the counting logic.
 */
test("shows remaining count, and the upgrade message when exhausted", async ({ page }) => {
  const account = await signUpFreshAccount(page);

  try {
    // Case 1: 2 of 3 remaining.
    await page.route("**/api/profile", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profile: { plan: "starter", name: "Test Co", ai_photo_estimates_remaining: 2 },
        }),
      });
    });
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/new");
    await expect(page.getByText("2 of 3 AI photo estimates left this month")).toBeVisible();
    await page.screenshot({ path: "test-results/photo-cap-remaining.png" });
    // Not blocked -- tapping opens the photo source sheet, not an error.
    await page.getByRole("button", { name: /add photos for ai analysis/i }).click();
    await expect(page.getByText(/take photo/i)).toBeVisible();
    await expect(page.getByText(/used your 3 free/i)).toHaveCount(0);
  } finally {
    await cleanupTestAccount(account.userId);
  }
});

test("blocks the camera tap client-side when exhausted, with an upgrade link", async ({ page }) => {
  const account = await signUpFreshAccount(page);

  try {
    await page.route("**/api/profile", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profile: { plan: "starter", name: "Test Co", ai_photo_estimates_remaining: 0 },
        }),
      });
    });
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/new");
    await expect(page.getByText(/AI photo estimates left this month/i)).toHaveCount(0);

    await page.getByRole("button", { name: /add photos for ai analysis/i }).click();
    await expect(page.getByText(/used your 3 free AI photo estimates this month/i)).toBeVisible();
    const upgradeLink = page.getByRole("link", { name: /upgrade to pro/i });
    await expect(upgradeLink).toBeVisible();
    await expect(upgradeLink).toHaveAttribute("href", "/subscribe");
    await page.screenshot({ path: "test-results/photo-cap-blocked.png" });
  } finally {
    await cleanupTestAccount(account.userId);
  }
});
