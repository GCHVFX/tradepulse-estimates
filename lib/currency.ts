/**
 * TradePulse supports Canada and the United States only.
 *
 * Two different currencies live in this app and must never be conflated:
 *
 *  - **Billing currency** is what Stripe charges a subscription in. Stripe
 *    locks it to the Customer on the first subscription and it can never be
 *    changed afterwards, so a current non-cancelled subscription is always
 *    the authority.
 *  - **Estimate currency** is what a contractor quotes their own customers
 *    in. It is a per-business setting, snapshotted onto each estimate at
 *    creation so historical estimates never move.
 *
 * Amounts are always rendered `CA$` or `US$`. A bare `$` is ambiguous to a
 * customer receiving a quote and is never emitted.
 */

export const CURRENCIES = ["cad", "usd"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const DEFAULT_CURRENCY: Currency = "cad";

/** Strict allowlist. Anything else is rejected, never coerced. */
export function parseCurrency(value: unknown): Currency | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (CURRENCIES as readonly string[]).includes(normalized) ? (normalized as Currency) : null;
}

/** Never throws. Unknown input falls back to CAD, the safe default. */
export function currencyOrDefault(value: unknown): Currency {
  return parseCurrency(value) ?? DEFAULT_CURRENCY;
}

/**
 * Maps Vercel's `x-vercel-ip-country` header to a default billing currency.
 * Only the United States defaults to USD. Canada, an unknown header, and
 * every other country default to CAD. The country itself is never persisted.
 */
export function currencyFromCountry(country: string | null | undefined): Currency {
  if (typeof country !== "string") return DEFAULT_CURRENCY;
  return country.trim().toUpperCase() === "US" ? "usd" : DEFAULT_CURRENCY;
}

export const CURRENCY_PREFIX: Record<Currency, string> = {
  cad: "CA$",
  usd: "US$",
};

export function currencyPrefix(currency: Currency): string {
  return CURRENCY_PREFIX[currency];
}

/**
 * Renders an amount with an unambiguous currency prefix.
 *
 * `decimals` mirrors the two existing estimate formatters: whole dollars for
 * totals, two decimals for line items. Grouping is en-CA, which is identical
 * to en-US for these values; the prefix is what disambiguates, not the locale.
 */
export function formatCurrency(
  amount: number,
  currency: Currency,
  options: { decimals?: 0 | 2 } = {}
): string {
  const decimals = options.decimals ?? 0;
  const value =
    decimals === 0
      ? Math.round(amount).toLocaleString("en-CA")
      : amount.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currencyPrefix(currency)}${value}`;
}

// ── Subscription plan pricing ────────────────────────────────────────────────

export type BillingPlan = "starter" | "pro";

/**
 * Whole-dollar monthly plan prices. USD is deliberately its own price point,
 * not a conversion of the CAD figure.
 */
export const PLAN_MONTHLY_PRICES: Record<Currency, Record<BillingPlan, number>> = {
  cad: { starter: 29, pro: 59 },
  usd: { starter: 19, pro: 39 },
};

export function planMonthlyPrice(plan: BillingPlan, currency: Currency): number {
  return PLAN_MONTHLY_PRICES[currency][plan];
}

/** e.g. "CA$29/month", "US$19/month". */
export function formatMonthlyPlanPrice(plan: BillingPlan, currency: Currency): string {
  return `${currencyPrefix(currency)}${planMonthlyPrice(plan, currency)}/month`;
}

/** e.g. "14-day free trial, then CA$29/month". */
export function trialCopy(plan: BillingPlan, currency: Currency): string {
  return `14-day free trial, then ${formatMonthlyPlanPrice(plan, currency)}`;
}

/** Shown on customer-facing estimates so the amounts are never ambiguous. */
export function allAmountsInLabel(currency: Currency): string {
  return `All amounts in ${currency.toUpperCase()}`;
}
