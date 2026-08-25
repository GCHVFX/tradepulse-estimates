/**
 * Public marketing prices. CAD is the headline currency on public surfaces;
 * US visitors are shown their own prices at signup, where the currency is
 * actually decided.
 *
 * Amount formatting lives in lib/currency.ts so nothing here can emit a bare
 * "$", which is ambiguous to a customer.
 */
import { PLAN_MONTHLY_PRICES, formatMonthlyPlanPrice, type BillingPlan } from "./currency";

export const STARTER_MONTHLY_PRICE_CAD = PLAN_MONTHLY_PRICES.cad.starter;
export const PRO_MONTHLY_PRICE_CAD = PLAN_MONTHLY_PRICES.cad.pro;
export const STARTER_MONTHLY_PRICE_USD = PLAN_MONTHLY_PRICES.usd.starter;
export const PRO_MONTHLY_PRICE_USD = PLAN_MONTHLY_PRICES.usd.pro;

export const PLAN_MONTHLY_PRICES_CAD = {
  starter: STARTER_MONTHLY_PRICE_CAD,
  pro: PRO_MONTHLY_PRICE_CAD,
} as const;

export type { BillingPlan };
export { formatMonthlyPlanPrice };

export function checkoutPathForPlan(plan: BillingPlan): string {
  return `/api/billing/checkout?plan=${plan}`;
}
