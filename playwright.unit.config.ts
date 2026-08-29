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
    "stripe-billing-recovery.spec.ts",
    "stripe-object-state.spec.ts",
    "account-provisioning.spec.ts",
    "oauth-intent.spec.ts",
    "no-business-access.spec.ts",
    "smoke-safety.spec.ts",
    "currency.spec.ts",
    "currency-rendering.spec.ts",
    "account-deletion.spec.ts",
    "bottom-nav.spec.ts",
    "signup-currency-layout.spec.ts",
    "homepage-pricing.spec.ts",
    "subscribe-billing-currency.spec.ts",
    "twilio-inbound-webhook.spec.ts",
    "sms-suppression-guard.spec.ts",
    "payment-reminder-copy.spec.ts",
    "payment-reminder-message-preview.spec.ts",
    "manual-payment-reminder.spec.ts",
    "cost-amplification-guards.spec.ts",
    "estimate-generation-claims.spec.ts",
    "share-link-canonical-host.spec.ts",
    "twilio-signature-allowlist.spec.ts",
    "password-reset-canonical-host.spec.ts",
    "twilio-messaging-service.spec.ts",
    "billing-status-sync.spec.ts",
    "subscription-access.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
