/**
 * /subscribe must show the currency the business is actually billed in.
 *
 * Observed on Production: a Canadian account viewed through a US VPN landed on
 * /subscribe and saw a card reading a bare `$59/month` next to a button
 * reading `Upgrade to Pro, CA$59/month`. The card printed a hardcoded CAD
 * number with no currency at all, and the button hardcoded "cad". A
 * USD-billed contractor would have been shown `$59` and `CA$59` while Checkout
 * charged them US$39.
 *
 * The rule now lives in lib/billing-currency.ts and is shared with
 * /api/billing/checkout, so the card, the button, and the charge cannot
 * disagree. These tests exercise that rule directly and then check the wiring.
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  lockedSubscriptionCurrency,
  resolveBillingCurrency,
  type BillingSubscription,
} from "../../lib/billing-currency";
import {
  currencyPrefix,
  formatMonthlyPlanPrice,
  planMonthlyPrice,
  type BillingPlan,
  type Currency,
} from "../../lib/currency";

/** Source with comments removed, so a comment can neither satisfy nor fail an assertion. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
}

/** Everything /subscribe renders for one business, via the page's own rule. */
async function subscribeSurface(input: {
  subscription?: BillingSubscription | null;
  estimateCurrency: Currency;
  plan: BillingPlan;
}) {
  const currency = await resolveBillingCurrency({
    subscription: input.subscription ?? null,
    readEstimateCurrency: async () => input.estimateCurrency,
  });
  return {
    currency,
    card: `${currencyPrefix(currency)}${planMonthlyPrice(input.plan, currency)}`,
    subscribeCta: `Subscribe, ${formatMonthlyPlanPrice(input.plan, currency)}`,
    upgradeCta: `Upgrade to Pro, ${formatMonthlyPlanPrice("pro", currency)}`,
  };
}

// ── The rule ────────────────────────────────────────────────────────────────

test("an existing CAD account shows CA$59 on the card, the button, and checkout", async () => {
  // The business record deliberately disagrees. A live subscription outranks
  // it, because Stripe has already locked the Customer to that currency.
  const s = await subscribeSurface({
    subscription: { status: "active", currency: "cad" },
    estimateCurrency: "usd",
    plan: "pro",
  });

  expect(s.currency).toBe("cad");
  expect(s.card).toBe("CA$59");
  expect(s.subscribeCta).toBe("Subscribe, CA$59/month");
  expect(s.upgradeCta).toBe("Upgrade to Pro, CA$59/month");
});

test("an existing USD account shows US$39 on the card, the button, and checkout", async () => {
  const s = await subscribeSurface({
    subscription: { status: "trialing", currency: "usd" },
    estimateCurrency: "cad",
    plan: "pro",
  });

  expect(s.currency).toBe("usd");
  expect(s.card).toBe("US$39");
  expect(s.subscribeCta).toBe("Subscribe, US$39/month");
  expect(s.upgradeCta).toBe("Upgrade to Pro, US$39/month");
});

test("with no subscription the business's own currency decides", async () => {
  const cad = await subscribeSurface({ subscription: null, estimateCurrency: "cad", plan: "pro" });
  const usd = await subscribeSurface({ subscription: null, estimateCurrency: "usd", plan: "pro" });

  expect(cad.card).toBe("CA$59");
  expect(usd.card).toBe("US$39");
});

test("a cancelled or expired subscription no longer pins the currency", async () => {
  for (const status of ["canceled", "incomplete_expired"]) {
    expect(lockedSubscriptionCurrency({ status, currency: "usd" }), status).toBeNull();

    const s = await subscribeSurface({
      subscription: { status, currency: "usd" },
      estimateCurrency: "cad",
      plan: "pro",
    });
    expect(s.card, status).toBe("CA$59");
  }

  // Everything still running does pin it.
  for (const status of ["active", "trialing", "past_due", "unpaid", "paused"]) {
    expect(lockedSubscriptionCurrency({ status, currency: "usd" }), status).toBe("usd");
  }
});

test("the button currency always matches the card currency", async () => {
  for (const estimateCurrency of ["cad", "usd"] as const) {
    for (const plan of ["starter", "pro"] as const) {
      const s = await subscribeSurface({ subscription: null, estimateCurrency, plan });
      const prefix = currencyPrefix(s.currency);

      expect(s.card.startsWith(prefix), `${estimateCurrency}/${plan} card`).toBe(true);
      expect(s.subscribeCta.includes(prefix), `${estimateCurrency}/${plan} button`).toBe(true);
      // The other currency must appear nowhere on the surface.
      const other = s.currency === "cad" ? "US$" : "CA$";
      expect(`${s.card} ${s.subscribeCta} ${s.upgradeCta}`).not.toContain(other);
    }
  }
});

test("no amount on /subscribe is ever printed as a bare $", async () => {
  for (const estimateCurrency of ["cad", "usd"] as const) {
    for (const plan of ["starter", "pro"] as const) {
      const s = await subscribeSurface({ subscription: null, estimateCurrency, plan });
      for (const rendered of [s.card, s.subscribeCta, s.upgradeCta]) {
        expect(rendered).toMatch(/(CA|US)\$/);
        expect(rendered, `${rendered} must not contain a bare $ amount`).not.toMatch(/(?<![A-Z])\$\d/);
      }
    }
  }

  // The markup itself. `<span ...>${plan.price}</span>` is what rendered $59.
  const picker = code("app/components/plan-picker.tsx");
  expect(picker).not.toContain("${plan.price}");
  expect(picker).not.toContain("PLAN_MONTHLY_PRICES_CAD");
  expect(picker).toContain("currencyPrefix(currency)");
});

// ── Wiring ──────────────────────────────────────────────────────────────────

test("/subscribe and checkout share one billing-currency rule", () => {
  const page = code("app/subscribe/page.tsx");
  const checkout = code("app/api/billing/checkout/route.ts");

  expect(page).toContain("resolveBillingCurrency");
  expect(checkout).toContain("lockedSubscriptionCurrency");
  for (const source of [page, checkout]) {
    expect(source).toContain("@/lib/billing-currency");
  }

  // Neither may re-derive the rule locally.
  expect(page).not.toContain('=== "canceled"');
  expect(checkout).not.toContain('=== "canceled"');
});

test("the plan card takes a required currency instead of assuming CAD", () => {
  const picker = code("app/components/plan-picker.tsx");
  const page = code("app/subscribe/page.tsx");

  expect(picker).toContain("currency: Currency;");
  expect(picker).not.toContain('formatMonthlyPlanPrice(selected, "cad")');
  expect(page).toContain("currency={billingCurrency}");
  expect(page).toContain('formatMonthlyPlanPrice("pro", billingCurrency)');
});

test("a signed-in contractor's billing currency never comes from their IP", () => {
  // This is the whole point of keeping geo out of the shared rule: an existing
  // customer opening a VPN must not appear to change what they are billed.
  const rule = code("lib/billing-currency.ts");
  expect(rule).not.toContain("currencyFromCountry");
  expect(rule).not.toContain("x-vercel-ip-country");
  expect(rule).not.toContain("headers");

  // On the page, geo is only the seed for the signed-out preview; a business
  // always overwrites it through the shared rule.
  const page = code("app/subscribe/page.tsx");
  expect(page).toMatch(/if \(business\) \{[\s\S]*billingCurrency = await resolveBillingCurrency\(/);
});

// ── Escape path ─────────────────────────────────────────────────────────────

test("/subscribe is not a dead end for an account with no access", () => {
  // A Pro signup that has not paid is subscription_status "incomplete", which
  // correctly has no access. It also has no Stripe subscription and no trial
  // end date, so the billing-portal button and the "continue trial" link both
  // render nothing. The proxy sends every other authenticated route back here.
  // Before this, the page had no navigation at all: pay or clear cookies.
  const page = code("app/subscribe/page.tsx");

  expect(page).toContain("SubscribeSignOut");
  expect(page).toContain("Signed in as {user.email}");
  // Shown to any signed-in visitor, not gated on a billing state that these
  // accounts do not have.
  expect(page).toMatch(/\{user && !isPreview && \([\s\S]{0,400}SubscribeSignOut/);
});

test("the escape path signs out and grants no access", () => {
  const button = code("app/components/subscribe-sign-out.tsx");

  expect(button).toContain("auth.signOut()");
  expect(button).toContain('router.push("/login")');
  // It must not touch the gate, the plan, or any billing state.
  for (const forbidden of ["subscription_status", "plan", "stripe", "hasAccess", "complimentary"]) {
    expect(button.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
  }
});

test("the subscription gate itself is unchanged", () => {
  const proxy = code("proxy.ts");

  // The rule that redirects to /subscribe must still be exactly this. Nothing
  // in this task may widen it.
  expect(proxy).toContain('const isActive = business.subscription_status === "active";');
  expect(proxy).toMatch(/isActive \|\| isTrialing \|\| business\.subscription_status === "complimentary"/);
  expect(proxy).toMatch(/if \(!hasAccess && pathname !== "\/subscribe"\)/);
});

// ── Recovery block placement and mobile spacing ─────────────────────────────

test("the recovery block renders before the price card and the CTA", () => {
  // It used to sit below the card, the CTA, the guarantee copy, and a divider.
  // Measured at 375x812 that put Sign out at y=1077 on an 812px viewport, so
  // someone in the wrong account would never have found it. It now renders at
  // y=260, directly under the description.
  const page = code("app/subscribe/page.tsx");

  const recovery = page.indexOf("Not the account you meant to use?");
  const signOut = page.indexOf("<SubscribeSignOut />");
  const description = page.indexOf("{description}");
  const planPicker = page.indexOf("<PlanPicker");
  const guarantee = page.indexOf("Powered by Stripe");

  expect(recovery, "recovery block must exist").toBeGreaterThan(-1);
  expect(recovery, "recovery belongs under the description").toBeGreaterThan(description);
  expect(recovery, "recovery belongs above the price card").toBeLessThan(planPicker);
  expect(signOut, "Sign out belongs above the price card").toBeLessThan(planPicker);
  expect(signOut, "Sign out belongs above the guarantee copy").toBeLessThan(guarantee);

  // The email stays, so someone can tell which account they are in.
  expect(page).toContain("Signed in as {user.email}");
});

test("relocating the recovery block did not turn it into a billing control", () => {
  const page = code("app/subscribe/page.tsx");
  // Exactly the recovery block: its opening guard to its closing brace. A
  // looser slice runs into `showPlanPicker` and matches "PlanPicker" by
  // accident, which is a false positive rather than a real finding.
  const start = page.indexOf("{user && !isPreview && (");
  const block = page.slice(start, page.indexOf(")}", start) + 2);

  // Sign-out only. No plan, subscription, checkout, or portal action may live
  // in this block, and it must not have grown a form that posts anywhere.
  for (const forbidden of ["/api/billing", "checkoutPathForPlan", "submitAction", "method=\"POST\"", "PlanPicker"]) {
    expect(block, forbidden).not.toContain(forbidden);
  }
  expect(block).toContain("<SubscribeSignOut />");
});

test("mobile top spacing is reduced without moving desktop", () => {
  const page = code("app/subscribe/page.tsx");

  const wrapper = page.match(/className="min-h-dvh[^"]*"/)![0];
  // Measured at 375x812: py-16 left a 64px gap above the icon and pushed the
  // page to 1221px. py-8 halves it to 32px, which is what keeps the relocated
  // Sign out inside the first viewport. Tailwind spacing is 4px per step.
  const mobilePy = Number(wrapper.match(/(?:^|\s)py-(\d+)(?:\s|")/)![1]) * 4;
  expect(mobilePy, "mobile vertical padding").toBeLessThanOrEqual(32);

  // Desktop keeps its own value through a separate sm: class. Measured
  // identical at 1280x800 before and after: 64px padding, 64px gap.
  expect(wrapper).toContain("sm:py-16");
});
