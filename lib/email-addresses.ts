/**
 * The one place TradePulse email addresses are decided.
 *
 * ESTIMATES_EMAIL/ESTIMATES_FROM are deliberately still on trytradepulse.com.
 * The web domain moved to tradepulse-estimates.com (see lib/site-url.ts),
 * but the Resend *sending* domain used for these hasn't: sending reputation
 * is per-domain and starts from zero, and this is the high-volume
 * transactional path (estimate sends, password resets, payment reminders),
 * so it needs a deliberate warmup before its `from:` address moves, not just
 * domain verification.
 *
 * When that happens, change EMAIL_DOMAIN here and nothing else. Nowhere else
 * in the repo should carry a TradePulse email address.
 *
 * SUPPORT_EMAIL moved to tradepulse-estimates.com on 2026-09-03: Zoho Mail is
 * live for inbound on that address, and Resend's domain verification for
 * tradepulse-estimates.com (DKIM + both SPF records) is confirmed verified,
 * sending enabled. Kept independent of EMAIL_DOMAIN on purpose -- SUPPORT_EMAIL
 * is only ever a `to:`/mailto/display address (see lib/notify-error.ts and
 * every page that links it), never a Resend `from:` sender, so it doesn't
 * carry the same warmup concern as the estimates sending address above.
 */

/** Mail domain for outbound estimates/transactional email. Moves only after that sending domain is verified and warmed up in Resend. */
export const EMAIL_DOMAIN = "trytradepulse.com";

/** Sending address for every outbound app email. */
export const ESTIMATES_EMAIL = `estimates@${EMAIL_DOMAIN}`;

/** Sending address with display name, for Resend `from:`. */
export const ESTIMATES_FROM = `TradePulse Estimates <${ESTIMATES_EMAIL}>`;

/** Published support address. Appears in app copy and the policy pages. */
export const SUPPORT_EMAIL = "support@tradepulse-estimates.com";
