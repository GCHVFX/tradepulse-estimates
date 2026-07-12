import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import crypto from "crypto";

export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required`);
  return value;
}

// Service-role client for test setup/teardown only. Never expose this key to the browser.
function adminClient() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY")
  );
}

function stripeClient(): Stripe {
  return new Stripe(requireEnv("STRIPE_SECRET_KEY"), { apiVersion: "2026-03-25.dahlia" });
}

export interface TestAccount {
  email: string;
  password: string;
  userId: string;
}

// Looks up a user by exact email via GoTrue's admin REST filter param, which
// isn't exposed by the installed supabase-js client's listUsers() wrapper.
// Only used as a setup-failure safety net below.
async function deleteUserByEmailIfExists(email: string): Promise<void> {
  const url = `${requireEnv("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`;
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) return;
  const body = (await res.json()) as { users?: { id: string }[] };
  const match = body.users?.find((u) => "id" in u);
  if (match) await cleanupTestAccount(match.id);
}

// Signs up a fresh throwaway account through the real signup UI, same flow a
// real contractor goes through. Password is generated per call, never stored,
// since the account is deleted at the end of the test regardless of outcome.
export async function signUpFreshAccount(page: Page): Promise<TestAccount> {
  const email = `gchansen+audit-${Date.now()}-${crypto.randomBytes(4).toString("hex")}@gmail.com`;
  const password = crypto.randomBytes(12).toString("hex");

  try {
    await page.goto("/signup");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/auth/signup") && res.request().method() === "POST"
      ),
      page.getByRole("button", { name: /create account/i }).click(),
    ]);

    const body = (await response.json()) as { success?: boolean; userId?: string; error?: string };
    if (!response.ok() || !body.userId) {
      throw new Error(`Signup failed: ${body.error ?? response.status()}`);
    }

    // A fresh signup always lands on /new — same assertion signup-lands-on-new.spec.ts makes.
    await page.waitForURL(/\/new/, { timeout: 15000 });

    return { email, password, userId: body.userId };
  } catch (err) {
    // The account may have been created server-side even though this test
    // never got a clean response (e.g. a client-side timeout). Since the
    // caller has no userId to clean up with in that case, fall back to an
    // email lookup so a setup failure can't leak a real Supabase/Stripe record.
    await deleteUserByEmailIfExists(email);
    throw err;
  }
}

// Best-effort delete that logs (but never throws) on failure, so a cleanup
// problem shows up in test output instead of silently leaking a row, while
// still not being able to fail the test itself.
async function runDelete(
  label: string,
  run: () => PromiseLike<{ error: { message: string } | null }>
): Promise<void> {
  try {
    const { error } = await run();
    if (error) {
      console.warn(`[cleanup] delete ${label} failed: ${error.message}`);
    }
  } catch (err) {
    console.warn(
      `[cleanup] delete ${label} threw: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// Deletes everything created by signUpFreshAccount: the Stripe customer (and
// any subscription on it), the tpe_businesses row plus every child row that
// references it (estimates and their line items / photos / changes, payment
// reminders, price book items), and the Supabase auth user. Children are
// removed before parents so a FK constraint can't block — and silently leak —
// the tpe_businesses delete. Safe to call even if signup partially failed;
// best-effort throughout (failures are logged, not thrown).
export async function cleanupTestAccount(userId: string): Promise<void> {
  const supabaseAdmin = adminClient();

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, stripe_customer_id")
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (business?.stripe_customer_id) {
    try {
      await stripeClient().customers.del(business.stripe_customer_id);
    } catch {
      // Already deleted or never fully created — nothing more to clean up on the Stripe side.
    }
  }

  if (business?.id) {
    const businessId = business.id;

    // The estimate row is inserted at the very END of the streaming
    // generate-estimate request, right before the stream closes. A test can
    // pass its "pricing summary visible" assertion mid-stream and reach cleanup
    // before that insert lands — so the estimate can appear AFTER the
    // estimate-delete step below but before the business delete, which then
    // FK-fails and silently leaks an orphaned business + estimate. Re-fetch and
    // retry until the business row is actually gone so a late insert can't leak.
    let businessDeleted = false;
    for (let attempt = 0; attempt < 5 && !businessDeleted; attempt++) {
      const { data: estimates } = await supabaseAdmin
        .from("tpe_estimates")
        .select("id")
        .eq("business_id", businessId);
      const estimateIds = (estimates ?? []).map((e) => e.id);

      // Grandchildren first (rows tied to the estimates), then the estimates,
      // then the remaining direct children of the business.
      if (estimateIds.length > 0) {
        await runDelete("tpe_estimate_changes", () =>
          supabaseAdmin.from("tpe_estimate_changes").delete().in("estimate_id", estimateIds)
        );
        await runDelete("tpe_estimate_line_items", () =>
          supabaseAdmin.from("tpe_estimate_line_items").delete().in("estimate_id", estimateIds)
        );
        await runDelete("tpe_estimate_photos", () =>
          supabaseAdmin.from("tpe_estimate_photos").delete().in("estimate_id", estimateIds)
        );
        await runDelete("tpe_payment_reminders (by estimate)", () =>
          supabaseAdmin.from("tpe_payment_reminders").delete().in("estimate_id", estimateIds)
        );
      }

      await runDelete("tpe_payment_reminders (by business)", () =>
        supabaseAdmin.from("tpe_payment_reminders").delete().eq("business_id", businessId)
      );
      await runDelete("tpe_estimates", () =>
        supabaseAdmin.from("tpe_estimates").delete().eq("business_id", businessId)
      );
      await runDelete("tpe_pricebook_items", () =>
        supabaseAdmin.from("tpe_pricebook_items").delete().eq("business_id", businessId)
      );

      const { error: bizErr } = await supabaseAdmin
        .from("tpe_businesses")
        .delete()
        .eq("id", businessId);

      if (!bizErr) {
        businessDeleted = true;
      } else if (attempt < 4) {
        // Most likely a generate-estimate insert that landed mid-cleanup.
        // Give it a moment, then re-fetch and remove the new child rows.
        await new Promise((r) => setTimeout(r, 400));
      } else {
        console.warn(`[cleanup] tpe_businesses delete failed after retries: ${bizErr.message}`);
      }
    }
  } else {
    // No business row resolved (e.g. signup failed before it was created).
    // Still attempt a delete by owner in case of drift.
    await runDelete("tpe_businesses (by owner)", () =>
      supabaseAdmin.from("tpe_businesses").delete().eq("owner_user_id", userId)
    );
  }

  const { error: userError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (userError) {
    console.warn(`[cleanup] delete auth user failed: ${userError.message}`);
  }
}

// Backdates trial_ends_at and cancels the Stripe subscription immediately, so
// the account reads as an expired trial with no active subscription.
export async function expireTrial(userId: string): Promise<void> {
  const supabaseAdmin = adminClient();

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("stripe_subscription_id")
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (business?.stripe_subscription_id) {
    try {
      await stripeClient().subscriptions.cancel(business.stripe_subscription_id);
    } catch {
      // Already canceled — fine, we just need no active subscription.
    }
  }

  await supabaseAdmin
    .from("tpe_businesses")
    .update({ trial_ends_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() })
    .eq("owner_user_id", userId);
}

// Clears every tracked "signup" rate-limit window, regardless of key. The
// signup rate limit is keyed by source IP, which every test in this suite
// shares (same CI runner), so the dedicated rate-limit test resets this
// before and after itself to avoid stealing budget from (or leaving debt
// for) the other signup-based tests and future runs from the same IP.
export async function resetSignupRateLimit(): Promise<void> {
  const supabaseAdmin = adminClient();
  await supabaseAdmin.from("tpe_rate_limits").delete().eq("action", "signup");
}
