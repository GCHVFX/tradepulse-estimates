# TradePulse handoff

Updated: 2026-08-28 20:21 PT (checkout.session.completed now writes subscription_status directly, closing the race that left a paying Pro customer stuck showing "Free trial"; profile badge corrected)

## Checkout webhook writes subscription_status directly; profile badge corrected (2026-08-28 20:21 PT)

**Status:** fixed on `main`, verified. Commit hash filled in after push, same
two-commit pattern as recent prior sessions.

### Confirmed production bug

A real Pro checkout completed on the live site: Stripe showed the
subscription Active, the Pro product has no trial configured, the $59
charge succeeded. Read the actual row via the Supabase MCP (read-only,
project `fctequqcwxyhmnjgxixg`) to ground-truth this before touching
anything:

```
id: 2578ba02-58a6-4ca1-bec2-555b55b485d8
plan: pro
subscription_status: trial
trial_ends_at: 2026-09-12 02:54:25+00
stripe_subscription_id: sub_1U9cU7Q45KFNqa8xBHKwUxEU
created_at: 2026-08-29 02:54:26.544544+00
updated_at: 2026-08-29 02:54:26.544544+00   (tpe_businesses has no update
                                              trigger, so this is not proof
                                              nothing wrote to the row after
                                              creation -- plan alone tells us
                                              something did)
```

### Task 1 -- diagnosis, verified against the code (not assumed)

Every place `subscription_status` is written:

1. **Signup** (`app/api/auth/signup/route.ts` and `app/auth/callback/route.ts`,
   both via `lib/account-provisioning.ts`): Starter signup writes `"trial"`
   with a real 14-day `trial_ends_at`. **A direct Pro signup writes
   `"incomplete"`, never `"trial"`** -- account-provisioning.ts's own
   comment: "Pro is paid up front. No trial and no subscription yet." This
   already contradicts a literal reading of "the signup path wrote trial for
   this Pro row" -- the actual mechanism is more specific, below.
2. **`app/api/billing/webhook/route.ts`** (the only other writer):
   - `linkCheckout()` (`checkout.session.completed`) -- **wrote only `plan`
     and `stripe_subscription_id`. Never touched `subscription_status` at
     all.** This is the bug.
   - `syncSubscription()` (`customer.subscription.created` /
     `.updated`) -- writes `subscription_status`, mapped via
     `toBusinessSubscriptionStatus()`. Correct, but gated by
     `expectedSubscriptionId` matching the row's *current*
     `stripe_subscription_id` in the DB at the moment this specific webhook
     runs.
   - `updateCurrentSubscriptionStatus()` (`customer.subscription.deleted` →
     `"cancelled"`; `invoice.payment_succeeded` → `"active"`;
     `invoice.payment_failed` → `"past_due"`) -- writes it directly, correct.

**The actual mechanism, confirmed by tracing `app/api/billing/upgrade/route.ts`
and `lib/stripe-webhook.ts` together:** this business started as Starter
(`subscription_status = "trial"`, a real 14-day trial), then upgraded to Pro
through `/api/billing/upgrade`'s Checkout flow. That flow's `checkout.session.completed`
event only ever wrote `plan` + `stripe_subscription_id` via `linkCheckout()`
-- never `subscription_status`. Meanwhile Stripe does **not** guarantee
webhook delivery order: if the paired `customer.subscription.created`/
`.updated` event for the *same* upgrade arrived and was processed *before*
`checkout.session.completed` ran, `handleSubscriptionChanged`'s own guard
(`business.stripeSubscriptionId !== subscription.id`) saw the row's
still-OLD (pre-upgrade) subscription id, didn't match the new one, and
returned early -- silently dropping that event's sync (Stripe still got a
200, so no retry). `checkout.session.completed` then ran afterward, updated
`plan` (matching the observed `plan: "pro"`) via its own
`expectedSubscriptionId`-gated match against the OLD id (which still
matched, since nothing had changed it yet), but never wrote
`subscription_status` at all -- leaving it stuck at the original `"trial"`.
This exactly matches the observed row: `plan` correct, `subscription_status`
stale, `updated_at` unchanged because nothing on this table ever sets it
explicitly (no DB trigger either, confirmed via
`information_schema.triggers`).

### Task 2 -- the fix

`handleCheckoutCompleted` already retrieves the Stripe subscription object
(to detect its price/plan). It now also maps that subscription's `.status`
via the *existing* `toBusinessSubscriptionStatus()` and passes it into the
*same* `linkCheckout()` call, so `subscription_status` can no longer depend
on a second, possibly-rejected webhook event to ever get set.
`linkCheckout`'s store implementation (`app/api/billing/webhook/route.ts`)
now includes `subscription_status` in its `.update()` when a mapped status
is available, and `trial_ends_at` when the subscription is `"trialing"` --
same conditional-write semantics `syncSubscription` already used.

**Stripe status coverage (Task 2's "at minimum" list, verified against
`toBusinessSubscriptionStatus()`):** this mapping already existed and
already covered every real Stripe `Subscription.status` value -- all eight
of them (`active`, `trialing`, `past_due`, `unpaid`, `incomplete`, `paused`,
`incomplete_expired`, `canceled`). **There is no Stripe status this app
currently lacks an equivalent for.** The bug was never a missing mapping --
it was one write path (`linkCheckout`) never calling the mapping at all.
Documented this directly in the function's own doc comment so it doesn't
need re-verifying next time.

### Task 3 -- every read of subscription_status / trial_ends_at, and the priority-fix question

**Yes, this lockout path exists, and it is not closed by anything in this
session.** `proxy.ts` (the app-wide middleware every route is gated by) has
its own inline copy of the exact `isActive || isTrialing || complimentary`
check, keyed on `subscription_status === "trial" && trial_ends_at > now`.
The identical pattern is independently duplicated in: `lib/auth.ts`
(`checkUserSubscriptionAccess`, `hasProPaymentsAccess`),
`app/api/generate-estimate/route.ts`, `app/api/price-book/route.ts`,
`app/api/price-book-items/route.ts`, `app/api/price-book-items/import/route.ts`,
and `app/api/estimates/[id]/analyze-photos/route.ts` -- seven independent
copies of the same logic, all sharing the same trial-expiry cliff. This
session's fix reduces how often a Pro business ends up stuck at
`subscription_status = "trial"` in the first place, but does **not** change
what happens if one does: once `trial_ends_at` passes on any row still
reading `"trial"` (for any reason -- a future bug, a webhook that never
arrives, manual DB drift), `proxy.ts` redirects that signed-in, paying
customer to `/subscribe` exactly like an expired Starter trial. For the
account above, `trial_ends_at` is 2026-09-12 -- not an immediate cliff, but
the mechanism is real and would affect any account in the same stuck state
regardless of runway.

**This was flagged, not fixed, in this session.** Hardening the access-check
logic itself (e.g. never letting a Pro-plan business's access depend on
`trial_ends_at` at all) was not one of the seven tasks given, would touch
several of the files listed above (most of which don't even currently
`select` the `plan` column needed to make that distinction), and risked
exceeding this session's scope without an explicit decision. **Recommend a
follow-up task specifically to harden or consolidate these seven duplicated
access checks** -- happy to scope that whenever it's prioritized.

### Task 4 -- profile badge

New `lib/subscription-display.ts`, deliberately separate from `lib/auth.ts`
(display logic must never get imported into an access decision, or vice
versa): `resolveDisplaySubscriptionStatus(subscriptionStatus, plan)` treats
`plan === "pro" && subscriptionStatus === "trial"` as `"active"` for display
purposes only (Pro is paid up front and never has a real trial, per
account-provisioning.ts's own comment -- this is reading the existing
contract correctly, not inventing a state), and
`resolveProfileBadge(subscriptionStatus, plan)` returns the badge label +
colour for trial / active / past_due / cancelled / complimentary, or `null`
for an unrecognized status.

`app/profile/page.tsx` now computes both once and reuses them: the header
badge renders from `resolveProfileBadge()` (replacing two separate hardcoded
conditionals, and adding visible states for `past_due` and `cancelled` that
didn't render anything before), and the *corrected* status is passed into
`ProfileForm`'s `subscriptionStatus` prop -- so the larger "Free Trial"
upgrade card in `profile-form.tsx` (which shows Starter's $29 price and a
day-countdown, and would have been just as wrong for this account) picks up
the same correction automatically, with zero changes to that file. A Pro
business stuck at "trial" now falls into that component's existing
`subscriptionStatus === "active"` branch instead, which correctly offers the
billing portal link rather than an "Upgrade to Pro" button or a stale
trial countdown.

### New tests (Task 5)

`tests/smoke/billing-status-sync.spec.ts` (new), 9 tests:

- A `checkout.session.completed` for an active Pro subscription (with the
  business's stored `stripe_subscription_id` still pointing at the OLD
  Starter trial subscription, reproducing the exact reported scenario)
  writes `subscription_status: "active"`, not `"trial"`.
- A `customer.subscription.updated` for an active Pro subscription also
  writes `"active"`.
- Every Stripe status Task 2 named (plus the two others that exist) maps
  explicitly; an unrecognized value maps to `null`, never an invented
  status.
- A Pro business with `subscription_status: "active"` is never treated as
  trial-expired regardless of `trial_ends_at` (exercised via
  `hasProPaymentsAccess`, the one instance of the duplicated access-check
  pattern that's actually exported and importable -- `proxy.ts`'s own copy
  isn't unit-testable without extracting it first, which wasn't in scope).
- `resolveDisplaySubscriptionStatus()` corrects Pro+trial to active and
  leaves every other plan/status combination unchanged.
- The profile badge renders correctly for trial, active, past_due, and
  cancelled.
- The exact production scenario, asserted directly: a `plan: "pro"`,
  `subscription_status: "trial"` badge never says "Free trial".
- A genuine Starter trial still says "Free trial" -- the fix is scoped to
  `plan === "pro"` only, not a blanket removal of the trial badge.

Also updated one existing test in `tests/smoke/stripe-webhook.spec.ts`
("checkout completion links only the expected TradePulse owner and
subscription") whose exact-`toEqual` assertion on the captured
`linkCheckout` input needed the new `subscriptionStatus: "active"` field
added -- confirmed this is the only existing test with an exact-equality
assertion on that object; every other existing `linkCheckout` test
destructures only the fields it needs and was unaffected.

### Verification actually run (2026-08-28 20:21 PT)

- `npx tsc --noEmit` -- clean.
- `npx next build` -- compiled successfully, all routes present including
  `/profile` and `/api/billing/webhook`, no new warnings, no errors.
- `npx playwright test --config=playwright.unit.config.ts` -- **403 passed,
  0 failed** (394 before this change, +9 new in
  `billing-status-sync.spec.ts`). Raw output pasted to chat during this
  session.

No dashboard was touched, no account was created or modified, no Production
data was written -- the only Production access this session was one
read-only SQL query (via the Supabase MCP) to ground-truth the reported bug
before diagnosing it, plus a read-only `information_schema.triggers` query.
No migration was written and no backfill was performed, per instruction.

### Backfill needed (not performed -- reported per instruction)

The one confirmed-affected row (`2578ba02-58a6-4ca1-bec2-555b55b485d8`) still
has `subscription_status = "trial"` today; this session's fix only prevents
*future* checkouts from landing in this state, it does not correct existing
rows. A backfill would need to, for every business where
`stripe_subscription_id` is set: call `stripe.subscriptions.retrieve()`,
map `.status` through the *existing* `toBusinessSubscriptionStatus()`, and
write `subscription_status` (and `trial_ends_at` when trialing) --
literally the same logic this session added to `handleCheckoutCompleted`,
just run once across existing rows instead of on the next webhook. Whether
to scope that to just this one known-affected business or run it broadly
(in case other rows are silently affected by the same race) is a decision
for Greg, not made here.

### Files changed

`lib/stripe-webhook.ts`, `app/api/billing/webhook/route.ts`,
`lib/subscription-display.ts` (new), `app/profile/page.tsx`,
`tests/smoke/billing-status-sync.spec.ts` (new),
`tests/smoke/stripe-webhook.spec.ts`, `playwright.unit.config.ts`,
`HANDOFF.md`.

### Next action

Decide on the backfill (see above), and decide whether to prioritize
hardening the seven duplicated trial-expiry access checks named in Task 3 --
that is the actual lockout risk and remains open.

## SMS-configured gates decoupled from TWILIO_FROM_NUMBER (2026-08-28 09:20 PT)

**Status:** fixed on `main`, verified, committed as `18ef693` and pushed to
`origin/main`.

### The gap this closes

Flagged at the end of the prior session: `resolveTwilioSendAddress()` no
longer requires `TWILIO_FROM_NUMBER` once `TWILIO_MESSAGING_SERVICE_SID` is
set, but three routes' "is SMS configured" gates still hard-required it
directly --

- `app/api/cron/payment-reminders/route.ts`'s `smsConfigured` check
- `app/api/estimates/[id]/send-reminder/route.ts`'s `smsConfigured` check
- `app/api/estimates/[id]/review-request/route.ts`'s early-return
  `"SMS is not configured."` guard

-- so retiring `TWILIO_FROM_NUMBER` from Vercel entirely (keeping only the
Messaging Service SID) would have silently stopped all three from ever
attempting a send. No error, nothing in logs, nothing in Sentry -- the gate
itself would just decide SMS isn't configured and skip straight to the
"not configured" branch each route already has for exactly that case.
`app/api/send-sms/route.ts` was checked for the same pattern and doesn't
have one (it never gated on `TWILIO_FROM_NUMBER` at all, so nothing to fix
there).

### The fix (Tasks 1 and 2)

New export in `lib/twilio-send.ts`: `hasUsableTwilioSender(env)`, true when
either `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER` is set
(blank-checked). Implemented by calling `resolveTwilioSendAddress(env)` and
checking its return value, not a second copy of the blank-check logic -- the
two literally cannot disagree about what counts as configured, since one is
built from the other's actual output.

All three gates now call `hasUsableTwilioSender(process.env)` in place of
the direct `process.env.TWILIO_FROM_NUMBER` check. Nothing else in any of
the three gates changed -- same `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`
conditions, same "SMS is not configured." error text, same behaviour for
every other input.

### New tests (Task 3)

Added to `tests/smoke/twilio-messaging-service.spec.ts`:

- `hasUsableTwilioSender` is true with only the SID set, only
  `TWILIO_FROM_NUMBER` set, or both set.
- False when neither is set, and false when both are empty/whitespace-only
  strings (proves the blank-check, not just a nullish-check).
- A new source-level guard, stronger than the existing "no hardcoded from"
  scan: it fails if the literal string `TWILIO_FROM_NUMBER` appears
  *anywhere* under `app/` at all (not just inside a `messages.create(`
  call) -- after this fix, that string genuinely does not appear under
  `app/` any more, so this is a real, currently-true invariant, not an
  aspirational one.

**Sanity-checked the new guard the same way as the prior session:**
temporarily reverted `review-request/route.ts`'s gate back to
`!process.env.TWILIO_FROM_NUMBER`, ran the test file alone, confirmed the
new guard failed with a message naming the exact file, then restored the
real fix and reran the full suite to confirm green. Never left in the
working tree, never committed.

### Verification actually run (2026-08-28 09:20 PT)

- `npx tsc --noEmit` -- clean.
- `npx next build` -- compiled successfully, all routes present, no new
  warnings, no errors.
- `npx playwright test --config=playwright.unit.config.ts` -- **394 passed,
  0 failed** (388 before this change, +6 new: 5 `hasUsableTwilioSender`
  tests + 1 new source-level guard). Raw output pasted to chat during this
  session.

No dashboard was touched, no account was created, no Production data was
touched, no real Twilio call was made.

### Files changed

`lib/twilio-send.ts`, `app/api/cron/payment-reminders/route.ts`,
`app/api/estimates/[id]/send-reminder/route.ts`,
`app/api/estimates/[id]/review-request/route.ts`,
`tests/smoke/twilio-messaging-service.spec.ts`, `CLAUDE.md` (Twilio SMS
section, documenting the gate fix and the second guard test), `HANDOFF.md`.

### Next action

None outstanding. `TWILIO_FROM_NUMBER` can now be retired from any Vercel
environment that has `TWILIO_MESSAGING_SERVICE_SID` set, whenever that's
wanted, without silently disabling SMS anywhere in the app.

## Messaging Service SID extended to the remaining Twilio send paths (2026-08-28 09:05 PT)

**Status:** fixed on `main`, verified, committed as `aab11de` and pushed to
`origin/main`. Confirmed in production before this task started: `send-sms`
(switched in the prior session) delivered a real estimate text successfully
via the Messaging Service SID.

### Context

Prior session switched only `app/api/send-sms/route.ts` to
`resolveTwilioSendAddress()` and explicitly flagged three more routes with
the identical bare-`from` pattern, pending a decision to extend it. That
decision came back this session: extend to all three.

### The fix (Task 1)

Same helper, same semantics, three files, nothing else touched in any of
them (per instruction):

- `app/api/cron/payment-reminders/route.ts`
- `app/api/estimates/[id]/send-reminder/route.ts`
- `app/api/estimates/[id]/review-request/route.ts`

Each gained one import (`import { resolveTwilioSendAddress } from
"@/lib/twilio-send";`) and one call-site change: `from:
process.env.TWILIO_FROM_NUMBER,` replaced with
`...resolveTwilioSendAddress(process.env),` inside the existing
`client.messages.create({ body, to, ... })` call. All four Twilio send paths
in the repo now resolve their address the same way.

**Left deliberately untouched, out of this task's scope:** each route's own
`smsConfigured` / config-presence check (e.g. `payment-reminders`' and
`send-reminder`'s `Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN &&
TWILIO_FROM_NUMBER)`, `review-request`'s equivalent early-return) still
requires `TWILIO_FROM_NUMBER` to be set even when only
`TWILIO_MESSAGING_SERVICE_SID` is configured. Since `TWILIO_FROM_NUMBER`
remains set in Production as the fallback, this has no live effect today,
but it's worth a separate look if `TWILIO_FROM_NUMBER` is ever retired
outright -- these gates would then incorrectly report SMS as unconfigured.

### New test (Task 2)

`tests/smoke/twilio-messaging-service.spec.ts` gained one new, deliberately
generic test: it recursively scans every `.ts`/`.tsx` file under `app/` and
`lib/`, identifies "Twilio senders" as any file that both imports `twilio`
and calls `messages.create(` (the import check is what avoids a false
positive on the *Anthropic* SDK's identically-named
`client.messages.create()` in `app/api/analyze-photo/route.ts` and
`app/api/estimates/[id]/analyze-photos/route.ts`), asserts the four known
senders are exactly what the scan finds (so the scan itself can't silently
find nothing and pass every assertion vacuously), then asserts none of them
hardcodes `from: process.env.TWILIO_FROM_NUMBER` and all of them spread
`...resolveTwilioSendAddress(process.env)`. `lib/twilio-send.ts` (the
resolver itself) and `lib/notify-error.ts` (Resend email `from`, unrelated)
are excluded explicitly, matching the instruction, though neither would have
matched the scan anyway.

**Sanity-checked the guard actually guards:** temporarily reverted
`review-request/route.ts`'s call site back to the bare-`from` pattern,
re-ran the new test alone, confirmed it failed with a clear message naming
the offending file and line, then restored the real fix and re-ran the full
suite to confirm green again. This wasn't a permanent change -- the working
tree was clean of it before commit.

### Verification actually run (2026-08-28 09:05 PT)

- `npx tsc --noEmit` -- clean.
- `npx next build` -- compiled successfully, all routes present, no new
  warnings, no errors.
- `npx playwright test --config=playwright.unit.config.ts` -- **388 passed, 0
  failed** (387 before this change, +1 new generic guard test; the other 7
  tests already in `twilio-messaging-service.spec.ts` from the prior session
  are unaffected). Raw output pasted to chat during this session.

No dashboard was touched, no account was created, no Production data was
touched, no real Twilio call was made during verification (the sanity-check
revert above never left the working tree, and was never committed or
deployed).

### Files changed

`app/api/cron/payment-reminders/route.ts`,
`app/api/estimates/[id]/send-reminder/route.ts`,
`app/api/estimates/[id]/review-request/route.ts`,
`tests/smoke/twilio-messaging-service.spec.ts`, `CLAUDE.md` (one line,
now stating all four routes use the resolver, not three-pending),
`HANDOFF.md`.

### Next action

None outstanding for this fix. The `smsConfigured`/`TWILIO_FROM_NUMBER`
gating note above is worth a look only if `TWILIO_FROM_NUMBER` is ever
retired from Vercel entirely -- not before then.

## Messaging Service SID for send-sms, domain-migration outcome, HANDOFF corrections (2026-08-28 08:56 PT)

**Status:** fixed on `main`, verified, committed as `0b68120` and pushed to `origin/main`.

### HANDOFF status-line corrections (Task 1)

This file had two `**Status:** fixed on \`main\`, verified, not yet committed.`
lines describing work that was actually committed and pushed days/hours
earlier -- the Twilio signature host-tolerance entry (actually `fac9f76`) and
the share-links entry (actually `147972f`). Both corrected to state the real
commit hash and pushed status. `git log --oneline` and `git log origin/main
--oneline` were both checked to confirm the hashes before writing them in --
not assumed from memory. This file is the project's durable memory; a false
"not yet committed" line is exactly the kind of staleness this file exists to
prevent, so the pattern stops here rather than compounding into a third
stale line next session.

### The bug (Task 2)

`app/api/send-sms/route.ts` sent every estimate text with a bare `from:
process.env.TWILIO_FROM_NUMBER`, bypassing the Twilio Messaging Service
entirely. Two real consequences, not just style: the Messaging Service's
Advanced Opt-Out management only governs sends made *through* the service,
and the number's 10DLC campaign registration is tied to the service, not to
an ad-hoc `from` send. A text sent this way sat outside both protections.

**Every other Twilio send path in the repo checked for the same pattern** (as
requested, not fixed -- see below): `app/api/cron/payment-reminders/route.ts`,
`app/api/estimates/[id]/send-reminder/route.ts`, and
`app/api/estimates/[id]/review-request/route.ts` all still send with a bare
`from: process.env.TWILIO_FROM_NUMBER`, identical pattern, identical exposure.
`lib/notify-error.ts` was checked and correctly left alone -- its `from` is an
email address (Resend), unrelated to Twilio.

### The fix (Task 2)

New `lib/twilio-send.ts`, one exported function,
`resolveTwilioSendAddress(env)`: returns `{ messagingServiceSid }` when
`TWILIO_MESSAGING_SERVICE_SID` is set (blank-checked via `?.trim()`, not
nullish-checked, matching `lib/site-url.ts`'s `cleanEnv` convention -- an env
var recorded as `""` in Vercel must be treated as absent), otherwise
`{ from: TWILIO_FROM_NUMBER }`. Twilio rejects a request carrying both
fields, so the return type is a real either/or, not both-optional.
`app/api/send-sms/route.ts` now spreads `...resolveTwilioSendAddress(process.env)`
into `client.messages.create()` instead of a hardcoded `from` field.

**New env var required:** `TWILIO_MESSAGING_SERVICE_SID`, value
`MGc054dd546b97c9ea33f4836276468516` -- needs to be set in Vercel (all
environments that send SMS) for `send-sms` to actually pick up the Messaging
Service. Until it's set there, `send-sms` falls back to `TWILIO_FROM_NUMBER`
exactly as before -- not a regression, but also not the fix taking effect.

**Only `app/api/send-sms/route.ts` was switched over this task**, matching
the literal instruction scope (one named route, one line number). The other
three routes listed above have the identical bare-`from` pattern and are
ready to adopt `resolveTwilioSendAddress()` trivially -- one import, one
line -- but that wasn't done here pending an explicit decision to extend it,
since the review-request and payment-reminder sends are a different feature
surface than estimate sends and weren't named in this task.

### 21610 handling (Task 3) -- already present everywhere, no code change

Checked all four Twilio send call sites (`send-sms`, `cron/payment-reminders`,
`estimates/[id]/send-reminder`, `estimates/[id]/review-request`): every one
already calls `recordSuppressionIfUnsubscribedError()` from
`lib/sms-suppression.ts` in its catch block, which recognizes Twilio error
code 21610 and writes `tpe_sms_suppressions` idempotently
(`store.suppress()`, an UPDATE-then-INSERT compare-and-swap). This was built
during the SMS opt-out release (see that section further down this file) and
was not disturbed by anything in this task. No code change was needed for
Task 3; a new focused test was added anyway per the bugfix-to-smoke-test
habit (see below), since this task explicitly called it out.

**On the "STOP webhooks pointed at the wrong app" data implication:** no
manual backfill is needed or was performed. `tpe_sms_suppressions` self-heals
automatically -- the next time TradePulse tries to text a number Twilio has
already recorded as unsubscribed, that send fails with 21610, and the
existing catch-block handling records the suppression then. The gap only
matters for numbers TradePulse hasn't attempted to text since the webhook
was pointed correctly; there is no way to backfill those without a Twilio-side
opt-out export, which wasn't requested and wasn't done.

### Domain migration outcome (Task 6)

Independently verified via `curl -s -o /dev/null -w '%{http_code}
%{redirect_url}'` against both legacy hosts with a path appended:

```
trytradepulse.com/share/test123      -> 308 https://tradepulse-estimates.com/share/test123
www.trytradepulse.com/share/test123  -> 308 https://tradepulse-estimates.com/share/test123
```

Both 308 (permanent redirect, method-preserving) to the canonical host with
the path intact -- the domain migration's redirect behavior is confirmed
working in Production, independent of anything this session changed.

**Reported, not independently verified by this agent (no Twilio Console
access):** the Twilio Messaging Service's inbound webhook had been pointing
at `review-request-umber.vercel.app` -- an unrelated app, not TradePulse --
until it was corrected earlier today. This explains why `tpe_sms_suppressions`
may be missing opt-outs Twilio already holds (see Task 3 above): inbound
STOP/START/HELP delivered to the wrong app never reached
`app/api/webhooks/twilio-inbound/route.ts` at all, regardless of anything in
this codebase's signature validation. Now that the webhook is corrected,
Task 3's self-healing on next-send-attempt is the intended recovery path.

### New tests (Task 4)

**`tests/smoke/twilio-messaging-service.spec.ts`** (new), 7 tests, asserting
on the payload `resolveTwilioSendAddress()` actually returns -- no mocked
Twilio SDK anywhere in this file:

1. With `TWILIO_MESSAGING_SERVICE_SID` set, the built payload contains
   `messagingServiceSid` and has no `from` key at all (checked via `"from" in
   payload`, not just a falsy check).
2. With it unset, the payload falls back to `from` and has no
   `messagingServiceSid` key.
3. An empty/whitespace-only `TWILIO_MESSAGING_SERVICE_SID` is treated as
   absent (blank-checked, not nullish-checked) -- proves the exact
   requirement, not just the happy path.
4. A parametrized check across four env shapes that Twilio never receives
   both fields at once.
5. A 21610 response results in a suppression write, using the real
   `recordSuppressionIfUnsubscribedError()` + a fake `SmsSuppressionStore`
   (same fake style already established in `sms-suppression-guard.spec.ts`
   and `twilio-inbound-webhook.spec.ts`).
6. A non-21610 error does **not** write a suppression, so the 21610 branch
   is proven selective, not a catch-all.
7. A source-level guard: `send-sms/route.ts` imports and spreads
   `resolveTwilioSendAddress`, and no longer contains a hardcoded
   `from: process.env.TWILIO_FROM_NUMBER` literal.

Added to `playwright.unit.config.ts`'s allowlist.

### Verification actually run (2026-08-28 08:56 PT)

- `npx tsc --noEmit` -- clean. (One real type error surfaced and was fixed
  during this task: `Pick<NodeJS.ProcessEnv, ...>` doesn't structurally
  accept a plain `process.env` argument in this project's TS setup --
  switched `resolveTwilioSendAddress`'s parameter to `Record<string, string |
  undefined>`, which does.)
- `npx next build` -- compiled successfully, all routes present including
  `/api/send-sms`, no new warnings, no errors.
- `npx playwright test --config=playwright.unit.config.ts` -- **387 passed, 0
  failed** (380 before this change, +7 new in
  `twilio-messaging-service.spec.ts`). Raw output pasted to chat during this
  session.

No dashboard was touched, no account was created, no Production data was
touched, no real Twilio call was made, no `.env.local` / `.env.vercel.production`
secret files were edited or committed (both are gitignored and untouched).

### Files changed

`lib/twilio-send.ts` (new), `app/api/send-sms/route.ts`,
`tests/smoke/twilio-messaging-service.spec.ts` (new),
`playwright.unit.config.ts`, `CLAUDE.md` (one line, documenting the new env
var and which routes use it), `HANDOFF.md` (this section, plus the two Task 1
corrections above).

### Next action

Set `TWILIO_MESSAGING_SERVICE_SID` = `MGc054dd546b97c9ea33f4836276468516` in
Vercel (all environments sending SMS), redeploy so the `NEXT_PUBLIC_`-free
server env var takes effect, then decide whether to extend
`resolveTwilioSendAddress()` to the three remaining bare-`from` routes
(`cron/payment-reminders`, `estimates/[id]/send-reminder`,
`estimates/[id]/review-request`) -- flagged above, not done this task.

## Twilio signature host-tolerance and password-reset canonical host (2026-08-28 07:22 PT)

**Status:** fixed on `main`, verified, committed as `fac9f76` and pushed to `origin/main`.

### The bugs

Two remaining `SITE_URL` usages flagged in the prior session (see "Share links
pinned to the canonical host" below, which pinned the other two call sites and
explicitly left these two out of scope):

1. **Twilio signature validation.** `app/api/webhooks/twilio-inbound/route.ts`
   rebuilt the signed URL from `SITE_URL` and validated against that one URL
   only. Twilio signs the exact URL it actually POSTed to, which is whatever
   the Twilio Console webhook configuration says -- not `SITE_URL`, which is
   env-driven and follows the current deployment. The moment the two
   disagreed, every inbound STOP/START/HELP failed signature validation with
   a clean 403, and nothing about that surfaces in logs or Sentry -- a silent
   compliance failure, not just a broken feature.
2. **Password reset redirect.** `app/api/send-reset-email/route.ts` built the
   Supabase recovery link's `redirectTo` from `SITE_URL`. An emailed link, like
   a share link, is a permanent artifact a user may click hours or days later;
   it should not depend on `NEXT_PUBLIC_APP_URL` being set correctly in every
   environment it might be sent from.

### The fix

1. **`lib/site-url.ts`** gained one new exported constant,
   `TWILIO_SIGNATURE_HOSTS`: `tradepulse-estimates.com`,
   `www.tradepulse-estimates.com`, `tradepulseestimates.com`,
   `www.tradepulseestimates.com`, `trytradepulse.com`, `www.trytradepulse.com`,
   and `tradepulse-estimates.vercel.app` (the project's stable Vercel host).
   Fixed, code-owned list -- not built from any request data.
2. **`lib/twilio-inbound-webhook.ts`**: `TwilioInboundDependencies.getWebhookUrl`
   (single URL) became `getWebhookUrls` (array). The handler now tries the
   signature against every candidate URL and succeeds if any one matches
   (`.some(...)`), instead of building or trusting anything from the request
   itself -- no `x-forwarded-host`, no `request.url`, no client-supplied host
   of any kind feeds the candidate list. Only the fixed allow-list does.
3. **`app/api/webhooks/twilio-inbound/route.ts`**: now imports
   `TWILIO_SIGNATURE_HOSTS` (not `SITE_URL`) and builds
   `getWebhookUrls: () => TWILIO_SIGNATURE_HOSTS.map((host) => \`https://${host}/api/webhooks/twilio-inbound\`)`.
4. **`app/api/send-reset-email/route.ts`**: now imports `canonicalUrl` instead
   of `SITE_URL`, and builds `redirectTo: canonicalUrl('/reset-password')`.
   `canonicalUrl()` consults no environment variable at all.

Left untouched, per instruction: billing checkout/portal/upgrade stay on
`SITE_URL` deliberately (those redirects are transient, one Stripe-session
long, and should follow the request origin so a preview deployment round-trips
to itself). No dashboards, pricing, copy, layout, or the logo were touched.

### New tests

- **`tests/smoke/twilio-signature-allowlist.spec.ts`** (new), 7 tests: the
  allow-list contains exactly the 7 expected hosts; a real Twilio signature
  computed for an alias host (`www.tradepulseestimates.com`) validates
  successfully; the project's `vercel.app` host also validates; a real
  signature computed for a host **not** on the allow-list (a branch-preview
  `*.vercel.app` URL, and a plain attacker-controlled domain) is rejected;
  the route/lib never reference `x-forwarded-host`, `request.headers.get("host")`,
  or `request.url`; the route derives its candidate hosts from the single
  `TWILIO_SIGNATURE_HOSTS` export, not scattered literals. Every signature is
  computed with the real `twilio` SDK (`getExpectedTwilioSignature` /
  `validateRequest`) against the real `TWILIO_SIGNATURE_HOSTS` constant --
  nothing here is mocked.
- **`tests/smoke/password-reset-canonical-host.spec.ts`** (new), 2 tests,
  matching `share-link-canonical-host.spec.ts`'s exact pattern: sets
  `NEXT_PUBLIC_APP_URL`, `VERCEL_URL`, and `NEXT_PUBLIC_VERCEL_URL` to junk
  deployment-shaped values, dynamically imports `lib/site-url.ts` **after**
  that mutation, and asserts `canonicalUrl("/reset-password")` is exactly
  `https://tradepulse-estimates.com/reset-password` regardless; a
  source-level guard confirms the route imports `canonicalUrl`, contains no
  `SITE_URL` reference, and builds `redirectTo` with exactly
  `canonicalUrl('/reset-password')`.
- **`tests/smoke/twilio-inbound-webhook.spec.ts`** (existing, updated): its
  `makeDependencies` helper switched from `getWebhookUrl` to
  `getWebhookUrls: () => [WEBHOOK_URL]` to match the new interface. All 9
  existing tests in that file still pass unmodified otherwise.

Both new files added to `playwright.unit.config.ts`'s allowlist.

### Verification actually run (2026-08-28 07:22 PT)

- `npx tsc --noEmit` -- clean.
- `npx next build` -- compiled successfully, all routes present including
  `/api/webhooks/twilio-inbound` and `/api/send-reset-email`, no new warnings.
- `npx playwright test --config=playwright.unit.config.ts` -- **380 passed, 0
  failed** (371 before this change: +9 new in
  `twilio-signature-allowlist.spec.ts`, +2 new in
  `password-reset-canonical-host.spec.ts`, existing `twilio-inbound-webhook.spec.ts`
  suite unaffected). Raw output pasted to chat during this session.

No dashboard was touched, no account was created, no Production data was
touched, no real Twilio or Supabase call was made -- every test uses fakes or
pure functions.

### Files changed

`lib/site-url.ts`, `lib/twilio-inbound-webhook.ts`,
`app/api/webhooks/twilio-inbound/route.ts`, `app/api/send-reset-email/route.ts`,
`tests/smoke/twilio-signature-allowlist.spec.ts` (new),
`tests/smoke/password-reset-canonical-host.spec.ts` (new),
`tests/smoke/twilio-inbound-webhook.spec.ts`, `playwright.unit.config.ts`,
`HANDOFF.md`.

### Next action

None outstanding for this fix -- committed and pushed, see Status above.

## Share links pinned to the canonical host, not SITE_URL (2026-08-27 22:05 PT)

**Status:** fixed on `main`, verified, committed as `147972f` and pushed to `origin/main`.

### The bug

`app/api/send-email/route.ts` and `app/api/send-sms/route.ts` built the
customer-facing share link from `SITE_URL` (see the migration section below).
`SITE_URL` resolves through `NEXT_PUBLIC_APP_URL`, then the Vercel deployment
URL, then localhost, before falling back to the canonical host. A share link is
a permanent artifact that ends up sitting in a customer's phone or inbox
indefinitely, so it must always be the canonical domain regardless of which
deployment or env state generated it. The comments already in both files
claimed "pinned to the canonical host," but the code underneath read
`SITE_URL`, which is not canonical, it's runtime-dependent. If
`NEXT_PUBLIC_APP_URL` were ever unset or wrong in Production, a real customer
share link could have been minted on a bare `*.vercel.app` deployment URL.

### The fix

Both routes now import `canonicalUrl` instead of `SITE_URL` from
`lib/site-url.ts`, and build `canonicalUrl(\`/share/${estimateId}\`)`.
`canonicalUrl()` is a plain wrapper around the `CANONICAL_SITE_URL` constant and
consults no environment variable at all, so this class of failure is now
structurally impossible rather than dependent on `NEXT_PUBLIC_APP_URL` being
set correctly.

Nothing else changed. The billing routes (`checkout`, `portal`, `upgrade`) keep
`SITE_URL` deliberately: their `success_url` / `cancel_url` / `return_url` are
transient, live only for the length of a Stripe session, and should follow the
request origin so a preview deployment round-trips to itself. The password
reset redirect and the Twilio signature URL were also left on `SITE_URL`,
out of scope for this task.

### New test

`tests/smoke/share-link-canonical-host.spec.ts`, added to the unit allowlist.
Two tests:

1. Sets `NEXT_PUBLIC_APP_URL`, `VERCEL_URL`, and `NEXT_PUBLIC_VERCEL_URL` to
   junk deployment-shaped values, dynamically imports `lib/site-url.ts`
   **after** that mutation (a static import would have been hoisted ahead of
   it), and asserts `canonicalUrl("/share/est_123")` is exactly
   `https://tradepulse-estimates.com/share/est_123`. Also asserts `SITE_URL`
   itself **did** pick up the junk value, proving the pollution was real and
   the test isn't accidentally passing because nothing changed.
2. A source-level guard, matching the convention in
   `signup-currency-layout.spec.ts`: both route files must import
   `canonicalUrl`, must contain no `SITE_URL` reference, and must build
   `shareUrl` with exactly `canonicalUrl(\`/share/${estimateId}\`)`. Comments
   are stripped before matching, so a comment alone can't satisfy it.

Reverting either route file to `SITE_URL` fails both tests.

### Verification actually run (2026-08-27 22:05 PT)

- `npx tsc --noEmit` — clean.
- `npx next build` — compiled successfully in 20.5s, 56/56 static pages, no new
  warnings.
- `npx playwright test --config=playwright.unit.config.ts` — **371 passed, 0
  failed** (369 before this change, +2 new). The new spec run in isolation:
  **2 passed**.
- `grep -n SITE_URL app/api/send-email/route.ts app/api/send-sms/route.ts` —
  the only remaining occurrences in either file are the explanatory comment
  text ("never SITE_URL"), not code. No import, no reference in the URL
  construction.

No dashboard was touched, no account was created, no Production data was
touched.

### Files changed

`app/api/send-email/route.ts`, `app/api/send-sms/route.ts`,
`tests/smoke/share-link-canonical-host.spec.ts` (new),
`playwright.unit.config.ts`, `HANDOFF.md`.

## Domain migration, code half (2026-08-27)

**Status:** implemented on `main`. DNS, Cloudflare, and Vercel were done and
verified before this session and were not touched. No Stripe, Supabase, Resend,
or PostHog dashboard was opened. Nothing in Section B of `MIGRATION.md` was
executed here; this is Section A only.

### Canonical host

**`https://tradepulse-estimates.com`, apex, no www.**

These alias hosts 301 to it and stay attached to the Vercel project
permanently: `www.tradepulse-estimates.com`, `tradepulseestimates.com`,
`www.tradepulseestimates.com`, `trytradepulse.com`, `www.trytradepulse.com`.

`trytradepulse.com` and `www.trytradepulse.com` are being retired but must never
be detached. Every estimate share link ever sent to a customer, and the printed
postcard QR codes for `/go/electricians-postcard` and `/go/trades-postcard`,
live on them. The 301 is the only thing keeping those working.

### Single source of truth: `lib/site-url.ts`

Two exports, deliberately separate:

- **`SITE_URL`** — the runtime origin. `NEXT_PUBLIC_APP_URL`, then the Vercel
  deployment URL (`NEXT_PUBLIC_VERCEL_URL` or `VERCEL_URL`) so previews link to
  themselves, then localhost in development, then the canonical host. Used for
  share links, Stripe `success_url` / `cancel_url` / `return_url`, the password
  reset `redirectTo`, and the Twilio signature URL.
- **`CANONICAL_URL`** / **`CANONICAL_DOMAIN`** — always the real domain, never a
  preview or localhost origin. Used for `metadataBase`, canonical tags, Open
  Graph and Twitter URLs, JSON-LD, the sitemap, `robots.ts`, the text baked into
  the OG image, and public marketing links.

They are separate because of `MIGRATION.md` D1. If `NEXT_PUBLIC_APP_URL` is
genuinely empty in Production, a single env-driven constant would resolve to the
`.vercel.app` deployment URL and publish canonical tags and a sitemap pointing
at it. Pinning the published identity to a constant makes that failure
impossible.

**Every term is blank-checked, not nullish-checked.** An empty string is not
nullish, so the old `NEXT_PUBLIC_APP_URL ?? "https://www.trytradepulse.com"`
chain would have handed an empty string to Stripe and to Twilio signature
validation. `cleanEnv()` treats empty and whitespace-only as unset. This closes
D1 in code regardless of what the dashboard value turns out to be.

A future domain change is `NEXT_PUBLIC_APP_URL` in Vercel plus
`CANONICAL_SITE_URL` in `lib/site-url.ts`. Nothing else in the repo carries a
TradePulse hostname.

### Behaviour change worth knowing: share links no longer follow the request origin

`/api/send-sms` and `/api/send-email` built the share URL from the request
`origin` header first. A contractor still signed in on `www.trytradepulse.com`
would therefore have minted share links on the retired alias, and those links
sit in customer inboxes permanently. Both routes now build the share URL from
`SITE_URL` unconditionally.

The billing routes keep origin-first. Their URLs are transient, so an alias
origin costs nothing there.

### `robots.txt` is now generated

`public/robots.txt` was static and could not read the constant. It is replaced
by `app/robots.ts`, which emits the same two rules with the `Sitemap:` line
built from `CANONICAL_URL`. Verified in the build output.

### `metadataBase` is set

`app/layout.tsx` now sets `metadataBase: new URL(CANONICAL_URL)`. **The three
long-standing `metadataBase` build notices recorded throughout this document are
gone.** That baseline no longer applies.

### Email deliberately did NOT move

Every `from:` address and the published support address are still on
`trytradepulse.com`. Resend has exactly one verified sending domain and sending
reputation is per-domain, so the new domain has to be added, verified, and
warmed up first.

They are now all held in **`lib/email-addresses.ts`**, values unchanged:
`EMAIL_DOMAIN`, `ESTIMATES_EMAIL`, `ESTIMATES_FROM`, `SUPPORT_EMAIL`. The later
switch is one edit to `EMAIL_DOMAIN`. Eighteen files previously carried a
literal address; none does now.

The only remaining `trytradepulse.com` string in application code is that one
constant. Everything else is historical documentation, which was left alone.

### Environment variables Greg must set in Vercel

| Variable | Environment | Required value |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Production | `https://tradepulse-estimates.com` |
| `NEXT_PUBLIC_APP_URL` | Preview | leave unset, so previews resolve to their own deployment URL |
| `NEXT_PUBLIC_APP_URL` | Development | unset, or `http://localhost:3000` |

`NEXT_PUBLIC_` values are inlined at build time. **Changing it does nothing
until a redeploy.**

`NEXT_PUBLIC_SUPABASE_URL` also holds a URL and is unaffected by this migration.
`PLAYWRIGHT_BASE_URL` is not a Vercel variable; it is a CI and local test
variable, and both its workflow value and its code default now point at the
canonical host.

**The live value of `NEXT_PUBLIC_APP_URL` could not be read from this session.**
The only record is the gitignored `.env.vercel.production` snapshot dated
2026-06-20, which shows an empty string. That is over two months old and is not
authoritative. Confirm it in the dashboard.

### New test

`tests/smoke/share-link-canonical-domain.spec.ts`, in the browser suite (not the
unit allowlist, because it needs a real browser and network). It asserts the
invariant directly: it seeds an estimate, navigates to the share route on the
canonical host **by absolute URL**, and asserts 200 with no redirect, that the
final host is the canonical host, and that the title, customer line, line item,
amount, and `All amounts in CAD` label are all on the page. It locates no nav
element to get there. A second test pins the canonical host to https, apex, no
`www.`, no trailing slash.

The seeded business row is ownerless on purpose: no Auth user, no Stripe
customer, no subscription. Teardown is a plain delete of the estimate then the
business, not the account-deletion RPC, which cannot act on an ownerless
business.

**It has not been run.** Running it writes to the Production database and hits
the Production site.

### Verification actually run (2026-08-27 21:36 PT)

- `npx tsc --noEmit` — clean.
- `npx next build` — compiled successfully in 20.6s, 56/56 static pages, **zero
  `metadataBase` notices**.
- `npx playwright test --config=playwright.unit.config.ts` — **369 passed, 0
  failed**, unchanged from the documented baseline.
- `npx eslint .` — **8 errors, 18 warnings**, identical to the documented
  baseline. No new lint problem.
- Generated build output inspected directly: `.next/server/app/robots.txt.body`
  and `sitemap.xml.body` are entirely on `tradepulse-estimates.com`, and
  `plumbers.html` carries `rel="canonical"`, `og:url`, and `og:image` on the
  canonical host with the JSON-LD `"url"` matching.
- `git grep -n trytradepulse` — zero hits in application code. The only code hit
  is the deliberate `EMAIL_DOMAIN` constant.

**Not run:** the full Playwright smoke suite, the new share-route test, and any
Production check. No account was created and no Production data was touched.

### Files changed

New: `lib/site-url.ts`, `lib/email-addresses.ts`, `app/robots.ts`,
`tests/smoke/share-link-canonical-domain.spec.ts`.
Deleted: `public/robots.txt`.
Changed: `app/layout.tsx`, `app/page.tsx`, `app/sitemap.ts`,
`app/opengraph-image.tsx`, `app/contact/page.tsx`, `app/login/layout.tsx`,
`app/signup/layout.tsx`, `app/plumbers/page.tsx`, `app/electricians/page.tsx`,
`app/trades/page.tsx`, `app/plumbing-cost/page.tsx`,
`app/electrical-cost/page.tsx`, `app/plumbing-estimate-template/page.tsx`,
`app/plumbing-estimate-template/content.ts`, `app/privacy/page.tsx`,
`app/terms/page.tsx`, `app/subscribe/page.tsx`, `app/share/[id]/page.tsx`,
`app/components/profile-form.tsx`, `app/components/estimate-actions.tsx`,
`app/components/CopyEmailButton.tsx`, `app/components/EstimateDemo.tsx`,
`app/components/EstimateDemoTrades.tsx`,
`app/components/EstimateDemoElectrical.tsx`, `app/api/send-sms/route.ts`,
`app/api/send-email/route.ts`, `app/api/send-reset-email/route.ts`,
`app/api/billing/checkout/route.ts`, `app/api/billing/portal/route.ts`,
`app/api/billing/upgrade/route.ts`, `app/api/cron/payment-reminders/route.ts`,
`app/api/estimates/[id]/send-reminder/route.ts`,
`app/api/webhooks/new-signup/route.ts`,
`app/api/webhooks/twilio-inbound/route.ts`, `lib/notify-error.ts`,
`playwright.config.ts`, `.github/workflows/smoke-tests.yml`,
`tests/smoke/twilio-inbound-webhook.spec.ts`, `CLAUDE.md`, `CODEX.md`,
`PROJECT.md`, `PROJECT-RELATIONSHIPS.md`, `HANDOFF.md`.

### Exact next action

1. Set `NEXT_PUBLIC_APP_URL=https://tradepulse-estimates.com` for Production in
   Vercel, then **redeploy** so the inlined value takes effect.
2. Work `MIGRATION.md` Section B5 while the old domain still serves 200: the
   Stripe webhook URL, the Supabase Site URL and redirect allow-list, the Google
   OAuth redirect, and the Supabase `auth.users` hook. Stripe does not follow
   redirects on webhook delivery, so this must happen before any 301 on the old
   host.
3. Only then turn on the four alias 301s (Section B6), and run Section C,
   starting with C11, the real share-link check.

### Still open, not addressed here

- `MIGRATION.md` D4: the homepage meta description and the OG image bake
  `CA$29` for every visitor while the visible pricing cards are geo-priced. See
  the pricing note below.
- `MIGRATION.md` D5: `app/page.tsx` still redirects a no-business identity to
  `/onboarding` instead of the proxy's `/signup?error=setup_required`.
- `MIGRATION.md` D8: the Twilio inbound webhook is still not configured
  anywhere. If it ever is, its Console URL must match `SITE_URL` character for
  character.
- `MIGRATION.md` D10: six untracked `*.bak-*` files still sit at the repo root
  and pollute every repo-wide grep.

### Pricing, checked and deliberately not changed

`lib/currency.ts` holds `cad: { starter: 29, pro: 59 }` and
`usd: { starter: 19, pro: 39 }`. The homepage pricing cards render
`currencyPrefix(currency)` plus `planMonthlyPrice(plan, currency)`, where the
currency comes from `currencyFromCountry(x-vercel-ip-country)`. **A Canadian
visitor sees CA$29 and CA$59; a US visitor sees US$19 and US$39, by design.**
The CAD figures are correct. The meta description is always `CA$29` because
static `metadata` cannot vary per request, and the OG image bakes `CA$29` into
the PNG. That mismatch is real but is not a wrong price, and it was not changed.

## Release 1: account-provisioning integrity (2026-08-24, uncommitted)

**Status:** implemented on `main` in the working tree, fully verified locally, **not committed and not deployed**.

### What it fixes

`app/api/auth/signup/route.ts` created the Stripe customer and the trial subscription before writing the `tpe_businesses` row, and its `dbError` branch deleted the Auth user while leaving both Stripe objects alive. Because the Auth user was the only handle carrying `metadata.user_id`, the surviving customer and its trialing subscription became unattributable. `app/auth/callback/route.ts` had the same asymmetry in `ensureBusiness()`.

### What changed

- **`lib/account-provisioning.ts` (new).** Dependency-injected `provisionNewAccount()`. Runs Stripe customer, then Starter trial subscription, then the business row, and compensates the whole attempt on any failure. No fallback path, so one call can never create two subscriptions.
- **`lib/account-provisioning-server.ts` (new).** Real Stripe/Supabase wiring plus the Sentry reporter. Keeps the saga module free of server-only imports so it stays unit-testable.
- **`lib/stripe-object-state.ts` (new).** `isMissingStripeObject()` (moved here, still re-exported from `lib/stripe-billing-recovery.ts` so the existing name keeps working) and the new `isDeletedStripeObject()`.
- **`app/api/auth/signup/route.ts`**, **`app/auth/callback/route.ts`.** Both now provision through the shared helper. Neither calls Stripe or `auth.admin.deleteUser` inline any more. Success behaviour is byte-identical.
- **`app/api/billing/checkout/route.ts`**, **`lib/stripe-billing-recovery.ts`.** A retrieved Stripe customer carrying `deleted: true` is now treated as missing. Stripe keeps deleted customers retrievable, so a catch-only check let a dead reference through and failed later at session creation instead of recreating the customer.

### Compensation order (after Stripe creation)

Business row, then Stripe customer (which also cancels its subscription), then the Auth user **last**. If any earlier step fails the sequence stops, the Auth user is preserved, and `reportCleanupFailure()` records `userId`, `customerId`, `subscriptionId`, `operation`, and `cleanupStep` to Sentry and the console. Deleting the Auth user while a Stripe object survives is precisely what created the unattributable orphans, so that is never done.

Google OAuth failures always preserve the Auth identity (`deleteAuthUserOnFailure: false`), sign the user out, and redirect to `/signup?error=setup_failed`. A later Google signup by that identity retries provisioning because no business row exists. **No timing heuristic is used anywhere.**

### Verification actually run (2026-08-24)

- `git diff --check`: passed, only the pre-existing benign CRLF notices.
- `npx.cmd tsc --noEmit`: passed.
- Focused new/changed tests (`account-provisioning`, `stripe-object-state`, `stripe-billing-recovery`): **24 passed**.
- Full safe unit suite: **240 passed**, 0 failed (was 219; +21 new).
- `npx.cmd next build`: passed, only the three known `metadataBase` notices.
- Targeted ESLint on all changed and new files: one `prefer-const` error at `lib/stripe-billing-recovery.ts:44`, **confirmed pre-existing** by linting the HEAD version of that file in isolation (same error, line 50 there).

### Corrected baseline

The full-lint baseline recorded below as "7 errors and 18 warnings" is **stale**. The verified current baseline is **8 errors and 18 warnings**, and the eighth is the `prefer-const` error above, which is present at HEAD.

### Read-only orphan diagnostic (2026-08-24, nothing mutated or cleaned)

Live Stripe: 384 customers (0 deleted in the list), 434 subscriptions (210 trialing, 164 past_due, 60 canceled). Only **9** customers are referenced by a `tpe_businesses` row, leaving **375 orphan customers and 425 orphan subscriptions**, every one created in 2026-08 and every one carrying `metadata.user_id`. No customer holds more than one subscription, so orphans are one-per-attempt, consistent with the fixed failure path rather than a duplicate-creation bug.

Supabase: 15 `auth.users` rows, **0 without a business row** (so no unprovisioned identity exists today), against 39 business rows. 34 business rows store a `stripe_customer_id`; 6 sampled ones that are absent from the Stripe list return `resource_missing`, meaning genuinely gone rather than deleted-and-retrievable. **No currently-stored reference to a deleted-but-retrievable customer was found**, so the deleted-customer handling closes a latent gap rather than an observed live failure.

### Authorised live Stripe orphan cleanup (2026-08-24, completed)

The owner explicitly authorised deleting these orphan records, confirming zero real subscribers. Executed with a temporary, auditable script (deleted afterwards), never through the Dashboard. No application code, schema, environment variable, Stripe Product/Price, webhook, or portal configuration was changed.

**Preflight (read-only, all guards passed).** Fully paginated live Stripe: 384 customers, 434 subscriptions, 598 invoices, 164 PaymentIntents, 0 charges. **Zero real money has ever moved in this account**: 0 charges, 0 succeeded PaymentIntents (all 164 sit at `requires_payment_method`, i.e. trials that ended with no card), and 0 invoices with `amount_paid > 0`. All 434 invoices in `paid` status are the $0 invoices Stripe issues for a trial, which is why the paid check requires `amount_paid > 0`, matching the guard the billing webhook already uses.

Target rule: not referenced by any `tpe_businesses.stripe_customer_id`, created in August 2026, has `metadata.user_id`, and no successful charge, paid invoice, or succeeded PaymentIntent. That produced **exactly 375** eligible customers, matching the required guard, with 0 overlap against the 9 referenced customers and 0 targets holding any paid record. Subscription ownership reconciled exactly: 374 on targets, 51 already-canceled on previously deleted customers, 9 on the referenced businesses (8 trialing, 1 past_due), totalling 434.

**Result.** 375 customers deleted, 0 failures, 0 already gone. 374 subscriptions cancelled by that deletion (202 trialing, 163 past_due, 9 already canceled). Stripe transitioned the 163 open invoices to `uncollectible` automatically as part of customer deletion, so the script voided 0 and deleted 0 drafts; `uncollectible` is a terminal state and was deliberately left alone, as were the 374 paid $0 trial invoices.

**Post-cleanup verification.** All 375 targets return `deleted: true`; none still live. 0 target subscriptions remain trialing, active, or past_due. 0 target open or draft invoices remain. Live customers now number 9, exactly the referenced set, and their 8 trialing plus 1 past_due subscriptions are unchanged. Both active CAD Prices and the archived one are untouched. Supabase is byte-for-byte unchanged (39 businesses, 34 with a customer reference, 33 with a subscription reference, 41 estimates, 15 auth users, identical plan/status distribution), and `max(tpe_businesses.updated_at)` remains 2026-08-23, proving no webhook wrote a business row. The single webhook endpoint is still enabled on the canonical URL with its 6 events, and **0 events have `pending_webhooks > 0`**, so nothing failed delivery. The `customer.subscription.deleted` deliveries were correctly no-ops because none of the deleted customers was referenced by a business row.

Note the 25 stored `stripe_customer_id` values that already pointed at absent customers are unrelated to this cleanup and were not touched.

### Authorised deletion of the nine business-linked test accounts (2026-08-24, 8 of 9 completed)

Owner-authorised removal of all nine remaining business-linked test accounts, run through the already-verified `deleteAuthenticatedAccount()` sequence with the same dependency implementations as `app/api/account/delete/route.ts`, so the order and compensation were preserved: claim lease, cancel subscription, remove Storage objects, transactional RPC, Auth user last. Two self-service guards were satisfied administratively because there is no browser session for an operator run: the `DELETE` confirmation string, and the 15-minute re-auth freshness check. No application code, schema, migration, environment variable, webhook, or deployment configuration was changed.

**Preflight (read-only, passed).** Nine unique target customer ids, all nine live in Stripe, no live customer outside the target set, and zero successful payments anywhere in the account (0 charges, 0 succeeded PaymentIntents, 0 invoices with `amount_paid > 0`). Database side: 9 business rows, 7 estimates, 0 photos, 1 logo.

**Result: 8 of 9 accounts fully deleted.** Businesses 39 to 31, estimates 41 to 35, Auth users 15 to 7, live Stripe customers 9 to 0. All nine Stripe customers are deleted and all nine subscriptions are `canceled`, with none left trialing, active, or past_due. Prices untouched. Webhook endpoint unchanged and 0 events undelivered.

**One account could not be deleted, and the cause is a real defect in the deletion path.** The ninth business row has an `owner_user_id` that no longer exists in `auth.users`. `begin_business_deletion` inserts a deletion claim into `tpe_estimate_generation_claims`, whose `owner_user_id` carries a foreign key to `auth.users`, so the insert fails with a foreign-key violation and the lease can never be acquired. `tpe_delete_business_account_data` then refuses with `BUSINESS_DELETION_CLAIM_REQUIRED` because no claim exists. **A business whose owner Auth user is already gone cannot be deleted by the established procedure at all.** Every workaround (manual row deletion, a schema change, or recreating an Auth user to satisfy the constraint) was outside the authorised scope, so the run stopped there rather than improvising.

**Two corrections to the expected counts.** Only 8 of the 9 target `owner_user_id` values actually existed in `auth.users`, so the expected "9 Auth users targeted" and "15 to 6" were off by one; 15 to 7 is the complete result for the 8 deletable accounts. Separately, **24 business rows in total carry an `owner_user_id` absent from `auth.users`**, so this defect is broader than the one blocked account and should be scoped on its own.

**Known partial state.** The runner deleted all nine Stripe customers after the account loop rather than per account, so the blocked account's Stripe customer was deleted even though its database rows remain. That business row now references a deleted Stripe customer and holds 1 estimate, and its `subscription_status` was set to `cancelled` by the normal webhook. It is inert because no Auth user can sign in as it. The Release 1 `isDeletedStripeObject` handling means Checkout would recreate a customer rather than fail on that stale reference. Deleting these remaining rows needs either a fix to the claim path or a separate explicit authorisation.

### Authorised one-off cleanup of ownerless business rows (2026-08-24, completed)

Owner-authorised historical-data cleanup of every `tpe_businesses` row whose `owner_user_id` had no matching `auth.users` record, including the Clearwater Plumbing row left behind by the account deletions above. These rows cannot be removed by the normal account-deletion procedure: `begin_business_deletion` must insert a claim into `tpe_estimate_generation_claims`, whose `owner_user_id` has a foreign key to `auth.users`, so the lease can never be acquired for an ownerless business. That mechanism is for live authenticated accounts and was deliberately not bypassed or modified. No application code, RPC definition, schema, migration, environment variable, Stripe configuration, or deployment configuration was changed, and no Auth user was created or deleted.

**Preflight (read-only, all guards passed).** Dependent tables were derived from the live foreign-key map plus the existing `tpe_delete_business_account_data` RPC. The FK map surfaced two tables the RPC does not handle, `tpe_delivery_claims` and `tpe_photo_upload_reservations` (both CASCADE), and confirmed `tpe_estimate_generation_claims.business_id` is RESTRICT so it must be removed first. Targets: exactly **24** ownerless businesses, Clearwater Plumbing included, none with a null owner. Affected records: 16 estimates, 8 estimate items, 0 legacy line items, 1 estimate photo, 2 estimate changes, 0 payment reminders, 0 price-book items, 0 generation or deletion claims, 0 delivery claims, 0 photo reservations, 10 user-keyed rate limits, 2 logo references. Stripe guard: of their 21 stored customer references, 20 were already missing and 1 deleted, **none live**, with no trialing, active, or past-due subscription and zero charges, succeeded PaymentIntents, or invoices with `amount_paid > 0` anywhere in the account.

**Storage first.** 1 estimate photo removed from `tpe-estimate-photos`. The 2 `logos` paths were already absent, tolerated the same way the production route tolerates a 404. Zero failures, so the database step was allowed to proceed.

**Database.** One atomic `DO` block. It asserted 24 ownerless businesses before deleting and asserted 24 business rows deleted after, either of which would have rolled the whole transaction back. Deletion order: generation claims, delivery claims, photo upload reservations, payment reminders, estimate changes, estimate items, estimate line items, estimate photos, estimates, price-book items, user-keyed rate limits, then the business rows. An earlier attempt aborted cleanly on a `FOR UPDATE` with aggregate error and changed nothing; the retry used the RPC's own subquery-locking pattern.

**Before and after.** Businesses 31 to **7**, estimates 35 to **19**, Auth users 7 to **7** (unchanged), ownerless businesses 24 to **0**, Clearwater Plumbing rows 1 to **0**. Zero orphaned estimates and zero orphaned photos remain. The only surviving claim is a pre-existing expired `generation` claim on a surviving Auth-backed business. All seven remaining businesses are Auth-backed and were not touched. Stripe was not modified by this cleanup and still shows 0 live customers, all 434 subscriptions `canceled`, none trialing, active, or past-due, and all three Prices intact.

## Release 2: no-business access closure and Google intent split (2026-08-24, uncommitted)

**Status:** implemented on `main` in the working tree, verified locally, **not committed and not deployed**. Release 1 (`1a9b4a6`) is live; `origin/main` is at `a7e5471`.

**Read-only production preflight:** **0 Auth users with no `tpe_businesses` row** (8 Auth users, 8 businesses). Nobody is currently in the state this release closes, so it is behaviourally inert for existing users. No Stripe, Supabase, Auth, or production data was mutated.

### 1. `/onboarding` is no longer a business-creation path

`getOrCreateBusiness()` and its `.insert()` are gone. The page now only looks a business up, and never writes `plan`, `subscription_status`, `trial_ends_at`, or any Stripe resource. Previously it minted a `starter` / `trial` row with no Stripe customer or subscription behind it, and `proxy.ts` honoured that as a valid 14-day trial, so any authenticated identity without a business could grant itself unbilled access.

The route is kept so stale links stay safe: a signed-out visitor goes to `/signup`, a no-business identity goes to `/signup?error=setup_required`, and a real business is redirected to `next` (path-validated) or `/estimates`.

### 2. `proxy.ts` no longer redirects to `/onboarding`

The `!business` branch now clears the Supabase session cookies on the redirect response and sends the person to `/signup?error=setup_required`. The old `/onboarding` exemption is removed with it. `/signup` is in `PUBLIC_PATHS`, so `isPublic()` short-circuits before the business lookup ever runs again and the redirect cannot loop.

The session must be cleared on a real response. `createSupabaseServerClient()`'s `setAll` swallows the write during a server-component render, so `signOut()` there looks successful and leaves the session intact. `lib/auth-session.ts` identifies the `sb-<ref>-auth-token` cookies, including the chunked `.0` / `.1` variants.

### 3. Google OAuth intent is bound, not trusted

`lib/oauth-intent.ts` holds a two-value allowlist (`login`, `signup`). `/auth/google` validates the requested intent, generates a nonce, writes `tp_oauth_intent` as `intent.nonce.issuedAt` in an **HttpOnly, SameSite=Lax, 10 minute** cookie, and puts **only the nonce** into `redirectTo`. The intent never appears in any URL.

`/auth/callback` reads the intent from that cookie and trusts it only when the value is on the allowlist, has not expired, was not issued in the future, and its nonce matches the one returned with the redirect. Missing, malformed, unknown, expired, or mismatched all resolve to `null`, and the callback then signs out and redirects to `/signup?error=signin_expired`. The cookie is cleared on every exit path. An unrecognised intent at the start route falls back to `login`, which never creates anything.

### 4. Callback branches

- **Business already exists:** both intents sign in normally. No provisioning, for either.
- **`login`, no business:** no business row, Stripe customer, subscription, or trial is created. Sign out, redirect `/signup?error=setup_required`.
- **`signup`, no business:** the Release 1 compensated helper runs (`deleteAuthUserOnFailure: false`). On failure it cleans partial database and Stripe resources, **preserves the Auth identity**, signs out, and redirects `/signup?error=setup_failed`. No timing heuristic, and no Google Auth user is ever deleted.

Email/password signup, paid/trial logic, webhook mapping, and Stripe Price-ID logic are untouched.

### Verification actually run (2026-08-24)

- `git diff --check`: passed, only the pre-existing benign CRLF notices.
- `npx.cmd tsc --noEmit`: passed.
- Focused new tests (`oauth-intent`, `no-business-access`): **23 passed**.
- Full safe unit suite: **263 passed**, 0 failed (was 240; +23 new).
- `npx.cmd next build`: passed, only the three known `metadataBase` notices.
- Targeted ESLint on all changed and new files: one `react-hooks/set-state-in-effect` error in `app/signup/page.tsx`, **confirmed pre-existing** by linting the HEAD version of that file in isolation. It is one of the 8 baseline errors and is unrelated to the one-line change made there.

### Authorised cleanup of the smoke-test burst, and test-harness hardening (2026-08-24)

**Cause.** A full Playwright smoke run was executed against Production between 19:05:16 and 19:07:52 PT, creating 20 live Stripe Customers with CAD 2900 Starter trials. Nineteen leaked: `cleanupTestAccount()` deleted the Stripe Customer inside a bare `catch {}`, then deleted the database and Auth rows anyway, so the Customers survived with nothing left pointing at them. The twentieth was never cleaned up at all and was the record behind the 7 to 8 count change between 18:57 and 19:17 PT. Both counts had been correct; the record was created between them.

**Preflight (read-only, all guards passed).** 20 live Customers, all inside the burst window, none outside it. All live-mode, all with `metadata.user_id`, none already deleted, each with a trialing CAD 2900 Starter subscription. Account-wide: 0 charges, 0 succeeded PaymentIntents, 0 invoices with `amount_paid > 0`. Database cross-check: 19 with neither Auth user nor business row, 1 Auth-backed with the exact fresh-test signature (47-character plus-alias, provider `email`, matching Stripe references, 0 estimates).

**Cleanup.** The 19 orphans were deleted directly: 19 deleted, 0 already gone, 0 failures, all 19 subscriptions cancelled. The Auth-backed account went through the established `deleteAuthenticatedAccount()` procedure with the route's own dependency implementations, and its Stripe Customer was deleted only after that procedure succeeded and the business row was confirmed gone, so no dangling reference could be created.

**Before and after.** Live Stripe Customers 20 to **0**. Trialing, active, or past-due subscriptions 20 to **0** (all 454 now `canceled`). Auth users 8 to **7**, businesses 8 to **7**, estimates 19 to **19** (the test account had none). Auth users without a business: **0**. Ownerless businesses: **0**. Orphaned estimates: **0**. All three Stripe Prices intact. The seven pre-existing Auth-backed businesses were untouched.

### Rule: fresh-account smoke tests must not run against Production

`tests/smoke/helpers.ts` `signUpFreshAccount()` now **refuses by default** and throws before any network call unless `ALLOW_PRODUCTION_SIGNUP_SMOKE=true` is set for that single run. Refusal is loud, never a silent skip, because a silent skip is how a green run can hide accounts that were never exercised. Anything that is not clearly a local stack counts as Production, and a live-mode Stripe key alone is decisive.

`cleanupTestAccount()` no longer swallows Stripe failures. Stripe cleanup runs first and now **throws** before any database or Auth deletion, so a failure can never again strip away the only record tying a Customer to a user. Only an already-missing Customer is tolerated; only genuinely transient failures (rate limit, lock timeout, `api_error`, 429, 5xx) are retried, bounded at 3 attempts; anything else fails immediately with the Customer id and manual-cleanup instructions. The logic lives in `tests/smoke/smoke-safety.ts` as pure functions, covered by 17 non-network tests in `tests/smoke/smoke-safety.spec.ts`.

**No full smoke suite was run in this session.** Only `playwright.unit.config.ts`, whose `testMatch` allowlist contains pure unit specs with no network access. No account was created.

## USD/CAD multi-currency (2026-08-24, uncommitted, NOT migrated, NOT deployed)

**Status:** implemented in the working tree. The migration file exists but **has not been applied to Production**, and no live Stripe object was modified.

### Migration created but not applied

`supabase/migrations/20260825000000_add_currency_columns.sql`. Additive only, no RLS change, no `SECURITY DEFINER`:

- `tpe_businesses.estimate_currency text not null default 'cad'`, checked `in ('cad','usd')`
- `tpe_estimates.currency text not null default 'cad'`, checked `in ('cad','usd')`

The `not null default 'cad'` backfills every existing row in the same statement, so all 7 businesses and 19 estimates stay CAD with no separate UPDATE. Rollback is `drop column` on both.

**Type-generation blocker.** `lib/database.types.ts` is generated from the live schema, which does not have these columns yet. Regenerating now would reproduce the old schema and hand-editing would fake schema state, so both new columns are read and written **only** through `lib/currency-db.ts`, which carries the narrow casts and the explanation. After the migration is applied, regenerate the types with the Supabase MCP and delete the casts. That is a one-file change.

### Currency model

Billing currency and estimate currency are deliberately separate and never conflated. **Billing currency is not stored**: Stripe locks it to the Customer on the first subscription and is the only authority, so a second copy would drift the moment a contractor changed their estimate currency. **Estimate currency** is a per-business setting, snapshotted onto each estimate at creation so historical estimates never move.

Prices are separate price points, never conversions: Starter CA$29 / US$19, Pro CA$59 / US$39. Amounts always render `CA$` or `US$`; a bare `$` is never emitted.

### Stripe preflight verified read-only (2026-08-24)

| Price | Active | Currency | Amount | Product | currency_options |
|---|---|---|---|---|---|
| `price_1U166oQ45KFNqa8x40e7T41u` | yes, livemode | cad | 2900 | `prod_Uzw4COlgTWZnhc` TradePulse Starter | **cad only** |
| `price_1TzwECQ45KFNqa8xsjncgiHQ` | yes, livemode | cad | 5900 | `prod_Uzw6WQ8HsaqblQ` TradePulse Pro | **cad only** |

Account `acct_1TzvK3Q45KFNqa8x`, country CA, default currency cad, `tax_behavior: unspecified` on both. Archived CAD 3900 Starter remains archived. **No Stripe object was modified.** Note that 5 live customers with trialing subscriptions existed at preflight time, created after the earlier cleanup.

### Verification actually run

- `git diff --check`: passed.
- `npx.cmd tsc --noEmit`: passed.
- Focused new tests (`currency.spec.ts`): **23 passed**.
- Full safe unit suite: **304 passed**, 0 failed (was 280).
- `npx.cmd next build`: passed, only the three known `metadataBase` notices. `/signup` is now dynamic, as expected from reading a request header.
- Full ESLint: **8 errors and 18 warnings, identical to the documented baseline**. The one `set-state-in-effect` error moved verbatim from `app/signup/page.tsx` to `app/signup/signup-form.tsx` with the code.

Five pre-existing tests asserted the old bare-`$` output and the old signup file layout; their expectations were updated to `CA$` and to `signup-form.tsx`, not weakened.

### Estimate rendering coverage now complete

Every customer-facing estimate surface renders the estimate's own persisted `currency` snapshot, never the business setting, so changing `Estimate currency` moves new estimates only:

- **Serializer** (`lib/estimate-summary.ts`): line items, the quantity/rate description, the preamble total, and the whole pricing block. A gap was found and closed here by the new tests: the Line Items table was still emitting `CA$` inside a USD estimate because only the pricing block had been threaded.
- **Editor** (`editable-estimate-body.tsx`): every total, tax, deposit, balance, and per-line amount, plus the inline formatter. Saving re-serializes with the same snapshot, so a save cannot silently rewrite an estimate to CAD. Forwarded from `estimate-pricing-editor.tsx` and the estimate detail page.
- **Reminders** (`lib/payment-reminder-message.ts`): SMS and email HTML both quote the snapshot. The email prose carries no amount. All three callers pass it: the cron (one batched lookup, not one query per estimate), the manual send route, and the Profile preview.
- **Share page and PDF**: the `All amounts in CAD/USD` label, deliberately below the pricing table and outside any cell, because a currency code inside an amount cell would break `parseCost()` on a later edit.

An estimate with no snapshot defaults to CAD, so all 19 existing estimates are unchanged.

**Old-price search.** No stale plan pricing remains on any product surface. The only `$39`/`$69` matches are the deliberately labelled *Superseded* decision record in `DECISIONS.md` (kept as history), unrelated estimate line-item amounts in test fixtures, and the current US$39 Pro price. Nothing was removed from `DECISIONS.md`: superseding is recorded there, not overwritten.

### Five live trialling subscriptions: read-only investigation

All five were created in an eight-second burst, two seconds apart, on the same evening, each with a distinct `metadata.user_id`. Every one is a CAD 2900 Starter trial on the existing Starter Price. **Zero charges, zero succeeded PaymentIntents, and zero invoices with `amount_paid > 0` account-wide.** All five Auth users and business rows are already absent, so no live account is affected. Classification: **all five confirmed test records.**

**Root cause, and it is not the gate failing.** The addresses match `tests/smoke/signup-rate-limit.spec.ts` exactly, whose generated address is ten characters longer than `signUpFreshAccount`'s. That spec creates accounts by POSTing straight to `/api/auth/signup` and **never calls `signUpFreshAccount`**, so the `ALLOW_PRODUCTION_SIGNUP_SMOKE` gate does not apply to it. It deliberately creates exactly five accounts to exhaust the five-per-hour limit, which is precisely what was observed. The gate was already on disk eleven minutes before the burst, so timing is not the explanation: the spec simply is not covered by it.

**Both follow-ups are now closed. See the rule below.**

### Cleanup of the five, and the complete production-smoke rule (2026-08-24)

**Cleanup.** All guards passed before mutation: exactly five customers in the burst window, no live customer outside that set, all CAD 2900 Starter trials, all with no Auth user and no business row, and zero charges, succeeded PaymentIntents, or invoices with `amount_paid > 0` account-wide. Result: **5 deleted, 0 failures.** Verified after: **0 live Stripe customers, 0 trialling/active/past-due subscriptions** (all 459 now `canceled`), all three Prices intact. The database was not touched: 7 businesses, 7 Auth users, 19 estimates, and `max(tpe_businesses.updated_at)` still 2026-08-18, well before this session.

**The rule, now enforced rather than documented.**

Every test-driven POST to `/api/auth/signup` goes through one wrapper, `postSignupApi()` in `tests/smoke/smoke-safety.ts`. It applies the Production gate **before** issuing any request, so a refused run creates nothing, and it accepts only the exact one-run override `ALLOW_PRODUCTION_SIGNUP_SMOKE=true`. `signup-rate-limit.spec.ts`, the spec that bypassed the old gate and created the five, now calls it. A static source test scans every file in `tests/smoke/`, with comments stripped so a comment can neither satisfy nor fail it, and fails if any spec outside the two approved wrapper files posts to that endpoint directly.

**Teardown is now deterministic even with no business row.** `cleanupTestAccount()` resolves the Stripe customer from the business row when present and otherwise from `metadata['user_id']`, so a missing `tpe_businesses` row can never silently skip Stripe again. That silent skip is exactly what let the five survive a teardown that had already removed their database and Auth records. Stripe is resolved and deleted **before** any database or Auth deletion. Only an explicitly already-missing customer is tolerated; only transient failures retry, bounded at three attempts. A failed or ambiguous resolution throws with the user id and the candidate customer ids, and leaves every record needed for recovery in place.

## Controlled Production verification of the currency cutover (2026-08-24)

Two synthetic trial accounts were created through the real deployed signup flow, one CAD and one USD, and both were removed afterwards. No payment method was entered and no payment succeeded.

### What passed

**Billing is correct in both currencies.** Both subscriptions used the same existing Starter Price ID, with no new Price and no USD-specific price. The CAD account produced a `cad` trialing subscription whose upcoming invoice totals **2900 cad**; the USD account produced a `usd` trialing subscription whose upcoming invoice totals **1900 usd**. Neither had a default payment method, the only invoices were the $0 trial invoices, and the account has **0 charges and 0 succeeded PaymentIntents**.

Note for future readers: `price.unit_amount` and the legacy `plan.amount` both report the Price object's CAD default (2900) even on a USD subscription. The authoritative billed figure is the upcoming invoice, which is where 1900 usd was confirmed.

**Signup copy is correct.** The deployed page renders `14-day free trial, then CA$29/month` by default with the `Change currency` control collapsed. Opening it and choosing USD switches both copy locations to `14-day free trial, then US$19/month`. The Profile `Estimate currency` control is live with CAD and USD options.

**Persistence is correct.** The CAD business stored `estimate_currency = 'cad'` and its estimate snapshotted `currency = 'cad'`; the USD business stored `'usd'` and its estimate snapshotted `'usd'`. The snapshot is written from the business setting at creation, as designed.

**CAD rendering is correct end to end.** The CAD estimate rendered `CA$` throughout the editor and its public share page, with zero `US$` and zero bare `$`, under an `All amounts in CAD` label.

### RELEASE BLOCKER, FIXED 2026-08-24 21:51 PT: USD estimates render CA$

A USD estimate displays **`CA$` amounts under an `All amounts in USD` label** on the public share page, and `CA$` in the `/new` editor. The stored snapshot is correct; only the rendering is wrong. This is customer-facing and wrong in the worst way, since the label and the amounts contradict each other.

Root cause, four call sites, none of which pass the estimate's currency into the already currency-aware serializer:

1. `lib/estimate-summary.ts` `formatEstimateForDisplay(summary)` does not accept or forward a currency, so `formatParsedEstimateForDisplay` falls back to CAD.
2. `lib/estimate-summary.ts` `formatEstimateForDisplayWithPricing(summary, lineItems, block)` has the same gap.
3. `lib/estimate-pricing-mode.ts` `buildCustomerPricingView` calls both of the above without a currency, which is what the share page and the PDF render.
4. `app/new/page.tsx` renders `EditableEstimateBody` without the `currency` prop.

CAD is unaffected because CAD is the fallback. **USD must not be offered to a real contractor until this is fixed.** The signup currency control is live in Production today, so a US contractor could select USD and be billed correctly at US$19 while their customer-facing estimates show CA$.

## /subscribe billing-currency defect FIXED (2026-08-25 09:03 PT, uncommitted)

**Status:** fixed in the working tree on `main`, **not committed, not pushed, not deployed**.

### What was seen on Production

In Opera with a US VPN, the public homepage and `/signup` correctly showed US pricing. The browser still held an authenticated **Canadian** session, so `/` redirected to `/subscribe`, which rendered a plan card reading a bare **`$59/month`** next to a button reading **`Upgrade to Pro, CA$59/month`**.

### Root cause

Two separate hardcodings in the same surface, neither of which consulted the account at all.

1. `app/components/plan-picker.tsx` rendered `<span …>${plan.price}</span>`, where `plan.price` came from `PLAN_MONTHLY_PRICES_CAD`. A **bare `$`** in front of a fixed CAD number, for everyone.
2. The button used `formatMonthlyPlanPrice(selected, "cad")`, and `app/subscribe/page.tsx` passed `formatMonthlyPlanPrice("pro", "cad")`. Literal `"cad"` in both.

The Canadian account happened to make the button read correctly, which is why only the card looked wrong. **A USD-billed contractor would have had it worse in a way the VPN session did not reveal:** card `$59`, button `CA$59`, and Checkout charging **US$39**. Three different answers on one screen.

Meanwhile `/api/billing/checkout` was already doing the right thing and `/subscribe` simply never asked it.

### Exact currency source of truth

Checkout's existing rule, now extracted verbatim into **`lib/billing-currency.ts`** and shared, in this order:

1. **A current Stripe subscription.** Stripe locks the currency to the Customer at the first subscription and it can never be changed, so once one exists it is the only authority. `canceled` and `incomplete_expired` are explicitly released and do not count, because Stripe keeps them readable forever.
2. **The business `estimate_currency`**, which was itself seeded from the geo default at signup.

**Geo appears nowhere in that rule, deliberately.** `lib/billing-currency.ts` imports no header and no `currencyFromCountry`, and a test asserts it stays that way. An existing customer's billing must not appear to change because they opened a VPN or travelled. On `/subscribe` geo seeds only the signed-out `?preview=true` case, where there is no business at all; any business immediately overwrites it through the shared rule.

Both callers pass in the subscription they have **already** retrieved, so sharing the rule costs no extra Stripe call. Checkout keeps its single `subscriptions.retrieve` and its unrelated `previousSubscriptionId` trial-cancellation logic untouched.

### The fix

- **`lib/billing-currency.ts`** (new): `lockedSubscriptionCurrency()` and `resolveBillingCurrency()`, with the released-status set in one place.
- **`app/api/billing/checkout/route.ts`**: the inline `status !== "canceled" && status !== "incomplete_expired"` check is replaced by `lockedSubscriptionCurrency(existing)`. Same behaviour, one implementation.
- **`app/components/plan-picker.tsx`**: `currency` is now a **required** prop. The card renders `` `${currencyPrefix(currency)}${planMonthlyPrice(plan.id, currency)}` `` and the default button label uses that currency. `PLAN_MONTHLY_PRICES_CAD` is gone from the component, and with it the only bare `$` on the page.
- **`app/subscribe/page.tsx`**: resolves the billing currency through the shared rule and passes it to both the picker and the upgrade label. Its business query now also selects `id`, needed for the estimate-currency fallback.

Not changed: Stripe Prices, Checkout behaviour, plans, trial rules, subscriptions, schema, migrations, cookies, and the authenticated redirect. `/subscribe` remains `ƒ` in the build output.

### Result

| Account state | Card | Button | Checkout charges |
|---|---|---|---|
| Live CAD subscription | **CA$59** | CA$59/month | CA$59 |
| Live USD subscription | **US$39** | US$39/month | US$39 |
| No subscription, business CAD | CA$59 | CA$59/month | CA$59 |
| No subscription, business USD | US$39 | US$39/month | US$39 |
| Cancelled or expired USD sub, business CAD | CA$59 | CA$59/month | CA$59 |

A live subscription outranks the business record: the CAD and USD rows above are asserted with the business record deliberately set to the *opposite* currency.

### Tests

`tests/smoke/subscribe-billing-currency.spec.ts`, 15 tests, registered in the unit allowlist. Six are behavioural, driving the shared rule and composing the exact strings the card and button render; three are wiring guards, covering that `/subscribe` and checkout share one rule, that the card takes a required currency, and that the rule imports no geo.

Reverting the three application files fails **4 of the 9**. The other five exercise `lib/billing-currency.ts`, which is new and has no pre-fix counterpart to fail against.

**One pre-existing test was updated, not weakened.** `currency.spec.ts` "Checkout prefers a current subscription currency" matched the inline `status !== "canceled" … billingCurrency = currencyOrDefault(...)` implementation that this change extracted. It now asserts checkout calls `lockedSubscriptionCurrency(existing)` **and** that the released-status set lives in `lib/billing-currency.ts`, so the intent is covered in both places rather than dropped.

### The redirect to /subscribe is correct enforcement, not a regression (2026-08-25 09:10 PT)

The same signed-in session reaches `/subscribe` in Chrome on a Canadian IP too, so this was never a VPN artifact. Traced read-only, no data touched.

**The chain.** Two places send an authenticated user to `/subscribe`, and they agree:

- `proxy.ts:125` covers `/new`, `/estimates`, and every other gated route: `if (!hasAccess && pathname !== "/subscribe")`.
- `app/page.tsx` covers `/` itself: `redirect(hasAccess ? "/estimates" : "/subscribe")`.

Both compute the same rule, which `lib/auth.ts` states a third time: access is `subscription_status === "active"`, or `"trial"` with `trial_ends_at` in the future, or `"complimentary"`.

**The account state.** Read-only, and it settles it:

| Account role | plan | status | trial ends | access |
|---|---|---|---|---|
| Two Pro signups created today, unpaid | pro | **incomplete** | null | **no** |
| The owner's own account | pro | complimentary | null | **yes** |

The most recently signed-in account, by roughly eight hours, is one of the two unpaid Pro signups created today. The owner's own account is complimentary and **has access**, so it would not be redirected at all. The browser is signed in as a test account, not the main one.

`incomplete` is set deliberately, at `lib/account-provisioning.ts:221`: Pro is paid up front, so a Pro signup creates the account with no trial and no subscription and sends the person straight to Stripe Checkout. Until they pay they have no access. `/subscribe` already titles this state "Finish setting up Pro". The gate is doing exactly its job, and nothing here weakens it. A test now pins the proxy rule verbatim so this task cannot have widened it.

It also explains the original sighting precisely: `neverHadTrial` is true for these accounts, so `showProOnly` is true, so the button read `Upgrade to Pro, CA$59/month` while the card read a bare `$59`. One of the two is a USD account, and the same page would have read `$59` and `CA$59` for it while Checkout charged US$39.

**Note that `incomplete` is not in the documented status set.** CLAUDE.md lists `trial | active | past_due | cancelled | complimentary`. The code uses `incomplete` in two places and the app handles it correctly, so this is a documentation gap rather than a bug, but the next person reading CLAUDE.md will not expect it.

### The real defect: /subscribe was a dead end

For an account in this state the page rendered with **no way out**:

- `canManageBilling` needs a Stripe subscription; these accounts have a customer but no subscription, so no billing-portal button.
- The "continue trial" link needs `!trialExpired`, and `trial_ends_at` is null, which reads as expired, so no link.
- Every other authenticated route bounces back to `/subscribe`.

The only exits were completing a paid checkout or clearing cookies. `app/components/subscribe-sign-out.tsx` adds a sign-out button, shown to any signed-in visitor, above a line reading `Signed in as {email}. Sign out to use a different account.` Surfacing the email is the point: being signed in as an unexpected account is the actual confusion here.

Signing out grants access to nothing. A test asserts the component touches no plan, subscription, Stripe, or gate state.

**One judgement call.** A fuller "every other page sends you back here" line would need the access rule on the page, and that rule is already written out three times, in `proxy.ts`, `app/page.tsx`, and `lib/auth.ts`. I did not add a fourth copy for a sentence. Worth extracting those three into one shared predicate as a separate change.

### Baseline has moved since the 07:52 PT verification

That verification confirmed 0 live Stripe Customers, 7 Auth users, 7 businesses. It is no longer true. Two accounts were created today at 15:35 UTC, after it:

Two Pro signups were created within a minute of each other around 15:35 UTC, one USD and one CAD. Both are `plan: pro`, `subscription_status: incomplete`, both have a live Stripe Customer, and neither has a subscription or any estimates.

So there are now **9 Auth users, 9 businesses, and 2 live Stripe Customers**. I did not create them, and I have not touched them: no authorisation was given to delete anything in this task. Flagging so the next cleanup starts from the real numbers rather than the stale ones. The identifiers are deliberately not recorded here; they are readable from the database when a cleanup is actually authorised.

### Recovery block moved above the fold, and mobile top spacing reduced (2026-08-25 09:38 PT, uncommitted)

The sign-out escape shipped in the right shape but the wrong place. Measured at 375x812, it sat below the price card, the CTA, the guarantee copy, and a divider: **Sign out at y=1077 on an 812px viewport**, 409px below the fold. Functionally correct, practically invisible to the person it exists for.

It now renders directly under the description and above the price card, with a plain lead-in, the email retained so the account is identifiable, and the same sign-out control unchanged.

Separately, the page wrapper carried `py-16` at every width, leaving a 64px band above the icon on a phone. It is now `py-8 sm:py-16`, mobile only.

**Measured at 375x812, local dev server, `getBoundingClientRect()`:**

| | Before | After |
|---|---|---|
| Gap above icon | 64px | **32px** |
| Heading | 140 to 172 | 108 to 140 |
| Recovery lead-in | absent | 220 to 240 |
| "Signed in as" notice | 1045 to 1077 | **244 to 260** |
| Sign out | 1077 to 1121 | **260 to 304** |
| First price card | 288 to 556 | 372 to 640 |
| CTA | 856 to 912 | 940 to 996 |
| Sign out visible without scrolling | **no** | **yes** |
| Notice before the price card | **no** | **yes** |
| Page height | 1221px | 1156px |

No overlap between heading, recovery block, card, or CTA, and no horizontal scroll at either width.

**Desktop is untouched.** At 1280x800 the computed `padding-top` is 64px and the gap above the icon is 64px, identical before and after, because `sm:py-16` carries it.

**Verifying this needed a temporary local scaffold.** `/subscribe` is not in `PUBLIC_PATHS`, so the proxy sends a signed-out request to `/login` and `?preview=true` never reaches the page. Measurement used a local-only scaffold that made the path public and rendered the block with a placeholder address. Both were reverted immediately; `proxy.ts` shows no diff against HEAD and the placeholder appears nowhere.

**Tests.** Three added to `tests/smoke/subscribe-billing-currency.spec.ts`, bringing it to 15: the recovery block renders after the description and before both the price card and the guarantee copy; the block is still sign-out only, with no billing route, checkout path, submit action, or form post inside it; and mobile padding is at most 32px while `sm:py-16` survives. Reverting the page fails two of the three. The third, the sign-out-only guard, passes either way by design, since the block was already inert before the move and the point is that moving it did not change that.

One detail worth recording: the first version of the sign-out-only test sliced from the recovery text to `<PlanPicker` and failed by matching `showPlanPicker`. That was a false positive in the test, not a finding. The slice now runs from the block's own guard to its closing brace.

Behaviour, auth implementation, redirect target, access gate, billing rule, Stripe, pricing, and all copy outside the recovery block are unchanged. No card, modal, toast, or account-management flow was added.

### Verification actually run (2026-08-25 09:03 PT)

- `git diff --check` — clean.
- `npx tsc --noEmit` — clean.
- Focused tests — **15 passed**.
- `npx playwright test --config=playwright.unit.config.ts` — **369 passed, 0 failed**.
- `npx next build` — compiled successfully in 30.1s, `/subscribe` still `ƒ`.

No account, subscription, or Checkout Session was created, and no Production data was touched.

### Files changed

`lib/billing-currency.ts` (new), `app/api/billing/checkout/route.ts`, `app/components/plan-picker.tsx`, `app/components/subscribe-sign-out.tsx` (new), `app/subscribe/page.tsx`, `tests/smoke/subscribe-billing-currency.spec.ts` (new), `tests/smoke/currency.spec.ts`, `playwright.unit.config.ts`, `HANDOFF.md`.

### Exact next deployment step

1. Review the uncommitted diff.
2. Commit on `main`, suggested subject `Fix subscribe billing currency display`.
3. Push. Production auto-deploys `main`.
4. After deploy, sign in as an existing Canadian account and confirm `/subscribe` shows `CA$59` on both the card and the button, with no bare `$`. Repeat through a US VPN on that **same** Canadian account and confirm it still reads `CA$59`, which is the guarantee that a VPN cannot appear to change an existing customer's billing. Read-only, no account creation needed.

## Homepage currency mismatch and mobile hero spacing FIXED (2026-08-25 08:18 PT, uncommitted)

**Status:** fixed in the working tree on `main`, measured in a real browser, **not committed, not pushed, not deployed**.

### The US geo default is now proven

A single Opera VPN session from a US exit reached `/signup` and saw `US$19/month` **before** `Change currency` was touched. That closes the item left open at 07:57 PT, when no US egress was available from this machine and the automatic-default claim could not be tested. `currencyFromCountry()` works in Production.

### Mismatch found

The same US session saw **CA$29 and CA$59 on the homepage pricing cards** while `/signup` offered that visitor US$19. The homepage had no country logic at all: it imported the fixed constants `STARTER_MONTHLY_PRICE_CAD` and `PRO_MONTHLY_PRICE_CAD` from `lib/plan-pricing.ts` and printed them behind a hardcoded `CA$`. A US visitor was quoted one price on the marketing page and charged a different one at signup.

### Fix 1, homepage currency

`app/page.tsx` now resolves the currency exactly the way `app/signup/page.tsx` does, with no second country rule anywhere:

```ts
const currency = currencyFromCountry((await headers()).get("x-vercel-ip-country"));
```

Three rendered prices switched from hardcoded CAD to that resolved currency: the hero bullet (`formatMonthlyPlanPrice("starter", currency)`), the Starter card, and the Pro card. `PRO_MONTHLY_PRICE_CAD` is no longer imported.

The two cards build their price as a single template literal rather than two adjacent JSX expressions. React had been serialising `{currencyPrefix(currency)}{planMonthlyPrice(...)}` as `US$<!-- -->39`, which renders correctly but splits the price across text nodes and makes any text assertion brittle.

Verified against the local dev server by sending the header directly, which is legitimate local testing rather than evidence about Production, where Vercel controls the header:

| `x-vercel-ip-country` | Starter card | Pro card | Hero bullet |
|---|---|---|---|
| US | **US$19** | **US$39** | US$19/month flat |
| CA | CA$29 | CA$59 | CA$29/month flat |
| GB | CA$29 | CA$59 | CA$29/month flat |
| AU | CA$29 | CA$59 | CA$29/month flat |
| none | CA$29 | CA$59 | CA$29/month flat |

**Per-request rendering.** `/` was already `ƒ` in the build output because `getUser()` reads cookies, and reading a request header keeps it that way. Confirmed `ƒ /` after the change, so one visitor's country-specific price can never be cached and served to another. No `revalidate` and no `force-static` directive exists on the route.

**Deliberately left CAD:** the static `metadata.description`, which is the search snippet rather than an on-page price. `metadata` is a module-level export and cannot read a request header without switching to `generateMetadata`. Making the indexed description vary by crawler country is an SEO decision, not part of this fix. It still states `CA$` explicitly.

No homepage currency selector, no client-side geo lookup, no cookie, no database field, no Stripe change, no migration, no environment variable, and no price changed.

### Fix 2, mobile hero spacing

Measured at 375x812 against the local dev server, `getBoundingClientRect()` rather than eyeballing. The fixed nav is 57px tall. The hero carried `pt-32` (128px), leaving a **95px void** between the header and the first hero content.

Changed the mobile value only, `pt-32` to `pt-20` (80px). `sm:pt-40` is a separate class and was not touched, so the desktop hero cannot move.

| Viewport | Hero padding-top | Nav height | Gap below nav | Gap to h1 |
|---|---|---|---|---|
| 375x812 before | 128px | 57px | **95px** | 165px |
| 375x812 after | 80px | 57px | **47px** | 117px |
| 1280x800 before | 160px | 89px | 156px | 210px |
| 1280x800 after | 160px | 89px | **156px, identical** | 210px |

No nav/content overlap, no horizontal scroll. No copy, header behaviour, or other section was touched.

### Tests

`tests/smoke/homepage-pricing.spec.ts`, 8 tests, registered in the `playwright.unit.config.ts` allowlist.

Three are behavioural: they call the same shared functions the page calls and assert the actual strings each country produces, so they check output rather than imports. Five are wiring guards: the homepage reads `x-vercel-ip-country` through `currencyFromCountry`, holds **no** country rule of its own (no `=== "US"`, no `toUpperCase()`, no `navigator.language`, exactly one mention of the header), the cards no longer hardcode a currency, the route stays per-request, and the mobile hero's `pt` is at most 80px while `sm:pt-40` survives.

Reverting `app/page.tsx` to its previous version fails **5 of the 8**, including the spacing guard, so they catch the real defects rather than passing beside them. The three that pass either way are the ones pinning `lib/currency.ts`, which was always correct; the defect was that the homepage never used it.

**One pre-existing test was updated, not weakened.** `currency.spec.ts` "public pricing states CA$ explicitly" required the literal `CA${STARTER_MONTHLY_PRICE_CAD}` in `app/page.tsx`, which pinned the hardcoded-CAD implementation that was the defect. It now asserts the rule that always mattered, that no amount reaches the markup without an explicit `CA$` or `US$`, plus that the metadata description stays CAD. Per-country values live in the new spec.

### Verification actually run (2026-08-25 08:18 PT)

- `git diff --check` — clean.
- `npx tsc --noEmit` — clean.
- Focused tests, `tests/smoke/homepage-pricing.spec.ts` — **8 passed**.
- `npx playwright test --config=playwright.unit.config.ts` — **354 passed, 0 failed**.
- `npx next build` — compiled successfully in 17.8s, `/` still `ƒ`.
- Local browser measurement at 375x812 and 1280x800, before and after.

No account was created, the full smoke suite was not run, and no Production data was touched.

### Files changed

`app/page.tsx`, `tests/smoke/homepage-pricing.spec.ts` (new), `tests/smoke/currency.spec.ts`, `playwright.unit.config.ts`, `HANDOFF.md`.

### Exact next deployment step

1. Review the uncommitted diff.
2. Commit on `main`, suggested subject `Fix homepage currency and mobile hero spacing`.
3. Push. Production auto-deploys `main`, and no promote step is needed now that the rollback is over.
4. After deploy, confirm from a US exit that the homepage cards read US$19 and US$39 and that `/signup` still reads US$19, then confirm a Canadian session reads CA$29 and CA$59 on both. Read-only, no account needed.

## Production USD verification PASSED on `7afcd0b` (2026-08-25 07:52 PT)

**Status:** the USD/CAD release is verified end to end against live Production. One synthetic account was created and completely removed. The rollback is over: Production serves `7afcd0b`, and the defect that caused it is confirmed fixed on every customer-facing surface.

### Deployment confirmed first

`https://www.trytradepulse.com/signup` renders `Change currency`, one price line reading `14-day free trial, then CA$29/month`, and the layout-fix classes `pt-8 pb-4`, `gap-5`, and `pb-40`. The `1bdc011` rollback literal `14-day free trial. No card required.` is gone. Selecting USD in the live page switched the copy to `14-day free trial, then US$19/month` with zero `CA$` on the page.

### Preflight, read-only

| Check | Expected | Actual |
|---|---|---|
| Live Stripe Customers | 0 | **0** |
| Trialling / active / past-due | 0 | **0** |
| Auth users | 7 | **7** |
| Businesses | 7 | **7** |
| Estimates | 19 | **19** |
| Ownerless businesses / orphan estimates | 0 | **0 / 0** |
| Active generation claims | 0 | **0** |
| Starter Price `price_1U166o…` | cad 2900, usd 1900 | **cad 2900, usd 1900**, both `tax_behavior: unspecified` |
| Pro Price `price_1TzwEC…` | cad 5900, usd 3900 | **cad 5900, usd 3900** |

The signup rate-limit bucket was already empty, so no reset was issued. That is one fewer Production mutation than the standard helper performs.

### The one account

`ALLOW_PRODUCTION_SIGNUP_SMOKE=true` was exported into the single test process only. It is not in `.env.local`, was never written to Vercel, and is unset in the shell afterwards.

Created through the real deployed signup UI with USD selected **before** submitting, via a temporary runner that called `assertFreshAccountSignupAllowed()` first. No payment method was entered.

- one synthetic account and its business
- one estimate, `pricing_source: structured`, 4 structured rows
- business `estimate_currency = usd`, estimate `currency = usd`

### Billing

| Check | Result |
|---|---|
| Subscription | status `trialing` |
| Price ID | `price_1U166oQ45KFNqa8x40e7T41u`, the **existing** Starter Price |
| Item count | **1** |
| Subscription currency | **`usd`** |
| Authoritative upcoming invoice | **1900 usd**, line `TradePulse Starter (at $19.00 / month)` |
| Default payment method | none, on both customer and subscription |
| Invoices with `amount_paid > 0` | 0 |

`price.unit_amount` and `price.currency` still report the CAD default (2900 / cad) even on this USD subscription. That is a Stripe reporting quirk, not a billing error. The upcoming invoice is the authoritative figure, and it is 1900 usd. Do not re-diagnose this next time.

### Rendered surfaces, all inspected as output rather than read from source

| Surface | Amounts | `US$` | `CA$` | Bare `$` | Label | Verdict |
|---|---|---|---|---|---|---|
| `/new` creation screen | 13 | yes | **0** | none | n/a | **PASS** |
| `/estimates/[id]` editor + detailed pricing | 5 | yes | **0** | none | n/a | **PASS** |
| `/share/[id]` public page | 13 | yes | **0** | none | `All amounts in USD` | **PASS** |
| Downloaded PDF (12,298 bytes) | 13 | yes | **0** | none | `All amounts in USD` | **PASS** |
| Detailed pricing view | 13 | yes | **0** | none | n/a | **PASS** |
| Grouped pricing view | 8 | yes | **0** | none | n/a | **PASS** |
| Payment reminder SMS | 1 | yes | **0** | none | n/a | **PASS** |
| Payment reminder email HTML | 1 | yes | **0** | none | n/a | **PASS** |

No surface combined `All amounts in USD` with `CA$` amounts. That contradiction was asserted against explicitly and did not occur anywhere.

The PDF was the real downloaded artifact, captured through Playwright's download event and scanned as bytes, not a re-render. Grouped pricing produced:

```
## Line Items
| Work package | Price |
|------|------|
| Additional items | US$190 |
| Plumbing | US$65 |
| Painting and finishing | US$12 |
```

The reminder SMS read: `USD Verification Co.: Invoice #1042 for US$350.00 was due September 4, 2026...`, and the email HTML `<strong>Amount:</strong> US$350.00`. The currency came from `readEstimateCurrencies()`, the cron's own lookup, which returned `usd` for the real estimate id.

### Two surfaces that needed a different route, and why

**Grouped pricing is not reachable in Production.** The estimate detail page showed no grouped toggle. The estimate was `pricing_source: structured` with visible rows and `draft` status, so the only remaining gate is `isGroupedPricingEnabled()`, meaning `ESTIMATE_GROUPED_PRICING_INTERNAL` is not `true` in Production. Grouped was therefore verified by running the real `buildCustomerPricingView()` over the real structured rows and the real snapshot currency with the flag enabled in the test process only. No Production configuration was changed.

**The reminder preview on `/profile` is Pro-gated.** The live page for this Starter trial rendered no `Payment reminders` section and no `<details>` at all, confirmed by inspecting the DOM while signed in as the account. Upgrading to Pro would have required a payment method, so the reminder text was verified by executing `buildPaymentReminderSms()` and `buildPaymentReminderEmailHtml()` with the currency read back out of the real estimate row. That is the same code the cron sends with, so this is an execution check, not a source read, but it is not a Production-rendered pixel.

### Cleanup

Deleted through the production endpoint, `POST /api/account/delete` with `confirmation: "DELETE"` as the signed-in user. That path takes the deletion claim, so an active generation lease would have answered 409 and the runner would have waited. **Succeeded on the first attempt**, no lease conflict: the generation claim had already been released when the estimate finished.

Order was enforced: the Stripe Customer was deleted only after the business row was confirmed gone.

| Step | Result |
|---|---|
| `POST /api/account/delete` | **200** `{success: true}` on attempt 1 |
| Business row | **gone** (`null`) |
| Estimate row | **gone** (0) |
| Structured item rows | **gone** (0) |
| Auth user lookup | **404** |
| Subscription | **canceled** |
| Stripe Customer | **deleted**, after the business row was confirmed gone |

### Final baseline, exactly restored

| Check | Expected | Actual |
|---|---|---|
| Live Stripe Customers | 0 | **0** |
| Trialling / active / past-due | 0 | **0** |
| Auth users | 7 | **7** |
| Businesses | 7 | **7** |
| Estimates | 19 | **19** |
| Ownerless businesses | 0 | **0** |
| Orphan estimates | 0 | **0** |
| Businesses / estimates reading `usd` | 0 | **0 / 0** |
| Leftover verification accounts | 0 | **0** |
| Charges / succeeded PaymentIntents | 0 | **0 / 0** |

Subscriptions went 461 to **462 canceled**, the one test trial, with none trialling, active, or past due.

Stripe Prices unchanged: 3 Prices and 2 Products, Starter still `cad 2900 / usd 1900`, Pro still `cad 5900 / usd 3900`, both active.

### Verification actually run (2026-08-25 07:52 PT)

- `git diff --check` — clean.
- `npx tsc --noEmit` — clean.
- `npx playwright test --config=playwright.unit.config.ts` — **346 passed**.
- `npx next build` — compiled successfully in 17.2s, 55/55 static pages.

All temporary runners and their result files, which held the throwaway password, were deleted. The full smoke suite was not run.

### Files changed

`HANDOFF.md` only. No application code, Stripe configuration, Supabase schema, migration, Vercel configuration, or pricing was touched.

### Open items

- `ESTIMATE_GROUPED_PRICING_INTERNAL` is not enabled in Production, so grouped customer pricing is built and correct but not reachable by a contractor. Enabling it is a separate decision.
- A single expired `tpe_estimate_generation_claims` row remains from 2026-08-24 19:39 UTC, owned by pre-existing business `28ba3f1e…`, not by any test account. Expired claims read as free, so it is inert. Not cleaned up, since it belongs to real data and no authorisation was given for it.

## Signup currency-control layout FIXED (2026-08-24 22:39 PT, closed out 2026-08-25 07:21 PT, uncommitted)

**Status:** fixed in the working tree on `main`, verified locally in a real browser, **not committed, not pushed, not deployed**.

### Deployment state at the time of this work

`df16aaa` (the USD rendering hotfix) is on `origin/main`, but **Production is still serving `1bdc011`**, the rollback. Verified by fetching `https://www.trytradepulse.com/signup`: it renders `14-day free trial. No card required.`, the exact literal from `1bdc011:app/signup/page.tsx` lines 94 and 197, with zero occurrences of `Change currency`, `CA$29`, `US$19`, or `Estimate currency`. `lib/currency.ts` does not exist at `1bdc011` at all. Vercel Instant Rollback pins Production until a deployment is promoted, so pushing `main` did not move it.

Because of that, the separately requested single-account Production USD verification **was not run and no account was created**. Production has no USD control to select, and `/api/auth/signup` at `1bdc011` accepts no `currency`, so the only account it could have made was a CAD one. `ALLOW_PRODUCTION_SIGNUP_SMOKE` was never set.

### The defect

At phone width the signup screen rendered the trial-price line **twice**: once under the "Create account" heading, and again inside the fixed bottom bar, stacked above the CTA together with the `Change currency` control. That bar measured roughly 190px tall, while `<main>` reserved no bottom space at all, so the bar sat on top of the Terms of Service text.

### The fix, `app/signup/signup-form.tsx` only

- **One price line.** The duplicate in the fixed bar is gone. The surviving line is the one under the heading. It also fixes a copy contradiction: the removed line used `trialCopy("pro", …)` ("14-day free trial, then CA$59/month") while the surviving one says "Pro is CA$59/month, billed right away", which is what the Pro flow actually does, since Pro goes straight to Checkout.
- **The currency control moved up**, directly under the price line and above the email field. It is the same control, unchanged in behaviour: collapsed `Change currency` trigger, expanding to 44px CAD and USD buttons.
- **The fixed bar now holds the CTA and nothing else**, which makes its height fixed and predictable at 112px: `pt-4` (16) + the button's `min-h-[56px]` + `pb-10` (40).
- **`<main>` reserves `pb-40`** (160px) below the Terms, clearing the 112px bar by 48px when scrolled to the bottom.
- **Dropped a redundant `mt-4` on the Terms paragraph.** `<main>` already spaces its children with `gap-6`, so that margin pushed the Terms 40px down instead of 24px. On a 1280x720 desktop viewport that was enough to slide the last line 5px under the fixed bar before the page had been scrolled. This was found by measuring, not by reading.
- **Reclaimed 32px above the Terms** in the second pass: header `pt-10 pb-6` to `pt-8 pb-4` (16px) and `<main>` `gap-6` to `gap-5` (4px across four gaps, 16px). See the closure section below for why this, and not the reserve, is what fixes initial paint.

Nothing else changed: no pricing, no country detection, no OAuth, no Stripe, no estimate currency, no other feature.

### Measured in a real browser, local dev server

Geometry read from `getBoundingClientRect()`, not eyeballed. "Gap to bar" is the distance from the bottom of the Terms text to the top of the fixed bar; "gap to CTA" is to the button itself.

| State | Viewport | Price lines | Gap to bar (initial paint / scrolled to bottom) | Gap to CTA |
|---|---|---|---|---|
| CAD, collapsed | 375x812 | 1 | **119 / 119** | 135 |
| USD, collapsed | 375x812 | 1 | **119 / 119** | 135 |
| Selector expanded | 375x812 | 1 | **100 / 100** | 116 |
| CAD, collapsed | 1280x720 | 1 | **43 / 48** | 59 / 64 |
| USD, collapsed | 1280x720 | 1 | **43 / 48** | 59 / 64 |
| Selector expanded | 1280x720 | 1 | **24 / 48** | 40 / 64 |

Every required state clears the bar by at least 16px at initial paint, worst case 24px. The first-pass numbers this replaces were 87 / 87, 87 / 87, 68 / 68, 11 / 16, 11 / 16, and -8 / 16.

Every state renders exactly one price line and one `Change currency` control, with the control below the price line and above the email field, and no horizontal scroll. Selecting USD switches the single line to `14-day free trial, then US$19/month` with zero `CA$` anywhere on the page, and CAD back to `CA$29/month` with zero `US$`.

Rendered reading order, from the page text: Create account, the price line, Change currency, Email, Password, Google, Sign in, Terms.

### Closing the remaining 8px (2026-08-25 07:21 PT)

The first pass left one state failing: 1280x720 with the selector expanded, where the Terms overlapped the fixed bar by 8px at initial paint and only became clear after scrolling. That was not good enough.

**The obvious remedy does not work, and measuring is what showed it.** Raising the main-content bottom reserve from `pb-32` to `pb-40` moved the scrolled-to-bottom clearance from 16px to 48px and left the initial-paint gap at **exactly its previous value**, -8px. The reason is structural: that padding sits *below* the Terms, so it makes the page taller and scrollable further, but it cannot move the Terms. Initial-paint clearance is decided entirely by the height of everything *above* them.

The measured stack above the Terms at 1280x720 expanded was 616px against a bar starting at 608px: header 102px, `main` padding-top 16px, then children of 112 + 176 + 78 + 20 + 16 with four 24px gaps. Clearing by 16px needed that 616 down to 592, so 24px had to come out. 32px was taken, for margin:

- header `pt-10 pb-6` to `pt-8 pb-4`, 64px of chrome for a logo down to 48px
- `main` `gap-6` to `gap-5`, 4px off each of four gaps

`pb-40` was kept. It is not what fixes initial paint, but it is harmless and it triples the scrolled-to-bottom clearance.

**Where the margin ends.** Initial-paint clearance depends on viewport height, so it is worth stating the boundary instead of implying the fix is universal. Measured at 1280x700: collapsed 23px, expanded **4px**, so still no overlap but under the 16px floor. Derived threshold for the expanded state is about 712px of viewport height, and about 693px collapsed. Below that the page still scrolls and scrolled-to-bottom clearance stays at 48px, but initial paint dips under 16px. Guaranteeing 16px at every viewport height is not achievable with static spacing, because a short enough viewport cannot hold the content and the CTA at once, and the CTA has to stay pinned per the project's UI rules.

### Tests

`tests/smoke/signup-currency-layout.spec.ts`, 8 tests, registered in the `playwright.unit.config.ts` allowlist. Source-level assertions, matching the `bottom-nav.spec.ts` precedent, with comments stripped so a comment can neither satisfy nor fail an assertion:

- exactly one `trialCopy(` and one `formatMonthlyPlanPrice(` call site
- exactly one `Change currency`, one `CURRENCIES.map`, one `setShowCurrency(true)`
- source order: price line, then currency control, then the email field
- the fixed bar contains the CTA and none of the moved elements
- Terms live inside `<main>`, and `main`'s reserved padding is **derived from the Tailwind classes** and asserted to be at least the bar's `pt` + `min-h` + `pb`, so growing the bar fails the test until the reserve grows with it. Its comment now records that this guards the scrolled case only.
- **the space above the Terms stays tight enough**: header `pt` + `pb` at most 48px, and `main`'s gap at most 20px, read from the classes. This is the guard for initial paint, the half the reserve cannot cover.
- **the expanded selector stays at exactly 44px**, a floor and a ceiling at once: smaller breaks the minimum tap target, larger spends the initial-paint clearance, since expanding is the binding case.
- both CAD and USD produce one line, via the shared `currency` state

Reverting `signup-form.tsx` to the pre-fix version fails 4 of the 8. Putting the header and gap spacing back fails the initial-paint guard. Growing the expanded selector to 56px fails the tap-target guard. Each was checked by making the change, running the suite, and restoring.

**No committed mobile-viewport visual check.** The existing setup cannot support one: `playwright.unit.config.ts` declares no browser project and runs in plain Node, and `playwright.config.ts` does have chromium but its `baseURL` defaults to `https://trytradepulse.com` with a `globalSetup` that resets a Production rate-limit bucket, so adding a rendered check there would mean running against Production. The mobile and desktop measurements above were taken live instead, through the local dev server. A screenshot could not be captured because the browser pane was not displayed; the geometry numbers are the evidence.

### Verification actually run (2026-08-25 07:21 PT, second pass)

- `git diff --check` — clean.
- `npx tsc --noEmit` — clean.
- Focused tests, `tests/smoke/signup-currency-layout.spec.ts` — **8 passed**.
- `npx playwright test --config=playwright.unit.config.ts` — **346 passed** (338 before this work, plus the 8 new).
- `npx next build` — compiled successfully in 28.9s, 55/55 static pages.
- Live browser measurement at 375x812, 1280x720, and 1280x700, CAD and USD, collapsed and expanded, at both scroll positions, against the local dev server. No account created, nothing submitted.

### Files changed

`app/signup/signup-form.tsx`, `tests/smoke/signup-currency-layout.spec.ts` (new), `playwright.unit.config.ts` (allowlist entry), `HANDOFF.md`.

### Observation, not changed

The expanded selector carries `aria-label="Estimate currency"`, but at signup this control sets the **billing** currency as well as the initial estimate currency. The label is arguably narrow. Left alone as a copy change outside this layout fix.

## USD rendering defect FIXED (2026-08-24 21:51 PT, uncommitted)

**Status:** fixed in the working tree on `main`, fully verified locally, **not committed, not pushed, not deployed**. Production remains rolled back to `1bdc011`.

### The rollback

Production was rolled back to `1bdc011` because the currency release shipped a customer-facing defect: a USD estimate rendered `CA$` amounts under an `All amounts in USD` label. Billing, persistence, and the currency snapshot were all correct. Only the rendering was wrong.

### Root cause

One shape, repeated. A formatter declared `currency: Currency = DEFAULT_CURRENCY`, and a caller that had the snapshot in hand did not pass it. The default then silently produced CAD. Because CAD was the fallback, every CAD estimate looked right and the bug stayed invisible until a real USD estimate existed.

Six call sites, not the four originally recorded. The two extra ones were found by the compiler once the defaults were removed:

1. `lib/estimate-summary.ts` `formatEstimateForDisplay(summary)` took no currency.
2. `lib/estimate-summary.ts` `formatEstimateForDisplayWithPricing(summary, lineItems, block)` had the same gap.
3. `lib/estimate-pricing-mode.ts` `buildCustomerPricingView` called both without a currency. That is what the share page, the contractor page, and the PDF render.
4. `app/new/page.tsx` rendered `EditableEstimateBody` and the streaming preview with no currency at all.
5. `lib/estimate-groups.ts` `renderGroupedLineItemsBlock` and `renderGroupedPlainText` hardcoded CAD through `formatDollars(g.total)`. Grouped customer pricing could never render USD.
6. `lib/generate-pdf.ts` used `options.currency ?? DEFAULT_CURRENCY` and **no caller ever passed `currency`**, so every PDF printed `All amounts in CAD` regardless of the estimate.

A seventh, smaller one: `app/components/editable-estimate-body.tsx` called `withComputedCost({...})` with no currency, so editing a quantity field in a USD estimate rewrote that cost cell as `CA$`.

### The fix

Snapshot currency is now a **required parameter** on every money-emitting function. `lib/estimate-summary.ts` no longer imports `DEFAULT_CURRENCY` at all, so the serializer has no CAD value in scope to fall back to. That is enforced by the compiler, not by convention, and pinned by a test asserting the import is absent.

- `formatEstimateForDisplay(summary, currency)` and `formatEstimateForDisplayWithPricing(summary, lineItems, currency, block?)` both take a required currency. Currency was deliberately moved **ahead** of the optional display block, because a caller overriding only that block used to reset the currency to CAD as a side effect.
- `formatDollars`, `formatMoney`, `withComputedCost`, `lineItemDisplayLabel`, `lineItemsBlock`, `displayLineItemsBlock`, `pricingBlock`, `syncPreambleTotal`, and `serializeSummary` all lost their defaults.
- `EstimatePricingRecord` now carries `currency` as a field, so no pricing view can be built without one.
- `renderGroupedLineItemsBlock`, `renderGroupedPlainText`, `itemsToLineItemsBlock`, `validateConversionTotals`, and `assertConversionSafe` all take a required currency.
- `GenerateEstimatePdfOptions.currency` is required and the `options = {}` default is gone. `DownloadPdfButton` takes it and the share page passes its snapshot.
- `EditableEstimateBody` and `EstimatePricingEditor` take `currency` as a **required** prop.

`parseSummary()` no longer formats. It used to call `withComputedCost(item)`, which forced the parser to pick a currency it has no way to know. The value was dead either way: `lineItemCost()` recomputes quantity times rate for every quantity row and both serializers re-format from that, so nothing displays or stores that field for a quantity item. The stored cost cell is now kept verbatim.

### How /new learns the snapshot

`/new` has no estimate row to query, and reading the business setting separately would be a second read that can drift. Instead `/api/generate-estimate` reads the currency **once**, before the stream opens, uses that same value for the row insert, and returns it as an `X-Estimate-Currency` response header. The client parses it with `parseCurrency` and threads it into both the editor and the streaming preview. A header rather than a body marker, so the existing `__ID__` and `__ERROR__` stream protocol is untouched and a stale client bundle simply ignores it.

### Where the CAD fallback still lives, deliberately

Only at database and legacy boundaries, where a historical estimate genuinely has no snapshot:

- `lib/currency-db.ts` (`estimateCurrencyOf`, `readEstimateCurrency`, `readEstimateCurrencies`, `readBusinessEstimateCurrency`).
- `lib/estimate-pricing-server.ts` `toEstimatePricingRecord`, via `estimateCurrencyOf(estimate)`.
- `lib/payment-reminder-message.ts`, whose context currency stays optional so an old reminder does not move.
- The initial React state on `/new`, before any estimate exists.

### Tests

`tests/smoke/currency-rendering.spec.ts` gained six regression tests. Each defect site was **re-introduced one at a time** and the suite re-run, to prove the tests fail on the broken code rather than merely passing beside it:

| Re-introduced defect | Test that failed |
|---|---|
| `buildCustomerPricingView` renders CAD | `a USD estimate renders US$ in detailed customer pricing`, `the currency label and the amounts beside it always agree` |
| `renderGroupedLineItemsBlock` renders CAD | `a USD estimate renders US$ in grouped customer pricing` |
| `/new` drops the editor `currency` prop | `no customer-facing surface can render an estimate without its currency` |
| PDF label ignores the snapshot | `the share page and PDF label the currency outside the pricing table` |

The tests assert that a USD estimate contains `US$`, contains no `CA$`, and contains no bare `$` amount, with the CAD equivalents in reverse. `tests/smoke/currency.spec.ts` replaced its old "formatters default to CAD" test with one asserting the serializer has no default left to fall back to.

### Verification actually run (2026-08-24 21:51 PT)

- `git diff --check` — clean.
- `npx tsc --noEmit` — clean.
- Focused defect proof — each of the four sites re-introduced separately, the correct test failed each time, then restored.
- `npx playwright test --config=playwright.unit.config.ts` — **338 passed**.
- `npx next build` — compiled successfully in 27.4s, all routes built.

### Test-account cleanup complete

The remaining USD controlled-test account was deleted once its estimate-generation lease expired at `2026-08-25 04:30:12 UTC`. The lease was **waited out, not bypassed**. Deletion ran through the established `deleteAuthenticatedAccount()` procedure with the production route's own dependency implementations, and the Stripe customer was deleted only after the business row was confirmed gone.

Production baseline verified afterwards, matching the expected numbers exactly:

| Check | Expected | Actual |
|---|---|---|
| Live Stripe Customers | 0 | **0** |
| Trialling / active / past-due subscriptions | 0 | **0** |
| Auth users | 7 | **7** |
| Businesses | 7 | **7** |
| Estimates | 19 | **19** |

Also confirmed: 0 charges, 0 succeeded PaymentIntents, 461 subscriptions all `canceled`, 0 ownerless businesses, 0 orphan estimates, and all 7 businesses plus all 19 estimates still reading `cad`.

### Exact redeployment step

Nothing was committed, pushed, or deployed. To redeploy the currency release:

1. Review the uncommitted diff listed below.
2. Commit it on `main` (suggested subject: `Fix USD estimate rendering`).
3. Push to `origin/main`. Vercel deploys `main` automatically, which rolls Production **forward off `1bdc011`** to the currency release plus this fix.
4. After the deploy, verify one USD estimate end to end on a controlled account: the `/new` editor, the public share page, and the downloaded PDF must all show `US$` with zero `CA$`, under an `All amounts in USD` label. Delete the account afterwards through the normal deletion procedure.

The Production migration and the live Stripe `currency_options` are **already applied** and were unaffected by the rollback, so no database or Stripe step is needed before redeploying.

### Files changed

`lib/estimate-summary.ts`, `lib/estimate-groups.ts`, `lib/estimate-items.ts`, `lib/estimate-item-migration.ts`, `lib/estimate-pricing-mode.ts`, `lib/estimate-pricing-server.ts`, `lib/generate-pdf.ts`, `app/api/generate-estimate/route.ts`, `app/api/estimates/[id]/pricing-mode/route.ts`, `app/new/page.tsx`, `app/share/[id]/page.tsx`, `app/components/editable-estimate-body.tsx`, `app/components/estimate-pricing-editor.tsx`, `app/components/download-pdf-button.tsx`, `tests/smoke/currency-rendering.spec.ts`, `tests/smoke/currency.spec.ts`, `tests/smoke/estimate-items-conversion.spec.ts`, `tests/smoke/estimate-grouped-pricing.spec.ts`, `tests/smoke/estimate-pricing-mode.spec.ts`.

### Removed: scripts/audit-estimate-summary-formats.ts

Deleted in this commit. It was a one-off read-only operator tool from the grouped-pricing planning slice, run manually with `AUDIT_CONFIRM_READONLY=yes` after a hand-rolled `tsc` step. Nothing imported it, no npm script ran it, and neither Playwright config could reach it: both are rooted at `./tests/smoke` and the unit config uses an explicit `testMatch` allowlist. CI runs only `npm run test:smoke`. It needed a currency argument threaded through it for this fix, which is what surfaced it as dead weight. `scripts/` is now empty and gone.

One consequence to know about: the sanitised production fixtures used to describe themselves as generated output, telling the reader not to edit them by hand and to regenerate with the script. With no script left, that instruction was unfollowable, so the header comments in `tests/fixtures/estimate-summaries/production-sanitised.ts` and `index.ts` were rewritten to say what is now true. The fixtures are checked-in source, hand-editable under review, and must stay sanitised with one representative per unique shape. No fixture data and no assertion changed. If a future slice needs a freshly captured corpus, the script has to be rewritten from history at `d5a1d1a^` rather than recovered from the working tree.

### Design smell found in passing, not fixed

`app/components/send-estimate-sheet.tsx` imports `generateEstimatePDF` and never calls it. Dead import, unrelated to this defect, left alone.

## Currency cutover COMPLETED in Production (2026-08-24)

Steps 1 to 3 of the cutover below are **done**. Only push and deploy remain.

### Migration applied

`supabase/migrations/20260825000000_add_currency_columns.sql` was applied through the Supabase MCP `apply_migration` workflow, byte-identical to the committed file (md5 verified against `HEAD` first). No ad hoc SQL was executed.

Recorded **exactly once** in `supabase_migrations.schema_migrations` as version `20260825035227`, name `add_currency_columns`.

Verified after: `tpe_businesses.estimate_currency` and `tpe_estimates.currency` both exist as `text`, `NOT NULL`, default `'cad'::text`, each with a check constraint `CHECK (col = ANY (ARRAY['cad','usd']))`. **7 of 7 businesses and 19 of 19 estimates read `cad`.** Nothing else moved: RLS policies 9 to 9, public functions 12 to 12, triggers 0 to 0, auth users 7 to 7. `tpe_` constraints went 53 to 55, exactly the two new checks.

### Types regenerated, temporary casts removed

`lib/database.types.ts` refreshed from the now-current Production schema via the Supabase MCP generator. Drift check: the types file declares 25 Row columns for `tpe_businesses` and 36 for `tpe_estimates`, matching the live schema exactly. `lib/currency-db.ts` no longer contains the `AnyClient` cast or its `no-explicit-any` disable, and is now typed against the real `Database`.

### Live Stripe Prices updated

Both existing Prices were re-read immediately before their update and every guard passed. No new Price, no new Product, no change to CAD amounts, default currency, archive state, or the legacy archived CAD 3900 Price. Stripe Tax and automatic tax were not touched.

| | Starter `price_1U166o…` | Pro `price_1TzwEC…` |
|---|---|---|
| Product | `prod_Uzw4COlgTWZnhc` TradePulse Starter, unchanged | `prod_Uzw6WQ8HsaqblQ` TradePulse Pro, unchanged |
| Default currency | cad, unchanged | cad, unchanged |
| CAD | 2900 before and after | 5900 before and after |
| USD | absent → **1900** | absent → **3900** |
| `tax_behavior` | `unspecified` on price, CAD and USD options | same |
| `currency_options` | `['cad']` → `['cad','usd']` | `['cad']` → `['cad','usd']` |

Account-wide after: 3 Prices (unchanged count), 2 Products (unchanged), **0 live Customers**, 459 subscriptions all `canceled`, none active, trialling, or past-due. **No Customer or Subscription was created.**

### Exact Production cutover sequence (steps 1 to 3 now complete)

1. Apply `20260825000000_add_currency_columns.sql` to Production (authorisation still outstanding).
2. Verify all businesses and estimates read `cad`.
3. Regenerate `lib/database.types.ts` and delete the casts in `lib/currency-db.ts`.
4. Confirm `STRIPE_PRO_PRICE_ID` is set in Vercel Production.
5. **Add the two USD currency options in live Stripe**, keeping the existing Price IDs:
   - `price_1U166oQ45KFNqa8x40e7T41u` → `currency_options[usd][unit_amount] = 1900`
   - `price_1TzwECQ45KFNqa8xsjncgiHQ` → `currency_options[usd][unit_amount] = 3900`
   - Set `currency_options[usd][tax_behavior] = unspecified` to match CAD.
6. Re-read both Prices and confirm the IDs, CAD amounts, and Products are unchanged.
7. Deploy, then verify one CAD and one USD signup on a controlled account and clean both up.

Step 5 must land before any USD signup reaches Stripe. Until then a USD subscription create would fail, and it fails loudly rather than silently billing CAD.

### Still deferred after this release

All CAD/USD currency work: the `currency` columns on `tpe_businesses` and `tpe_estimates`, the estimate-currency snapshot and formatters, the Profile `Estimate currency` control, the AI prompt spelling rule, and Stripe `currency_options` (USD 1900 Starter / 3900 Pro) on the existing Price IDs. That work is fully designed and needs Production migration authorization plus confirmation that `STRIPE_PRO_PRICE_ID` is set in Vercel Production. Also still open: a business whose owner Auth user is removed first still cannot be deleted through the normal account-deletion procedure, because the deletion claim has a foreign key to `auth.users`.

**Exact next step:** review the uncommitted Release 2 diff, then commit and deploy if approved. Nothing has been committed, pushed, or deployed.

### Superseded: Release 2 (access control) as originally scoped

`proxy.ts` still redirects an authenticated user with no business row to `/onboarding`, and `app/onboarding/page.tsx` still creates a business row with `plan: 'starter'`, `subscription_status: 'trial'` and **no Stripe customer or subscription**, which `proxy.ts` then honours as a valid trial. That unbilled-trial path is untouched by this release. Release 2 removes the `/onboarding` insert, repoints the proxy redirect to `/signup`, and repoints `safeNextPath()`. The diagnostic above shows 0 accounts currently in that state, so Release 2 is behaviourally inert for existing users. Also deferred: Google `intent` login/signup split, all currency work, Stripe Price `currency_options`, and any migration.

**Exact next action for Release 1:** review the uncommitted diff, then commit and deploy if approved. Nothing has been committed, pushed, or deployed.

## Current state (pre-Release-1 context, retained)

The Profile polish described below was subsequently committed. `main` is now at `c27c563` ("Finalize Profile settings polish") and is level with `origin/main`.

- **Branch:** `codex/profile-settings-mobile-polish`, created from local `main` commit `9399524` (the reviewed reminder-preview terminology correction). Production remains at `6250a9279098060737ea3650c598bfce3618aef1` (`Improve Profile Pro setup mobile UX`), deployment `dpl_G2PhqQG5ZTNSr5EkxoNNvDZoWsmr`, READY. Vercel cron remains disabled.
- **Pending revised Profile mobile polish:** the green bordered review/payment status rows were removed in favour of plain settings copy. The Profile form still stacks logo and company name on mobile, keeps the manual review-link action as a real secondary button, and retains the compact payment-link input. Customer-facing helper copy now describes actual name, phone, and email uses. The collapsed reminder preview uses estimate terminology, a clear example business name before Profile setup, and the same shared formatter as sent SMS.
- **Profile save regression fixed:** the uncommitted `Show business name on estimates` control was sending `show_business_name_on_estimates` through every Profile PATCH, but that column was only in an unapplied local migration and was absent from the generated schema types. The database rejected the update, causing the local “Could not save” state and later apparent default values after re-login. The control, its migration, header/PDF wiring, and its incomplete tests were removed. No existing Profile data was deleted.
- **Persisted setting prerequisite:** a new supported version requires a non-Production Supabase target. There is no local Supabase stack (Docker unavailable) and no Supabase development branch; the only connected TradePulse project is Production. Do not apply or test a new migration until a safe development target is supplied or a narrow Production schema migration is explicitly authorised.
- **Local verification:** `npx.cmd tsc --noEmit` and `git diff --check` passed (only existing CRLF notices). Focused Profile/reminder tests passed (**12 passed**); full safe unit suite passed (**219 passed**). No deployment or provider action was performed. Re-run the same checks immediately before committing.
- **Release constraints:** do not re-enable or invoke Vercel cron. Do not send SMS, create Checkout, complete payment, or alter Stripe, Google, or payment behaviour for this UX change.
- **Pricing:** Starter is **CA$29/month** and Pro is **CA$59/month**. Stripe price IDs remain environment-driven. Production pricing and Checkout paths were verified during the completed cutover.
- **Communications:** remain disabled unless a future task explicitly authorises them.

### Estimate-generation deletion-race verification (local only)

- Root cause confirmed from Production logs: a business was present at the access check but missing for the later `tpe_estimates` insert. Anthropic streaming starts before that insert.
- `git diff --check` passed.
- `npx.cmd tsc --noEmit` passed after the deletion-lease correction.
- Focused estimate-generation claim, account-deletion, and cost-guard tests: 20 passed.
- Full safe unit suite: 218 passed. The two stale manual-reminder source-text assertions were corrected to locate the specific existing reminder timestamp update without depending on line endings; reminder behaviour was not changed.
- The local Supabase CLI cannot validate migrations because no local database is running. Production migration application was confirmed through the Supabase remote migration list. No Production data, deployment, or provider action was performed.
- **Release verification after migration:** `git diff --check` passed, including the reconciled untracked migration; `npx.cmd tsc --noEmit` passed; focused estimate-generation claim, account-deletion, and cost-guard tests passed (**20 passed**); full safe unit suite passed (**218 passed**). Post-migration Supabase security advisors show only the same four pre-existing informational RLS-without-policy notices for service-role-only tables. No new claim-table finding appeared.
- **Exact next action:** commit only the safe Profile-polish files, push and fast-forward `main`, then confirm the Git-triggered Production deployment and perform a constrained authenticated mobile Profile visual check if a controlled browser session is available.

## Completed product and platform work

### Stripe cutover acceptance

- Canonical Production webhook: `https://www.trytradepulse.com/api/billing/webhook`.
- Exact supported events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, and `invoice.payment_failed`.
- A Stripe-signed hosted Workbench delivery passed. Billing Portal configuration and a direct hosted Portal session passed within the no-payment limits.
- The five temporary `NEW_` Production Vercel variables were removed. Canonical Production Stripe variables remain, without recording values.
- Synthetic Stripe Checkout Sessions and their shared synthetic customer were cleaned up. Old-account and Parlay isolation checks passed. No real payment, card entry, email, or SMS occurred.

### Contact and support

- Public `/contact` is deployed, signed-out access is allowlisted, the homepage Support link works, and the sitemap includes `/contact`.
- Contact support paths cover account, estimates, billing/refunds, and privacy. Footer targets meet the 44px minimum at the verified mobile viewport.

### Owner administrative correction

- The owner's own account remains intact with Pro and complimentary access. Its stale Stripe customer and subscription references were cleared while existing estimates were preserved.

### Bottom navigation and account deletion

- The bottom navigation has one primary `New` estimate action. The duplicate Estimates-page header action was removed and remains removed.
- **Approved final design (2026-08-05), superseding all earlier descriptions of this section:** `app/components/bottom-nav.tsx` is a conventional flat four-column bar (`grid-cols-4`, one shared `itemClass()` helper). Rates, Estimates, New, and Profile all use the identical column structure — `py-2`, a 42px icon slot, `gap-1`, label — so icons and labels land on the same baseline across all four. New is emphasized only by colour: an orange (`#f59e0b`) Plus icon and orange label, plus a subtle 42px rounded-square background (`rgba(245,158,11,0.15)`) behind its icon. There is no circle, no floating/overlapping element, and New is not taller or wider than the other three items. Two earlier designs were tried and rejected in this same session: a 66px flush circle (no overlap, but the client wanted New visually distinct without a filled circle) and a 62px circle overlapping 12px above the bar (rejected as still reading as a dominant floating action button). Verified at 375×812 and 412×915: all four columns equal width, icon slots and labels pixel-identical across all four, no overlap above the bar, no horizontal overflow, 44px+ tap targets throughout.
- Profile contains a destructive Delete account section. It requires an exact `DELETE` confirmation and a sign-in no older than 15 minutes.
- The server-only route authenticates the caller, rechecks business ownership, rejects cross-origin requests, and cancels Stripe only when its stored customer and subscription match. It then removes owned Storage objects, calls the service-role-only transactional RPC for dependent database records, deletes the Auth user last, and clears the local session.
- The RPC locks the owned business and estimates, then deletes payment reminders, estimate changes, structured items, legacy line items, photo metadata, estimates, price-book items, the user-keyed rate limit, and the business. Missing Stripe objects and a retry after database completion are handled safely; failures before Auth deletion leave the user signed in.
- Hosted synthetic end-to-end verification passed: the authenticated production flow redirected to the signed-out homepage. Read-back confirmed the synthetic Auth user, business, estimate, dependent rows, and Storage object were all absent. The fixture had no Stripe customer or subscription, so no Stripe action ran. Other business, estimate, reminder, change, item, line-item, photo, and price-book counts were unchanged. The unrelated rate-limit pool count decreased by one between snapshots, so its unchanged state cannot be asserted from those snapshots alone.

## Verification actually run for the account UX release

- Focused Playwright unit tests: 11 passed.
- Complete safe unit suite: 123 passed.
- `npx.cmd tsc --noEmit`: passed.
- Targeted ESLint for the changed account and navigation files: passed.
- `npx.cmd next build`: passed. The only notices were the pre-existing `metadataBase` warnings.
- `git diff --check`: passed.
- Local signed-out delete request returned HTTP 401. Local signed-in browser checks covered `/estimates`, `/new`, and `/profile` at 390 by 844 and 1440 by 900 with no new console errors or horizontal overflow.
- Hosted sign-in, Profile delete confirmation, deletion redirect, and direct database/Auth/Storage read-back passed.

## Preserved local state and known limits

- Do not discard, reset, stash, clean, or commit the pre-existing unrelated changes: `.claude/settings.local.json`, `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `.ai-control-centre/`, the existing `AGENTS.md.bak-*` and `CLAUDE.md.bak-*` files, and `supabase/.temp/`.
- Existing full-lint baseline remains **7 errors and 18 warnings**. The account release did not change that baseline. Build warnings are the three existing `metadataBase` notices.
- The Stripe acceptance deliberately did not use a real card or send communications. Do not recreate its synthetic Stripe objects or repeat that audit without a new explicit need.
- The rate-limit count observation above is the only unresolved verification ambiguity from the hosted deletion. All owned synthetic records were directly read back as absent.

## Homepage proof and positioning (completed 2026-08-06)

All work below is implemented on `main`, deployed as the commit titled `Improve homepage proof and support access` (see `git log` for the exact SHA; this file avoids hardcoding it to prevent a circular reference at commit time).

### Final approved homepage structure (`app/page.tsx`, top to bottom)

1. Nav, hero, and the existing interactive `EstimateDemo` — unchanged. No second demo was added.
2. Contractor pain strip (slim row, right after the hero): "No more quoting after dinner", "No more rebuilding every estimate", "No more losing jobs to a faster quote".
3. Trust strip, "How it works" three-step section — unchanged.
4. Trade-specific examples, `app/components/TradeExamples.tsx` (new client component): tab selector for Plumbing / Electrical / Painting, heading "See what TradePulse creates", each panel marked **Example**, generic trade icons only, realistic job description + scope excerpt + 2-3 line-item names, no prices, no invented company names/customers/logos/testimonials/ratings/usage figures/endorsements.
5. Workflow showcase ("Review, edit, send, done"): 4-step grid covering what the hero demo doesn't show (light edits, send channels, the customer-facing view).
6. Benefits grid — unchanged.
7. Positioning section: "Fast estimates without another complicated business platform", short supporting copy (minimal setup, phone-first, not a CRM, not an enterprise field-service platform). No competitor names, no AI/SaaS jargon.
8. "After the estimate": one-line teasers for Reviews / Payments / Follow-Up (PRO-tagged), kept brief and non-duplicative of the fuller Pro pricing-card bullets.
9. Pricing (Starter **CA$29/month**, Pro **CA$59/month**, unchanged): AI Photo Estimates copy corrected to "Take a photo of the job and TradePulse uses it to help draft the estimate." (no diagnosis or exact-pricing claim).
10. FAQ — Step 1 and the "Do I need to be technical to use this?" answer both say contractors can **type or dictate** the job description; no wording implies typing is required.
11. Final CTA, footer — unchanged. Single primary CTA reusing the existing `/signup` (or `/subscribe` / `/new` for signed-in users) route; no second competing CTA.

### Support-page redesign (`app/contact/page.tsx`, plus new `app/components/CopyEmailButton.tsx`)

- Five compact, full-row `<a href="mailto:...">` topic links (Sign-in/account trouble, Estimate help, Billing or refund request, Privacy or data question, Something else), each with a correct subject and a short prefilled body (no private account data). Every decorative child (icon, text, chevron) is `pointer-events-none` so only the anchor itself is ever hit-tested; `touch-manipulation` added; no nested buttons, no `preventDefault`, no Next.js `Link` used for any mailto.
- Fallback block below the topic rows: "Can't open your email app?" with a native `mailto:` link showing the address, and a "Copy email address" button (`CopyEmailButton.tsx`, client component) with success ("Email copied.") and failure ("Couldn't copy automatically...") states, no dependency added.
- Hero and intro spacing tightened for mobile (hero `py-16 sm:py-20` → `py-6 sm:py-14`; the "Before you email" aside box hidden on mobile with its guidance condensed into one sentence shown inline instead, restored as a fuller box on `sm:`+; intro block `py-8 sm:py-10` → `py-4 sm:py-10`). First topic row now renders at y≈508px on a 390×844 viewport (was ≈1272px before this pass) — visible without scrolling. Desktop (1440×900) two-column layout unchanged in spirit, still balanced.
- Profile page (`app/profile/page.tsx`): added a plain muted-text "Support" link routing to `/contact`, placed between the profile form and the destructive Delete-account section — less prominent than any account/billing control, consistent with existing "Sign out" styling. Bottom navigation (`bottom-nav.tsx`) was not touched by any of this work.
- Public homepage footer "Support" link (already pointing to `/contact`) unchanged.

### Exact verification run for this release

- `npx tsc --noEmit`: passed.
- Targeted ESLint on all five changed/added files: passed, zero errors (2 pre-existing `<img>` warnings in `app/page.tsx`, unrelated to this work).
- Complete safe unit suite (`npx playwright test --config=playwright.unit.config.ts`): **123 passed**.
- `npx next build`: passed, only the three pre-existing `metadataBase` notices.
- `git diff --check`: clean (only benign LF/CRLF notices).
- Browser verification at 390×844, 412×915, 1440×900: no horizontal overflow at any size on either page; hero demo runs end to end to "Estimate saved"; trade tabs switch content correctly; all homepage CTAs route to the correct paths; all 5 contact mailto hrefs verified via rendered `href` and hit-tested (nothing intercepts); Copy Email Address success and failure paths both verified; only the pre-existing single `/api/profile` 401 (unauthenticated baseline) seen in console, no new errors.
- Hosted (production) verification: see the Deployment section immediately below.

### Deployment (2026-08-06)

- Commit `a58cc00` ("Improve homepage proof and support access"), pushed to `origin/main`.
- Vercel deployment `dpl_F3No6EAu8FLbYH6GSRjLXt5qe8BZ` reached **READY**, aliased to `www.trytradepulse.com` and the other project aliases. No manual redeploy was used.
- Hosted verification on production: homepage returns 200, Starter $29 / Pro $59 confirmed in rendered text, new sections (pain strip, trade examples heading, AI Photo Estimates copy) confirmed present, no horizontal overflow at 390px, trade tabs switch content correctly (verified clicking through to the Painting panel), the hero demo runs end to end to "Estimate saved". `/contact` returns 200, all 5 topic-row `mailto` hrefs verified correct, first row renders at the same y≈508px as local. Network log showed no 5xx responses; console showed only the expected unauthenticated `/api/profile` 401 baseline, no new errors.
- **Not verified this session:** the Profile Support link while actually signed in, and whether tapping a topic row opens a real mail app on a physical device — both require credentials/hardware this agent doesn't have. Code for both was verified by inspection and local/hosted DOM checks only.

## SMS opt-out and payment-reminder message preview (2026-08-07)

Implemented and locally verified across four sessions; committed and deployed as noted below. Reasoning for the durable decisions here is in DECISIONS.md, not repeated in full.

### Inbound Twilio webhook

- Route: `app/api/webhooks/twilio-inbound/route.ts` (POST). Validates Twilio's `X-Twilio-Signature` via the official `twilio.validateRequest`, against `${NEXT_PUBLIC_APP_URL ?? "https://www.trytradepulse.com"}/api/webhooks/twilio-inbound`.
- Handles `OptOutType=STOP` / `START` / `HELP`; falls back to parsing Twilio's documented keyword set from `Body` (STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT, START/YES/UNSTOP, HELP/INFO) when `OptOutType` is absent, so it works correctly even before Advanced Opt-Out is confirmed enabled in Console.
- STOP/START are idempotent (compare-and-swap UPDATE-then-INSERT in `lib/sms-suppression.ts`); a duplicate webhook delivery is a safe no-op. HELP is a recognized no-op that changes nothing locally (Twilio's own Advanced Opt-Out reply already answers it). Always returns empty TwiML; this app never sends a second opt-out confirmation.
- Never references `tpe_estimates` or `payment_status` anywhere in its code path — structurally cannot mutate invoice/customer/payment state, confirmed by test.

### Suppression data model

- `public.tpe_sms_suppressions`: `phone` (unique, E.164), `sms_opted_out`, `opted_out_at`, `opted_in_at`, `last_message_sid`. RLS enabled, no policies (matches every other `tpe_` table; service-role access only).
- Global by normalized phone number, not scoped to a business or estimate — see DECISIONS.md for why.

### Every SMS send path is protected

- `app/api/cron/payment-reminders/route.ts` (automated daily cron)
- `app/api/send-sms/route.ts` (manual "Send Estimate" SMS)
- `app/api/estimates/[id]/review-request/route.ts` (Google review request SMS)
- All three check suppression before ever calling Twilio, and return `{ error: SMS_OPTED_OUT_MESSAGE, code: "sms_opted_out" }` (HTTP 409) instead of a generic failure. Twilio error 21610 is caught by one shared `recordSuppressionIfUnsubscribedError()` helper in all three (idempotent, no retry). No other Twilio call site exists in the codebase.

### Payment-reminder message format

Centralized in `lib/payment-reminder-message.ts` (`buildPaymentReminderSms()`), the single function both the production cron and the Profile Message Preview call — they cannot drift from each other.

- With a payment link: `"{Business}: Invoice #{ref} for ${amount} {lead-in}. Pay here: {link}. Reply STOP to stop text reminders."`
- Without one: `"{Business}: Invoice #{ref} for ${amount} {lead-in}. Please arrange payment at your earliest convenience. Reply STOP to stop text reminders."`
- Stage lead-ins preserved: `pre_due` "is due {date}", `overdue_1` "was due {date}", `overdue_2` "remains outstanding as of {date}", `overdue_ongoing` "remains unpaid".
- No "your contractor" fallback in the SMS path; a blank business name just omits the prefix. The email path is unrelated to this change and keeps its existing "your contractor" fallback.

### Contractor-facing behaviour

- Estimate detail (`app/components/estimate-actions.tsx`): amber "SMS opted out" banner on an affected unpaid invoiced estimate ("Customer opted out of text reminders. Follow up another way. The invoice is still unpaid, this does not change the balance."), with an "Email Customer" action reusing the existing `SendEstimateSheet` (opens directly to its email panel, prefilled) or "No email on file. Follow up by phone or in person." when there's no email on file.
- `/payments` unpaid-invoices list: same "SMS opted out" tag on affected rows, one batched suppression lookup for the whole list.
- No new contractor-facing email notification system was built. Checked for a reusable one first (`notify-error`, `new-signup`) — both only notify a fixed admin address, not the business owner — so building one would have been new scope; the in-app banner and list tag are the notification.

### Message Preview

Profile → Pro Features → directly beneath the Payment link field.

- Calls `buildPaymentReminderSms("overdue_1", ...)` with the contractor's live (pre-save) business-name and payment-link field state, plus fixed example invoice values (`#1042`, `$350`, `August 4, 2026`) — never real customer data, since a real invoice only exists at send time.
- Updates before save: reads the same `useState` the input fields already write to on every keystroke, no separate preview state to fall out of sync. Verified live in the browser (business name and payment-link edits both).
- Read-only: no textarea, no editable STOP wording, no editable business-name prefix, no per-stage template editing, no advanced messaging settings.
- Payment-link field's helper text: "Payment reminders include this link so customers can pay directly from the text." (replaced the prior similar-purpose text rather than showing both).

### Migration status

`supabase/migrations/20260807000000_create_tpe_sms_suppressions.sql`, applied via the Supabase MCP `apply_migration` tool on 2026-08-07, recorded in `supabase_migrations.schema_migrations` as `20260807051039 create_tpe_sms_suppressions`. Confirmed present in the live project (`fctequqcwxyhmnjgxixg`) before this release: table exists, RLS enabled, 0 rows. `lib/database.types.ts` regenerated and confirmed byte-identical to the freshly-generated live schema, no drift, no unrelated database object touched.

### Verification actually run

- Complete safe unit suite including all new/extended SMS and Message Preview test files: **173 passed**, 0 failed.
- `npx tsc --noEmit`: clean.
- Targeted ESLint on every changed/added file: clean except pre-existing baseline warnings/errors, individually confirmed via `git diff` inspection each session to be lines this work never touched (`app/estimates/[id]/page.tsx`'s one `<a>`-vs-`<Link>` error, unused-prop warnings in `send-estimate-sheet.tsx` and `profile-form.tsx`, one `useEffect` dependency warning).
- `npx next build`: passed, only the three known `metadataBase` notices.
- `git diff --check`: clean, only benign LF/CRLF notices.
- Manual browser verification across sessions via temporary isolated preview routes (props-driven, no auth needed, always removed after use along with their `proxy.ts` entry): SMS-opted-out banner and its Email Customer fallback, Message Preview live-updating from both business-name and payment-link field edits, no-link fallback, long-payment-URL wrapping with no overflow, 390×844 / 412×915 / 1440×900 all clean, no new console errors beyond the known baseline unauthenticated `/api/profile` 401.
- **Not verified: a real STOP/START SMS round-trip against a live Twilio number.** Deliberately deferred — see below.

### Production deployment

- Commit `3e4e0c0` ("Add SMS opt-out handling and reminder preview"), pushed to `origin/main`.
- Vercel deployment `dpl_DTaE51jTE2U5JvDFLUX9fBWq2epx` reached **READY**, aliased to `www.trytradepulse.com` and the other project aliases. No manual redeploy used.
- Hosted verification: `/api/webhooks/twilio-inbound` returns 405 for GET (route deployed, POST-only, correct), `/profile` redirects unauthenticated visitors to sign-in (correct, not a 5xx), homepage loads clean with no horizontal overflow at 390×844 or 1440×900, only the known baseline unauthenticated `/api/profile` 401 in console, no 5xx anywhere. The Message Preview itself was not re-verified live in production under a real signed-in Pro account (no credentials available to this agent); the deployed code is byte-identical to what was verified locally via the isolated preview route earlier this session.

### External Twilio configuration still required

- The inbound webhook URL (`https://www.trytradepulse.com/api/webhooks/twilio-inbound`) is not yet configured anywhere in Twilio Console. Until "A MESSAGE COMES IN" → Webhook → POST is set to that URL on the number/messaging configuration actually sending TradePulse's SMS, no inbound STOP/START/HELP will ever reach this app, regardless of how correct the code is.
- Whether Twilio Advanced Opt-Out is enabled on that number/messaging configuration is unverified — this agent has no Twilio Console access (no MCP tool for it). The inbound webhook's own keyword-based fallback parser (STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT etc.) works correctly either way, but Advanced Opt-Out is the carrier-compliant, officially-supported path and should be turned on regardless.

### Fresh-account production acceptance test remains mandatory after Twilio setup

Once the inbound webhook is configured, a full production acceptance pass is required before this feature is considered launch-ready: a fresh/synthetic test account (this project's local dev shares the same Supabase project and live Stripe as production — see memory notes on that), a real invoice, a real STOP reply confirmed to suppress future reminders, a real START reply confirmed to restore eligibility, and cleanup of every synthetic record afterward. Explicitly not performed this session, per instruction.

## Manual payment reminders and mobile action-bar fix (2026-08-07)

Implemented, locally verified, committed, and deployed as noted below. Durable reasoning for the "manual sends are independent of the automated schedule" decision is in DECISIONS.md, not repeated in full.

### Send Reminder Now (manual per-invoice reminder)

- Route: `POST /api/estimates/[id]/send-reminder/route.ts`. Signed-in owner required, `hasProPaymentsAccess()` required, the invoice must belong to the caller's own business (matched by `id` **and** `business_id` in one query), `payment_status` must be `unpaid`, `invoice_amount` and `due_date` must both be set. Never callable anonymously, never touches any invoice other than the one requested.
- Reuses the same production primitives as the cron: `buildPaymentReminderSms()` / `buildPaymentReminderEmailBody()` / `buildPaymentReminderEmailHtml()` from `lib/payment-reminder-message.ts`, and the same suppression-guard-then-send-then-21610-handling pattern from `lib/sms-suppression.ts`. No duplicated message-building or send logic.
- `reminder_count` only advances when at least one channel actually sent, via a compare-and-swap update (`.eq("reminder_count", currentReminderCount)`) so a duplicate tap or a same-moment cron run can't double-advance it. Never touches `payment_status`, `invoice_amount`, or `due_date`.
- UI (`app/components/estimate-actions.tsx`): the old "Send Payment Reminder" button (which only opened the invoicing sheet) is relabeled **"Invoice This Job"** — accurate to what it actually does. A new **"Send Reminder Now"** button appears only when the estimate is invoiced, unpaid, and the business has Pro Payments access. Tap → inline "Confirm — send reminder now?" → tap again → "Sending..." (disabled, prevents duplicate taps) → one of the result strings shown below the button ("Reminder sent by text and email", "Reminder sent by text", "Reminder sent by email", "SMS opted out. Reminder sent by email.", "SMS opted out. No email address available.", "No customer contact method available.", "Reminder could not be sent").

### Manual stage selection is deliberately not the cron's schedule

- The cron's own `computeNextReminderStage()` (`lib/payment-reminder-stage.ts`) is **unchanged** and remains fully schedule-driven (2 days pre-due, 1/5/14+ days overdue), used only by `app/api/cron/payment-reminders/route.ts`.
- The manual route uses a separate function, `selectManualReminderStage()`, that never refuses for timing reasons: future due date → `pre_due` wording (any distance out, not just the cron's 2-day window); due today/overdue with nothing sent yet → `overdue_1` wording, however overdue; due today/overdue with a prior reminder already sent → whichever of `overdue_1` / `overdue_2` / `overdue_ongoing` actually matches how overdue the invoice is now, using the same day thresholds the cron uses. It only refuses for the invoice-state guards listed above (unpaid, amount/due date present, Pro access, ownership), never because "the schedule doesn't say so yet."
- **Cron/manual duplicate protection:** the manual send's resulting `reminder_count` is set to the same stage-index value the cron's own indexing would use for reaching that stage (not a naive `+1`), and never regresses below what's already recorded. That means an immediate subsequent cron run correctly sees that stage as already covered and does not resend the identical wording — the two selection functions stay independent, but their `reminder_count` bookkeeping stays compatible.

### SMS opt-out / email fallback (manual route)

- Identical guard order to every other SMS path: suppression checked before Twilio is ever called; Twilio 21610 is caught via the shared `recordSuppressionIfUnsubscribedError()` helper (idempotent, no retry).
- SMS and email are fully independent — a suppressed or failed SMS never blocks the email attempt, and vice versa. If SMS is suppressed but email succeeds, the send is still treated as successful ("SMS opted out. Reminder sent by email.").
- If no channel can actually send (no phone and no email, or all attempted channels fail), `reminder_count` and `last_reminder_sent_at` are left untouched — nothing is recorded as sent.

### Mobile estimate action-bar white-strip fix

- Cause: `estimate-actions.tsx`'s fixed bar used `bottom-[90px]`, based on a stale comment assuming `BottomNav` was ~93.5px tall (an older floating-circle design). `BottomNav` was redesigned to a flat 87px bar and the offset was never revisited — the intended ~3.5px overlap became an actual 3px *gap*, exposing the white estimate card underneath.
- Fix: corrected to `bottom-[84px]` (matching a real 87px `BottomNav` measurement), plus a `ResizeObserver` that publishes the action bar's real height as the `--tp-estimate-action-bar-height` CSS custom property. `app/estimates/[id]/page.tsx`'s `<main>` bottom padding now uses `calc(var(--tp-estimate-action-bar-height, 200px) + 108px)` instead of a static guessed `pb-[14rem]`, since the bar's real height ranges from ~100px (one button) to 400px+ (several stacked panels) depending on estimate state.
- Verified at 390×844 and 412×915: no white strip, all real content reachable by scrolling above the fixed bar, no horizontal overflow.

### Verification actually run (local)

- Focused tests: `tests/smoke/manual-payment-reminder.spec.ts` (30 tests), `tests/smoke/payment-reminder-copy.spec.ts`, `tests/smoke/sms-suppression-guard.spec.ts`, `tests/smoke/payment-reminder-message-preview.spec.ts` — **71 passed**, 0 failed.
- `npx tsc --noEmit`: clean.
- Targeted ESLint on every changed/added file: clean except the pre-existing, unrelated `<a>`-vs-`<Link>` error in `app/estimates/[id]/page.tsx:110`, individually confirmed via `git diff` inspection to predate this work.
- `npx next build`: passed.
- `git diff --check`: clean, only benign LF/CRLF notices.
- Manual browser verification via a temporary isolated preview route (props-driven, no auth needed, removed after use along with its `proxy.ts` entry): unpaid+Pro shows "Send Reminder Now", paid/not-invoiced/non-Pro/opted-out states all render correctly (opted-out still shows the button, with the "SMS opted out" banner and email fallback beside it), full click→confirm→send→result cycle verified against the real route (received the real route's 401 when unauthenticated, confirming the request actually reached the server), no horizontal overflow at 390×844 or 412×915.
- **Not verified this session: a real SMS/email send.** Deliberately not performed — see "Exact next action" below.

### Production deployment

- Commit: see "Current state" above once updated post-push.
- Vercel deployment ID and READY status: recorded once confirmed post-push.
- Hosted verification: recorded once confirmed post-push.

**Exact next action:** perform the controlled production payment-reminder STOP/START test using one test invoice and the owner's own phone number (same outstanding action already queued for the SMS opt-out feature above — this release doesn't add a new Twilio configuration requirement, it reuses the already-deployed inbound webhook and suppression store).

## Cost-amplification guard verification and next action

- Migration reconciliation: Supabase records `20260817044348_cost_amplification_guards`; local source was renamed from `20260817044143_cost_amplification_guards.sql` after its applied functions, constraints, RLS state, comment, and service-role grants were confirmed to match. Its SQL was not re-run.
- Photo uploads now take a service-role-only atomic reservation for the requested business, estimate, file count, and byte count. The reservation includes the full requested file count and bytes from pending uploads in the business quota, is deleted after success or handled failure, and stale pending reservations stop consuming quota after 15 minutes if an invocation terminates before cleanup.
- Delivery claims remain deliberately cost-safe: a provider failure after a successful claim can block automatic retry. Manual support recovery is required until a deliberate, rate-limited recovery flow is implemented.
- The focused claim-ordering test now checks an awaited claim and its negative-claim guard before each Twilio or Resend call. Re-run the focused test, full safe suite, typecheck, build, and `git diff --check` before any commit.

### Preview smoke-test attempt (2026-08-17)

- `fix/cost-amplification-guards` was pushed to `origin` at `6048ff05d9cf1f8269d1b966c9374330142bf346`. Its Git-triggered Vercel Preview deployment `dpl_8yWoVkhGaHYzub67ZEKRytPitHXS` failed before becoming testable.
- The Preview build compiled and completed TypeScript, then failed while collecting page data because `STRIPE_SECRET_KEY` is not configured for the Preview environment. It is Production-only. Do not copy the Production key. Configure isolated Stripe **test-mode** Preview credentials and matching test price IDs before retrying.
- Initially, `GOOGLE_PLACES_API_KEY` was absent from Production and Preview. It was later added to Preview only; it remains absent from Production.
- The payment-reminder cron remains configured in `vercel.json`, but Vercel cron jobs run only on Production, so the failed Preview did not invoke it. No Preview route was requested and no test account, customer data, SMS, email, Stripe Checkout Session, payment, or Google Places request was created.
- Local verification in this session: `git diff --check`, `npx.cmd tsc --noEmit`, focused guard tests (4 passed), and full safe unit suite (208 passed). Local `npx.cmd next build` could not fetch the public DM Sans font in this execution environment; Vercel's own build passed compilation and TypeScript before the missing Preview Stripe configuration stopped it.

### Ready Preview follow-up (2026-08-17)

- A later Preview redeploy, `dpl_9a92hxCKqTWNtY5g8Ba5A8uw56dr`, is READY at `https://tradepulse-estimates-a27y0qpuo-gchansen-2620s-projects.vercel.app` and its metadata confirms `6048ff05d9cf1f8269d1b966c9374330142bf346`. Its homepage returned 200.
- Vercel environment names confirm `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_ID`, and `GOOGLE_PLACES_API_KEY` are Preview-only, while `GOOGLE_PLACES_API_KEY` remains absent from Production. Preview has no `STRIPE_PRO_PRICE_ID` or `STRIPE_WEBHOOK_SECRET`. The READY deployment above was built before `STRIPE_PRICE_ID` was added, so its running `/api/billing/checkout` route still reports that variable as missing.
- A Preview POST to `/api/profile/find-review-link` without authentication returned 401 before a Places lookup. A Preview POST to `/api/billing/checkout` without authentication redirected to `/login`; neither call created a Checkout Session or contacted a provider. Cron was not invoked.
- The remaining controlled smoke checks were completed in the authenticated session below, except Checkout, which must not be retried against this already-built deployment.

### Authenticated Preview smoke test (2026-08-17)

- A controlled Preview account signed in successfully. One small synthetic, no-customer estimate was generated and the authenticated estimate list contained its generated ID exactly once. This invoked one expected Anthropic estimate-generation call.
- One controlled password-reset request returned the generic `{ ok: true }` response. No SMS was sent. The reset route was exercised once only and may have invoked one expected Resend send.
- One Starter Checkout POST was attempted with the Preview origin and without following any redirect. It returned HTTP 500 before a Checkout redirect. Deployment logs show `[checkout] STRIPE_PRICE_ID not configured`, so no Checkout Session, card entry, or payment occurred. Do not retry against this deployment.
- One 1x1 valid PNG logo upload returned 200. One authenticated synthetic Google Places lookup returned 404 (no matching business) rather than a configuration error. The route may issue up to four Google search requests per one guarded lookup. Vercel environment names confirm the Places key is Preview-only and absent from Production.
- Cron was not invoked. Provider dashboards were not accessed, so no dashboard usage delta was independently verified. No unexpected app-side provider request was identified beyond the one estimate generation, one controlled reset request, and one guarded Places lookup described above.

**Exact next action:** after confirming the Preview `STRIPE_PRICE_ID` is a test-mode price, allow one Git-triggered Preview deployment so the new environment applies, then rerun only the single Starter Checkout test. Do not merge or deploy Production until that succeeds and provider dashboard caps are verified. No real customer message, card, or Production checkout was used.

### Preview Pro-upgrade stale-reference recovery (2026-08-17)

- Latest Preview deployment: `dpl_7PQhtzUh875YRPf4FQWRrrACgJ1Y`, READY at `https://tradepulse-estimates-az0rcg8q7-gchansen-2620s-projects.vercel.app`. It is Preview-only and was never promoted.
- The earlier Pro-upgrade failure was confirmed as stale saved Stripe customer and subscription references on the controlled synthetic Preview account. Both objects were absent from the connected TradePulse Stripe sandbox. Only that account's `tpe_businesses.stripe_customer_id` and `tpe_businesses.stripe_subscription_id` were cleared, while its Starter plan and trial status were preserved.
- `app/api/billing/upgrade/route.ts` now validates saved references before reuse. A missing saved customer clears both references and starts fresh Checkout; a missing subscription clears only that reference; valid trial references are retained for the existing metadata path. Non-missing subscription lookup failures retain the existing log-and-continue behaviour. `lib/stripe-billing-recovery.ts` and `tests/smoke/stripe-billing-recovery.spec.ts` cover those cases; `playwright.unit.config.ts` includes the focused test.
- One authorized Preview Pro-upgrade POST then returned HTTP 200 with a Stripe sandbox Checkout redirect. The URL was not opened and no card or payment was used. Read-back confirms a fresh sandbox customer is stored for the synthetic account and no completed subscription is stored. Vercel runtime logs record the request as HTTP 200 with no route error.
- Verification: `git diff --check` passed, `npx.cmd tsc --noEmit` passed, focused stale-reference tests passed (3), and the full safe unit suite passed (211). Local `npx.cmd next build` remains blocked only by this environment's failed public DM Sans fetch; the new Vercel Preview build passed compilation, TypeScript, page generation, and READY deployment.

**Exact next action:** verify provider dashboard caps and alerts before any Production deployment. Keep Vercel cron disabled and Google Places absent from Production. The reviewed recovery work is ready for its authorised local commit; do not push or deploy it until explicitly authorised.

## Known existing lint and metadata warnings (unchanged baseline)

- Full-lint baseline remains **7 errors and 18 warnings**, unrelated to this release.
- Build warnings are the three pre-existing `metadataBase` notices (no `metadataBase` set in `app/layout.tsx`'s metadata export).
- Two pre-existing `<img>` (not `next/image`) ESLint warnings in `app/page.tsx` (logo images), unrelated to this release.

## Next milestone: Twilio configuration and the real STOP/START acceptance test

This blocks the SMS opt-out feature from being launch-ready even though the code is deployed. Nothing in this milestone can be done by an agent without Twilio Console access.

1. In Twilio Console, on the number/messaging configuration TradePulse actually sends from: set "A MESSAGE COMES IN" → Webhook → POST → `https://www.trytradepulse.com/api/webhooks/twilio-inbound`.
2. Confirm (don't assume) whether Advanced Opt-Out is enabled on that same configuration; enable it if not.
3. Perform one controlled real STOP/START SMS test against a real phone the operator controls, confirming TradePulse records suppression on STOP and restores eligibility on START.
4. Perform the full fresh-account production acceptance test described above (synthetic account, real invoice, real STOP/START, verified suppression, cleanup).

**Exact next action:** configure Twilio inbound messaging and Advanced Opt-Out as above, then perform the controlled real STOP/START SMS test, then the fresh-account production acceptance test.

## Queued after that: review the homepage on production

Review the homepage on production, then decide whether any sections should be shortened or removed based on the full mobile scroll experience (the homepage gained five new sections in an earlier session: pain strip, trade examples, workflow showcase, positioning, and "After the estimate"). Do not begin new product work in that task — it is a review-and-trim decision, not a feature slice. Load `www.trytradepulse.com` on a real mobile device, scroll the full homepage, and judge whether the combined length reads as strong proof or as padding, before making any cuts.
