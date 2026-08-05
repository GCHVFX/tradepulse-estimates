import { expect, test } from "@playwright/test";
import {
  PLAN_MONTHLY_PRICES_CAD,
  PRO_MONTHLY_PRICE_CAD,
  STARTER_MONTHLY_PRICE_CAD,
  checkoutPathForPlan,
  formatMonthlyPlanPrice,
} from "../../lib/plan-pricing";

test("Starter and Pro use the approved monthly CAD prices", () => {
  expect(STARTER_MONTHLY_PRICE_CAD).toBe(29);
  expect(PRO_MONTHLY_PRICE_CAD).toBe(59);
  expect(PLAN_MONTHLY_PRICES_CAD).toEqual({ starter: 29, pro: 59 });
  expect(formatMonthlyPlanPrice("starter")).toBe("$29/month");
  expect(formatMonthlyPlanPrice("pro")).toBe("$59/month");
  expect(checkoutPathForPlan("starter")).toBe("/api/billing/checkout?plan=starter");
  expect(checkoutPathForPlan("pro")).toBe("/api/billing/checkout?plan=pro");
});
