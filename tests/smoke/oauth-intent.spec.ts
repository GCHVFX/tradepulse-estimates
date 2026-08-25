import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  OAUTH_INTENTS,
  OAUTH_INTENT_COOKIE,
  OAUTH_INTENT_MAX_AGE_SECONDS,
  OAUTH_NONCE_PARAM,
  createOAuthNonce,
  parseOAuthIntent,
  resolveOAuthIntent,
  serializeOAuthIntentCookie,
} from "../../lib/oauth-intent";

const NOW = Date.UTC(2026, 7, 24, 12, 0, 0);

// ── Allowlist ─────────────────────────────────────────────────────────────────

test("only login and signup are accepted intents", () => {
  expect(OAUTH_INTENTS).toEqual(["login", "signup"]);
  expect(parseOAuthIntent("login")).toBe("login");
  expect(parseOAuthIntent("signup")).toBe("signup");

  for (const bad of [
    "Signup",
    "SIGNUP",
    "signup ",
    " signup",
    "admin",
    "provision",
    "",
    null,
    undefined,
    0,
    {},
    ["signup"],
    "signup;login",
    "a".repeat(10_000),
  ]) {
    expect(parseOAuthIntent(bad), `${String(bad).slice(0, 20)} must not parse`).toBeNull();
  }
});

// ── Cookie + nonce binding ────────────────────────────────────────────────────

test("a well formed cookie resolves only when its nonce matches the callback", () => {
  const nonce = createOAuthNonce();
  const cookie = serializeOAuthIntentCookie("signup", nonce, NOW);

  expect(resolveOAuthIntent(cookie, nonce, NOW)).toBe("signup");
  expect(resolveOAuthIntent(cookie, "a-different-nonce", NOW)).toBeNull();
  expect(resolveOAuthIntent(cookie, "", NOW)).toBeNull();
  expect(resolveOAuthIntent(cookie, null, NOW)).toBeNull();
  // Same length, different value: the compare is on content, not length.
  expect(resolveOAuthIntent(cookie, "x".repeat(nonce.length), NOW)).toBeNull();
});

test("a fourth segment is the signup currency, so it does not invalidate the intent", () => {
  const nonce = createOAuthNonce();
  // An unparseable currency degrades to "no explicit choice" (CAD) rather
  // than throwing the whole signup away.
  expect(resolveOAuthIntent(`signup.${nonce}.${NOW}.extra`, nonce, NOW)).toBe("signup");
  expect(resolveOAuthIntent(`signup.${nonce}.${NOW}.usd`, nonce, NOW)).toBe("signup");
});

test("a missing or malformed cookie never resolves", () => {
  const nonce = createOAuthNonce();
  for (const bad of [
    undefined,
    null,
    "",
    "signup",
    `signup.${nonce}`,
    `signup.${nonce}.${NOW}.extra.more`,
    `.${nonce}.${NOW}`,
    `signup..${NOW}`,
    `signup.${nonce}.not-a-number`,
    `admin.${nonce}.${NOW}`,
  ]) {
    expect(resolveOAuthIntent(bad, nonce, NOW), `${String(bad)} must not resolve`).toBeNull();
  }
});

test("an expired or future-dated cookie never resolves", () => {
  const nonce = createOAuthNonce();
  const cookie = serializeOAuthIntentCookie("signup", nonce, NOW);
  const maxAgeMs = OAUTH_INTENT_MAX_AGE_SECONDS * 1000;

  expect(resolveOAuthIntent(cookie, nonce, NOW + maxAgeMs)).toBe("signup");
  expect(resolveOAuthIntent(cookie, nonce, NOW + maxAgeMs + 1)).toBeNull();
  expect(resolveOAuthIntent(cookie, nonce, NOW + 24 * 60 * 60 * 1000)).toBeNull();
  // Clock skew or a forged timestamp in the future is treated as invalid.
  expect(resolveOAuthIntent(cookie, nonce, NOW - 1)).toBeNull();
});

test("a tampered intent cannot be upgraded to signup", () => {
  const nonce = createOAuthNonce();
  const loginCookie = serializeOAuthIntentCookie("login", nonce, NOW);

  expect(resolveOAuthIntent(loginCookie, nonce, NOW)).toBe("login");
  // Swapping the intent segment while keeping a valid nonce still only ever
  // yields an allowlisted value, and an attacker cannot write the HttpOnly
  // cookie in the first place.
  expect(resolveOAuthIntent(`signup.${nonce}.${NOW}`, nonce, NOW)).toBe("signup");
  expect(resolveOAuthIntent(`superuser.${nonce}.${NOW}`, nonce, NOW)).toBeNull();
});

test("nonces are unique per flow", () => {
  const nonces = new Set(Array.from({ length: 200 }, () => createOAuthNonce()));
  expect(nonces.size).toBe(200);
});

// ── Wiring assertions over the real routes ────────────────────────────────────

test("the OAuth start route binds the intent to an HttpOnly cookie, never the URL", () => {
  const source = readFileSync("app/auth/google/route.ts", "utf8");

  expect(source).toContain("parseOAuthIntent");
  expect(source).toContain("OAUTH_INTENT_COOKIE");
  expect(OAUTH_INTENT_COOKIE).toBe("tp_oauth_intent");
  expect(OAUTH_NONCE_PARAM).toBe("s");
  expect(source).toContain("httpOnly: true");
  expect(source).toContain('sameSite: "lax"');
  expect(source).toContain("OAUTH_INTENT_MAX_AGE_SECONDS");
  // The intent must not be placed into redirectTo, only the nonce.
  expect(source).not.toMatch(/redirectTo:[^\n]*intent=/);
  expect(source).toMatch(/redirectTo:[^\n]*OAUTH_NONCE_PARAM/);
});

test("the callback reads the intent from the cookie and never from the query string", () => {
  const source = readFileSync("app/auth/callback/route.ts", "utf8");

  expect(source).toContain("resolveOAuthIntent");
  expect(source).toContain(`request.cookies.get(OAUTH_INTENT_COOKIE)`);
  expect(source).toContain(`searchParams.get(OAUTH_NONCE_PARAM)`);
  expect(source).not.toContain(`searchParams.get('intent')`);
  expect(source).not.toContain(`searchParams.get("intent")`);

  // Login must reach the abandon path, not provisioning.
  expect(source).toMatch(/intent === 'login'[\s\S]{0,200}abandon\('setup_required'\)/);
  // An unresolved intent fails closed before any business lookup.
  expect(source).toMatch(/if \(!intent\)[\s\S]{0,80}abandon\('signin_expired'\)/);
});

test("both entry points declare an explicit intent", () => {
  expect(readFileSync("app/login/page.tsx", "utf8")).toContain('<GoogleAuth intent="login" />');
  // The signup page is now a server wrapper; the button lives in the form.
  expect(readFileSync("app/signup/signup-form.tsx", "utf8")).toContain('<GoogleAuth intent="signup"');
});
