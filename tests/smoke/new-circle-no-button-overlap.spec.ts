import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpFreshAccount, cleanupTestAccount } from "./helpers";

/**
 * Regression lock: fixing the gap between EstimateActions and BottomNav
 * (bottom-[102px] -> bottom-[90px], see estimate-actions-no-nav-gap.spec.ts)
 * pulled the action bar close enough that BottomNav's floating "New" circle
 * (z-40, rendered on top) started overlapping the bottom of the "Send
 * Estimate" button (z-30) by about 6.5px. Since the circle is on top, a tap
 * meant for the bottom edge of Send Estimate could land on New instead.
 * Fixed by giving the action bar more bottom padding (pb-4 -> pb-7) so its
 * button clears the circle's protrusion zone, without moving the bar's own
 * outer edge (which still needs to touch/overlap the nav, or the original
 * gap bug reopens).
 */
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const SUMMARY =
  "# Test Job\n\nSummary.\n\nEstimated total: $100\n\n## Scope of Work\n- Do the work\n\n## Line Items\n| Item | Cost |\n|------|------|\n| Labour | $100.00 |\n\n## Pricing Summary\n| | |\n|---|---|\n| Subtotal | $100 |\n| Tax (GST 5%) | $5 |\n| **Total** | **$105** |\n| No deposit required | |\n| Balance on completion | $105 |\n";

test("the floating New circle does not overlap the estimate detail action button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const account = await signUpFreshAccount(page);

  try {
    const admin = adminClient();
    const { data: business } = await admin
      .from("tpe_businesses")
      .select("id")
      .eq("owner_user_id", account.userId)
      .maybeSingle();
    if (!business) throw new Error("No business row for test account");

    const { data: inserted } = await admin
      .from("tpe_estimates")
      .insert({
        title: "Test Job",
        summary: SUMMARY,
        status: "draft",
        source: "ai_generated",
        business_id: business.id,
        customer_name: "",
        customer_phone: "",
        customer_email: "",
        job_address: "",
        description: "",
        service_type: "estimate",
        location: "",
        urgency: "flexible",
        prepared_by: "",
      })
      .select("id")
      .single();
    if (!inserted) throw new Error("Insert failed");

    await page.goto(`/estimates/${inserted.id}`);
    const sendButton = page.getByRole("button", { name: /^send estimate$/i });
    await expect(sendButton).toBeVisible();

    const circle = await page.locator("nav button span").first().boundingBox();
    const button = await sendButton.boundingBox();
    expect(circle).not.toBeNull();
    expect(button).not.toBeNull();
    if (!circle || !button) return;

    const verticalOverlap = circle.y < button.y + button.height;
    const horizontalOverlap =
      circle.x < button.x + button.width && circle.x + circle.width > button.x;

    expect(verticalOverlap && horizontalOverlap).toBe(false);
  } finally {
    await cleanupTestAccount(account.userId);
  }
});
