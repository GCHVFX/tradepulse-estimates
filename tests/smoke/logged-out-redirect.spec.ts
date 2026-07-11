import { test, expect } from "@playwright/test";

test("visiting /new while logged out redirects to /login", async ({ page }) => {
  await page.goto("/new");
  await expect(page).toHaveURL(/\/login/);
});
