/**
 * Regression test for a real production bug: app/api/send-email/route.ts and
 * app/api/send-sms/route.ts built the customer-facing share link from
 * SITE_URL, which resolves through NEXT_PUBLIC_APP_URL, then the Vercel
 * deployment URL, then localhost. A share link is a permanent artifact that
 * ends up sitting in a customer's phone or inbox, so it must always be the
 * canonical domain, never a stray deployment URL or a stale env value. The
 * fix pins both routes to `canonicalUrl()` instead, which ignores the
 * environment entirely.
 *
 * The env vars are set to junk deployment-shaped values, not simply cleared,
 * because clearing them would just fall through the same env chain
 * `canonicalUrl()` is supposed to be independent of. `await import()` runs
 * after the mutation, since module-level `import` statements are hoisted
 * ahead of any top-level code and would load lib/site-url.ts before the env
 * pollution took effect.
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const SEND_EMAIL = "app/api/send-email/route.ts";
const SEND_SMS = "app/api/send-sms/route.ts";
const CANONICAL_PREFIX = "https://tradepulse-estimates.com/share/";

/** Source with comments removed, matching signup-currency-layout.spec.ts. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
}

test("canonicalUrl() builds the share link on the canonical host regardless of runtime env", async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://tradepulse-estimates-git-some-branch.vercel.app";
  process.env.VERCEL_URL = "tradepulse-estimates-git-some-branch-gchansen.vercel.app";
  process.env.NEXT_PUBLIC_VERCEL_URL = "tradepulse-estimates-git-some-branch-gchansen.vercel.app";

  const { canonicalUrl, SITE_URL } = await import("../../lib/site-url");

  const shareUrl = canonicalUrl("/share/est_123");
  expect(shareUrl).toBe(`${CANONICAL_PREFIX}est_123`);
  expect(shareUrl.startsWith(CANONICAL_PREFIX)).toBe(true);

  // Proves the pollution actually worked: SITE_URL, which the bug used to
  // read from, did follow the junk env. canonicalUrl() did not.
  expect(SITE_URL).not.toBe("https://tradepulse-estimates.com");
  expect(SITE_URL).toContain("vercel.app");
});

test("send-email and send-sms build shareUrl from canonicalUrl, not SITE_URL", () => {
  for (const path of [SEND_EMAIL, SEND_SMS]) {
    const source = code(path);
    expect(source, `${path} must not import SITE_URL`).not.toContain("SITE_URL");
    expect(source, `${path} must import canonicalUrl`).toContain(
      'import { canonicalUrl } from "@/lib/site-url"'
    );
    expect(source, `${path} must build shareUrl from canonicalUrl()`).toMatch(
      /const shareUrl = canonicalUrl\(`\/share\/\$\{estimateId\}`\);/
    );
  }
});
