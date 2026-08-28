/**
 * The one place the TradePulse site URL is decided.
 *
 * Every absolute TradePulse URL in the app is built from SITE_URL or
 * SITE_DOMAIN. Changing domains again is a change to NEXT_PUBLIC_APP_URL in
 * Vercel, plus CANONICAL_SITE_URL below as the last-resort default. Nothing
 * else in the repo should carry a TradePulse hostname.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_APP_URL, the deliberate value set per environment.
 *   2. The Vercel deployment URL, so preview deployments link to themselves.
 *   3. localhost in development.
 *   4. CANONICAL_SITE_URL.
 *
 * Empty and whitespace-only values are treated as unset. NEXT_PUBLIC_APP_URL
 * has been recorded as "" in a production snapshot, and "" is not nullish, so
 * a `??` chain would hand an empty string to Stripe and to Twilio signature
 * validation. Blank-checking every term is what stops that.
 *
 * NEXT_PUBLIC_ values are inlined at build time, so a change in Vercel needs a
 * redeploy to take effect.
 */

/** Canonical host. Apex, no www. */
const CANONICAL_SITE_URL = "https://tradepulse-estimates.com";

const LOCAL_SITE_URL = "http://localhost:3000";

function cleanEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Strips a trailing slash so `${SITE_URL}/share/1` never doubles up. */
function withoutTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function resolveSiteUrl(): string {
  const configured = cleanEnv(process.env.NEXT_PUBLIC_APP_URL);
  if (configured) return withoutTrailingSlash(configured);

  // VERCEL_URL is server-only. NEXT_PUBLIC_VERCEL_URL is the browser-visible
  // twin Vercel injects for Next.js projects. Neither carries a protocol.
  const vercelHost =
    cleanEnv(process.env.NEXT_PUBLIC_VERCEL_URL) ?? cleanEnv(process.env.VERCEL_URL);
  if (vercelHost) return withoutTrailingSlash(`https://${vercelHost}`);

  if (process.env.NODE_ENV === "development") return LOCAL_SITE_URL;

  return CANONICAL_SITE_URL;
}

/** Absolute site origin, no trailing slash. Example: https://tradepulse-estimates.com */
export const SITE_URL = resolveSiteUrl();

/** Hostname only, for display copy and link text. Example: tradepulse-estimates.com */
export const SITE_DOMAIN = new URL(SITE_URL).host;

/**
 * The canonical host, independent of environment. Metadata, canonical tags,
 * Open Graph URLs, and the sitemap must always publish the real domain, never
 * a preview or localhost origin.
 */
export const CANONICAL_URL = CANONICAL_SITE_URL;

/** Canonical hostname only. Example: tradepulse-estimates.com */
export const CANONICAL_DOMAIN = new URL(CANONICAL_SITE_URL).host;

/** Builds an absolute canonical URL for a path. `path` must start with "/". */
export function canonicalUrl(path: string): string {
  return path === "/" ? CANONICAL_URL : `${CANONICAL_URL}${path}`;
}

/** Builds an absolute runtime URL for a path. `path` must start with "/". */
export function siteUrl(path: string): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path}`;
}
