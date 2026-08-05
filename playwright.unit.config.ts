import { defineConfig } from "@playwright/test";

// Pure tests import one server module for its deterministic row mapper. Give
// that module inert constructor values without loading production credentials.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "unit-test-service-role-key";

export default defineConfig({
  testDir: "./tests/smoke",
  testMatch: [
    "estimate-pricing-mode.spec.ts",
    "estimate-grouped-pricing.spec.ts",
    "estimate-item-migration.spec.ts",
    "estimate-items-conversion.spec.ts",
    "plan-pricing.spec.ts",
    "stripe-webhook.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
