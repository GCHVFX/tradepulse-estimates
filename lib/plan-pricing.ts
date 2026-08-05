export const STARTER_MONTHLY_PRICE_CAD = 29;
export const PRO_MONTHLY_PRICE_CAD = 59;

export const PLAN_MONTHLY_PRICES_CAD = {
  starter: STARTER_MONTHLY_PRICE_CAD,
  pro: PRO_MONTHLY_PRICE_CAD,
} as const;

export type BillingPlan = keyof typeof PLAN_MONTHLY_PRICES_CAD;

export function formatMonthlyPlanPrice(plan: BillingPlan): string {
  return `$${PLAN_MONTHLY_PRICES_CAD[plan]}/month`;
}

export function checkoutPathForPlan(plan: BillingPlan): string {
  return `/api/billing/checkout?plan=${plan}`;
}
