import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpFreshAccount, cleanupTestAccount } from "./helpers";

/**
 * Estimate delete contract.
 *
 * tpe_estimate_changes, tpe_estimate_photos, and tpe_payment_reminders all
 * reference tpe_estimates with delete_rule NO ACTION (not CASCADE). DELETE
 * /api/estimates?id= used to delete the parent row first, so any estimate
 * that had ever been sent (an audit-log row), invoiced (a reminder row), or
 * had a photo attached failed with a foreign key violation. The route
 * returned 500, but the client never checked the response and always called
 * router.refresh(), so the Delete button spun forever and the estimate
 * silently survived. This locks in that the delete actually removes the
 * blocking child rows first and the parent row is genuinely gone from the
 * database, not just absent from a subsequent list render.
 */
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

test("deleting an estimate with sent/invoiced/photo history actually removes it", async ({
  page,
}) => {
  test.setTimeout(60000);
  const account = await signUpFreshAccount(page);

  try {
    const admin = adminClient();

    const { data: business } = await admin
      .from("tpe_businesses")
      .select("id")
      .eq("owner_user_id", account.userId)
      .maybeSingle();
    if (!business) throw new Error("No business row for test account");

    const { data: estimate } = await admin
      .from("tpe_estimates")
      .insert({
        business_id: business.id,
        title: "Delete regression test",
        summary: "## Line Items\n| Item | Cost |\n|---|---|\n| Test | $100.00 |",
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
    if (!estimate) throw new Error("Estimate insert failed");
    const estimateId = estimate.id;

    // Recreate exactly the blocking condition: one row in each table that
    // references this estimate with delete_rule NO ACTION.
    await admin.from("tpe_estimate_changes").insert({
      estimate_id: estimateId,
      user_id: account.userId,
      change_type: "sent",
      new_value: "sms",
    });
    await admin.from("tpe_payment_reminders").insert({
      estimate_id: estimateId,
      business_id: business.id,
      channel: "sms",
      stage: "pre_due",
      message: "test reminder",
    });
    await admin.from("tpe_estimate_photos").insert({
      estimate_id: estimateId,
      storage_path: `${account.userId}/${estimateId}/does-not-exist.jpg`,
      original_filename: "does-not-exist.jpg",
      mime_type: "image/jpeg",
      file_size: 1,
    });

    const deleteRes = await page.request.delete(`/api/estimates?id=${estimateId}`);
    expect(
      deleteRes.status(),
      "delete must succeed even with sent/invoiced/photo history"
    ).toBe(200);

    const { data: estimateRow } = await admin
      .from("tpe_estimates")
      .select("id")
      .eq("id", estimateId)
      .maybeSingle();
    expect(estimateRow, "estimate row actually removed from the database").toBeNull();

    const { data: changeRows } = await admin
      .from("tpe_estimate_changes")
      .select("id")
      .eq("estimate_id", estimateId);
    expect(changeRows ?? [], "audit-log rows removed with the estimate").toHaveLength(0);

    const { data: reminderRows } = await admin
      .from("tpe_payment_reminders")
      .select("id")
      .eq("estimate_id", estimateId);
    expect(reminderRows ?? [], "payment reminder rows removed with the estimate").toHaveLength(0);

    const { data: photoRows } = await admin
      .from("tpe_estimate_photos")
      .select("id")
      .eq("estimate_id", estimateId);
    expect(photoRows ?? [], "photo rows removed with the estimate").toHaveLength(0);
  } finally {
    await cleanupTestAccount(account.userId);
  }
});
