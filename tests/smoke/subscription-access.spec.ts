/**
 * Regression tests for the consolidated subscription access gate.
 *
 * Before lib/subscription-access.ts existed, nine call sites each
 * reimplemented `isActive || isTrialing || complimentary` against the raw
 * stored subscription_status, while lib/subscription-display.ts separately
 * resolved a *corrected* status for the profile badge. The two could
 * disagree, and did: a Pro business stuck at subscription_status "trial"
 * past trial_ends_at rendered an "Active" badge while every gate redirected
 * it to /subscribe, giving the customer no stated reason for the lockout.
 *
 * These tests assert on the values the shared predicate and the shared badge
 * function actually produce -- no mocked Supabase, no mocked Stripe.
 */
import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  hasSubscriptionAccess,
  hasLiveSubscriptionId,
  resolveSubscriptionStatus,
  SUBSCRIPTION_ACCESS_COLUMNS,
  type SubscriptionAccessBusiness,
} from "../../lib/subscription-access";
import { resolveProfileBadge } from "../../lib/subscription-display";

const NOW = new Date("2026-08-28T20:00:00.000Z");
const PAST = new Date("2026-08-01T00:00:00.000Z").toISOString();
const FUTURE = new Date("2026-09-30T00:00:00.000Z").toISOString();
const LIVE_SUB = "sub_1U9cU7Q45KFNqa8xBHKwUxEU";

// ---------------------------------------------------------------------------
// Task 5: behaviour
// ---------------------------------------------------------------------------

test("Pro, status trial, trial_ends_at in the past, live subscription id: access granted", () => {
  // The exact confirmed-in-production row from 2026-08-29, with its trial
  // date rolled past. Before the consolidation this was a hard lockout for a
  // paying customer.
  expect(
    hasSubscriptionAccess(
      {
        plan: "pro",
        subscription_status: "trial",
        trial_ends_at: PAST,
        stripe_subscription_id: LIVE_SUB,
      },
      NOW
    )
  ).toBe(true);
});

test("Pro, status trial, past trial_ends_at, but NO subscription id: access denied", () => {
  // The rescue is deliberately narrow: a Pro-plan row with no subscription
  // on record has not paid for anything, so it is not rescued.
  expect(
    hasSubscriptionAccess(
      { plan: "pro", subscription_status: "trial", trial_ends_at: PAST, stripe_subscription_id: null },
      NOW
    )
  ).toBe(false);
  // An empty string is not a live subscription either (blank-checked, not
  // nullish-checked -- matching lib/site-url.ts and lib/twilio-send.ts).
  expect(
    hasSubscriptionAccess(
      { plan: "pro", subscription_status: "trial", trial_ends_at: PAST, stripe_subscription_id: "   " },
      NOW
    )
  ).toBe(false);
});

test("Starter, status trial, trial_ends_at in the past: access denied", () => {
  expect(
    hasSubscriptionAccess(
      { plan: "starter", subscription_status: "trial", trial_ends_at: PAST, stripe_subscription_id: LIVE_SUB },
      NOW
    )
  ).toBe(false);
});

test("Starter, status trial, trial_ends_at in the future: access granted", () => {
  expect(
    hasSubscriptionAccess(
      { plan: "starter", subscription_status: "trial", trial_ends_at: FUTURE, stripe_subscription_id: LIVE_SUB },
      NOW
    )
  ).toBe(true);
});

test("complimentary: access granted, with or without any trial date", () => {
  // Preserved exactly as it worked before the consolidation -- no date is
  // consulted for a complimentary account.
  expect(
    hasSubscriptionAccess(
      { plan: "starter", subscription_status: "complimentary", trial_ends_at: PAST, stripe_subscription_id: null },
      NOW
    )
  ).toBe(true);
  expect(
    hasSubscriptionAccess(
      { plan: "pro", subscription_status: "complimentary", trial_ends_at: null, stripe_subscription_id: null },
      NOW
    )
  ).toBe(true);
});

test("past_due, canceled, cancelled, unpaid, and incomplete are all denied -- today's behaviour, pinned", () => {
  // None of these were ever granted by the original nine call sites. Pinned
  // here so a future change to the shared predicate cannot silently start
  // letting one of them through. "incomplete" matters in particular: it is
  // what lib/account-provisioning.ts writes for a direct Pro signup that has
  // not completed Checkout yet.
  for (const status of ["past_due", "canceled", "cancelled", "unpaid", "incomplete"]) {
    for (const plan of ["starter", "pro"]) {
      expect(
        hasSubscriptionAccess(
          { plan, subscription_status: status, trial_ends_at: FUTURE, stripe_subscription_id: LIVE_SUB },
          NOW
        ),
        `${plan} / ${status} must be denied`
      ).toBe(false);
    }
  }
});

test("a missing business, a missing status, and an unrecognized status are all denied", () => {
  expect(hasSubscriptionAccess(null, NOW)).toBe(false);
  expect(hasSubscriptionAccess(undefined, NOW)).toBe(false);
  expect(
    hasSubscriptionAccess(
      { plan: null, subscription_status: null, trial_ends_at: null, stripe_subscription_id: null },
      NOW
    ),
    "every field null"
  ).toBe(false);
  expect(
    hasSubscriptionAccess(
      { plan: "pro", subscription_status: null, trial_ends_at: null, stripe_subscription_id: null },
      NOW
    ),
    "pro with no status"
  ).toBe(false);
  expect(
    hasSubscriptionAccess(
      { plan: null, subscription_status: "something_new", trial_ends_at: null, stripe_subscription_id: null },
      NOW
    ),
    "unrecognized status"
  ).toBe(false);
});

test("a trial grants access right up to trial_ends_at and not past it", () => {
  const business: SubscriptionAccessBusiness = {
    plan: "starter",
    subscription_status: "trial",
    trial_ends_at: "2026-08-28T20:00:00.000Z",
    stripe_subscription_id: null,
  };
  expect(hasSubscriptionAccess(business, new Date("2026-08-28T19:59:00.000Z")), "before expiry").toBe(true);
  expect(hasSubscriptionAccess(business, new Date("2026-08-28T20:01:00.000Z")), "after expiry").toBe(false);
});

test("hasLiveSubscriptionId blank-checks rather than nullish-checks", () => {
  expect(hasLiveSubscriptionId(LIVE_SUB)).toBe(true);
  expect(hasLiveSubscriptionId(null)).toBe(false);
  expect(hasLiveSubscriptionId(undefined)).toBe(false);
  expect(hasLiveSubscriptionId("")).toBe(false);
  expect(hasLiveSubscriptionId("   ")).toBe(false);
});

// ---------------------------------------------------------------------------
// Task 5: the badge and the gate agree for every combination above
// ---------------------------------------------------------------------------

/** Badge labels that tell the customer they are entitled to use the app. */
const ENTITLED_LABELS = new Set(["Subscription active", "Complimentary"]);
/** Badge labels that tell the customer they are not. */
const BLOCKED_LABELS = new Set(["Payment issue", "Subscription cancelled"]);

test("the badge and the gate agree for every combination -- neither can claim a state the other contradicts", () => {
  const combinations: SubscriptionAccessBusiness[] = [];
  for (const plan of ["starter", "pro"]) {
    for (const subscription_status of [
      "trial",
      "active",
      "complimentary",
      "past_due",
      "cancelled",
      "canceled",
      "unpaid",
      "incomplete",
    ]) {
      for (const trial_ends_at of [PAST, FUTURE, null]) {
        for (const stripe_subscription_id of [LIVE_SUB, null]) {
          combinations.push({ plan, subscription_status, trial_ends_at, stripe_subscription_id });
        }
      }
    }
  }

  // 2 plans x 8 statuses x 3 dates x 2 subscription ids.
  expect(combinations).toHaveLength(96);

  for (const business of combinations) {
    const access = hasSubscriptionAccess(business, NOW);
    const badge = resolveProfileBadge(
      business.subscription_status,
      business.plan,
      business.stripe_subscription_id
    );
    const where = JSON.stringify(business);

    if (badge && ENTITLED_LABELS.has(badge.label)) {
      expect(access, `badge says "${badge.label}" but access was denied: ${where}`).toBe(true);
    }

    if (badge && BLOCKED_LABELS.has(badge.label)) {
      expect(access, `badge says "${badge.label}" but access was granted: ${where}`).toBe(false);
    }

    // "Free trial" is the one label whose meaning depends on the date, so it
    // must track exactly whether the trial is still running.
    if (badge?.label === "Free trial") {
      const trialStillRunning = Boolean(
        business.trial_ends_at && new Date(business.trial_ends_at) > NOW
      );
      expect(access, `Free trial badge disagreed with the gate: ${where}`).toBe(trialStillRunning);
    }
  }
});

test("the specific production disagreement is gone: Pro stuck at trial shows Active AND is let in", () => {
  const business: SubscriptionAccessBusiness = {
    plan: "pro",
    subscription_status: "trial",
    trial_ends_at: PAST,
    stripe_subscription_id: LIVE_SUB,
  };

  expect(resolveProfileBadge(business.subscription_status, business.plan, business.stripe_subscription_id))
    .toEqual({ label: "Subscription active", colorClass: "emerald" });
  expect(hasSubscriptionAccess(business, NOW)).toBe(true);
});

test("resolveSubscriptionStatus is the single source both the gate and the badge read", () => {
  // Same inputs, same resolved value, whichever side asks.
  expect(resolveSubscriptionStatus("trial", "pro", LIVE_SUB)).toBe("active");
  expect(resolveSubscriptionStatus("trial", "pro", null)).toBe("trial");
  expect(resolveSubscriptionStatus("trial", "starter", LIVE_SUB)).toBe("trial");
  expect(resolveSubscriptionStatus("past_due", "pro", LIVE_SUB)).toBe("past_due");
});

// ---------------------------------------------------------------------------
// Task 4: source-level guard
// ---------------------------------------------------------------------------

/**
 * Files allowed to read subscription_status / trial_ends_at directly,
 * each for a reason that is NOT an app-access decision. Listed individually
 * rather than pattern-matched, matching the convention in
 * twilio-messaging-service.spec.ts.
 */
const ACCESS_DECISION_EXEMPT = new Map<string, string>([
  [
    "lib/subscription-access.ts",
    "the helper itself -- the one place this logic is allowed to live",
  ],
  [
    "app/subscribe/page.tsx",
    "the paywall itself, i.e. where a denied customer lands. It decides which plan cards, portal button, and day-countdown to render, not whether to admit anyone.",
  ],
  [
    "app/api/billing/checkout/route.ts",
    "chooses which Stripe flow to start for an already-subscribed customer; not an app-access gate.",
  ],
  [
    "app/api/billing/upgrade/route.ts",
    "chooses Stripe Checkout vs the billing portal for an upgrade; not an app-access gate.",
  ],
  [
    "app/components/trial-banner.tsx",
    "renders a days-remaining countdown from trial_ends_at; displays a number, decides nothing.",
  ],
]);

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name).split("\\").join("/");
    if (entry.isDirectory()) {
      listSourceFiles(full, out);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

test("no file outside lib/subscription-access.ts decides access from subscription_status or trial_ends_at", () => {
  const files = [...listSourceFiles("app"), ...listSourceFiles("lib"), "proxy.ts"];

  // Sanity check on the scan itself: if this ever returns nothing (or almost
  // nothing) every assertion below passes vacuously and the guard stops
  // meaning anything. Fail loudly instead.
  expect(files.length).toBeGreaterThan(50);
  expect(files).toContain("proxy.ts");
  expect(files).toContain("lib/subscription-access.ts");

  for (const path of files) {
    if (ACCESS_DECISION_EXEMPT.has(path)) continue;
    const source = readFileSync(path, "utf8");

    expect(
      source,
      `${path} compares subscription_status directly -- use hasSubscriptionAccess() from @/lib/subscription-access`
    ).not.toMatch(/subscription_status\s*===/);

    expect(
      source,
      `${path} does trial_ends_at date math directly -- use hasSubscriptionAccess() from @/lib/subscription-access`
    ).not.toMatch(/new Date\([^)]*trial_ends_at/);
  }
});

test("every exemption in the allow-list is real, so a stale entry cannot quietly hide a regression", () => {
  for (const [path, reason] of ACCESS_DECISION_EXEMPT) {
    const source = readFileSync(path, "utf8");
    const stillReadsThem =
      /subscription_status\s*===/.test(source) || /new Date\([^)]*trial_ends_at/.test(source);
    expect(
      stillReadsThem,
      `${path} no longer reads these fields -- drop it from ACCESS_DECISION_EXEMPT (reason on file: ${reason})`
    ).toBe(true);
  }
});

test("all nine former call sites now go through the shared predicate", () => {
  const callSites = [
    "proxy.ts",
    "lib/auth.ts",
    "app/page.tsx",
    "app/api/generate-estimate/route.ts",
    "app/api/price-book/route.ts",
    "app/api/price-book-items/route.ts",
    "app/api/price-book-items/import/route.ts",
    "app/api/estimates/[id]/analyze-photos/route.ts",
  ];

  for (const path of callSites) {
    const source = readFileSync(path, "utf8");
    expect(source, `${path} must import the shared predicate`).toContain(
      'from "@/lib/subscription-access"'
    );
    expect(source, `${path} must call hasSubscriptionAccess`).toContain("hasSubscriptionAccess(");
  }
});

// ---------------------------------------------------------------------------
// Column-completeness guard
//
// hasSubscriptionAccess() reads four columns. A caller whose select omits one
// would get `undefined` for it, which resolves to "no live subscription" and
// denies a paying Pro customer with no error logged anywhere -- the silent
// failure mode this whole consolidation exists to prevent.
//
// THE TYPE SYSTEM IS NOW THE PRIMARY GUARD. SubscriptionAccessBusiness
// declares all four fields required-but-nullable, so a select that omits one
// no longer compiles:
//
//   proxy.ts(117,30): error TS2345: Argument of type '{ plan: any;
//   subscription_status: any; trial_ends_at: any; }' is not assignable to
//   parameter of type 'SubscriptionAccessBusiness'.
//     Property 'stripe_subscription_id' is missing ... but required in type
//     'SubscriptionAccessBusiness'.
//
// That closes the hole this comment previously described as out of reach for
// a regex: a file selecting no subscription columns at all
// (`.select("id, name")`) and passing the row to the predicate is now a
// compile error naming the exact call site and column, with no column name
// needed for anything to match on.
//
// The tests below are kept as a second, cheaper layer. They still earn their
// place: `tsc` proves the object *has* the keys, while these prove the select
// is written the maintainable way (via the shared constant) and that a
// hand-spelled select in one of these files carries the full set. They also
// fail faster and with a more actionable message than a type error when
// someone adds a narrower second business query to an existing route.
// ---------------------------------------------------------------------------

/** Every `.select(...)` argument in a source file, as raw text. */
function selectArguments(source: string): string[] {
  return [...source.matchAll(/\.select\(([^)]*)\)/g)].map((m) => m[1]);
}

/** Files that both query tpe_businesses and decide access from the result. */
function businessAccessCallers(): string[] {
  const files = [...listSourceFiles("app"), ...listSourceFiles("lib"), "proxy.ts"];
  return files.filter((path) => {
    const source = readFileSync(path, "utf8");
    const queriesBusinesses = source.includes('.from("tpe_businesses")');
    const decidesAccess =
      source.includes("hasSubscriptionAccess(") ||
      source.includes("hasProPaymentsAccess(") ||
      source.includes("resolveSubscriptionStatus(");
    return queriesBusinesses && decidesAccess;
  });
}

test("every file that queries tpe_businesses and decides access selects all four columns", () => {
  expect(SUBSCRIPTION_ACCESS_COLUMNS).toBe(
    "plan, subscription_status, trial_ends_at, stripe_subscription_id"
  );

  const callers = businessAccessCallers();

  // Discovered, not hardcoded, so a NEW route that queries businesses and
  // gates on the result is covered the day it is written. The floor guards
  // against the discovery itself silently returning nothing.
  expect(callers.length, "expected to discover the known access call sites").toBeGreaterThanOrEqual(13);

  for (const path of callers) {
    const source = readFileSync(path, "utf8");

    expect(
      source,
      `${path} queries tpe_businesses and gates on the result, so it must select via SUBSCRIPTION_ACCESS_COLUMNS`
    ).toContain("SUBSCRIPTION_ACCESS_COLUMNS");

    // Belt and braces: even a hand-spelled select in one of these files must
    // carry all four, so adding a second, narrower business query to a file
    // that already imports the constant cannot quietly reintroduce the bug.
    for (const argument of selectArguments(source)) {
      if (!argument.includes("subscription_status")) continue;
      if (argument.includes("SUBSCRIPTION_ACCESS_COLUMNS")) continue;
      for (const column of ["plan", "subscription_status", "trial_ends_at", "stripe_subscription_id"]) {
        expect(
          argument,
          `${path} has a hand-spelled select missing "${column}" -- use SUBSCRIPTION_ACCESS_COLUMNS`
        ).toContain(column);
      }
    }
  }
});

test("the four Pro Payments call sites are among the files that guard covers", () => {
  // hasProPaymentsAccess receives its business row from its callers, so those
  // callers -- not lib/auth.ts -- are where an incomplete select would bite.
  const callers = businessAccessCallers();
  for (const path of [
    "app/api/estimates/[id]/invoice/route.ts",
    "app/api/estimates/[id]/mark-paid/route.ts",
    "app/api/estimates/[id]/send-reminder/route.ts",
    "app/api/cron/payment-reminders/route.ts",
    "app/profile/page.tsx",
  ]) {
    expect(callers, `${path} must be discovered by the column guard`).toContain(path);
  }
});
