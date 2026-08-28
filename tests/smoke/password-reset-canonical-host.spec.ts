/**
 * Regression test for a real production risk, same class of bug as
 * share-link-canonical-host.spec.ts: app/api/send-reset-email/route.ts built
 * the emailed password-reset link from SITE_URL, which resolves through
 * NEXT_PUBLIC_APP_URL, then the Vercel deployment URL, then localhost. An
 * emailed link, like a share link, is a permanent artifact a user may click
 * hours or days later -- it must always point at the canonical domain,
 * never a stray deployment URL or a stale env value. The fix pins the
 * redirect to `canonicalUrl()` instead, which ignores the environment
 * entirely.
 *
 * The env vars are set to junk deployment-shaped values, not simply
 * cleared, because clearing them would just fall through the same env
 * chain `canonicalUrl()` is supposed to be independent of. `await import()`
 * runs after the mutation, since a module-level `import` statement is
 * hoisted ahead of any top-level code and would load lib/site-url.ts before
 * the env pollution took effect.
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const ROUTE_PATH = "app/api/send-reset-email/route.ts";
const CANONICAL_RESET_URL = "https://tradepulse-estimates.com/reset-password";

test("canonicalUrl() builds the password-reset redirect on the canonical host even when NEXT_PUBLIC_APP_URL and VERCEL_URL are junk", async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://tradepulse-estimates-git-some-branch.vercel.app";
  process.env.VERCEL_URL = "tradepulse-estimates-git-some-branch-gchansen.vercel.app";
  process.env.NEXT_PUBLIC_VERCEL_URL = "tradepulse-estimates-git-some-branch-gchansen.vercel.app";

  const { canonicalUrl, SITE_URL } = await import("../../lib/site-url");

  const redirectTo = canonicalUrl("/reset-password");
  expect(redirectTo).toBe(CANONICAL_RESET_URL);
  expect(redirectTo.startsWith("https://tradepulse-estimates.com")).toBe(true);

  // Proves the pollution actually worked: SITE_URL, which the bug used to
  // read from, did follow the junk env. canonicalUrl() did not.
  expect(SITE_URL).not.toBe("https://tradepulse-estimates.com");
  expect(SITE_URL).toContain("vercel.app");
});

test("send-reset-email builds redirectTo from canonicalUrl, not SITE_URL", () => {
  const source = readFileSync(ROUTE_PATH, "utf8");
  expect(source, `${ROUTE_PATH} must not import SITE_URL`).not.toContain("SITE_URL");
  expect(source, `${ROUTE_PATH} must import canonicalUrl`).toContain(
    "import { canonicalUrl } from '@/lib/site-url'"
  );
  expect(source, `${ROUTE_PATH} must build redirectTo from canonicalUrl()`).toContain(
    "redirectTo: canonicalUrl('/reset-password'),"
  );
});
