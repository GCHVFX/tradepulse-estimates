import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { isSupabaseAuthCookie, supabaseAuthCookieNames } from "../../lib/auth-session";

/**
 * Strips comments so a "must not contain" assertion tests the code rather
 * than prose. These files deliberately describe the removed behaviour in
 * comments, which would otherwise trip every negative assertion.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
}

// ── Session cookie identification ─────────────────────────────────────────────

test("Supabase session cookies are identified, including chunked ones", () => {
  expect(isSupabaseAuthCookie("sb-fctequqcwxyhmnjgxixg-auth-token")).toBe(true);
  expect(isSupabaseAuthCookie("sb-fctequqcwxyhmnjgxixg-auth-token.0")).toBe(true);
  expect(isSupabaseAuthCookie("sb-fctequqcwxyhmnjgxixg-auth-token.1")).toBe(true);

  for (const other of [
    "sb-auth-token",
    "tp_oauth_intent",
    "__Host-session",
    "sb-project-auth-token-code-verifier",
    "",
  ]) {
    expect(isSupabaseAuthCookie(other), `${other} must not be treated as a session cookie`).toBe(false);
  }

  expect(
    supabaseAuthCookieNames(["sb-abc-auth-token", "sb-abc-auth-token.1", "tp_oauth_intent", "other"])
  ).toEqual(["sb-abc-auth-token", "sb-abc-auth-token.1"]);
});

// ── /onboarding can no longer create anything ────────────────────────────────

test("/onboarding never inserts or upserts a business", () => {
  const source = code("app/onboarding/page.tsx");

  expect(source).not.toContain(".insert(");
  expect(source).not.toContain(".upsert(");
  expect(source).not.toContain("getOrCreateBusiness");
});

test("/onboarding never assigns a trial or touches Stripe", () => {
  const source = code("app/onboarding/page.tsx");

  expect(source).not.toContain("trial_ends_at");
  expect(source).not.toContain("subscription_status");
  expect(source).not.toContain('plan: "starter"');
  expect(source.toLowerCase()).not.toContain("stripe");
});

test("/onboarding sends a no-business or signed-out visitor to /signup", () => {
  const source = readFileSync("app/onboarding/page.tsx", "utf8");

  expect(source).toMatch(/if \(!user\)[\s\S]{0,60}redirect\("\/signup"\)/);
  expect(source).toMatch(/if \(!business\)[\s\S]{0,80}redirect\("\/signup\?error=setup_required"\)/);
  // It must not send them back to the old self-healing destination.
  expect(source).not.toContain('redirect("/login?error=business_setup_failed")');
});

test("/onboarding still renders the setup form for a real business", () => {
  const source = readFileSync("app/onboarding/page.tsx", "utf8");

  expect(source).toContain("OnboardingForm");
  expect(source).toContain("businessId={business.id}");
});

// ── proxy behaviour ───────────────────────────────────────────────────────────

test("the proxy no longer exempts or redirects to /onboarding", () => {
  const source = readFileSync("proxy.ts", "utf8");

  expect(source).not.toContain('pathname === "/onboarding"');
  expect(source).not.toContain('new URL("/onboarding", request.url)');
  expect(source).not.toContain("onboardingUrl");
});

test("a no-business identity is signed out and sent to /signup", () => {
  const source = readFileSync("proxy.ts", "utf8");

  expect(source).toMatch(/if \(!business\)/);
  expect(source).toContain('new URL("/signup", request.url)');
  expect(source).toContain('signupUrl.searchParams.set("error", "setup_required")');
  expect(source).toContain("isSupabaseAuthCookie(cookie.name)");
  expect(source).toContain("redirect.cookies.delete(cookie.name)");
});

test("the redirect destination is public, so the no-business redirect cannot loop", () => {
  const source = readFileSync("proxy.ts", "utf8");

  // /signup is in PUBLIC_PATHS, so isPublic() short-circuits before the
  // business lookup ever runs again on the destination.
  const publicPaths = source.slice(source.indexOf("const PUBLIC_PATHS"), source.indexOf("function isPublic"));
  expect(publicPaths).toContain('"/signup"');
  expect(publicPaths).toContain('"/login"');
});

test("an existing business user keeps the unchanged access rules", () => {
  const source = readFileSync("proxy.ts", "utf8");

  // This used to assert proxy.ts's own inline
  // `isActive || isTrialing || complimentary` formula literally. That formula
  // was one of nine independent copies and now lives once in
  // lib/subscription-access.ts, so the assertion moved with it: proxy must
  // delegate to the shared predicate, and the redirect condition around it
  // must still be exactly the same. What now counts as access is pinned by
  // the behaviour matrix in subscription-access.spec.ts, which covers
  // strictly more cases than these three string checks did.
  expect(
    source,
    "proxy.ts must decide access via the shared predicate in @/lib/subscription-access"
  ).toContain('from "@/lib/subscription-access"');

  // Asserted as an exact substring, closing paren included, so that ADDING a
  // condition (the realistic way this gate gets widened -- an extra
  // `&& pathname !== "/estimates"` exemption, say) breaks it just as loudly
  // as removing the check altogether.
  expect(
    source,
    'proxy.ts must redirect on exactly `!hasSubscriptionAccess(business) && pathname !== "/subscribe"` -- ' +
      "no extra path exemptions, no weakened condition. Widening who gets past this gate is the regression this test exists to stop."
  ).toContain('if (!hasSubscriptionAccess(business) && pathname !== "/subscribe")');
});

// ── Google callback branches ─────────────────────────────────────────────────

test("Google login with a business signs in without provisioning", () => {
  const source = readFileSync("app/auth/callback/route.ts", "utf8");

  expect(source).toMatch(/if \(hasBusiness\)[\s\S]{0,200}return response;/);
  // The business check happens before either provisioning call site.
  expect(source.indexOf("const hasBusiness")).toBeLessThan(source.indexOf("ensureBusiness(user.id"));
});

test("Google login without a business never provisions and is sent to signup", () => {
  const source = readFileSync("app/auth/callback/route.ts", "utf8");

  expect(source).toMatch(/intent === 'login'[\s\S]{0,300}abandon\('setup_required'\)/);

  // The login branch must return before ensureBusiness is reached.
  const loginBranch = source.indexOf("intent === 'login'");
  const provisioning = source.indexOf("ensureBusiness(user.id");
  expect(loginBranch).toBeGreaterThan(-1);
  expect(loginBranch).toBeLessThan(provisioning);
});

test("Google signup without a business uses the Release 1 compensated helper", () => {
  const source = code("app/auth/callback/route.ts");

  expect(source).toContain("provisionNewAccount");
  expect(source).toContain("createAccountProvisioningDependencies");
  expect(source).toContain("deleteAuthUserOnFailure: false");
  // A failed provisioning attempt abandons the session rather than granting
  // access, with the Auth identity left intact by the helper.
  expect(source).toMatch(/if \(!provisioned\)\s*\{\s*return abandon\('setup_failed'\);/);
});

test("the callback creates Stripe objects in exactly one place", () => {
  const source = readFileSync("app/auth/callback/route.ts", "utf8");

  // Provisioning is reached through the helper only. No direct Stripe calls,
  // so a second customer or subscription cannot be created here.
  expect(source).not.toContain("stripe.customers.create");
  expect(source).not.toContain("stripe.subscriptions.create");
  expect((source.match(/provisionNewAccount\(/g) ?? []).length).toBe(1);
  expect((source.match(/ensureBusiness\(user\.id/g) ?? []).length).toBe(1);
});

test("no Google Auth user is deleted and no timing heuristic is used", () => {
  const source = readFileSync("app/auth/callback/route.ts", "utf8");

  expect(source).not.toContain("deleteUser");
  expect(source).not.toContain("created_at");
  expect(source).not.toContain("last_sign_in_at");
});
