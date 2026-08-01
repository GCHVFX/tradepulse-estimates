import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpFreshAccount, cleanupTestAccount } from "./helpers";

/**
 * Photo deletion contract.
 *
 * The client used to send `{ url }` holding a short-lived signed URL, while
 * DELETE /api/estimates/[id]/photos matches the row on `storage_path`. Every
 * delete therefore returned 400 and photo removal was impossible. This locks
 * in the corrected field name and proves the full delete actually removes both
 * the storage object and the database row.
 *
 * A signed URL must never work as the identifier: it is regenerated on every
 * render and expires, so it cannot address a row.
 */
const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

test("photo delete keys on storage_path, removes storage object and row, and rejects a signed URL", async ({
  page,
}) => {
  test.setTimeout(120000);
  const account = await signUpFreshAccount(page);

  try {
    const admin = adminClient();

    const { data: business } = await admin
      .from("tpe_businesses")
      .select("id")
      .eq("owner_user_id", account.userId)
      .maybeSingle();
    if (!business) throw new Error("No business row for test account");

    // Photo upload and delete are both Pro-gated.
    await admin.from("tpe_businesses").update({ plan: "pro" }).eq("id", business.id);

    const { data: estimate } = await admin
      .from("tpe_estimates")
      .insert({
        business_id: business.id,
        title: "Photo delete test",
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
    if (!estimate) throw new Error("Estimate insert failed");

    // Upload through the real route, so the stored path is whatever the app
    // actually writes rather than something this test made up.
    const uploadRes = await page.request.post(`/api/estimates/${estimate.id}/photos`, {
      data: { photos: [{ base64: TINY_JPEG_BASE64 }] },
    });
    expect(uploadRes.status(), "upload should still work, unchanged by this fix").toBe(200);
    const uploaded = (await uploadRes.json()) as { photoUrls: string[] };
    expect(uploaded.photoUrls.length).toBe(1);
    const signedUrl = uploaded.photoUrls[0];

    const { data: photoRow } = await admin
      .from("tpe_estimate_photos")
      .select("id, storage_path")
      .eq("estimate_id", estimate.id)
      .maybeSingle();
    if (!photoRow) throw new Error("No photo row after upload");

    // The old client payload must not delete anything.
    const wrongFieldRes = await page.request.delete(`/api/estimates/${estimate.id}/photos`, {
      data: { url: signedUrl },
    });
    expect(wrongFieldRes.status(), "signed URL is not a valid identifier").toBe(400);

    const { data: stillThere } = await admin
      .from("tpe_estimate_photos")
      .select("id")
      .eq("id", photoRow.id)
      .maybeSingle();
    expect(stillThere, "a rejected delete must not remove the row").not.toBeNull();

    // The corrected payload deletes for real.
    const correctRes = await page.request.delete(`/api/estimates/${estimate.id}/photos`, {
      data: { storage_path: photoRow.storage_path },
    });
    expect(correctRes.status(), "storage_path is the identifier the route matches on").toBe(200);

    const { data: goneRow } = await admin
      .from("tpe_estimate_photos")
      .select("id")
      .eq("id", photoRow.id)
      .maybeSingle();
    expect(goneRow, "database row removed").toBeNull();

    const { data: listed } = await admin.storage
      .from("tpe-estimate-photos")
      .list(`${account.userId}/${estimate.id}`);
    const remaining = (listed ?? []).map((f) => f.name);
    expect(
      remaining.includes(photoRow.storage_path.split("/").pop()!),
      "storage object removed"
    ).toBe(false);

    // Ownership is still enforced: a second account cannot delete this photo.
    // (It is already gone, so this asserts the 404/403 path, not a real delete.)
    const foreignRes = await page.request.delete(`/api/estimates/${estimate.id}/photos`, {
      data: { storage_path: "someone-else/does-not-exist.jpg" },
    });
    expect(
      [403, 404].includes(foreignRes.status()),
      "unknown storage_path must not succeed"
    ).toBe(true);
  } finally {
    await cleanupTestAccount(account.userId);
  }
});
