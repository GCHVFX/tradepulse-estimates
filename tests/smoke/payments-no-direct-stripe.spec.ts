import { test, expect } from "@playwright/test";
import { signUpFreshAccount, cleanupTestAccount, loginAs } from "./helpers";

/**
 * Invariant: a non-Pro contractor who reaches the Payments surface lands on an
 * in-app page that explains the feature. Upgrading is always a deliberate tap,
 * never an automatic bounce out to Stripe Checkout.
 *
 * The bug this guards (fixed in 68e0c4b): the Payments entry point used to
 * render as a button for non-Pro users that POSTed to /api/billing/upgrade on
 * tap and assigned window.location.href to the Stripe URL it returned, so a
 * Starter user tapping something that looked like ordinary navigation was
 * thrown straight into a payment flow with no confirmation.
 *
 * The first version of this test clicked a bottom-nav "Payments" link, so it
 * broke when that tab was deliberately removed in d93768a even though the
 * invariant was intact. These tests assert the invariant itself: /payments
 * behaves correctly for a non-Pro user however they arrive at it. Nothing here
 * depends on the shape of the navigation.
 */

const STRIPE_URL = /stripe\.com/;

// Long enough for a client-side redirect to have fired if one existed. An
// automatic bounce happens as soon as the upgrade call returns, so this only
// has to outlast that round trip, not any human hesitation.
const SETTLE_MS = 3000;

// Both checks run against one throwaway account. /api/auth/signup allows 5
// signups per hour per IP and the whole suite shares this machine's IP, so a
// second signup here would eat budget another test needs.
test.describe.configure({ mode: "serial" });

test.describe("Payments surface for a non-Pro account", () => {
  let account: Awaited<ReturnType<typeof signUpFreshAccount>>;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      account = await signUpFreshAccount(page);
    } finally {
      await page.close();
    }
  });

  test.afterAll(async () => {
    if (account) await cleanupTestAccount(account.userId);
  });

  test("/payments renders the in-app upgrade panel instead of redirecting to Stripe", async ({
    page,
  }) => {
    await loginAs(page, account.email, account.password);
    await page.goto("/payments");

    await expect(page).toHaveURL(/\/payments/);
    await expect(page).not.toHaveURL(STRIPE_URL);

    // The in-app panel, not a payment form on someone else's domain.
    await expect(page.getByRole("heading", { name: /payments is a pro feature/i })).toBeVisible();

    // Upgrading is a link the contractor chooses to tap, and it points at our
    // own subscribe page rather than straight at a checkout session.
    const upgradeLink = page.getByRole("link", { name: /upgrade to pro/i });
    await expect(upgradeLink).toBeVisible();
    await expect(upgradeLink).toHaveAttribute("href", "/subscribe");

    // Nothing navigates on its own while the contractor reads the panel.
    await page.waitForTimeout(SETTLE_MS);
    await expect(page).toHaveURL(/\/payments/);
    await expect(page).not.toHaveURL(STRIPE_URL);
  });

  test("the Unpaid Invoices entry point lands on /payments, not Stripe", async ({ page }) => {
    await loginAs(page, account.email, account.password);
    await page.goto("/estimates");
    await page.getByRole("link", { name: /unpaid invoices/i }).click();

    await expect(page).toHaveURL(/\/payments/);
    await expect(page).not.toHaveURL(STRIPE_URL);

    await page.waitForTimeout(SETTLE_MS);
    await expect(page).not.toHaveURL(STRIPE_URL);
  });
});
