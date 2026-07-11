import { test, expect } from "@playwright/test";
import { signUpFreshAccount, cleanupTestAccount } from "./helpers";

test("generating an estimate renders a pricing summary", async ({ page }) => {
  const account = await signUpFreshAccount(page);

  try {
    await page
      .locator("textarea")
      .fill("Replace 50-gallon gas water heater. New unit, expansion tank, about 3 hours labour.");
    await page.getByRole("button", { name: /generate estimate/i }).click();

    await expect(page.getByText(/pricing summary/i)).toBeVisible({ timeout: 30000 });
  } finally {
    await cleanupTestAccount(account.userId);
  }
});
