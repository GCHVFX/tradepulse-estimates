import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpFreshAccount, cleanupTestAccount } from "./helpers";

/**
 * Server-side enforcement of the Starter AI photo estimate cap (3/calendar
 * month, Pro unlimited). Calls /api/analyze-photo directly rather than
 * through the UI, since the whole point of the requirement is that the cap
 * can't be bypassed by going around the client -- a test that only drove the
 * browser wouldn't prove that.
 *
 * Uses real Anthropic vision calls (4 of them: 3 allowed, 1 that should
 * never reach Anthropic at all, plus 1 more after flipping to Pro) rather
 * than stubbing the route, because the thing under test is the route's own
 * gating logic, not just the response shape.
 */
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("Starter is capped at 3 AI photo estimates/month server-side; Pro is unlimited", async ({
  page,
}) => {
  test.setTimeout(120000);
  const account = await signUpFreshAccount(page);

  try {
    const admin = adminClient();
    const { data: business } = await admin
      .from("tpe_businesses")
      .select("id, plan")
      .eq("owner_user_id", account.userId)
      .maybeSingle();
    if (!business) throw new Error("No business row for test account");
    expect(business.plan).toBe("starter");

    async function callAnalyze() {
      return page.request.post("/api/analyze-photo", {
        data: {
          photos: [{ base64: TINY_PNG_BASE64, mediaType: "image/png", note: "" }],
        },
      });
    }

    // Calls 1-3: allowed.
    for (let i = 1; i <= 3; i++) {
      const res = await callAnalyze();
      const body = await res.json();
      expect(res.status(), `call ${i} status`).toBe(200);
      expect(typeof body.description, `call ${i} has description`).toBe("string");
    }

    // Call 4: blocked before Anthropic, distinct error code, never a 500.
    const blockedRes = await callAnalyze();
    const blockedBody = await blockedRes.json();
    expect(blockedRes.status()).toBe(403);
    expect(blockedBody.error).toBe("photo_limit_reached");
    expect(blockedBody.message).toContain("3 free AI photo estimates");

    // Profile reflects 0 remaining.
    const profileRes = await page.request.get("/api/profile");
    const profileBody = await profileRes.json();
    expect(profileBody.profile.ai_photo_estimates_remaining).toBe(0);

    // Flip to Pro directly in the DB (server reads plan fresh every call) --
    // confirms the cap is plan-driven, not just a hardcoded lockout.
    await admin.from("tpe_businesses").update({ plan: "pro" }).eq("id", business.id);

    const proRes = await callAnalyze();
    const proBody = await proRes.json();
    expect(proRes.status(), "Pro call after Starter exhausted its cap").toBe(200);
    expect(typeof proBody.description).toBe("string");

    const proProfileRes = await page.request.get("/api/profile");
    const proProfileBody = await proProfileRes.json();
    expect(proProfileBody.profile.ai_photo_estimates_remaining).toBeNull();
  } finally {
    await cleanupTestAccount(account.userId);
  }
});
