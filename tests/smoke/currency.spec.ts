import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  PLAN_MONTHLY_PRICES,
  allAmountsInLabel,
  currencyFromCountry,
  currencyOrDefault,
  formatCurrency,
  formatMonthlyPlanPrice,
  parseCurrency,
  trialCopy,
} from "../../lib/currency";
import {
  createOAuthNonce,
  resolveOAuthIntent,
  resolveOAuthSignupCurrency,
  serializeOAuthIntentCookie,
} from "../../lib/oauth-intent";
import { formatDollars, formatMoney, parseCost, parseSummary, serializeSummary } from "../../lib/estimate-summary";

const NOW = Date.UTC(2026, 7, 25, 12, 0, 0);

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
}

// ── Country defaults ─────────────────────────────────────────────────────────

test("only the United States defaults to USD", () => {
  expect(currencyFromCountry("US")).toBe("usd");
  expect(currencyFromCountry("us")).toBe("usd");
  expect(currencyFromCountry(" US ")).toBe("usd");
});

test("Canada, unknown, and every other country default to CAD", () => {
  for (const country of ["CA", "ca", "GB", "MX", "FR", "AU", "XX", "", "  ", null, undefined]) {
    expect(currencyFromCountry(country as string | null), `${String(country)} must default to CAD`).toBe("cad");
  }
  expect(DEFAULT_CURRENCY).toBe("cad");
});

// ── Override allowlisting ────────────────────────────────────────────────────

test("only cad and usd are accepted currencies", () => {
  expect(CURRENCIES).toEqual(["cad", "usd"]);
  expect(parseCurrency("cad")).toBe("cad");
  expect(parseCurrency("USD")).toBe("usd");
  expect(parseCurrency(" Cad ")).toBe("cad");

  for (const bad of ["eur", "gbp", "aud", "cad;usd", "", "$", null, undefined, 0, {}, ["usd"], "c".repeat(5000)]) {
    expect(parseCurrency(bad), `${String(bad).slice(0, 12)} must not parse`).toBeNull();
  }
});

test("tampered or missing currency falls back to CAD rather than failing", () => {
  for (const bad of ["eur", "", null, undefined, {}, 42]) {
    expect(currencyOrDefault(bad)).toBe("cad");
  }
  expect(currencyOrDefault("usd")).toBe("usd");
});

// ── Display formatting ───────────────────────────────────────────────────────

test("amounts always distinguish CA$ from US$ and never emit a bare $", () => {
  expect(formatCurrency(1234, "cad")).toBe("CA$1,234");
  expect(formatCurrency(1234, "usd")).toBe("US$1,234");
  expect(formatCurrency(1234.5, "cad", { decimals: 2 })).toBe("CA$1,234.50");
  expect(formatCurrency(1234.5, "usd", { decimals: 2 })).toBe("US$1,234.50");

  for (const rendered of [
    formatCurrency(10, "cad"),
    formatCurrency(10, "usd"),
    formatDollars(10, "cad"),
    formatDollars(10, "usd"),
    formatMoney(10, "cad"),
    formatMoney(10, "usd"),
  ]) {
    expect(rendered, `${rendered} must carry a currency prefix`).toMatch(/^(CA|US)\$/);
  }
});

test("the estimate serializer has no currency default to fall back to", () => {
  // The USD rendering defect: formatEstimateForDisplay() and friends took
  // `currency: Currency = DEFAULT_CURRENCY`, so any caller that forgot to
  // pass the snapshot silently rendered CA$ on a USD estimate. Removing the
  // import is what makes that unrepresentable rather than merely discouraged.
  const summary = code("lib/estimate-summary.ts");
  expect(summary).not.toContain("DEFAULT_CURRENCY");
  expect(summary).not.toMatch(/currency: Currency\s*=/);

  // Explicit CAD still renders exactly as it always did.
  expect(formatDollars(1234, "cad")).toBe("CA$1,234");
  expect(formatMoney(12.5, "cad")).toBe("CA$12.50");
});

test("plan prices are separate price points, not conversions", () => {
  expect(PLAN_MONTHLY_PRICES).toEqual({ cad: { starter: 29, pro: 59 }, usd: { starter: 19, pro: 39 } });
  expect(formatMonthlyPlanPrice("starter", "cad")).toBe("CA$29/month");
  expect(formatMonthlyPlanPrice("pro", "cad")).toBe("CA$59/month");
  expect(formatMonthlyPlanPrice("starter", "usd")).toBe("US$19/month");
  expect(formatMonthlyPlanPrice("pro", "usd")).toBe("US$39/month");
});

test("signup trial copy is unambiguous in both currencies", () => {
  expect(trialCopy("starter", "cad")).toBe("14-day free trial, then CA$29/month");
  expect(trialCopy("starter", "usd")).toBe("14-day free trial, then US$19/month");
  expect(trialCopy("pro", "cad")).toBe("14-day free trial, then CA$59/month");
  expect(trialCopy("pro", "usd")).toBe("14-day free trial, then US$39/month");
  expect(allAmountsInLabel("cad")).toBe("All amounts in CAD");
  expect(allAmountsInLabel("usd")).toBe("All amounts in USD");
});

// ── Parsing must survive the new prefixes ────────────────────────────────────

test("amount parsing tolerates CA$ and US$ as well as bare $", () => {
  expect(parseCost("CA$1,234.00")).toBe(1234);
  expect(parseCost("US$1,234.00")).toBe(1234);
  expect(parseCost("$285.00")).toBe(285);
  expect(parseCost("**CA$1,840.00**")).toBe(1840);
  // Genuinely unreadable amounts still resolve to 0, unchanged behaviour.
  expect(parseCost("approx. $40-$60")).toBe(0);
  expect(parseCost("TBD")).toBe(0);
});

test("a USD estimate round-trips through serialize and parse without losing amounts", () => {
  const items = [{ id: "a", label: "Labour", cost: "US$285.00" }];
  const usd = serializeSummary("", [], items, 0, [], [], "GST", 5, "usd");
  expect(usd).toContain("US$");
  expect(usd).not.toMatch(/(?<![A-Z])\$\d/);

  const reparsed = parseSummary(usd);
  const total = reparsed.lineItems.reduce((sum, i) => sum + parseCost(i.cost), 0);
  expect(total).toBe(285);
});

// ── OAuth: currency bound to the signup intent only ──────────────────────────

test("Google signup carries only its bound currency through OAuth", () => {
  const nonce = createOAuthNonce();
  const cookie = serializeOAuthIntentCookie("signup", nonce, NOW, "usd");

  expect(resolveOAuthIntent(cookie, nonce, NOW)).toBe("signup");
  expect(resolveOAuthSignupCurrency(cookie, nonce, NOW)).toBe("usd");
  // A mismatched nonce invalidates the currency along with the intent.
  expect(resolveOAuthSignupCurrency(cookie, "wrong-nonce", NOW)).toBeNull();
  // Expiry invalidates it too.
  expect(resolveOAuthSignupCurrency(cookie, nonce, NOW + 11 * 60 * 1000)).toBeNull();
});

test("Google login can neither carry nor use a signup currency", () => {
  const nonce = createOAuthNonce();

  // A login cookie never serializes a currency, even if one is passed.
  const loginCookie = serializeOAuthIntentCookie("login", nonce, NOW, "usd");
  expect(loginCookie).toBe(`login.${nonce}.${NOW}`);
  expect(resolveOAuthSignupCurrency(loginCookie, nonce, NOW)).toBeNull();

  // Even a hand-crafted login cookie with a currency segment yields nothing.
  expect(resolveOAuthSignupCurrency(`login.${nonce}.${NOW}.usd`, nonce, NOW)).toBeNull();
});

test("a tampered or unknown currency segment resolves to null, not to USD", () => {
  const nonce = createOAuthNonce();
  for (const bad of ["eur", "", "usd;cad", "USDX"]) {
    expect(resolveOAuthSignupCurrency(`signup.${nonce}.${NOW}.${bad}`, nonce, NOW)).toBeNull();
  }
  // A signup with no currency segment is simply "no explicit choice".
  expect(resolveOAuthSignupCurrency(`signup.${nonce}.${NOW}`, nonce, NOW)).toBeNull();
});

// ── Wiring assertions over the real routes ───────────────────────────────────

test("signup reads the country server-side and never geolocates the browser", () => {
  const page = code("app/signup/page.tsx");
  expect(page).toContain("x-vercel-ip-country");
  expect(page).toContain("currencyFromCountry");

  const form = code("app/signup/signup-form.tsx");
  for (const banned of ["navigator.geolocation", "getCurrentPosition", "ipapi", "geoip"]) {
    expect(form).not.toContain(banned);
    expect(page).not.toContain(banned);
  }
  // The country itself is never persisted, only the resulting currency.
  expect(page).not.toContain("country:");
});

test("email signup passes the validated currency into provisioning", () => {
  const route = code("app/api/auth/signup/route.ts");
  expect(route).toContain("currencyOrDefault(body.currency)");
  expect(route).toContain("businessEstimateCurrencyPatch(currency)");
  expect(route).toMatch(/\{ userId, email, plan, currency, deleteAuthUserOnFailure: true \}/);
});

test("the direct trial subscription selects its currency explicitly", () => {
  const server = code("lib/account-provisioning-server.ts");
  expect(server).toMatch(/createTrialSubscription\(\{ customerId, currency \}\)/);
  expect(server).toMatch(/subscriptions\.create\(\{[\s\S]{0,200}currency,/);
  // Same Price ID for both currencies: no separate USD price.
  expect(server).toContain("process.env.STRIPE_PRICE_ID!");
  expect(server).not.toContain("STRIPE_PRICE_ID_USD");
});

test("Checkout prefers a current subscription currency and disables adaptive pricing", () => {
  const route = code("app/api/billing/checkout/route.ts");

  expect(route).toContain("adaptive_pricing: { enabled: false }");
  expect(route).toContain("currency: resolvedCurrency");
  // Current non-cancelled subscription wins.
  expect(route).toMatch(/status !== "canceled"[\s\S]{0,160}billingCurrency = currencyOrDefault\(existing\.currency\)/);
  // Only when nothing locks it does the business estimate currency apply.
  expect(route).toMatch(/billingCurrency \?\? \(await readBusinessEstimateCurrency/);
});

test("changing Profile estimate currency never calls Stripe and only writes when valid", () => {
  const route = code("app/api/profile/route.ts");

  expect(route).toContain("parseCurrency");
  expect(route).toMatch(/estimateCurrency \? businessEstimateCurrencyPatch\(estimateCurrency\) : \{\}/);
  expect(route.toLowerCase()).not.toContain("stripe");
});

test("a new estimate snapshots the business estimate currency", () => {
  const route = code("app/api/generate-estimate/route.ts");
  expect(route).toContain("estimateCurrencyPatch");
  expect(route).toContain("readBusinessEstimateCurrency(supabaseAdmin, business.id)");
});

test("existing Price-ID webhook mapping is unchanged", () => {
  const webhook = code("lib/stripe-webhook.ts");
  expect(webhook).toContain("toWebhookPlan");
  expect(webhook.toLowerCase()).not.toContain("currency");
});

test("the migration is additive, constrained, and backfills every row to cad", () => {
  const sql = readFileSync("supabase/migrations/20260825000000_add_currency_columns.sql", "utf8");

  expect(sql).toContain("add column if not exists estimate_currency text not null default 'cad'");
  expect(sql).toContain("add column if not exists currency text not null default 'cad'");
  expect(sql).toContain("check (estimate_currency in ('cad', 'usd'))");
  expect(sql).toContain("check (currency in ('cad', 'usd'))");
  // Additive only: nothing is dropped, renamed, or given a new RLS policy.
  // Statements only, so the "-- no SECURITY DEFINER" note does not match.
  const statements = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .toLowerCase();

  expect(statements).not.toContain("drop ");
  expect(statements).not.toContain("security definer");
  expect(statements).not.toContain("create policy");
  expect(statements).not.toContain("alter policy");
});

test("no superseded $39 or $69 plan pricing remains on product surfaces", () => {
  for (const path of [
    "lib/currency.ts",
    "lib/plan-pricing.ts",
    "app/page.tsx",
    "app/opengraph-image.tsx",
    "app/signup/signup-form.tsx",
    "app/components/plan-picker.tsx",
    "app/subscribe/page.tsx",
  ]) {
    const source = readFileSync(path, "utf8");
    expect(source, `${path} must not quote the superseded 39/month price`).not.toMatch(/\$39\b|\bCA\$39\b/);
    expect(source, `${path} must not quote the superseded 69/month price`).not.toMatch(/\$69\b|\bCA\$69\b/);
  }
});

test("public pricing states CA$ explicitly and never a bare $ amount", () => {
  const home = readFileSync("app/page.tsx", "utf8");
  expect(home).toContain("CA${STARTER_MONTHLY_PRICE_CAD}");
  expect(home).toContain("CA${PRO_MONTHLY_PRICE_CAD}");
  expect(home).not.toContain('">${STARTER_MONTHLY_PRICE_CAD}<');
  expect(home).not.toContain('">${PRO_MONTHLY_PRICE_CAD}<');
});
