import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpFreshAccount, cleanupTestAccount } from "./helpers";

/**
 * Phase 1 slice 2, the database half: PUT /api/estimates/[id]/pricing and the
 * tpe_save_contractor_pricing transaction
 * (specs/contractor-owned-pricing.md sections 12 and 15).
 *
 * NEEDS LIVE SERVICES AND AN APPLIED MIGRATION. These cases cover behaviour
 * that only exists inside a real transaction: the delivered re-check under the
 * row lock, inbound-quote promotion, atomic row replacement, and the permitted
 * business-default writes. They cannot run against production, because
 * 20260916000000_add_contractor_pricing_snapshots_and_save_fn.sql is
 * deliberately not applied there, and this project has no local Supabase stack
 * (no supabase/config.toml, no Docker), so they are written now and run when a
 * disposable database exists or the migration is applied to a preview project.
 *
 * Deliberately no SMS, no email, no AI. Delivery is simulated by setting
 * copied_at or status directly, which is the same state copy link produces and
 * sends nothing to anyone.
 */

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

type Admin = ReturnType<typeof adminClient>;

async function businessFor(admin: Admin, userId: string): Promise<string> {
  const { data } = await admin
    .from("tpe_businesses")
    .select("id")
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("No business row for test account");
  return data.id;
}

async function seedEstimate(
  admin: Admin,
  businessId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const { data, error } = await admin
    .from("tpe_estimates")
    .insert({
      business_id: businessId,
      title: "Slice 2 pricing test",
      summary: "",
      status: "draft",
      source: "ai_generated",
      pricing_source: "contractor_pricing",
      customer_name: "",
      customer_phone: "",
      customer_email: "",
      job_address: "",
      description: "test",
      location: "unknown",
      service_type: "unknown",
      urgency: "unknown",
      ...overrides,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) throw new Error(`Estimate insert failed: ${error?.message}`);
  return data.id;
}

async function rowsFor(admin: Admin, estimateId: string) {
  const { data } = await admin
    .from("tpe_estimate_items")
    .select("item_type, description, quantity, unit, unit_price, markup_percent")
    .eq("estimate_id", estimateId)
    .order("display_order", { ascending: true });
  return data ?? [];
}

/** Calls the transaction directly, which is what these cases are about. */
async function save(
  admin: Admin,
  estimateId: string,
  businessId: string,
  rows: unknown[],
  tax: unknown = null,
  firstHourlyRate: number | null = null
) {
  return admin.rpc("tpe_save_contractor_pricing", {
    p_estimate_id: estimateId,
    p_business_id: businessId,
    p_rows: rows,
    p_tax: tax,
    p_first_hourly_rate: firstHourlyRate,
  } as never);
}

const LABOUR_ROW = {
  description: "Labour",
  item_type: "labour",
  quantity: 8,
  unit: "hr",
  unit_price: 95,
  markup_percent: null,
  line_total: 760,
  display_order: 0,
};
const MATERIALS_ROW = {
  description: "Materials",
  item_type: "material",
  quantity: 1,
  unit: null,
  unit_price: 200,
  markup_percent: 20,
  line_total: 200,
  display_order: 1,
};

test("a second save replaces the prior rows instead of appending them", async ({ page }) => {
  test.setTimeout(60000);
  const account = await signUpFreshAccount(page);
  try {
    const admin = adminClient();
    const businessId = await businessFor(admin, account.userId);
    const estimateId = await seedEstimate(admin, businessId);

    await save(admin, estimateId, businessId, [LABOUR_ROW, MATERIALS_ROW]);
    expect(await rowsFor(admin, estimateId)).toHaveLength(2);

    await save(admin, estimateId, businessId, [LABOUR_ROW]);
    const after = await rowsFor(admin, estimateId);
    expect(after).toHaveLength(1);
    expect(after[0].item_type).toBe("labour");
  } finally {
    await cleanupTestAccount(account.userId);
  }
});

test("the transaction re-checks delivery, so a delivered estimate cannot be repriced", async ({ page }) => {
  test.setTimeout(60000);
  const account = await signUpFreshAccount(page);
  try {
    const admin = adminClient();
    const businessId = await businessFor(admin, account.userId);

    // Every delivery signal, including copy link's, which never sets sent_at.
    for (const delivered of [
      { sent_at: new Date().toISOString() },
      { copied_at: new Date().toISOString() },
      { status: "sent" },
      { status: "done" },
    ]) {
      const estimateId = await seedEstimate(admin, businessId, delivered);
      const { error } = await save(admin, estimateId, businessId, [LABOUR_ROW]);
      expect(error?.message, JSON.stringify(delivered)).toContain("ESTIMATE_DELIVERED");
      expect(await rowsFor(admin, estimateId)).toHaveLength(0);
    }
  } finally {
    await cleanupTestAccount(account.userId);
  }
});

test("an inbound quote is promoted on its first pricing save, complete or not", async ({ page }) => {
  test.setTimeout(60000);
  const account = await signUpFreshAccount(page);
  try {
    const admin = adminClient();
    const businessId = await businessFor(admin, account.userId);

    await admin
      .from("tpe_businesses")
      .update({ tax_label: "HST", tax_rate: 13, deposit_percent: 25, deposit_threshold: 1000 })
      .eq("id", businessId);

    const estimateId = await seedEstimate(admin, businessId, {
      source: "website_quote",
      status: "needs_review",
      pricing_source: "markdown",
    });

    // Labour only: still incomplete, and it still promotes.
    const { error } = await save(admin, estimateId, businessId, [LABOUR_ROW]);
    expect(error).toBeNull();

    const { data } = await admin
      .from("tpe_estimates")
      .select("status, pricing_source, tax_label_snapshot, tax_rate_snapshot, deposit_percent_snapshot, deposit_threshold_snapshot")
      .eq("id", estimateId)
      .maybeSingle();

    const promoted = data as unknown as Record<string, unknown>;
    expect(promoted.pricing_source).toBe("contractor_pricing");
    expect(promoted.status).toBe("draft");
    expect(promoted.tax_label_snapshot).toBe("HST");
    expect(Number(promoted.tax_rate_snapshot)).toBe(13);
    expect(Number(promoted.deposit_percent_snapshot)).toBe(25);
    expect(Number(promoted.deposit_threshold_snapshot)).toBe(1000);
  } finally {
    await cleanupTestAccount(account.userId);
  }
});

test("an existing contractor_pricing estimate keeps its snapshots unless tax is changed", async ({ page }) => {
  test.setTimeout(60000);
  const account = await signUpFreshAccount(page);
  try {
    const admin = adminClient();
    const businessId = await businessFor(admin, account.userId);
    const estimateId = await seedEstimate(admin, businessId, {
      tax_label_snapshot: "GST",
      tax_rate_snapshot: 5,
      deposit_percent_snapshot: 25,
      deposit_threshold_snapshot: 1000,
    } as Record<string, unknown>);

    await save(admin, estimateId, businessId, [LABOUR_ROW]);

    const { data: unchanged } = await admin
      .from("tpe_estimates")
      .select("tax_label_snapshot, tax_rate_snapshot, deposit_percent_snapshot, deposit_threshold_snapshot")
      .eq("id", estimateId)
      .maybeSingle();
    const kept = unchanged as unknown as Record<string, unknown>;
    expect(kept.tax_label_snapshot).toBe("GST");
    expect(Number(kept.deposit_percent_snapshot)).toBe(25);
    expect(Number(kept.deposit_threshold_snapshot)).toBe(1000);

    // An explicit change moves the estimate snapshot and the business default
    // together, in one transaction.
    await save(admin, estimateId, businessId, [LABOUR_ROW], { label: "HST", rate: 13 });

    const { data: changed } = await admin
      .from("tpe_estimates")
      .select("tax_label_snapshot, tax_rate_snapshot, deposit_percent_snapshot")
      .eq("id", estimateId)
      .maybeSingle();
    const updated = changed as unknown as Record<string, unknown>;
    expect(updated.tax_label_snapshot).toBe("HST");
    expect(Number(updated.tax_rate_snapshot)).toBe(13);
    expect(Number(updated.deposit_percent_snapshot)).toBe(25);

    const { data: businessRow } = await admin
      .from("tpe_businesses")
      .select("tax_label, tax_rate")
      .eq("id", businessId)
      .maybeSingle();
    expect(businessRow?.tax_label).toBe("HST");
    expect(Number(businessRow?.tax_rate)).toBe(13);
  } finally {
    await cleanupTestAccount(account.userId);
  }
});

test("the first hourly rate becomes the business default, and a later override does not", async ({ page }) => {
  test.setTimeout(60000);
  const account = await signUpFreshAccount(page);
  try {
    const admin = adminClient();
    const businessId = await businessFor(admin, account.userId);
    await admin.from("tpe_businesses").update({ labour_rate: 0, markup_percent: 20 }).eq("id", businessId);

    const estimateId = await seedEstimate(admin, businessId);
    await save(admin, estimateId, businessId, [{ ...LABOUR_ROW, unit_price: 125 }], null, 125);

    const { data: afterFirst } = await admin
      .from("tpe_businesses")
      .select("labour_rate, markup_percent")
      .eq("id", businessId)
      .maybeSingle();
    expect(Number(afterFirst?.labour_rate)).toBe(125);

    // A per-estimate override on a business that already has a rate changes
    // this estimate only.
    await save(admin, estimateId, businessId, [{ ...LABOUR_ROW, unit_price: 150 }], null, 150);
    const { data: afterOverride } = await admin
      .from("tpe_businesses")
      .select("labour_rate, markup_percent")
      .eq("id", businessId)
      .maybeSingle();
    expect(Number(afterOverride?.labour_rate)).toBe(125);

    // Markup never moves from this route.
    await save(admin, estimateId, businessId, [{ ...MATERIALS_ROW, markup_percent: 40 }]);
    const { data: afterMarkup } = await admin
      .from("tpe_businesses")
      .select("markup_percent")
      .eq("id", businessId)
      .maybeSingle();
    expect(Number(afterMarkup?.markup_percent)).toBe(20);
  } finally {
    await cleanupTestAccount(account.userId);
  }
});

test("a failed save leaves the previous rows, snapshots and defaults untouched", async ({ page }) => {
  test.setTimeout(60000);
  const account = await signUpFreshAccount(page);
  try {
    const admin = adminClient();
    const businessId = await businessFor(admin, account.userId);
    const estimateId = await seedEstimate(admin, businessId, {
      tax_label_snapshot: "GST",
      tax_rate_snapshot: 5,
    } as Record<string, unknown>);

    await save(admin, estimateId, businessId, [LABOUR_ROW, MATERIALS_ROW]);
    const before = await rowsFor(admin, estimateId);

    // A blank description violates the not-blank CHECK inside the insert,
    // after the delete has already run in the same transaction.
    const { error } = await save(
      admin,
      estimateId,
      businessId,
      [{ ...LABOUR_ROW, description: "" }],
      { label: "HST", rate: 13 }
    );
    expect(error).not.toBeNull();

    expect(await rowsFor(admin, estimateId)).toEqual(before);
    const { data } = await admin
      .from("tpe_estimates")
      .select("tax_label_snapshot")
      .eq("id", estimateId)
      .maybeSingle();
    expect((data as unknown as Record<string, unknown>).tax_label_snapshot).toBe("GST");
    const { data: businessRow } = await admin
      .from("tpe_businesses")
      .select("tax_label")
      .eq("id", businessId)
      .maybeSingle();
    expect(businessRow?.tax_label).not.toBe("HST");
  } finally {
    await cleanupTestAccount(account.userId);
  }
});

test("another business cannot save pricing onto this estimate", async ({ page }) => {
  test.setTimeout(60000);
  const account = await signUpFreshAccount(page);
  try {
    const admin = adminClient();
    const businessId = await businessFor(admin, account.userId);
    const estimateId = await seedEstimate(admin, businessId);

    const { error } = await save(
      admin,
      estimateId,
      "00000000-0000-0000-0000-000000000000",
      [LABOUR_ROW]
    );
    expect(error?.message).toContain("ESTIMATE_NOT_FOUND_OR_NOT_OWNED");
    expect(await rowsFor(admin, estimateId)).toHaveLength(0);
  } finally {
    await cleanupTestAccount(account.userId);
  }
});

test("concurrent saves serialize, and no partial row set is observable", async ({ page }) => {
  test.setTimeout(60000);
  const account = await signUpFreshAccount(page);
  try {
    const admin = adminClient();
    const businessId = await businessFor(admin, account.userId);
    const estimateId = await seedEstimate(admin, businessId);

    const [first, second] = await Promise.all([
      save(admin, estimateId, businessId, [LABOUR_ROW, MATERIALS_ROW]),
      save(admin, estimateId, businessId, [LABOUR_ROW]),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    // Whichever committed last owns the whole row set: one or two rows, never
    // a mixture of both saves.
    const rows = await rowsFor(admin, estimateId);
    expect([1, 2]).toContain(rows.length);
    if (rows.length === 1) {
      expect(rows[0].item_type).toBe("labour");
    } else {
      expect(rows.map((row) => row.item_type)).toEqual(["labour", "material"]);
    }
  } finally {
    await cleanupTestAccount(account.userId);
  }
});
