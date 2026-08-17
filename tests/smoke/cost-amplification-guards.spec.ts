import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("rate limits use the atomic take_rate_limit RPC", () => {
  const source = read("lib/rate-limit.ts");
  const migration = read("supabase/migrations/20260817044348_cost_amplification_guards.sql");
  expect(source).toContain('rpc("take_rate_limit"');
  expect(migration).toContain("unique (key, action)");
  expect(migration).toContain("on conflict (key, action) do update");
});

test("outbound delivery paths await and verify a durable claim before provider use", () => {
  for (const path of [
    "app/api/send-sms/route.ts",
    "app/api/send-email/route.ts",
    "app/api/estimates/[id]/review-request/route.ts",
    "app/api/estimates/[id]/send-reminder/route.ts",
    "app/api/cron/payment-reminders/route.ts",
  ]) {
    const source = read(path);
    expect(source).toContain("await claimDelivery(");
    const firstSmsProviderCall = source.indexOf("messages.create");
    const firstEmailProviderCall = source.indexOf("resend.emails.send");
    for (const providerCall of [firstSmsProviderCall, firstEmailProviderCall].filter((offset) => offset >= 0)) {
      const claimCall = source.lastIndexOf("await claimDelivery(", providerCall);
      expect(claimCall).toBeGreaterThanOrEqual(0);
      expect(claimCall).toBeLessThan(providerCall);
      const claimGuard = source.indexOf("if (!claimId)", claimCall);
      expect(claimGuard).toBeGreaterThan(claimCall);
      expect(claimGuard).toBeLessThan(providerCall);
    }
  }
});

test("public reset and legacy notification routes cannot cause unlimited Resend calls", () => {
  const reset = read("app/api/send-reset-email/route.ts");
  const notifyRoute = read("app/api/notify-error/route.ts");
  expect(reset).toContain("password-reset-ip");
  expect(reset).toContain("password-reset-email");
  expect(reset).toContain("GENERIC_RESPONSE");
  expect(notifyRoute).not.toContain('from "resend"');
});

test("photo uploads reserve and release business quota around Storage writes", () => {
  const route = read("app/api/estimates/[id]/photos/route.ts");
  const migration = read("supabase/migrations/20260817150442_fix_photo_reservation_file_count.sql");

  const reserveCall = route.indexOf("await reservePhotoUpload(");
  const uploadCall = route.indexOf('.upload(storagePath, buffer');
  expect(reserveCall).toBeGreaterThanOrEqual(0);
  expect(uploadCall).toBeGreaterThan(reserveCall);
  expect(route).toContain("finally {");
  expect(route).toContain("await releasePhotoUploadReservation");
  expect(migration).toContain("for update");
  expect(migration).toContain("status = 'reserved'");
  expect(migration).toContain("p_expected_file_count");
  expect(migration).toContain("p_expected_byte_count");
  expect(migration).toContain("sum(expected_file_count)");
});
