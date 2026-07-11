import { test, expect } from "@playwright/test";
import { signUpFreshAccount, cleanupTestAccount } from "./helpers";

test("fresh signup lands on /new, not /onboarding", async ({ page }) => {
  const account = await signUpFreshAccount(page);

  try {
    await expect(page).toHaveURL(/\/new/);
  } finally {
    await cleanupTestAccount(account.userId);
  }
});
