import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpFreshAccount, cleanupTestAccount } from "./helpers";

/**
 * Server-side Pro enforcement on the Payments routes, plus the completed_at
 * repair.
 *
 * Calls PATCH /api/estimates/[id]/invoice and /mark-paid directly rather than
 * through the UI. That is the whole point: both routes previously had no plan
 * check at all, so a Starter account could invoice and mark paid (and thereby
 * start the reminder cron sending SMS and email to its customers) simply by
 * calling the API. A test driving only the browser would not have caught it,
 * because the UI does hide the buttons.
 *
 * Also asserts that marking paid leaves completed_at alone. completed_at means
 * "the job was marked done"; mark-paid used to overwrite it, and on an estimate
 * that was never marked done it invented a completion time that never happened.
 *
 * Sends nothing: the reminder cron is not invoked here, and no SMS or email is
 * triggered by either route under test.
 */
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

test("invoice and mark-paid are Pro-gated server-side, and mark-paid preserves completed_at", async ({
  page,
}) => {
  test.setTimeout(120000);
  const account = await signUpFreshAccount(page);

  try {
    const admin = adminClient();

    const { data: business } = await admin
      .from("tpe_businesses")
      .select("id, plan")
      .eq("owner_user_id", account.userId)
      .maybeSingle();
    if (!business) throw new Error("No business row for test account");
    expect(business.plan, "fresh signups start on starter").toBe("starter");

    // A minimal estimate to act on. Inserted directly rather than generated,
    // so this test costs no Anthropic call and stays focused on the gating.
    const { data: estimate, error: insertError } = await admin
      .from("tpe_estimates")
      .insert({
        business_id: business.id,
        title: "Pro gate test",
        summary: "## Line Items\n| Item | Cost |\n|---|---|\n| Test | $100.00 |",
        status: "draft",
        customer_name: "Test Customer",
        customer_phone: "",
        customer_email: "",
        job_address: "",
        description: "test",
        location: "unknown",
        service_type: "unknown",
        urgency: "unknown",
      })
      .select("id")
      .maybeSingle();
    if (insertError || !estimate) throw new Error(`Estimate insert failed: ${insertError?.message}`);

    const invoiceBody = { amount: 100, due_date: "2099-01-01" };

    // --- Starter: both routes must refuse ---
    const starterInvoice = await page.request.patch(
      `/api/estimates/${estimate.id}/invoice`,
      { data: invoiceBody }
    );
    expect(starterInvoice.status(), "starter invoice must be refused").toBe(403);
    expect((await starterInvoice.json()).error).toBe("Pro plan required");

    const starterMarkPaid = await page.request.patch(
      `/api/estimates/${estimate.id}/mark-paid`
    );
    expect(starterMarkPaid.status(), "starter mark-paid must be refused").toBe(403);
    expect((await starterMarkPaid.json()).error).toBe("Pro plan required");

    // The refusals must not have written anything.
    const { data: afterRefusal } = await admin
      .from("tpe_estimates")
      .select("payment_status, invoice_amount, completed_at")
      .eq("id", estimate.id)
      .maybeSingle();
    expect(afterRefusal?.payment_status, "no payment state written").toBeNull();
    expect(afterRefusal?.invoice_amount, "no invoice written").toBeNull();

    // --- Flip to Pro: both routes must now succeed ---
    await admin.from("tpe_businesses").update({ plan: "pro" }).eq("id", business.id);

    const proInvoice = await page.request.patch(
      `/api/estimates/${estimate.id}/invoice`,
      { data: invoiceBody }
    );
    expect(proInvoice.status(), "pro invoice must be allowed").toBe(200);

    // Mark the job done the way the app does, so there is a real completed_at
    // for mark-paid to leave alone.
    const doneAt = "2026-07-01T10:00:00.000Z";
    await admin
      .from("tpe_estimates")
      .update({ status: "done", completed_at: doneAt })
      .eq("id", estimate.id);

    const proMarkPaid = await page.request.patch(
      `/api/estimates/${estimate.id}/mark-paid`
    );
    expect(proMarkPaid.status(), "pro mark-paid must be allowed").toBe(200);

    const { data: afterPaid } = await admin
      .from("tpe_estimates")
      .select("payment_status, completed_at")
      .eq("id", estimate.id)
      .maybeSingle();

    expect(afterPaid?.payment_status, "payment state still changes").toBe("paid");
    expect(
      new Date(afterPaid!.completed_at!).toISOString(),
      "mark-paid must not touch the job completion timestamp"
    ).toBe(doneAt);

    // --- mark-paid must not invent a completion time when there isn't one ---
    const { data: second } = await admin
      .from("tpe_estimates")
      .insert({
        business_id: business.id,
        title: "Never marked done",
        summary: "## Line Items\n| Item | Cost |\n|---|---|\n| Test | $50.00 |",
        status: "sent",
        customer_name: "Test Customer",
        customer_phone: "",
        customer_email: "",
        job_address: "",
        description: "test",
        location: "unknown",
        service_type: "unknown",
        urgency: "unknown",
      })
      .select("id")
      .maybeSingle();
    if (!second) throw new Error("Second estimate insert failed");

    await page.request.patch(`/api/estimates/${second.id}/invoice`, { data: invoiceBody });
    const secondPaid = await page.request.patch(`/api/estimates/${second.id}/mark-paid`);
    expect(secondPaid.status()).toBe(200);

    const { data: afterSecond } = await admin
      .from("tpe_estimates")
      .select("payment_status, completed_at")
      .eq("id", second.id)
      .maybeSingle();

    expect(afterSecond?.payment_status).toBe("paid");
    expect(
      afterSecond?.completed_at,
      "an estimate never marked done must not gain a job completion timestamp"
    ).toBeNull();
  } finally {
    await cleanupTestAccount(account.userId);
  }
});
