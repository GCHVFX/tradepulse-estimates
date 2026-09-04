/**
 * The one place TradePulse email addresses are decided.
 *
 * EMAIL_DOMAIN moved to tradepulse-estimates.com on 2026-09-03: confirmed
 * verified in Resend (DKIM + both SPF records, sending enabled -- see
 * HANDOFF.md for the verification check). This is the `from:` domain for
 * every transactional email path deriving from ESTIMATES_EMAIL/
 * ESTIMATES_FROM -- confirmed by grep, not assumed, to be six call sites
 * across six files, not just the three named when this migration was
 * first scoped (estimate sends, password resets, payment reminders):
 * app/api/send-email/route.ts (estimate sent to customer),
 * app/api/send-reset-email/route.ts (password reset),
 * app/api/cron/payment-reminders/route.ts (scheduled reminder),
 * app/api/estimates/[id]/send-reminder/route.ts (manual reminder resend,
 * same family as the cron job but a separate code path), plus two
 * internal-only notification emails not customer-facing at all:
 * lib/notify-error.ts (alerts SUPPORT_EMAIL on an API failure) and
 * app/api/webhooks/new-signup/route.ts (alerts NOTIFY_EMAIL on a new
 * signup). All six moved together since they all derive from this one
 * constant -- there's no way to move a subset without editing every
 * call site individually, which would defeat the point of having one
 * source of truth here.
 *
 * When this needs to change again, change EMAIL_DOMAIN here and nothing
 * else. Nowhere else in the repo should carry a TradePulse email address.
 *
 * SUPPORT_EMAIL moved to tradepulse-estimates.com separately on
 * 2026-09-03, before this change: Zoho Mail is live for inbound on that
 * address, and Resend's domain verification for tradepulse-estimates.com
 * (DKIM + both SPF records) was confirmed verified, sending enabled, at
 * that time too. Kept independent of EMAIL_DOMAIN on purpose (even now
 * that both point at the same domain) -- SUPPORT_EMAIL is only ever a
 * `to:`/mailto/display address (see lib/notify-error.ts and every page
 * that links it), never a Resend `from:` sender, so it doesn't carry the
 * same warmup concern this constant is named for.
 */

/** Mail domain for outbound estimates/transactional email. */
export const EMAIL_DOMAIN = "tradepulse-estimates.com";

/** Sending address for every outbound app email. */
export const ESTIMATES_EMAIL = `estimates@${EMAIL_DOMAIN}`;

/** Sending address with display name, for Resend `from:`. */
export const ESTIMATES_FROM = `TradePulse Estimates <${ESTIMATES_EMAIL}>`;

/** Published support address. Appears in app copy and the policy pages. */
export const SUPPORT_EMAIL = "support@tradepulse-estimates.com";
