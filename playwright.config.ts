/**
 * Playwright smoke suite config for TradePulse Estimates.
 *
 * Every account-dependent test self-provisions: it signs up a fresh
 * throwaway account (gchansen+audit-<timestamp>-<random>@gmail.com, random
 * generated password) through the real signup UI, uses it, then deletes the
 * Stripe customer, tpe_businesses row, and Supabase auth user in a `finally`
 * block. No static fixture accounts or stored test passwords required.
 *
 * Required env vars (set locally via .env.local, not committed to git, or
 * as CI secrets — never hardcode real values in test files):
 *
 *   PLAYWRIGHT_BASE_URL             Base URL to run against. Defaults to
 *                                   https://trytradepulse.com (production).
 *
 *   NEXT_PUBLIC_SUPABASE_URL        Supabase project URL.
 *   SUPABASE_SERVICE_ROLE_KEY       Service-role key, used only for test
 *                                   setup/teardown (looking up and deleting
 *                                   the throwaway account). Never sent to
 *                                   the browser.
 *   STRIPE_SECRET_KEY               Used only for test setup/teardown
 *                                   (canceling a subscription to simulate an
 *                                   expired trial, deleting the Stripe
 *                                   customer created by signup).
 *
 * These tests create real Supabase users plus real Stripe customers and
 * trial subscriptions on whichever Stripe mode the target deployment is
 * wired to — cleaned up immediately after each test, but don't point
 * PLAYWRIGHT_BASE_URL at production unless that side effect is acceptable.
 */
import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

export default defineConfig({
  testDir: "./tests/smoke",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "https://trytradepulse.com",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
