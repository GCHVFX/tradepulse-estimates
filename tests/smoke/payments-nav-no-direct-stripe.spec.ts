import { test, expect } from "@playwright/test";
import { signUpFreshAccount, cleanupTestAccount } from "./helpers";

test("Payments nav tap for a non-Pro account lands on the preview page, not Stripe", async ({ page }) => {
  const account = await signUpFreshAccount(page);

  try {
    await page.getByRole("link", { name: /payments/i }).click();

    await expect(page).toHaveURL(/\/payments/);
    await expect(page).not.toHaveURL(/stripe\.com/);
  } finally {
    await cleanupTestAccount(account.userId);
  }
});
