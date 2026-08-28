/**
 * The one place TradePulse email addresses are decided.
 *
 * Deliberately still on trytradepulse.com. The web domain moved to
 * tradepulse-estimates.com (see lib/site-url.ts), but the Resend sending
 * domain has not: sending reputation is per-domain and starts from zero, so
 * the new domain has to be added and verified in Resend, and warmed up,
 * before any `from:` address moves.
 *
 * When that happens, change EMAIL_DOMAIN here and nothing else. Nowhere else
 * in the repo should carry a TradePulse email address.
 */

/** Mail domain. Moves only after the new sending domain is verified in Resend. */
export const EMAIL_DOMAIN = "trytradepulse.com";

/** Sending address for every outbound app email. */
export const ESTIMATES_EMAIL = `estimates@${EMAIL_DOMAIN}`;

/** Sending address with display name, for Resend `from:`. */
export const ESTIMATES_FROM = `TradePulse Estimates <${ESTIMATES_EMAIL}>`;

/** Published support address. Appears in app copy and the policy pages. */
export const SUPPORT_EMAIL = `support@${EMAIL_DOMAIN}`;
