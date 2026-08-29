/**
 * Guard against a spec file existing but never running.
 *
 * tests/smoke/ holds two different kinds of test. The unit-safe ones are
 * listed individually in playwright.unit.config.ts's testMatch and run on
 * every verification pass. The rest need live services (a real Supabase
 * account, Stripe, a running dev server, a browser) and are run deliberately,
 * not as part of the fast suite.
 *
 * Nothing enforced which bucket a new file landed in. A spec added to
 * tests/smoke/ but left out of testMatch still type-checks, still looks like
 * it is covering something, and silently never executes. That is not
 * hypothetical: pro-payments-entitlement.spec.ts -- the unit coverage for the
 * Pro Payments entitlement rule behind invoicing, mark-paid, and the reminder
 * cron -- sat unrun in exactly that state until it was found by accident on
 * 2026-08-28, while `tsc` type-checked it the whole time.
 *
 * So every file on disk must be either in testMatch or on the exclusion list
 * below, with a stated reason. A file that is neither fails this test. An
 * exclusion naming a file that no longer exists also fails, so the list
 * cannot rot into a place where a deleted-and-recreated spec hides.
 */
import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";

const UNIT_CONFIG = "playwright.unit.config.ts";
const SMOKE_DIR = "tests/smoke";

/**
 * Specs that legitimately cannot run in the unit config, each with the
 * specific reason it cannot -- same convention as ACCESS_DECISION_EXEMPT in
 * subscription-access.spec.ts. "Needs live services" is recorded per file
 * rather than as a blanket category so that a file whose reason stops being
 * true is visible as a wrong sentence, not hidden inside a group.
 */
const CANNOT_RUN_IN_UNIT_CONFIG = new Map<string, string>([
  // --- browser only: need a running dev server, but no live account ---
  [
    "logged-out-redirect.spec.ts",
    "Browser only: navigates to /new and asserts the redirect to /login. Needs a running dev server and the page fixture, neither of which the unit config provides.",
  ],
  [
    "public-pages-load.spec.ts",
    "Browser only: loads each public path and asserts no unexpected console errors. Needs a running dev server and the page fixture.",
  ],

  // --- need a real Supabase account created via tests/smoke/helpers.ts ---
  [
    "billing-gate-no-deadend.spec.ts",
    "Signs up a real account, expires its trial, and checks /subscribe is not a dead end. Needs live Supabase plus a browser.",
  ],
  [
    "estimate-actions-no-nav-gap.spec.ts",
    "Signs up a real account and measures the fixed action bar against the bottom nav in a real browser. Geometry cannot be asserted without rendering.",
  ],
  [
    "generate-estimate.spec.ts",
    "Signs up a real account and exercises the live AI generation endpoint. Needs Supabase and the Anthropic API.",
  ],
  [
    "line-item-qty-clear-does-not-lock.spec.ts",
    "Signs up a real account and drives the line-item editor in a browser to prove clearing a quantity does not lock the row.",
  ],
  [
    "new-circle-no-button-overlap.spec.ts",
    "Signs up a real account and checks nav button overlap in a rendered browser layout. Needs Supabase service-role access plus a browser.",
  ],
  [
    "payments-no-direct-stripe.spec.ts",
    "Signs up and logs in a real account, then asserts the Payments surfaces never call Stripe directly. Needs live Supabase and a browser.",
  ],
  [
    "payments-pro-enforced.spec.ts",
    "Signs up a real account and asserts Pro Payments gating server-side. This is the API-level counterpart to the pure rule coverage in pro-payments-entitlement.spec.ts, which does run in the unit config.",
  ],
  [
    "photo-delete-uses-storage-path.spec.ts",
    "Signs up a real account and exercises photo deletion against real Supabase Storage objects.",
  ],
  [
    "photo-monthly-cap-server-enforced.spec.ts",
    "Signs up a real account and drives the monthly photo cap through the real rate-limit table.",
  ],
  [
    "photo-monthly-cap-ui.spec.ts",
    "Signs up a real account and checks the monthly photo cap messaging in a rendered browser.",
  ],
  [
    "photos-persist-after-generate.spec.ts",
    "Signs up a real account and verifies attached photos survive generation, driven through the browser.",
  ],
  [
    "share-link-canonical-domain.spec.ts",
    "Creates a real estimate with Supabase service-role access, then loads its share URL in a browser to confirm the canonical host resolves. The pure host-building half of this is covered by share-link-canonical-host.spec.ts, which does run in the unit config.",
  ],
  [
    "signup-lands-on-new.spec.ts",
    "Performs a real signup through helpers.ts and asserts the landing route. Needs live Supabase and Stripe.",
  ],
  [
    "signup-rate-limit.spec.ts",
    "Makes repeated real signup attempts and resets the rate-limit table between them. Needs live Supabase.",
  ],
]);

/** The spec filenames listed in the unit config's testMatch array. */
function unitConfigTestMatch(): string[] {
  const source = readFileSync(UNIT_CONFIG, "utf8");
  const start = source.indexOf("testMatch:");
  expect(start, `${UNIT_CONFIG} must declare a testMatch array`).toBeGreaterThan(-1);

  const open = source.indexOf("[", start);
  const close = source.indexOf("]", open);
  expect(close, `${UNIT_CONFIG}'s testMatch array must be closed`).toBeGreaterThan(open);

  const block = source.slice(open, close);
  return [...block.matchAll(/["']([^"']+\.spec\.ts)["']/g)].map((m) => m[1]);
}

/** Every spec file actually present in tests/smoke/. */
function specFilesOnDisk(): string[] {
  return readdirSync(SMOKE_DIR)
    .filter((name) => name.endsWith(".spec.ts"))
    .sort();
}

test("every spec file in tests/smoke is either in the unit config or excluded with a reason", () => {
  const matched = new Set(unitConfigTestMatch());
  const onDisk = specFilesOnDisk();

  // Sanity check on the scan itself: if either side comes back empty or
  // implausibly small, every assertion below passes vacuously.
  expect(onDisk.length, "expected to find the smoke specs on disk").toBeGreaterThan(40);
  expect(matched.size, "expected the unit config to list many specs").toBeGreaterThan(25);

  const unaccounted = onDisk.filter(
    (name) => !matched.has(name) && !CANNOT_RUN_IN_UNIT_CONFIG.has(name)
  );

  expect(
    unaccounted,
    `these spec files exist but never run: they are not in ${UNIT_CONFIG}'s testMatch and not on ` +
      "CANNOT_RUN_IN_UNIT_CONFIG. Add each to testMatch if it is unit-safe, or to the exclusion " +
      "list with the reason it cannot run there. A spec that never runs still type-checks, so " +
      "nothing else will tell you."
  ).toEqual([]);
});

test("this guard itself runs in the unit config", () => {
  // Without this, the guard could be added to tests/smoke and left out of
  // testMatch -- the exact failure it exists to catch.
  expect(unitConfigTestMatch(), `${UNIT_CONFIG} must include this guard`).toContain(
    "unit-suite-completeness.spec.ts"
  );
});

test("every exclusion names a file that still exists, with a real reason", () => {
  const onDisk = new Set(specFilesOnDisk());

  for (const [name, reason] of CANNOT_RUN_IN_UNIT_CONFIG) {
    expect(
      onDisk.has(name),
      `CANNOT_RUN_IN_UNIT_CONFIG names "${name}", which no longer exists in ${SMOKE_DIR}. ` +
        "Remove the stale entry -- left in place it would silently excuse a future file of the same name."
    ).toBe(true);

    // A blank or token reason would let a file be waved through without
    // anyone having to justify it.
    expect(
      reason.trim().length,
      `the exclusion for "${name}" needs a real stated reason, not a placeholder`
    ).toBeGreaterThan(40);
  }
});

test("no file is both in the unit config and on the exclusion list", () => {
  const matched = new Set(unitConfigTestMatch());

  for (const name of CANNOT_RUN_IN_UNIT_CONFIG.keys()) {
    expect(
      matched.has(name),
      `"${name}" is listed in ${UNIT_CONFIG}'s testMatch AND excluded as unable to run there. ` +
        "One of the two is wrong -- if it now runs in the unit config, drop the exclusion."
    ).toBe(false);
  }
});
