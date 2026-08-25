import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  PRODUCTION_SIGNUP_OVERRIDE_ENV,
  STRIPE_CLEANUP_MAX_ATTEMPTS,
  assertFreshAccountSignupAllowed,
  deleteStripeCustomerForTest,
  isMissingStripeCustomerError,
  isProductionTarget,
  isTransientStripeError,
} from "./smoke-safety";

const LOCAL = { stripeKey: "sk_test_abc", supabaseUrl: "http://127.0.0.1:54321" };
const PROD = { stripeKey: "sk_live_abc", supabaseUrl: "https://fctequqcwxyhmnjgxixg.supabase.co" };

// ── Production detection ──────────────────────────────────────────────────────

test("a live Stripe key alone marks the target as Production", () => {
  expect(isProductionTarget(PROD)).toBe(true);
  expect(isProductionTarget({ stripeKey: "sk_live_x", supabaseUrl: "http://localhost:54321" })).toBe(true);
});

test("only a genuinely local stack is treated as non-Production", () => {
  expect(isProductionTarget(LOCAL)).toBe(false);
  expect(isProductionTarget({ stripeKey: "sk_test_x", supabaseUrl: "http://localhost:54321" })).toBe(false);
  expect(isProductionTarget({ stripeKey: "sk_test_x", supabaseUrl: "https://localhost:54321" })).toBe(false);
});

test("an unknown or missing target is treated as Production", () => {
  expect(isProductionTarget({})).toBe(true);
  expect(isProductionTarget({ stripeKey: "sk_test_x" })).toBe(true);
  expect(isProductionTarget({ stripeKey: "sk_test_x", supabaseUrl: "" })).toBe(true);
  expect(isProductionTarget({ stripeKey: "sk_test_x", supabaseUrl: "https://example.supabase.co" })).toBe(true);
});

// ── The gate ──────────────────────────────────────────────────────────────────

test("fresh-account signup is refused against Production by default", () => {
  expect(() => assertFreshAccountSignupAllowed(PROD)).toThrow(/Refusing to create a fresh signup account/i);
  expect(() => assertFreshAccountSignupAllowed(PROD)).toThrow(new RegExp(PRODUCTION_SIGNUP_OVERRIDE_ENV));
});

test("refusal is loud, not a silent skip", () => {
  let threw = false;
  try {
    assertFreshAccountSignupAllowed(PROD);
  } catch (error) {
    threw = true;
    // Actionable: says what it creates and what to do about it.
    expect((error as Error).message).toContain("Stripe Customer");
    expect((error as Error).message).toContain("leaked 19 live Stripe customers");
  }
  expect(threw, "the gate must throw rather than return quietly").toBe(true);
});

test("only the exact override value unlocks a Production run", () => {
  expect(() => assertFreshAccountSignupAllowed({ ...PROD, override: "true" })).not.toThrow();

  for (const bad of ["TRUE", "True", "1", "yes", "", " true", "true ", undefined]) {
    expect(
      () => assertFreshAccountSignupAllowed({ ...PROD, override: bad }),
      `override ${JSON.stringify(bad)} must not unlock Production`
    ).toThrow();
  }
});

test("a local stack needs no override", () => {
  expect(() => assertFreshAccountSignupAllowed(LOCAL)).not.toThrow();
  expect(() => assertFreshAccountSignupAllowed({ ...LOCAL, override: undefined })).not.toThrow();
});

// ── Stripe error classification ───────────────────────────────────────────────

test("only an already-missing customer is tolerated", () => {
  expect(isMissingStripeCustomerError({ code: "resource_missing" })).toBe(true);
  expect(isMissingStripeCustomerError({ statusCode: 404 })).toBe(true);
  expect(isMissingStripeCustomerError(new Error("No such customer: 'cus_1'"))).toBe(true);

  for (const other of [
    { code: "rate_limit" },
    { type: "api_error" },
    new Error("card_declined"),
    { statusCode: 500 },
    null,
  ]) {
    expect(isMissingStripeCustomerError(other)).toBe(false);
  }
});

test("only genuinely transient failures are retryable", () => {
  for (const transient of [
    { code: "rate_limit" },
    { code: "lock_timeout" },
    { type: "rate_limit_error" },
    { type: "api_error" },
    { type: "api_connection_error" },
    { statusCode: 429 },
    { statusCode: 500 },
    { statusCode: 503 },
  ]) {
    expect(isTransientStripeError(transient), JSON.stringify(transient)).toBe(true);
  }

  for (const permanent of [
    { code: "resource_missing" },
    { type: "card_error" },
    { type: "invalid_request_error" },
    { statusCode: 400 },
    { statusCode: 403 },
    new Error("permission denied"),
    null,
  ]) {
    expect(isTransientStripeError(permanent), JSON.stringify(permanent)).toBe(false);
  }
});

// ── Retry behaviour ───────────────────────────────────────────────────────────

const noSleep = async () => {};

test("a successful delete happens once", async () => {
  let calls = 0;
  const outcome = await deleteStripeCustomerForTest(
    async () => {
      calls += 1;
    },
    "cus_1",
    { sleep: noSleep }
  );
  expect(outcome).toBe("deleted");
  expect(calls).toBe(1);
});

test("an already-missing customer resolves without retrying", async () => {
  let calls = 0;
  const outcome = await deleteStripeCustomerForTest(
    async () => {
      calls += 1;
      throw { code: "resource_missing" };
    },
    "cus_1",
    { sleep: noSleep }
  );
  expect(outcome).toBe("already-gone");
  expect(calls).toBe(1);
});

test("a transient failure is retried a bounded number of times then throws", async () => {
  let calls = 0;
  await expect(
    deleteStripeCustomerForTest(
      async () => {
        calls += 1;
        throw { statusCode: 429, message: "rate limited" };
      },
      "cus_leak",
      { sleep: noSleep }
    )
  ).rejects.toThrow(/Stripe cleanup failed for customer cus_leak after 3 attempt\(s\)/);
  expect(calls).toBe(STRIPE_CLEANUP_MAX_ATTEMPTS);
});

test("a transient failure that then succeeds resolves", async () => {
  let calls = 0;
  const outcome = await deleteStripeCustomerForTest(
    async () => {
      calls += 1;
      if (calls < 2) throw { statusCode: 500 };
    },
    "cus_1",
    { sleep: noSleep }
  );
  expect(outcome).toBe("deleted");
  expect(calls).toBe(2);
});

test("a permanent failure throws immediately with actionable context", async () => {
  let calls = 0;
  await expect(
    deleteStripeCustomerForTest(
      async () => {
        calls += 1;
        throw { type: "invalid_request_error", message: "permission denied" };
      },
      "cus_perm",
      { sleep: noSleep }
    )
  ).rejects.toThrow(/Delete cus_perm manually/);
  expect(calls, "a permanent failure must not be retried").toBe(1);
});

// ── Wiring assertions over the real helper ───────────────────────────────────

test("cleanupTestAccount no longer swallows Stripe failures", () => {
  const source = readFileSync("tests/smoke/helpers.ts", "utf8");

  expect(source).toContain("deleteStripeCustomerForTest");
  expect(source).not.toMatch(/customers\.del\([^)]*\);\s*\n\s*\} catch \{/);
  expect(source).not.toContain("// Already deleted or never fully created");
});

test("the Stripe cleanup runs before any database or Auth deletion", () => {
  const source = readFileSync("tests/smoke/helpers.ts", "utf8");

  const stripeStep = source.indexOf("deleteStripeCustomerForTest");
  const firstDbDelete = source.indexOf("runDelete(");
  const authDelete = source.indexOf("admin.deleteUser");

  expect(stripeStep).toBeGreaterThan(-1);
  expect(stripeStep).toBeLessThan(firstDbDelete);
  expect(stripeStep).toBeLessThan(authDelete);
});

test("signUpFreshAccount gates on the override before doing anything", () => {
  const source = readFileSync("tests/smoke/helpers.ts", "utf8");

  const fn = source.slice(source.indexOf("export async function signUpFreshAccount"));
  const gate = fn.indexOf("assertFreshAccountSignupAllowed");
  const firstNetwork = Math.min(
    ...[fn.indexOf("resetSignupRateLimit"), fn.indexOf("page.goto")].filter((i) => i > -1)
  );

  expect(gate).toBeGreaterThan(-1);
  expect(gate).toBeLessThan(firstNetwork);
  expect(fn).toContain("process.env.ALLOW_PRODUCTION_SIGNUP_SMOKE");
});

// ── The signup API wrapper is the only permitted direct caller ───────────────

import { readdirSync } from "node:fs";
import { postSignupApi, resolveTestStripeCustomerId } from "./smoke-safety";

/** Comments stripped, so a comment can neither satisfy nor fail the check. */
function specCode(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

const APPROVED_WRAPPER_FILES = new Set(["smoke-safety.ts", "helpers.ts"]);

test("no smoke spec posts to /api/auth/signup outside the approved wrapper", () => {
  const dir = "tests/smoke";
  const offenders: string[] = [];

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts")) continue;
    if (APPROVED_WRAPPER_FILES.has(file)) continue;

    const source = specCode(`${dir}/${file}`);
    // A direct POST is `<something>.post("/api/auth/signup"...)`. The wrapper
    // itself is the only place that literal may appear alongside `.post(`.
    if (/\.post\(\s*["'`]\/api\/auth\/signup/.test(source)) offenders.push(file);
  }

  expect(offenders, `these specs must call postSignupApi() instead: ${offenders.join(", ")}`).toEqual([]);
});

test("the wrapper is the only file that names the signup endpoint in a post call", () => {
  const wrapper = specCode("tests/smoke/smoke-safety.ts");
  // Assembled, not written literally, so this spec is not caught by the
  // directory scan above as an offender against its own rule.
  const postCall = "request.post(" + '"/api/auth/signup"';
  expect(wrapper).toContain(postCall);
  expect(wrapper).toContain("assertFreshAccountSignupAllowed(env)");
  // Gate before request, never after.
  expect(wrapper.indexOf("assertFreshAccountSignupAllowed(env)")).toBeLessThan(wrapper.indexOf(postCall));
});

test("the rate-limit spec goes through the wrapper", () => {
  const spec = specCode("tests/smoke/signup-rate-limit.spec.ts");
  expect(spec).toContain("postSignupApi(request,");
  expect(spec).not.toMatch(/\.post\(\s*["'`]\/api\/auth\/signup/);
});

// ── Gate behaviour on the five-account rate-limit path ──────────────────────

function fakeRequest(calls: string[]) {
  return {
    async post(url: string) {
      calls.push(url);
      return { status: () => 200, ok: () => true, json: async () => ({ userId: "u1" }) };
    },
  };
}

test("the five-account rate-limit path is blocked by default on Production", async () => {
  const calls: string[] = [];
  await expect(
    postSignupApi(fakeRequest(calls), { email: "a@b.com", password: "x" }, PROD)
  ).rejects.toThrow(/Refusing to create a fresh signup account/i);
  expect(calls, "no request may be made when the gate refuses").toEqual([]);
});

test("the explicit one-run override permits the Production path", async () => {
  const calls: string[] = [];
  const res = await postSignupApi(fakeRequest(calls), { email: "a@b.com", password: "x" }, {
    ...PROD,
    override: "true",
  });
  expect(res.status()).toBe(200);
  expect(calls).toEqual(["/api/auth/signup"]);
});

test("a local stack needs no override for the signup API", async () => {
  const calls: string[] = [];
  await postSignupApi(fakeRequest(calls), { email: "a@b.com", password: "x" }, LOCAL);
  expect(calls).toEqual(["/api/auth/signup"]);
});

// ── Cleanup resolution when the business row is absent ──────────────────────

test("cleanup finds the customer from metadata when no business row exists", async () => {
  const searched: string[] = [];
  const resolution = await resolveTestStripeCustomerId(
    { userId: "user-1", businessCustomerId: null },
    {
      async searchByUserId(id) {
        searched.push(id);
        return ["cus_from_metadata"];
      },
    }
  );

  expect(resolution).toEqual({ kind: "found", customerId: "cus_from_metadata" });
  expect(searched, "the absent business row must trigger a metadata lookup").toEqual(["user-1"]);
});

test("a business row short-circuits the lookup", async () => {
  let searched = 0;
  const resolution = await resolveTestStripeCustomerId(
    { userId: "user-1", businessCustomerId: "cus_from_row" },
    {
      async searchByUserId() {
        searched += 1;
        return [];
      },
    }
  );

  expect(resolution).toEqual({ kind: "found", customerId: "cus_from_row" });
  expect(searched).toBe(0);
});

test("only a positive empty result counts as nothing to clean", async () => {
  const resolution = await resolveTestStripeCustomerId(
    { userId: "user-1", businessCustomerId: null },
    { async searchByUserId() { return []; } }
  );
  expect(resolution).toEqual({ kind: "none" });
});

test("a failed lookup fails loudly with the user id and never continues", async () => {
  await expect(
    resolveTestStripeCustomerId(
      { userId: "user-42", businessCustomerId: null },
      { async searchByUserId() { throw new Error("stripe unreachable"); } }
    )
  ).rejects.toThrow(/Could not look up the Stripe customer for user user-42[\s\S]*stripe unreachable/);
});

test("an ambiguous lookup refuses to guess", async () => {
  await expect(
    resolveTestStripeCustomerId(
      { userId: "user-9", businessCustomerId: null },
      { async searchByUserId() { return ["cus_a", "cus_b"]; } }
    )
  ).rejects.toThrow(/Ambiguous Stripe cleanup for user user-9: 2 customers match[\s\S]*cus_a, cus_b/);
});

test("cleanup resolves Stripe before touching database or Auth records", () => {
  const full = specCode("tests/smoke/helpers.ts");
  // Measure inside cleanupTestAccount only: runDelete's own definition sits
  // above it and would otherwise be mistaken for the first database call.
  const source = full.slice(full.indexOf("export async function cleanupTestAccount"));

  const resolve = source.indexOf("resolveTestStripeCustomerId(");
  const del = source.indexOf("deleteStripeCustomerForTest(");
  const firstDb = source.indexOf("runDelete(");
  const auth = source.indexOf("admin.deleteUser");

  expect(resolve).toBeGreaterThan(-1);
  expect(resolve).toBeLessThan(del);
  expect(del).toBeLessThan(firstDb);
  expect(del).toBeLessThan(auth);
  // The old conditional that skipped Stripe when the row was missing is gone.
  expect(source).not.toContain("if (business?.stripe_customer_id) {");
});
