import { expect, test } from "@playwright/test";
import {
  PLAN_MONTHLY_PRICES_CAD,
  PRO_MONTHLY_PRICE_CAD,
  STARTER_MONTHLY_PRICE_CAD,
  checkoutPathForPlan,
  formatMonthlyPlanPrice,
} from "../../lib/plan-pricing";

test("Starter and Pro use the approved monthly CAD prices", () => {
  // USD is its own price point, never a conversion of the CAD figure.
  expect(STARTER_MONTHLY_PRICE_CAD).toBe(29);
  expect(PRO_MONTHLY_PRICE_CAD).toBe(59);
  expect(PLAN_MONTHLY_PRICES_CAD).toEqual({ starter: 29, pro: 59 });
  expect(formatMonthlyPlanPrice("starter", "cad")).toBe("CA$29/month");
  expect(formatMonthlyPlanPrice("pro", "cad")).toBe("CA$59/month");
  expect(formatMonthlyPlanPrice("starter", "usd")).toBe("US$19/month");
  expect(formatMonthlyPlanPrice("pro", "usd")).toBe("US$39/month");
  expect(checkoutPathForPlan("starter")).toBe("/api/billing/checkout?plan=starter");
  expect(checkoutPathForPlan("pro")).toBe("/api/billing/checkout?plan=pro");
});
