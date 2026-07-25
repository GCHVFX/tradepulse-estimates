import { test, expect } from "@playwright/test";
import { signUpFreshAccount, cleanupTestAccount } from "./helpers";

/**
 * Regression lock: photos, their notes, and the typed description used to be
 * held inside the form view, so switching to the estimate view unmounted them
 * and going "Back to Description" came back to an empty form. They now live in
 * the page, and only sending or starting a new estimate clears them.
 *
 * The AI calls (profile plan, photo analysis, estimate generation) are stubbed
 * so this test stays fast, free, and deterministic. What it exercises is the
 * page's own state, which is where the bug was.
 */

// 1x1 PNG, small enough to keep the upload trivial, real enough for the
// browser to decode and downscale like any camera photo.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const FAKE_SUMMARY = `# Test Job

Job summary for the stubbed estimate.

Estimated total: $285

## Scope of Work
- Do the work

## Line Items
| Item | Qty | Unit | Rate | Cost |
|------|-----|------|------|------|
| Labour | 3 | hrs | $95.00 | $285.00 |

## Pricing Summary
| | |
|---|---|
| Subtotal | $285 |
| Tax (GST 5%) | $14 |
| **Total** | **$299** |
| No deposit required | |
| Balance on completion | $299 |
`;

test("photos and description survive going back to the description screen", async ({ page }) => {
  const account = await signUpFreshAccount(page);

  try {
    await page.route("**/api/profile", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ profile: { plan: "pro", name: "Test Co" } }),
      });
    });

    await page.route("**/api/analyze-photo", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ description: "Stubbed photo analysis." }),
      })
    );

    await page.route("**/api/generate-estimate", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: `${FAKE_SUMMARY}\n__ID__:00000000-0000-0000-0000-000000000000`,
      })
    );

    await page.route("**/api/estimates/*/photos", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
    );

    await page.goto("/new");

    await page.locator("textarea").first().fill("Replace bathroom exhaust fan.");

    await page.getByRole("button", { name: /add photos/i }).click();
    await page.getByRole("button", { name: /choose from camera roll/i }).click();
    await page
      .locator('input[type="file"]:not([capture])')
      .setInputFiles({ name: "job.png", mimeType: "image/png", buffer: TINY_PNG });

    await expect(page.getByAltText("Job site photo")).toBeVisible();
    await page.getByPlaceholder("Add a note...").fill("Fan above the shower");

    await page.getByRole("button", { name: /generate estimate/i }).click();
    await expect(page.getByRole("button", { name: /back to description/i })).toBeVisible({
      timeout: 30000,
    });

    await page.getByRole("button", { name: /back to description/i }).click();

    await expect(page.locator("textarea").first()).toHaveValue("Replace bathroom exhaust fan.");
    await expect(page.getByAltText("Job site photo")).toBeVisible();
    await expect(page.getByPlaceholder("Add a note...")).toHaveValue("Fan above the shower");
  } finally {
    await cleanupTestAccount(account.userId);
  }
});
