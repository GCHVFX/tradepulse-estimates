# TradePulse Stripe Webhook Contract

This document is the source of truth for the dedicated TradePulse Stripe event destination. The production cutover has not been performed.

## Canonical destination

- URL: `https://trytradepulse.com/api/billing/webhook`
- Method: `POST`
- Compatibility alias: none
- Stripe API version: `2026-03-25.dahlia`

The application has one webhook implementation at `app/api/billing/webhook/route.ts`. Event verification and dispatch live in `lib/stripe-webhook.ts` so route behaviour and supported events cannot diverge.

## Exact event list

Configure the Stripe destination to send exactly:

1. `checkout.session.completed`
2. `customer.subscription.created`
3. `customer.subscription.updated`
4. `customer.subscription.deleted`
5. `invoice.payment_succeeded`
6. `invoice.payment_failed`

`customer.subscription.created` remains required. TradePulse creates trial subscriptions directly during email signup and Google OAuth provisioning, outside Checkout. The event provides a safe recovery path for synchronising the new subscription if the application write and asynchronous Stripe delivery do not arrive in the expected order.

`invoice.payment_failed` remains required. It immediately marks the matching current subscription `past_due` without deleting Stripe references or sending customer communications. Subscription updates use the same fail-closed TradePulse status domain described below.

## Event behaviour

| Event | Database behaviour | Safety and duplicate delivery |
| --- | --- | --- |
| `checkout.session.completed` | Sets `stripe_subscription_id` and the plan derived from the retrieved Stripe subscription. | Requires valid owner and plan metadata, a matching Stripe customer/subscription relationship, and exactly one configured TradePulse price. The conditional database update must return the intended row before any previous trial is inspected or cancelled. The prior trial's customer must also match. A transient cancellation failure returns HTTP 500 so duplicate delivery can retry it after the idempotent link. |
| `customer.subscription.created` | Sets `stripe_subscription_id`, mapped `subscription_status`, trial end when trialling, and the recognized plan. | Uses the same synchronization path as updates. Unknown customers, conflicting current subscriptions, unsupported statuses, and unrecognized prices are acknowledged without mutation. Duplicate assignments are safe. |
| `customer.subscription.updated` | Updates the same fields as subscription creation. | The customer and current subscription must match. Status and plan come from the shared mappings below. Repeated state assignments are safe. |
| `customer.subscription.deleted` | Sets `subscription_status` to `cancelled`. | The update requires both the Stripe customer and current subscription ids. Repeated deletion delivery is safe. |
| `invoice.payment_succeeded` | Sets `subscription_status` to `active` only when `amount_paid` is positive. | Requires the invoice's parent subscription to match the business, the retrieved subscription customer to match, and Stripe's mapped subscription state to be `active`. Terminal, recovery, and unknown states cannot be reactivated by a late invoice. Repeated active assignments are safe. |
| `invoice.payment_failed` | Sets `subscription_status` to `past_due`. | Requires the invoice's parent subscription and retrieved Stripe customer to match the business. Terminal and unknown subscription states are not overwritten. Customer and subscription references remain unchanged. Repeated past-due assignments are safe. No email or SMS is sent. |

Unknown signed events return HTTP 200 without mutation. Supported events with missing identifiers or invalid metadata also return HTTP 200 without mutation because retrying malformed or unrelated payloads cannot make them safe.

## Price mapping

- `STRIPE_PRICE_ID` maps to `starter`.
- `STRIPE_PRO_PRICE_ID` maps to `pro`.
- A subscription must contain exactly one price item and that price must match exactly one configured TradePulse price.
- Checkout metadata must agree with the plan derived from the retrieved subscription.
- Unknown, missing, multiple, or ambiguously configured prices cause no database mutation. The internal warning records only safe booleans and the item count, never a price id.
- Invoice events do not resolve a plan because they do not update the plan field.

## Status mapping

Stripe subscription creation and update events use one shared mapping:

| Stripe status | Stored TradePulse status |
| --- | --- |
| `active` | `active` |
| `trialing` | `trial` |
| `past_due` | `past_due` |
| `unpaid` | `past_due` |
| `incomplete` | `past_due` |
| `paused` | `past_due` |
| `incomplete_expired` | `cancelled` |
| `canceled` | `cancelled` |

An unknown Stripe status is acknowledged without mutation. It never defaults to active. `complimentary` remains an application-only status and is never assigned by Stripe.

This preserves the current access rules: only `active`, an unexpired `trial`, or `complimentary` has application access. Billing-recovery states fail closed as `past_due`, and terminal states fail closed as `cancelled`.

## Idempotency

- Checkout uses customer, owner, and expected-current-subscription predicates. Zero matched rows are a safe refusal, and no prior trial is touched. Once linking succeeds, duplicate delivery can safely retry a transient previous-trial cancellation.
- Subscription creation and update use conditional assignments against a null or matching current subscription.
- Deletion and invoice updates require both the customer and current subscription ids.
- Repeated delivery performs the same state assignment and does not create records or send communications.

## Signature verification

The handler:

1. Reads the request body as raw text.
2. Requires the `stripe-signature` header.
3. Requires the server-only `STRIPE_WEBHOOK_SECRET` environment variable.
4. Calls Stripe's `constructEvent` before event dispatch.
5. Returns HTTP 400 for missing or invalid signatures.
6. Returns HTTP 500 when the webhook secret is missing or a database operation fails.

No JSON parsing occurs before signature verification. Error responses never include raw Stripe or database errors.

## Safe test configuration

`playwright.unit.config.ts` includes the webhook specification so signed fixtures run with no production base URL, no production global setup, no production credentials, and no production writes. The normal smoke configuration is unchanged.

## Dashboard change still required

The Stripe Dashboard was not modified and the production cutover was not performed in this repair. After this code is deployed and before restarting the coordinated billing cutover, update the dedicated TradePulse Stripe destination to the canonical URL, exact six-event list, and compatible API version above. Do not change the shared Greg Hansen Studio or Parlay configuration.
