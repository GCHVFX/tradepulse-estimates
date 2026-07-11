import { test, expect } from "@playwright/test";
import { signUpFreshAccount, cleanupTestAccount, expireTrial } from "./helpers";

test("expired trial with no subscription reaches Checkout, not a dead end", async ({ page }) => {
  const account = await signUpFreshAccount(page);

  try {
    await expireTrial(account.userId);

    await page.goto("/new");

    await expect(page).toHaveURL(/\/subscribe/);
    await expect(page.getByRole("button", { name: /subscribe/i })).toBeVisible();
  } finally {
    await cleanupTestAccount(account.userId);
  }
});
