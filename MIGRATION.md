# TradePulse domain migration

Discovery completed 2026-08-26 22:27 PT. Read-only session. Nothing in this
document has been executed. No code, config, or external service was changed
while producing it.

---

## Variables

Change these two lines and nothing else in this document needs editing.

```
TARGET_DOMAIN   = tradepulse-estimates.com
CANONICAL_HOST  = https://tradepulse-estimates.com     # apex, no www
```

Everything below refers to `TARGET_DOMAIN` and `CANONICAL_HOST`. Where a literal
appears it is only because it is a value you must paste into a dashboard field.

### The six hostnames

| # | Hostname | Role |
|---|---|---|
| 1 | `tradepulse-estimates.com` | **PRIMARY, canonical.** Serves 200. |
| 2 | `www.tradepulse-estimates.com` | 301 to #1 |
| 3 | `tradepulseestimates.com` | 301 to #1 |
| 4 | `www.tradepulseestimates.com` | 301 to #1 |
| 5 | `trytradepulse.com` | 301 to #1 |
| 6 | `www.trytradepulse.com` | 301 to #1 |

### Why apex is canonical, and why that is a change

The repo is already inconsistent on this point and the migration has to settle it.

- Every `alternates.canonical`, every Open Graph `url`, `app/sitemap.ts`, and
  `public/robots.txt` use the **apex** `https://trytradepulse.com`.
- Every runtime fallback in application code uses **www**
  (`https://www.trytradepulse.com`).
- The Stripe webhook and the Playwright suite disagree with each other: the
  webhook is registered on www, the smoke suite targets apex.

Apex wins because it is the form already published to search engines and used in
every canonical tag. Picking www instead would mean rewriting all of Task 2's
metadata list to www **and** changing what Google has indexed as canonical.

`CANONICAL_HOST` is therefore the single value used for:

- `metadataBase` in `app/layout.tsx` (currently absent, see Section D)
- every `alternates.canonical`
- every Open Graph and Twitter card `url` and `images` entry
- `app/sitemap.ts` entries and the `Sitemap:` line in `public/robots.txt`
- the estimate share link builder fallback
- `NEXT_PUBLIC_APP_URL`

---

## Task 1 findings: what this session can and cannot do

### MCP servers present in this session

Connected and usable: Vercel, Supabase, Resend, PostHog, Gmail, Google Drive,
Google Calendar, Adobe, Higgsfield, Context7 docs, Audible, hotels, plus the
local Claude Code servers (Claude Browser, claude-in-chrome, computer-use,
session management, directory, MCP registry, scheduled tasks, terminal reader)
and the visualize server.

Declared but **not authenticated**, and not usable in this non-interactive
session: the `vercel` HTTP server in `.mcp.json` pointing at `mcp.vercel.com`,
and the plugin servers for Ahrefs, Canva, HubSpot, Klaviyo, Similarweb,
Supermetrics, Atlassian, Box, DocuSign, Egnyte, Slack, Amplitude, Asana,
ClickUp, Figma, Fireflies, Intercom, Linear, Monday, Notion, and Pendo.

### Per-service capability

| Service | Server connected | Can read config | Can write config |
|---|---|---|---|
| **Cloudflare** | **No** | **No** | **No** |
| **Vercel** | Yes | Partly | **No, not for domains or env vars** |
| **Supabase** | Yes | Database only | Database only, **not auth settings** |
| **Stripe** | **No** | **No** | **No** |
| **Resend** | Yes | Yes | Yes |
| **PostHog** | Yes | Yes | Yes |
| **Sentry** | **No** | **No** | **No** |

### The five specific tools asked about

1. **Add a DNS record in Cloudflare.**
   **No tool exists.** There is no Cloudflare MCP server in this session. Every
   DNS record in this plan is manual.

2. **Attach a domain to a Vercel project.**
   **No tool exists.** The Vercel server's complete tool set is: `list_teams`,
   `list_projects`, `get_project`, `list_deployments`, `get_deployment`,
   `get_deployment_build_logs`, `get_runtime_logs`, `get_runtime_errors`,
   `get_web_analytics`, `get_git_deployment_context`, `create_git_project`,
   `deploy_to_vercel`, `pause_project`, `unpause_project`,
   `get_project_deployment_protection`, `update_project_deployment_protection`,
   `get_access_to_vercel_url`, `web_fetch_vercel_url`,
   `search_vercel_documentation`, the agent-run and toolbar-thread tools, and
   the billing tools `buy_credits`, `buy_addon`, `buy_pro`,
   `check_domain_availability_and_price`, `get_purchase_quote`, `buy_domain`,
   `get_domain_order`.
   `buy_domain` **registers** a domain through Vercel. It does not attach an
   existing domain to a project. There is no `add_domain`, no
   `update_project_domains`, and no redirect configuration tool.

3. **Update the Supabase auth Site URL and redirect allow-list.**
   **No tool exists.** The Supabase server covers projects, branches, tables,
   SQL, migrations, edge functions, advisors, logs, and type generation. Auth
   configuration is not exposed. There is also no `supabase/config.toml` in this
   repo, so these settings exist only in the Supabase dashboard.

4. **Update a Stripe webhook endpoint URL.**
   **No tool exists.** There is no Stripe MCP server in this session. The only
   Stripe access this repo has is the secret key used by application code at
   runtime.

5. **Add a sending domain in Resend.**
   **Yes.** `mcp__8a62246f-f938-49d3-9ec6-ba5b87562dc0__create-domain`, then
   `...__verify-domain` once DNS is in place, and `...__get-domain` to poll
   status. `...__list-domains` reads current state.

### Multiple domains on one Vercel project with one primary

Vercel supports this natively: attach all six hostnames to the project, mark one
as the production domain, and set each other hostname to redirect to it.

**I cannot do it.** There is no MCP tool for attaching a domain or for setting a
domain redirect. The Vercel CLI is also not installed on this machine (the
session-start hook reported this). Every step of it is manual, in the Vercel
dashboard, and appears in Section B.

### What was actually read during discovery

- `get_project` on `prj_SFkXioh5LXD88fcHCNMtkm34n6ym` /
  `team_BhGnfNuFsAjUpZwl8XY2zp6w`. Current attached domains:
  `www.trytradepulse.com`, `trytradepulse.com`,
  `tradepulse-estimates.vercel.app`, and two per-branch aliases. **Neither new
  domain is attached.** Latest production deployment
  `dpl_3pvwbHq15zVV8uYartmaLh4iayyK`, READY.
- Resend `list-domains`: exactly one domain, `trytradepulse.com`, status
  `verified`, sending enabled, region `us-east-1`.
- Supabase `list_projects`: the TradePulse project is `fctequqcwxyhmnjgxixg`,
  region `ca-central-1`, `ACTIVE_HEALTHY`.

---

## Task 2 findings: every occurrence in the repo

### 2a. Runtime base URL construction (the functional path)

Five call sites build a URL at runtime. Four share the same three-step fallback,
`request origin` then `NEXT_PUBLIC_APP_URL` then a hardcoded literal.

| File and line | What it builds | Fallback chain |
|---|---|---|
| [app/api/send-sms/route.ts:108](app/api/send-sms/route.ts:108) | `${origin}/share/${estimateId}` at line 113. **This is the estimate share link in SMS.** | origin, env, `https://www.trytradepulse.com` |
| [app/api/send-email/route.ts:111](app/api/send-email/route.ts:111) | `${origin}/share/${estimateId}` at line 116. **Estimate share link in email.** | origin, env, `https://www.trytradepulse.com` |
| [app/api/billing/checkout/route.ts:37](app/api/billing/checkout/route.ts:37) | `success_url` line 139, `cancel_url` line 140 | origin, env, `https://www.trytradepulse.com` |
| [app/api/billing/portal/route.ts:23](app/api/billing/portal/route.ts:23) | `return_url` line 28 | origin, env, `https://www.trytradepulse.com` |
| [app/api/billing/upgrade/route.ts:44](app/api/billing/upgrade/route.ts:44) | `success_url` line 100, `cancel_url` line 101 | origin, env, `https://www.trytradepulse.com` |
| [app/api/billing/upgrade/route.ts:151](app/api/billing/upgrade/route.ts:151) | portal `return_url` line 159 | **env, literal only. No origin header fallback.** |
| [app/api/webhooks/twilio-inbound/route.ts:13](app/api/webhooks/twilio-inbound/route.ts:13) | The URL Twilio's signature is validated against | **env, literal only.** |
| [app/api/send-reset-email/route.ts:28](app/api/send-reset-email/route.ts:28) | Password reset `redirectTo` | **Hardcoded `https://www.trytradepulse.com/reset-password`. No env var at all.** |

Client-side share link construction, no env var involved:

- [app/components/send-estimate-sheet.tsx:75](app/components/send-estimate-sheet.tsx:75)
  `window.location.origin + "/share/" + estimateId`, used by Copy Link.
  Self-correcting, but see the note in Section D about it minting alias-domain
  links.

**The origin-header-first ordering matters.** After cutover a contractor still
signed in on `trytradepulse.com` will have share links, checkout URLs, and
portal return URLs built from the **alias** origin, not the primary. Those still
work through the 301, but they put the old domain into customer inboxes
indefinitely. Section A step A6 addresses this.

### 2b. Environment variables holding URLs

- `NEXT_PUBLIC_APP_URL` is the only one. Read at the eight sites above.
- It is **absent from `.env.local`**, so local development always falls through
  to the hardcoded production literal.
- The pulled production snapshot `.env.vercel.production` (dated 2026-06-20,
  gitignored) records it as `NEXT_PUBLIC_APP_URL=""`. See Section D item 1. That
  snapshot is over two months old and is not authoritative.
- `NEXT_PUBLIC_SUPABASE_URL` holds a URL but is unaffected by this migration.
- Because the name is `NEXT_PUBLIC_`, its value is **inlined at build time**.
  Changing it in Vercel does nothing until a redeploy.

### 2c. next.config redirects and headers

[next.config.ts](next.config.ts) has **no `redirects()`**. It has a `headers()`
block applying HSTS, X-Frame-Options, CSP and others to `/:path*`.

- The CSP names no first-party host. `default-src 'self'` and `connect-src
  'self'` are origin-relative, so **no CSP change is needed** for the migration.
- HSTS is `max-age=63072000; includeSubDomains; preload`. Each new hostname
  starts its own HSTS clock at first HTTPS response. Note that
  `includeSubDomains` on the apex will pin `www` too.

[vercel.json](vercel.json) contains only the payment-reminders cron. No routes,
no redirects.

### 2d. metadataBase, canonicals, sitemap, robots, OG and Twitter

**`metadataBase` is not set anywhere.** [app/layout.tsx:17](app/layout.tsx:17)
exports metadata with title, description and icons only. This is the source of
the three `metadataBase` build notices recorded throughout HANDOFF.md.

Canonical tags, one per file:

| File | Line |
|---|---|
| [app/page.tsx](app/page.tsx:14) | 14 |
| [app/contact/page.tsx](app/contact/page.tsx:23) | 23 |
| [app/login/layout.tsx](app/login/layout.tsx:6) | 6 |
| [app/signup/layout.tsx](app/signup/layout.tsx:6) | 6 |
| [app/plumbers/page.tsx](app/plumbers/page.tsx:11) | 11 |
| [app/electricians/page.tsx](app/electricians/page.tsx:12) | 12 |
| [app/trades/page.tsx](app/trades/page.tsx:11) | 11 |
| [app/plumbing-cost/page.tsx](app/plumbing-cost/page.tsx:8) | 8 |
| [app/electrical-cost/page.tsx](app/electrical-cost/page.tsx:8) | 8 |
| [app/plumbing-estimate-template/page.tsx](app/plumbing-estimate-template/page.tsx:11) | 11 |

Open Graph `url` and image URLs, and Twitter card images:

| File | Lines |
|---|---|
| [app/page.tsx](app/page.tsx:18) | 18 (`url`), 22 (`images[0].url`, `social-card.png`), 35 (twitter `images`) |
| [app/plumbers/page.tsx](app/plumbers/page.tsx:15) | 15, 17, 25 |
| [app/electricians/page.tsx](app/electricians/page.tsx:16) | 16, 18, 26 |
| [app/trades/page.tsx](app/trades/page.tsx:15) | 15, 17, 25 |
| [app/plumbing-cost/page.tsx](app/plumbing-cost/page.tsx:12) | 12, 14, 22 |
| [app/electrical-cost/page.tsx](app/electrical-cost/page.tsx:12) | 12, 14, 22 |
| [app/plumbing-estimate-template/page.tsx](app/plumbing-estimate-template/page.tsx:16) | 16, 18, 27 |

JSON-LD `"url"` inside schema.org blocks (the `https://schema.org` `@context`
values are not domain references and must not be touched):

- [app/plumbers/page.tsx:38](app/plumbers/page.tsx:38)
- [app/electricians/page.tsx:39](app/electricians/page.tsx:39)
- [app/trades/page.tsx:38](app/trades/page.tsx:38)

Sitemap: [app/sitemap.ts](app/sitemap.ts) lines 6, 12, 18, 24, 30, 36, 42, 48.
All eight entries.

Robots: [public/robots.txt:3](public/robots.txt:3),
`Sitemap: https://trytradepulse.com/sitemap.xml`.

OG image: [app/opengraph-image.tsx:40](app/opengraph-image.tsx:40) renders the
literal text `trytradepulse.com` **into the generated PNG**. This is pixels, not
markup. It needs a code change and a cache bust, and any social platform holding
the old card will keep showing the old domain until it re-crawls.

### 2e. Estimate share link construction

Three places, all listed above:
[send-sms/route.ts:113](app/api/send-sms/route.ts:113),
[send-email/route.ts:116](app/api/send-email/route.ts:116),
[send-estimate-sheet.tsx:75](app/components/send-estimate-sheet.tsx:75).
The share page itself, `app/share/[id]/page.tsx`, builds no absolute URL for
itself.

### 2f. Email templates, Resend from and reply-to

No `reply_to` or `replyTo` anywhere, consistent with the CLAUDE.md rule.

Five `from:` addresses, all `estimates@trytradepulse.com`:

- [app/api/send-email/route.ts:127](app/api/send-email/route.ts:127) `TradePulse Estimates <estimates@trytradepulse.com>`
- [app/api/send-reset-email/route.ts:38](app/api/send-reset-email/route.ts:38) `estimates@trytradepulse.com`
- [app/api/estimates/[id]/send-reminder/route.ts:205](app/api/estimates/[id]/send-reminder/route.ts:205) `TradePulse Estimates <estimates@trytradepulse.com>`
- [app/api/cron/payment-reminders/route.ts:204](app/api/cron/payment-reminders/route.ts:204) `TradePulse Estimates <estimates@trytradepulse.com>`
- [app/api/webhooks/new-signup/route.ts:17](app/api/webhooks/new-signup/route.ts:17) `estimates@trytradepulse.com`
- [lib/notify-error.ts:18](lib/notify-error.ts:18) from `estimates@trytradepulse.com`, to `support@trytradepulse.com`

Support address `support@trytradepulse.com` appears in user-facing copy at
[app/contact/page.tsx:17](app/contact/page.tsx:17) and
[136](app/contact/page.tsx:136),
[app/components/CopyEmailButton.tsx:5](app/components/CopyEmailButton.tsx:5),
[app/components/profile-form.tsx:799](app/components/profile-form.tsx:799),
[app/subscribe/page.tsx:198](app/subscribe/page.tsx:198),
[app/privacy/page.tsx:235](app/privacy/page.tsx:235) and
[269](app/privacy/page.tsx:269),
[app/terms/page.tsx:84](app/terms/page.tsx:84),
[186](app/terms/page.tsx:186), [228](app/terms/page.tsx:228), and in the footers
of [app/plumbers/page.tsx:161](app/plumbers/page.tsx:161),
[app/electricians/page.tsx:162](app/electricians/page.tsx:162),
[app/trades/page.tsx:165](app/trades/page.tsx:165),
[app/plumbing-cost/page.tsx:261](app/plumbing-cost/page.tsx:261),
[app/electrical-cost/page.tsx:258](app/electrical-cost/page.tsx:258),
[app/plumbing-estimate-template/page.tsx:159](app/plumbing-estimate-template/page.tsx:159).
Also in the checked-in policy source [privacy-policy.md:75](privacy-policy.md:75)
and [95](privacy-policy.md:95), and
[terms-of-service.md:82](terms-of-service.md:82) and
[104](terms-of-service.md:104).

### 2g. SMS body copy in the Twilio send path

[app/api/send-sms/route.ts:117](app/api/send-sms/route.ts:117) to 120. The body
is `"{greeting} {business} has sent you an estimate: {shareUrl}"`. **The domain
enters only through `shareUrl`.** No hardcoded domain in the copy itself.

[app/api/estimates/[id]/review-request/route.ts:135](app/api/estimates/%5Bid%5D/review-request/route.ts:135)
appends `business.google_review_link`, a per-business Google URL. Unaffected.

[app/api/cron/payment-reminders/route.ts:159](app/api/cron/payment-reminders/route.ts:159)
and [lib/payment-reminder-message.ts:104](lib/payment-reminder-message.ts:104)
carry the business's own `payment_link`. Unaffected.

### 2h. PDF generation

[lib/generate-pdf.ts](lib/generate-pdf.ts) contains **no TradePulse URL**. The
footer at line 398 reads `Generated by ${footerName}`, where `footerName` falls
back to the string `"TradePulse"` (line 391), not a domain. `loadImageAsDataUrl`
at line 24 fetches whatever URL it is handed, which is a Supabase signed URL.
**No change required.**

### 2i. Stripe URLs

`success_url`, `cancel_url` and `return_url` are all listed in 2a. There is no
hardcoded Stripe redirect URL outside those routes. The
`https://buy.stripe.com` string at
[app/components/profile-form.tsx:682](app/components/profile-form.tsx:682) is a
Stripe-hosted URL and is unrelated.

### 2j. Supabase auth callback and reset paths in code

- [app/auth/google/route.ts:22](app/auth/google/route.ts:22) derives `origin`
  from `request.url`, then builds `redirectTo` at line 53 and error redirects at
  line 58. Line 74 sets the cookie `secure` flag from
  `origin.startsWith("https://")`. **All request-relative. No change needed.**
- [app/auth/callback/route.ts:16](app/auth/callback/route.ts:16), same pattern,
  redirects at lines 21, 50 and 111. **No change needed.**
- [app/api/send-reset-email/route.ts:28](app/api/send-reset-email/route.ts:28)
  is the exception. Hardcoded, no env var. **Must change.**
- [proxy.ts](proxy.ts) builds every redirect with `new URL(path, request.url)`.
  `PUBLIC_PATHS` are paths, not hosts. **Fully domain agnostic.**

### 2k. CORS and allowed-origin lists

There is no CORS allow-list anywhere in the repo. The only origin check is
[app/api/account/delete/route.ts:29](app/api/account/delete/route.ts:29), which
compares the `Origin` header against `new URL(request.url).origin`, a same-origin
test computed per request. **Domain agnostic, no change needed.**

`next.config.ts` `images.remotePatterns` allows only the Supabase host.
Unaffected.

### 2l. Marketing and product copy carrying the old domain

- [app/share/[id]/page.tsx:163](app/share/%5Bid%5D/page.tsx:163) "Powered by
  TradePulse" link on **every public estimate**.
- [app/components/estimate-actions.tsx:556](app/components/estimate-actions.tsx:556)
  referral share URL.
- [app/components/profile-form.tsx:102](app/components/profile-form.tsx:102)
  `referralUrl`.
- [app/components/EstimateDemo.tsx:280](app/components/EstimateDemo.tsx:280),
  [EstimateDemoTrades.tsx:275](app/components/EstimateDemoTrades.tsx:275),
  [EstimateDemoElectrical.tsx:274](app/components/EstimateDemoElectrical.tsx:274)
  each `window.open('https://trytradepulse.com/signup')`.
- Visible footer link text `trytradepulse.com` at
  [app/plumbers/page.tsx:155](app/plumbers/page.tsx:155),
  [app/electricians/page.tsx:156](app/electricians/page.tsx:156),
  [app/trades/page.tsx:159](app/trades/page.tsx:159),
  [app/plumbing-cost/page.tsx:257](app/plumbing-cost/page.tsx:257),
  [app/electrical-cost/page.tsx:254](app/electrical-cost/page.tsx:254),
  [app/plumbing-estimate-template/page.tsx:155](app/plumbing-estimate-template/page.tsx:155).
- [app/plumbing-estimate-template/content.ts:162](app/plumbing-estimate-template/content.ts:162)
  inside prose.

### 2m. Test and CI targets

- [playwright.config.ts:57](playwright.config.ts:57)
  `baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "https://trytradepulse.com"`,
  documented at line 14.
- [.github/workflows/smoke-tests.yml:38](.github/workflows/smoke-tests.yml:38)
  `PLAYWRIGHT_BASE_URL: https://trytradepulse.com`, with the reasoning comment at
  line 14.
- [tests/smoke/twilio-inbound-webhook.spec.ts:11](tests/smoke/twilio-inbound-webhook.spec.ts:11)
  pins `https://www.trytradepulse.com/api/webhooks/twilio-inbound` as the
  signature URL under test.

### 2n. Project documentation carrying the old domain

`CLAUDE.md:358`, `CODEX.md:368`, `PROJECT.md:5`, `PROJECT-RELATIONSHIPS.md:18`,
`privacy-policy.md`, `terms-of-service.md`, and many historical entries in
`HANDOFF.md`, `DECISIONS.md` and the `TRADEPULSE_*` baseline documents.
**Historical records must not be rewritten.** Only the "current state" lines in
`CLAUDE.md`, `CODEX.md`, `PROJECT.md` and `PROJECT-RELATIONSHIPS.md` should
change.

---

## Task 3: settings that live in a dashboard, not the repo

None of these were touched.

| # | Service | Setting | Current value, and how it is known |
|---|---|---|---|
| 1 | Vercel | Project domains on `prj_SFkXioh5LXD88fcHCNMtkm34n6ym` | `www.trytradepulse.com`, `trytradepulse.com`, plus `.vercel.app` aliases. **Read this session via `get_project`.** Neither new domain is attached. |
| 2 | Vercel | Which attached domain is the production domain, and the per-domain redirect config | **Not readable by any tool available here.** Must be inspected in the dashboard. |
| 3 | Vercel | `NEXT_PUBLIC_APP_URL` for Production, Preview and Development | **Not readable here.** The June 20 local snapshot shows `""`. Confirm the live value in the dashboard. |
| 4 | Cloudflare | DNS zones and records for all three domains, apex and www | **Not readable here.** No Cloudflare access at all. |
| 5 | Cloudflare | Proxy status (orange vs grey cloud) per record | **Not readable here.** Must be DNS-only for Vercel. |
| 6 | Supabase | Auth, URL Configuration, **Site URL** | **Not readable here.** Project `fctequqcwxyhmnjgxixg`. |
| 7 | Supabase | Auth, URL Configuration, **Redirect URLs allow-list** | **Not readable here.** Must cover `/auth/callback` and `/reset-password` on every hostname in use. |
| 8 | Supabase | Google provider authorised redirect, and the matching entry in the Google Cloud OAuth client | **Not readable here.** Google sign-in breaks if the callback host is not allow-listed on both sides. |
| 9 | Supabase | Auth email templates, if any use an absolute URL | **Not readable here.** |
| 10 | Supabase | The `auth.users` insert webhook that calls `/api/webhooks/new-signup` | **Not readable here.** Its target URL is on the old domain. |
| 11 | Stripe | Webhook endpoint URL | HANDOFF.md records the canonical endpoint as `https://www.trytradepulse.com/api/billing/webhook`, enabled, 6 events. **Not verifiable here, no Stripe access.** |
| 12 | Stripe | Billing portal branding, business URL, and policy links | **Not readable here.** Likely points at the old domain. |
| 13 | Stripe | Checkout branding and any Stripe-hosted policy URLs | **Not readable here.** |
| 14 | Resend | Verified sending domains | Exactly one, `trytradepulse.com`, verified, `us-east-1`. **Read this session.** `TARGET_DOMAIN` is not present. |
| 15 | Resend | Webhooks | Readable via `list-webhooks`, not queried this session to keep the footprint minimal. |
| 16 | Twilio | The "A MESSAGE COMES IN" webhook on the sending number | HANDOFF.md:1075 states this **has never been configured**. If it is ever set, it must match `NEXT_PUBLIC_APP_URL` exactly or every inbound STOP fails signature validation. |
| 17 | Google Search Console | Property for the new domain, plus the Change of Address tool on the old one | Not set up. |
| 18 | Google Analytics | Stream URL for `G-BYZEBWLC56` ([app/layout.tsx:47](app/layout.tsx:47)) | **Not readable here.** |
| 19 | PostHog | Project allowed domains and toolbar authorised URLs | Readable via the PostHog server, not queried this session. |
| 20 | Sentry | Project `tradepulse-estimates` in org `tradepulse-kc` ([next.config.ts:51](next.config.ts:51)), allowed domains and any alert links | **Not readable here.** No Sentry server. |
| 21 | Google Places | API key HTTP referrer restrictions, if any, on `GOOGLE_PLACES_API_KEY` | **Not readable here.** A referrer restriction on the old domain would break Profile review-link lookup. |
| 22 | Domain registrars | Where each of the three domains is registered, and its nameservers | **Not readable here.** |
| 23 | GitHub | Repository secrets used by the smoke workflow | Not readable here. Only `PLAYWRIGHT_BASE_URL` is in the workflow file, not a secret. |

---

## Section A: steps executable from a Claude Code session

Every step here is a repo edit. **None of the domain, DNS, or external-service
work in Section B can be done from here**, for the reasons given in Task 1.

These edits are safe to land **before** the cutover only if `CANONICAL_HOST`
already resolves. Land them as one commit, deploy, and do not merge until
Section B step B4 is verified. A1 through A5 are pure metadata and are harmless
early. A6 through A9 change runtime behaviour and must not deploy before the new
domain serves 200.

Tool for every step: `Edit` (or `Write` for a full-file rewrite). No MCP call is
involved in any of them.

### A1. Set `metadataBase`

`Edit` [app/layout.tsx](app/layout.tsx:17). Add
`metadataBase: new URL(CANONICAL_HOST)` to the `metadata` export. This also
clears the three long-standing build notices recorded in HANDOFF.md.

Consider introducing `lib/site-url.ts` exporting a single
`SITE_URL` constant, and importing it everywhere below, so the next domain change
is one line. Recommended, and it is the reason this document has a
`TARGET_DOMAIN` variable at the top.

### A2. Canonicals

`Edit` each of the 10 files listed in 2d, replacing the host in
`alternates.canonical` with `CANONICAL_HOST`. Keep every path exactly as it is.

### A3. Open Graph, Twitter, JSON-LD

`Edit` the 7 files listed in 2d for `url` and `images`, and the 3 JSON-LD `"url"`
values. **Do not touch the `https://schema.org` `@context` strings.**

### A4. Sitemap and robots

`Edit` [app/sitemap.ts](app/sitemap.ts), all 8 entries.
`Edit` [public/robots.txt:3](public/robots.txt:3) to
`Sitemap: {CANONICAL_HOST}/sitemap.xml`.

### A5. OG image text

`Edit` [app/opengraph-image.tsx:40](app/opengraph-image.tsx:40) to render
`TARGET_DOMAIN`. The PNG is generated at build, so a deploy regenerates it.
Social caches will lag.

### A6. Runtime fallbacks, and the origin-first ordering

`Edit` all eight sites in 2a. Two separate changes:

1. Replace every `"https://www.trytradepulse.com"` literal with the shared
   `SITE_URL` constant from A1.
2. **Recommended, and worth a decision:** in
   [send-sms/route.ts:108](app/api/send-sms/route.ts:108) and
   [send-email/route.ts:111](app/api/send-email/route.ts:111), **drop the
   `request.headers.get("origin")` term** so the share link is always built from
   `SITE_URL`. Today a contractor working on an alias domain mints share links on
   that alias. Those links survive via the 301, but they land in customer inboxes
   and stay there. Pinning the share host to canonical is the only way to stop
   the old domain propagating into new sends. The billing routes can keep
   origin-first, since their URLs are transient.

### A7. Password reset redirect

`Edit` [app/api/send-reset-email/route.ts:28](app/api/send-reset-email/route.ts:28)
to `` `${SITE_URL}/reset-password` ``. This is the only reset path in code and it
has no env fallback at all today.

### A8. Marketing and product copy

`Edit` the sites in 2l: the share-page "Powered by" link, the referral URLs in
`estimate-actions.tsx` and `profile-form.tsx`, the three demo components'
`window.open`, the six footer link texts, and the prose link in
`plumbing-estimate-template/content.ts`.

Support and sending email addresses are a **separate decision** and are
deliberately not in this step. See B7.

### A9. Tests and CI

`Edit` [playwright.config.ts:57](playwright.config.ts:57) default and its
line 14 comment, and
[.github/workflows/smoke-tests.yml:38](.github/workflows/smoke-tests.yml:38) plus
its line 14 comment, to `CANONICAL_HOST`.

`Edit` [tests/smoke/twilio-inbound-webhook.spec.ts:11](tests/smoke/twilio-inbound-webhook.spec.ts:11)
only if and when `NEXT_PUBLIC_APP_URL` and the Twilio Console URL both move.
**These three values must change together or inbound SMS signature validation
fails.**

### A10. Documentation

`Edit` the current-state lines in `CLAUDE.md:358`, `CODEX.md:368`,
`PROJECT.md:5`, `PROJECT-RELATIONSHIPS.md:18`. Add a note to `CLAUDE.md`
recording `CANONICAL_HOST` as the canonical host and the three-domain alias set.
**Leave `HANDOFF.md`, `DECISIONS.md`, and every `TRADEPULSE_*` document alone.
They are historical records.**

### A11. Verification I can run here

- `npx.cmd tsc --noEmit`
- `npx.cmd next build`, and confirm the three `metadataBase` notices are gone
- The safe unit suite via `playwright.unit.config.ts`
- Full ESLint, compared against the documented baseline of 8 errors and 18
  warnings
- A repo-wide grep proving no `trytradepulse.com` remains outside the historical
  documents and the deliberately unchanged email addresses

### A12. Resend domain, the one external write available here

`mcp__8a62246f-f938-49d3-9ec6-ba5b87562dc0__create-domain` with
`{ name: TARGET_DOMAIN, region: "us-east-1" }` to match the existing domain.
It returns the DKIM, SPF and DMARC records to add in Cloudflare, then
`...__verify-domain` with the returned id once DNS has propagated, then
`...__get-domain` to poll until `verified`.

**This is a write to an external service and needs explicit approval before it
runs.** It is listed here rather than in Section B only because a tool for it
exists. Sequence it at B7, after DNS.

---

## Section B: manual dashboard steps, in required order

DNS is first because Vercel and Resend both block on it.

### B0. Preconditions

1. Confirm all three domains are registered and under your control, and note the
   registrar for each.
2. Confirm each domain's nameservers point at Cloudflare, and a Cloudflare zone
   exists for each of the three.
3. **Cloudflare, read the current records for `trytradepulse.com` and write them
   down before changing anything.** Nothing about the old domain is deleted in
   this plan.
4. **Vercel, record the current production domain and the current
   `NEXT_PUBLIC_APP_URL` for all three environments.** The local snapshot says
   `""`, which if true is already a live defect. See Section D item 1.
5. **Stripe, record the current webhook endpoint URL, its signing secret
   reference, and its event list.** HANDOFF.md says
   `https://www.trytradepulse.com/api/billing/webhook` with 6 events.
6. **Supabase, screenshot the current Site URL and the complete Redirect URLs
   allow-list.**

### B1. Cloudflare DNS for the primary domain

In the `tradepulse-estimates.com` zone:

- Apex `@`: the record type and value **exactly as Vercel displays them** when
  you add the domain in B3. Historically an `A` record to `76.76.21.21`; Vercel
  now issues different values per project. **Do not paste a value from memory or
  from this document. Use what the Vercel dashboard shows.**
- `www`: `CNAME` to the target Vercel shows, historically
  `cname.vercel-dns.com`.

**Both records must be DNS-only, the grey cloud, not proxied.** An orange-cloud
proxy in front of Vercel breaks certificate issuance and can produce a redirect
loop with Vercel's own apex-to-www handling.

This is a chicken-and-egg with B3. The practical order is: add the domain in
Vercel first (B3), read the exact records off the Vercel screen, then create them
here, then let Vercel verify.

### B2. Cloudflare DNS for the two alias domains

Same two records, apex and www, in the `tradepulseestimates.com` zone.

For `trytradepulse.com`, **the apex and www records already exist and already
point at Vercel.** Do not change them. They keep working, and the redirect is
configured in Vercel at B5, not in DNS.

### B3. Vercel, attach all six hostnames

Vercel dashboard, project `tradepulse-estimates`, Settings, Domains.

Add, in this order:

1. `tradepulse-estimates.com`
2. `www.tradepulse-estimates.com`
3. `tradepulseestimates.com`
4. `www.tradepulseestimates.com`

`trytradepulse.com` and `www.trytradepulse.com` are already attached.

For each, Vercel shows the exact DNS records required. Create them in Cloudflare
per B1 and B2, then wait for Vercel to show **Valid Configuration** and an issued
certificate on all six. Certificate issuance can take several minutes and will
fail while a record is orange-clouded.

### B4. Vercel, set the primary and redeploy

1. Set `tradepulse-estimates.com` as the **production domain**.
2. Set `www.tradepulse-estimates.com` to **redirect to** `tradepulse-estimates.com`
   with status **301**.
3. **Leave `trytradepulse.com` and `www.trytradepulse.com` serving normally for
   now.** Do not set their redirects yet.
4. Update `NEXT_PUBLIC_APP_URL` to `CANONICAL_HOST` for **Production**, and set a
   sensible value for Preview and Development. It is a `NEXT_PUBLIC_` variable,
   so it is inlined at build time.
5. **Redeploy.** The env change does nothing without one.
6. Merge and deploy the Section A code changes if they are not already in.

**At this point both the new domain and the old domain serve 200.** That overlap
is deliberate and is what makes B5 and B6 safe.

### B5. Stripe, Supabase, and Twilio, while both domains still work

Do all of these before any 301 is turned on. Stripe does **not** follow redirects
on webhook delivery, so a 301 on the old webhook URL breaks it outright.

1. **Stripe, Developers, Webhooks.** Edit the existing endpoint's URL in place to
   `{CANONICAL_HOST}/api/billing/webhook`. **Editing preserves the signing
   secret**, so `STRIPE_WEBHOOK_SECRET` does not change. Do **not** create a
   second endpoint; the code reads exactly one secret. Confirm all 6 events are
   still attached, and that `pending_webhooks` is 0 on recent events.
2. **Stripe, Settings, Branding and Customer portal.** Update the business URL
   and any policy links to the new domain.
3. **Supabase, Auth, URL Configuration.** **Add first, remove nothing yet.** Add
   to the Redirect URLs allow-list:
   `{CANONICAL_HOST}/auth/callback`, `{CANONICAL_HOST}/reset-password`,
   `{CANONICAL_HOST}/**`, and the same three for `www.tradepulse-estimates.com`.
   Keep every existing `trytradepulse.com` entry so in-flight reset and
   confirmation links continue to resolve. Then set **Site URL** to
   `CANONICAL_HOST`.
4. **Google Cloud Console, OAuth client.** Add the new authorised redirect URI
   alongside the existing one. Supabase's own callback host does not change, but
   confirm it, because Google sign-in fails closed.
5. **Supabase, Database, Webhooks.** Repoint the `auth.users` insert hook to
   `{CANONICAL_HOST}/api/webhooks/new-signup`.
6. **Twilio.** Per HANDOFF.md:1075 the inbound webhook has never been configured.
   If it is configured now or later, its URL must be
   `{CANONICAL_HOST}/api/webhooks/twilio-inbound` and must match
   `NEXT_PUBLIC_APP_URL` **character for character**, because
   [twilio-inbound/route.ts:13](app/api/webhooks/twilio-inbound/route.ts:13)
   validates the signature against the constructed string.
7. **Google Places.** If `GOOGLE_PLACES_API_KEY` has HTTP referrer restrictions,
   add the new hostnames.
8. **PostHog and Sentry.** Add the new hostnames to allowed domains. Neither is a
   hard blocker, but both will quietly stop reporting otherwise.
9. **Google Analytics.** Update the stream URL for `G-BYZEBWLC56`.

### B6. Turn on the three alias redirects

Only after B5 is verified. Vercel, Settings, Domains:

- `trytradepulse.com` → redirect to `tradepulse-estimates.com`, **301**
- `www.trytradepulse.com` → redirect to `tradepulse-estimates.com`, **301**
- `tradepulseestimates.com` → redirect to `tradepulse-estimates.com`, **301**
- `www.tradepulseestimates.com` → redirect to `tradepulse-estimates.com`, **301**

Vercel domain redirects preserve path and query string. **Verify this explicitly
against a real estimate share link**, per checklist item C11. It is the single
most important behaviour in this migration, because every estimate ever sent to a
customer lives on the old domain.

Nothing is deleted. All six hostnames stay attached to the project permanently.

### B7. Resend sending domain

1. Add `TARGET_DOMAIN` in Resend, either in the dashboard or via the MCP call in
   A12.
2. Add the returned DKIM, SPF and DMARC records in the Cloudflare zone for
   `TARGET_DOMAIN`. **DNS-only, grey cloud.** These are TXT and CNAME records and
   must not be proxied.
3. Verify, and wait for status `verified`.
4. **Only then** change the six `from:` addresses in code (2f) to
   `estimates@{TARGET_DOMAIN}`, and the support address to
   `support@{TARGET_DOMAIN}`. This is a code change, so it is a Section A
   follow-up commit, not a dashboard step.
5. Set up mail forwarding or a mailbox for `support@{TARGET_DOMAIN}` before
   publishing it anywhere.
6. **Do not remove `trytradepulse.com` from Resend.** Removing it kills replies
   and any future send from the old address.

Sending domain reputation is per-domain and starts fresh. Expect a warm-up
period. If deliverability matters more than branding in the short term, keeping
`estimates@trytradepulse.com` as the sender for a few weeks after the web
cutover is a legitimate choice.

### B8. Search

1. Add `TARGET_DOMAIN` as a Google Search Console property and verify it.
2. Submit `{CANONICAL_HOST}/sitemap.xml`.
3. Use the **Change of Address** tool on the `trytradepulse.com` property,
   pointing at the new one. It requires the 301s from B6 to be live.
4. Repeat for Bing Webmaster Tools.
5. **Keep the old property.** Do not remove it. Google needs it to process the
   change of address.

### B9. Off-platform references

QR-coded postcards in circulation point at `trytradepulse.com/go/electricians-postcard`
and `/go/trades-postcard`. Those cannot be reprinted. The 301 from B6 is the only
thing keeping them working, which is a permanent reason never to detach
`trytradepulse.com`.

Also update, as time allows: Google Business Profile, social profiles, any
directory listings, email signatures, and invoice or estimate templates held
outside the app.

---

## Section C: verification checklist

One line per item. Run after B6, in order. Every item is pass or fail, no
partial.

### DNS and certificates

- [ ] C1. `dig +short tradepulse-estimates.com` and `dig +short www.tradepulse-estimates.com` both return Vercel targets, and neither returns a Cloudflare proxy IP.
- [ ] C2. Same for `tradepulseestimates.com`, `www.tradepulseestimates.com`, `trytradepulse.com`, `www.trytradepulse.com`. Six hostnames, all resolving.
- [ ] C3. `curl -sI https://{each of the six}` returns a valid certificate with no TLS error, on all six.
- [ ] C4. Vercel Settings, Domains shows **Valid Configuration** on all six.

### Redirects

- [ ] C5. `curl -sI https://www.tradepulse-estimates.com/` returns **301** with `location: {CANONICAL_HOST}/`.
- [ ] C6. `curl -sI https://tradepulseestimates.com/` and `https://www.tradepulseestimates.com/` each return **301** to `{CANONICAL_HOST}/`.
- [ ] C7. `curl -sI https://trytradepulse.com/` and `https://www.trytradepulse.com/` each return **301** to `{CANONICAL_HOST}/`.
- [ ] C8. `curl -sI https://{CANONICAL_HOST}/` returns **200**, not a redirect. The primary must not redirect to anything.
- [ ] C9. `curl -sI https://trytradepulse.com/plumbers` returns 301 to `{CANONICAL_HOST}/plumbers`. **Path is preserved.**
- [ ] C10. `curl -sI "https://trytradepulse.com/go/electricians-postcard"` returns 301 preserving the path, and following it lands on `/electricians` with the UTM query string intact. This is the printed-postcard path.
- [ ] C11. **Take a real estimate share link previously sent to a customer, `https://trytradepulse.com/share/<id>`. `curl -sI` it, confirm 301 to `{CANONICAL_HOST}/share/<id>` with the same id, then open the redirect target in a browser and confirm the estimate renders with the correct business name, line items, pricing block, and currency label.** This is the highest-stakes item in the migration.

### SEO surfaces

- [ ] C12. `curl -s {CANONICAL_HOST}/sitemap.xml` lists 8 URLs, all on `TARGET_DOMAIN`, zero on any old domain.
- [ ] C13. `curl -s {CANONICAL_HOST}/robots.txt` shows the `Sitemap:` line on `TARGET_DOMAIN`.
- [ ] C14. View source on `{CANONICAL_HOST}/`, `/plumbers`, `/electricians`, `/trades`, `/plumbing-cost`, `/electrical-cost`, `/plumbing-estimate-template`, `/contact`, `/login`, `/signup`. Every `<link rel="canonical">` and every `og:url` is on `TARGET_DOMAIN`.
- [ ] C15. `curl -s {CANONICAL_HOST}/opengraph-image` returns a PNG whose bottom-right text reads `TARGET_DOMAIN`.
- [ ] C16. `npx next build` produces **zero `metadataBase` notices**, down from the three recorded in HANDOFF.md.

### Auth

- [ ] C17. **Signup.** Create a throwaway account through `{CANONICAL_HOST}/signup`. It completes, a `tpe_businesses` row is written, and the account lands on the app. **Per HANDOFF.md this must not run against Production without `ALLOW_PRODUCTION_SIGNUP_SMOKE=true`, and the account must be torn down through `cleanupTestAccount()`, which deletes the Stripe customer first.**
- [ ] C18. **Google sign-in.** Complete a Google OAuth round trip on the new domain. The `tp_oauth_intent` cookie is set, the nonce matches, and the callback lands signed in rather than on `/signup?error=signin_expired`.
- [ ] C19. **Password reset.** Request a reset from `{CANONICAL_HOST}/login`, confirm the email arrives, and confirm the link inside it points at `{CANONICAL_HOST}/reset-password` and successfully sets a new password. This exercises both the hardcoded redirect fixed in A7 and the Supabase allow-list from B5.
- [ ] C20. **Old-domain reset link.** A reset link issued before the cutover, on `www.trytradepulse.com/reset-password`, still 301s and still completes. If it does not, the Supabase allow-list lost an old entry.
- [ ] C21. Signing in on `{CANONICAL_HOST}` and navigating to `/new`, `/estimates`, `/profile`, `/rates` shows no redirect loop through `proxy.ts`.

### Stripe

- [ ] C22. **Checkout.** Start checkout from `{CANONICAL_HOST}/subscribe`. The Stripe session opens, and its `success_url` and `cancel_url` both point at `TARGET_DOMAIN`. Cancel out and confirm the return lands on `{CANONICAL_HOST}/subscribe`.
- [ ] C23. **Webhook receipt.** In Stripe, Developers, Webhooks, confirm the endpoint URL is `{CANONICAL_HOST}/api/billing/webhook`, status enabled, all 6 events attached. Trigger a real event, then confirm a **2xx delivery** in the Stripe event log with `pending_webhooks: 0`, and confirm the matching `tpe_businesses` row was updated.
- [ ] C24. **Billing portal.** For an account with `subscription_status = 'active'`, open the portal from Profile and confirm the `return_url` brings you back to `{CANONICAL_HOST}/profile`.
- [ ] C25. Stripe shows **zero** failed deliveries to any `trytradepulse.com` URL after the cutover timestamp.

### Email

- [ ] C26. **Outbound email arrives.** Send an estimate by email from the app to a real inbox. It arrives, and the View Estimate button links to `{CANONICAL_HOST}/share/<id>`.
- [ ] C27. **SPF passes.** In the received message's raw headers, `Authentication-Results` shows `spf=pass` for the sending domain.
- [ ] C28. **DKIM passes.** The same header shows `dkim=pass` with the signing domain matching the `from:` domain, and `dmarc=pass`.
- [ ] C29. Resend `list-domains` shows the sending domain `verified` with sending enabled, and `trytradepulse.com` still present and still verified.
- [ ] C30. Password reset email, new-signup notification, and a payment reminder each arrive and each pass C27 and C28.

### SMS

- [ ] C31. **Send an estimate by SMS.** It arrives, and the link in the body is on `TARGET_DOMAIN`, not an alias. This proves the A6 origin-ordering change landed.
- [ ] C32. Opening that SMS link on a phone loads the estimate with no redirect hop.
- [ ] C33. If and only if the Twilio inbound webhook is configured: text STOP to the sending number and confirm a 2xx in Twilio's debugger, not a 401 signature failure, and confirm the suppression row was written.

### Application

- [ ] C34. Create an estimate end to end on `{CANONICAL_HOST}`: generate, edit, save, download the PDF. The PDF renders with the correct footer and pricing.
- [ ] C35. Copy Link on the send sheet produces a `TARGET_DOMAIN` URL, since it reads `window.location.origin`.
- [ ] C36. Upload a logo, and confirm it renders on the share page and in the PDF. This exercises the Supabase `remotePatterns` allow-list, which is unchanged but worth confirming.
- [ ] C37. The full Playwright smoke suite passes against `PLAYWRIGHT_BASE_URL={CANONICAL_HOST}`, subject to the production-signup rule in HANDOFF.md.
- [ ] C38. Browser devtools console on `{CANONICAL_HOST}` shows **zero CSP violations** across the landing page, `/new`, and a share page.
- [ ] C39. PostHog and Sentry both receive events from the new hostname.
- [ ] C40. The payment-reminders cron fires at 17:00 UTC on the new domain and its Vercel function log shows a successful run.

### Rollback trigger

If C11, C19, C23 or C26 fails, **remove the four alias redirects in Vercel**
(B6) so all six hostnames serve 200 again, and diagnose with both domains live.
Do not detach any domain, and do not revert DNS.

---

## Section D: broken or inconsistent, independent of the migration

Found during discovery. **Nothing here was fixed in this session.** Each needs
its own decision.

### D1. `NEXT_PUBLIC_APP_URL` may be set to an empty string in Production

`.env.vercel.production:5` records `NEXT_PUBLIC_APP_URL=""`.

Every read of it uses `??`, which is **nullish** coalescing. An empty string is
not nullish, so `process.env.NEXT_PUBLIC_APP_URL ?? "https://www.trytradepulse.com"`
evaluates to `""`, not to the literal.

Where that is currently masked: the four billing routes and the two send routes
try `request.headers.get("origin")` first, and a browser always sends it.

Where it is **not** masked, because there is no origin fallback:

- [app/api/webhooks/twilio-inbound/route.ts:13](app/api/webhooks/twilio-inbound/route.ts:13)
  would compute the signature URL as the bare string
  `/api/webhooks/twilio-inbound`, and **every inbound Twilio request would fail
  signature validation**. This is consistent with HANDOFF.md:1075 reporting that
  inbound SMS has never been exercised, though that entry attributes it to the
  Twilio Console side.
- [app/api/billing/upgrade/route.ts:151](app/api/billing/upgrade/route.ts:151)
  would build a portal `return_url` of `/profile?upgraded=1`, which Stripe would
  reject as not absolute.

**Caveat, stated plainly:** that env snapshot is dated 2026-06-20 and is
gitignored. It may be stale. **This session has no way to read the live Vercel
value.** Confirm it in the dashboard before treating it as a live defect. If it
is genuinely empty, the fix is either to set a real value or to change every read
from `??` to `||` so an empty string falls through. `||` is the more robust
choice regardless.

### D2. Canonical host disagrees with runtime host, today

Metadata, sitemap, robots and the smoke suite all say apex `trytradepulse.com`.
Every runtime fallback and the Stripe webhook say `www.trytradepulse.com`. Both
are attached to the project. This has presumably been harmless because Vercel
serves both, but it means the app has never had one canonical host. The migration
forces the decision, which is why Section A pins everything to `CANONICAL_HOST`.

### D3. `metadataBase` has never been set

`app/layout.tsx` has no `metadataBase`. HANDOFF.md records "three known
`metadataBase` notices" as an accepted baseline across at least eight separate
verification runs. Next.js resolves relative metadata URLs against a guessed base
in its absence. Fixed by A1.

### D4. Pricing: the report does not match the code

**Checked, not fixed, as instructed.**

[lib/currency.ts:82](lib/currency.ts:82):

```ts
export const PLAN_MONTHLY_PRICES: Record<Currency, Record<BillingPlan, number>> = {
  cad: { starter: 29, pro: 59 },
  usd: { starter: 19, pro: 39 },
};
```

The CAD figures are **CA$29 Starter and CA$59 Pro, which is correct.**

The homepage pricing cards at [app/page.tsx:535](app/page.tsx:535) and
[575](app/page.tsx:575) render `currencyPrefix(currency)` plus
`planMonthlyPrice(plan, currency)`, where `currency` comes from
`currencyFromCountry((await headers()).get("x-vercel-ip-country"))` at
[app/page.tsx:181](app/page.tsx:181). A US visitor therefore sees **US$19 and
US$39 by design**, and a Canadian visitor sees CA$29 and CA$59.

The meta description at [app/page.tsx:13](app/page.tsx:13) is built from
`STARTER_MONTHLY_PRICE_CAD` and is **always CA$29**, for every visitor. Next.js
static `metadata` cannot vary per request the way the body does.

**So the sighting is real but is not a pricing bug.** It is a US visitor seeing
geo-priced cards next to a CAD-only meta description. The genuine inconsistency
is narrower: **the meta description and OG image hardcode CAD while the visible
page is geo-priced.** The same applies to
[app/opengraph-image.tsx:34](app/opengraph-image.tsx:34), which bakes
`CA$29/month` into the PNG.

Whether that matters is a judgement call. The meta description is what appears in
a US search result for a page that will then show US$19. Options are to drop the
price from the meta description entirely, or to accept it. **Not changed here.**

### D5. `app/page.tsx` still redirects to `/onboarding`

[app/page.tsx:190](app/page.tsx:190): `if (!business) redirect("/onboarding")`.

HANDOFF.md Release 2 removed `/onboarding` as a business-creation path and
changed [proxy.ts:105](proxy.ts:105) to send a no-business identity to
`/signup?error=setup_required` with the session cleared. `app/page.tsx` was not
updated with it.

Currently benign, because `/onboarding` itself now forwards a no-business
identity to `/signup?error=setup_required`. But it is an extra hop, it does
**not** clear the session the way the proxy path does, and it contradicts the
release's stated intent. Worth aligning.

### D6. `incomplete` is an undocumented `subscription_status`

HANDOFF.md already flags this. `CLAUDE.md` documents the status set as
`trial | active | past_due | cancelled | complimentary`. The code sets and reads
`incomplete` in at least two places, including
[lib/account-provisioning.ts:221](lib/account-provisioning.ts:221) for paid Pro
signups. The app handles it correctly. It is a documentation gap, and it is the
state that produced the `/subscribe` dead end fixed in commit `d5c091d`.

### D7. Smoke suite targets a hostname that will become a redirect

[playwright.config.ts:57](playwright.config.ts:57) and
[.github/workflows/smoke-tests.yml:38](.github/workflows/smoke-tests.yml:38) both
target `https://trytradepulse.com`. After B6 that is a 301.

Playwright navigations follow redirects, so most assertions would survive. **API
tests would not necessarily.** A 301 on a `POST` is converted to a `GET` by
standard fetch semantics, which would silently break every spec that posts to
`/api/auth/signup` through `postSignupApi()`. A9 must land before or with B6.

### D8. Twilio inbound webhook has never been configured

HANDOFF.md:1075 and :1181. The handler exists, is tested, and is deployed, but no
Twilio Console entry points at it. No inbound STOP, START or HELP reaches the app
today. Independent of this migration, but the migration is the natural moment to
either configure it on the new domain or decide not to.

### D9. Uncommitted working tree at the time of discovery

`git status` showed modifications to `.claude/settings.local.json`, `.gitignore`,
`AGENTS.md`, `CLAUDE.md`, `CODEX.md`, and `app/profile/page.tsx`, plus untracked
`.ai-control-centre/`, six `*.bak-*` files at the repo root, and
`supabase/.temp/`. The `app/profile/page.tsx` modification in particular is
unexplained by HANDOFF.md and should be reviewed before any migration commit
lands on top of it.

### D10. Repo-root `.bak-*` files are untracked clutter

`AGENTS.md.bak-*` and `CLAUDE.md.bak-*`, three each, sitting untracked at the
repo root. They pollute every repo-wide grep, including this discovery. Either
gitignore them or move them out of the root.

---

## Summary of what blocks what

```
B1/B2 Cloudflare DNS
        |
        v
B3 Vercel attach six hostnames  ---> certificates issue
        |
        v
B4 Set primary + NEXT_PUBLIC_APP_URL + redeploy   [both domains now serve 200]
        |
        +---> B5 Stripe webhook URL, Supabase auth URLs, Google OAuth, Twilio
        |          (must happen while the OLD domain still serves 200)
        |
        +---> B7 Resend domain (blocked on DNS, not on B4)
        |
        v
B6 Turn on the four 301s        [old domain now redirects]
        |
        v
B8 Search Console change of address
        |
        v
Section C verification
```

The one rule that makes this safe: **the old domain keeps serving 200 until every
integration has been repointed.** Stripe does not follow redirects on webhook
delivery, and Twilio validates signatures against an exact URL string. Both fail
hard, not gracefully, if the redirect goes on first.
