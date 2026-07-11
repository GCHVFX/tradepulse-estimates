import { test, expect } from "@playwright/test";

const PUBLIC_PATHS = ["/", "/login", "/signup"];

// TrialBanner (mounted globally in app/layout.tsx) fetches /api/profile on
// every page load with no auth check first. For an anonymous visitor this
// always 401s — expected, handled gracefully client-side (banner just never
// renders), not a bug this suite should flag. Everything else still fails.
const EXPECTED_NOISE = /Failed to load resource: the server responded with a status of 401/;

for (const path of PUBLIC_PATHS) {
  test(`${path} returns 200 and renders without console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && !EXPECTED_NOISE.test(msg.text())) errors.push(msg.text());
    });

    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });
}
