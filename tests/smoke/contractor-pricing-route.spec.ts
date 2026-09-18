import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Phase 1 slice 2, the database half: the tpe_save_contractor_pricing
 * transaction (specs/contractor-owned-pricing.md sections 12 and 15).
 *
 * These cases cover behaviour that only exists inside a real transaction: the
 * delivered re-check under the row lock, inbound-quote promotion, atomic row
 * replacement, the permitted business-default writes, rollback, and blocking
 * between concurrent writers. They run against a disposable PostgreSQL server
 * started for this file and thrown away afterwards. Never production, and
 * never a mock: locking and MVCC cannot be proven by anything but the real
 * server.
 *
 * The server binary comes from the embedded-postgres package already present
 * on this machine. If it cannot be found, every test here skips with the
 * reason, rather than passing on weaker evidence.
 */

/** Where the embedded PostgreSQL binaries and pg client live. */
function moduleRoot(): string | null {
  const candidates = [
    process.env.EMBEDDED_POSTGRES_MODULES,
    path.resolve(process.cwd(), "node_modules"),
    "C:/Work/tools/lead-auditor-II/node_modules",
    path.resolve(process.cwd(), "../lead-auditor-II/node_modules"),
  ].filter((entry): entry is string => Boolean(entry));

  for (const root of candidates) {
    if (existsSync(path.join(root, "embedded-postgres", "dist", "index.js")) && existsSync(path.join(root, "pg"))) {
      return root;
    }
  }
  return null;
}

const MODULES = moduleRoot();
const SKIP_REASON =
  "No disposable PostgreSQL available: embedded-postgres was not found. Set EMBEDDED_POSTGRES_MODULES to a node_modules directory containing embedded-postgres and pg.";

/* eslint-disable @typescript-eslint/no-explicit-any */
type PgClient = {
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
  end(): Promise<void>;
};

const PORT = 55_000 + Math.floor(Math.random() * 900);
const DB_NAME = "tradepulse_pricing_test";

let postgres: { stop(): Promise<void> } | null = null;
let ClientCtor: new (config: Record<string, unknown>) => PgClient;
let admin: PgClient;

function newClient(): PgClient {
  return new ClientCtor({
    host: "127.0.0.1",
    port: PORT,
    user: "postgres",
    password: "pricing-test",
    database: DB_NAME,
    // Declared, not assumed. A fresh server on a Windows locale negotiates
    // WIN1252, which cannot represent every character a migration may carry,
    // and the failure surfaces as an encoding error rather than a SQL one.
    client_encoding: "UTF8",
  });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.skip(MODULES === null, SKIP_REASON);
  test.setTimeout(180_000);

  const embedded = await import(pathToFileURL(path.join(MODULES!, "embedded-postgres", "dist", "index.js")).href);
  const EmbeddedPostgres = (embedded.default ?? embedded) as new (options: Record<string, unknown>) => {
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ClientCtor = require(path.join(MODULES!, "pg")).Client;

  const instance = new EmbeddedPostgres({
    databaseDir: path.join(os.tmpdir(), `tp-pricing-pg-${Date.now()}`),
    user: "postgres",
    password: "pricing-test",
    port: PORT,
    persistent: false,
  });
  await instance.initialise();
  await instance.start();
  await instance.createDatabase(DB_NAME);
  postgres = instance;

  admin = newClient();
  await admin.connect();
  await admin.query(readFileSync("tests/fixtures/contractor-pricing-schema.sql", "utf8"));
  // Production order: the original save-function migration, then the Phase 2
  // slice 3B taxable-handling replacement, exactly as they will land on the
  // real database.
  await admin.query(
    readFileSync(
      "supabase/migrations/20260916000000_add_contractor_pricing_snapshots_and_save_fn.sql",
      "utf8"
    )
  );
  await admin.query(
    readFileSync(
      "supabase/migrations/20260918000000_add_taxable_to_contractor_pricing_save_fn.sql",
      "utf8"
    )
  );
});

test.afterAll(async () => {
  await admin?.end().catch(() => {});
  await postgres?.stop().catch(() => {});
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

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

async function newBusiness(overrides: Record<string, unknown> = {}): Promise<string> {
  const columns = Object.keys(overrides);
  const values = Object.values(overrides);
  const sql = columns.length
    ? `insert into tpe_businesses (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning id`
    : "insert into tpe_businesses default values returning id";
  const { rows } = await admin.query(sql, values);
  return rows[0].id;
}

async function newEstimate(businessId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const entries = { business_id: businessId, pricing_source: "contractor_pricing", status: "draft", source: "ai_generated", ...overrides };
  const columns = Object.keys(entries);
  const values = Object.values(entries);
  const { rows } = await admin.query(
    `insert into tpe_estimates (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    values
  );
  return rows[0].id;
}

async function save(
  client: PgClient,
  estimateId: string,
  businessId: string,
  rows: unknown[],
  tax: unknown = null,
  firstHourlyRate: number | null = null
) {
  return client.query(
    "select public.tpe_save_contractor_pricing($1::uuid, $2::uuid, $3::jsonb, $4::jsonb, $5::numeric) as result",
    [estimateId, businessId, JSON.stringify(rows), tax === null ? null : JSON.stringify(tax), firstHourlyRate]
  );
}

async function rowsFor(estimateId: string, client: PgClient = admin) {
  const { rows } = await client.query(
    "select item_type, description, quantity, unit, unit_price, markup_percent, taxable from tpe_estimate_items where estimate_id = $1 order by display_order",
    [estimateId]
  );
  return rows;
}

async function estimateState(estimateId: string) {
  const { rows } = await admin.query(
    "select status, pricing_source, tax_label_snapshot, tax_rate_snapshot, deposit_percent_snapshot, deposit_threshold_snapshot from tpe_estimates where id = $1",
    [estimateId]
  );
  return rows[0];
}

async function businessState(businessId: string) {
  const { rows } = await admin.query(
    "select labour_rate, markup_percent, tax_label, tax_rate from tpe_businesses where id = $1",
    [businessId]
  );
  return rows[0];
}

/** Whether a promise is still unsettled after a grace period. */
async function stillPending(promise: Promise<unknown>, ms: number): Promise<boolean> {
  const marker = Symbol("pending");
  const result = await Promise.race([
    promise.then(() => "settled"),
    new Promise((resolve) => setTimeout(() => resolve(marker), ms)),
  ]);
  return result === marker;
}

// ── Row replacement ──────────────────────────────────────────────────────────

test("a second save replaces the prior rows instead of appending them", async () => {
  const businessId = await newBusiness();
  const estimateId = await newEstimate(businessId);

  await save(admin, estimateId, businessId, [LABOUR_ROW, MATERIALS_ROW]);
  expect(await rowsFor(estimateId)).toHaveLength(2);

  await save(admin, estimateId, businessId, [LABOUR_ROW]);
  const after = await rowsFor(estimateId);
  expect(after).toHaveLength(1);
  expect(after[0].item_type).toBe("labour");
});

// ── Taxable (Phase 2 slice 3B) ────────────────────────────────────────────────

test("A: an old-style row payload without taxable persists as taxable = true", async () => {
  // LABOUR_ROW and MATERIALS_ROW are deliberately unchanged from Phase 1 --
  // no taxable field at all, exactly what the currently deployed 51e152d
  // client still sends. Proves migration-first compatibility: this function
  // must already handle that payload correctly before the application code
  // that would ever send `taxable: false` is deployed.
  const businessId = await newBusiness();
  const estimateId = await newEstimate(businessId);

  await save(admin, estimateId, businessId, [LABOUR_ROW, MATERIALS_ROW]);
  const rows = await rowsFor(estimateId);
  expect(rows).toHaveLength(2);
  expect(rows.every((row: { taxable: boolean }) => row.taxable === true)).toBe(true);
});

test("B: a row containing taxable: false persists false", async () => {
  const businessId = await newBusiness();
  const estimateId = await newEstimate(businessId);

  await save(admin, estimateId, businessId, [{ ...LABOUR_ROW, taxable: false }, MATERIALS_ROW]);
  const rows = await rowsFor(estimateId);
  const labourRow = rows.find((row: { item_type: string }) => row.item_type === "labour");
  const materialRow = rows.find((row: { item_type: string }) => row.item_type === "material");
  expect(labourRow.taxable).toBe(false);
  expect(materialRow.taxable).toBe(true);
});

test("C: the RPC's own returned rows carry the correct taxable boolean, not just the table", async () => {
  const businessId = await newBusiness();
  const estimateId = await newEstimate(businessId);

  const { rows: resultRows } = await save(admin, estimateId, businessId, [
    { ...LABOUR_ROW, taxable: false },
    MATERIALS_ROW,
  ]);
  const returnedRows = resultRows[0].result.rows as Array<{ item_type: string; taxable: boolean }>;
  expect(returnedRows).toHaveLength(2);
  const returnedLabour = returnedRows.find((row) => row.item_type === "labour");
  const returnedMaterial = returnedRows.find((row) => row.item_type === "material");
  expect(returnedLabour?.taxable).toBe(false);
  expect(returnedMaterial?.taxable).toBe(true);
});

// ── Delivery ─────────────────────────────────────────────────────────────────

test("the transaction re-checks delivery, so a delivered estimate cannot be repriced", async () => {
  const businessId = await newBusiness();

  for (const delivered of [
    { sent_at: new Date().toISOString() },
    { copied_at: new Date().toISOString() },
    { status: "sent" },
    { status: "done" },
  ]) {
    const estimateId = await newEstimate(businessId, delivered);
    await expect(save(admin, estimateId, businessId, [LABOUR_ROW])).rejects.toThrow(/ESTIMATE_DELIVERED/);
    expect(await rowsFor(estimateId), JSON.stringify(delivered)).toHaveLength(0);
  }
});

test("delivery is re-checked inside the transaction, not only by the route", async () => {
  // The estimate is delivered after the route would have read it and before
  // the save runs. Only the in-transaction check can catch this.
  const businessId = await newBusiness();
  const estimateId = await newEstimate(businessId);

  await admin.query("update tpe_estimates set copied_at = now() where id = $1", [estimateId]);
  await expect(save(admin, estimateId, businessId, [LABOUR_ROW])).rejects.toThrow(/ESTIMATE_DELIVERED/);
  expect(await rowsFor(estimateId)).toHaveLength(0);
});

// ── Promotion ────────────────────────────────────────────────────────────────

test("an inbound quote is promoted on its first pricing save, and copies all four snapshots", async () => {
  const businessId = await newBusiness({
    tax_label: "HST",
    tax_rate: 13,
    deposit_percent: 25,
    deposit_threshold: 1000,
  });
  const estimateId = await newEstimate(businessId, {
    source: "website_quote",
    status: "needs_review",
    pricing_source: "markdown",
  });

  // Labour only: still incomplete, and it still promotes.
  await save(admin, estimateId, businessId, [LABOUR_ROW]);

  const state = await estimateState(estimateId);
  expect(state.pricing_source).toBe("contractor_pricing");
  expect(state.status).toBe("draft");
  expect(state.tax_label_snapshot).toBe("HST");
  expect(Number(state.tax_rate_snapshot)).toBe(13);
  expect(Number(state.deposit_percent_snapshot)).toBe(25);
  expect(Number(state.deposit_threshold_snapshot)).toBe(1000);
  expect(await rowsFor(estimateId)).toHaveLength(1);
});

test("a legacy estimate is refused rather than promoted", async () => {
  const businessId = await newBusiness();
  const estimateId = await newEstimate(businessId, { pricing_source: "markdown", source: "ai_generated" });

  await expect(save(admin, estimateId, businessId, [LABOUR_ROW])).rejects.toThrow(
    /ESTIMATE_NOT_CONTRACTOR_PRICING/
  );
  expect(await rowsFor(estimateId)).toHaveLength(0);
});

// ── Snapshots and business defaults ──────────────────────────────────────────

test("an existing estimate keeps its snapshots unless tax is explicitly changed", async () => {
  const businessId = await newBusiness({ tax_label: "GST", tax_rate: 5 });
  const estimateId = await newEstimate(businessId, {
    tax_label_snapshot: "GST",
    tax_rate_snapshot: 5,
    deposit_percent_snapshot: 25,
    deposit_threshold_snapshot: 1000,
  });

  await save(admin, estimateId, businessId, [LABOUR_ROW]);
  const kept = await estimateState(estimateId);
  expect(kept.tax_label_snapshot).toBe("GST");
  expect(Number(kept.tax_rate_snapshot)).toBe(5);
  expect(Number(kept.deposit_percent_snapshot)).toBe(25);
  expect(Number(kept.deposit_threshold_snapshot)).toBe(1000);

  await save(admin, estimateId, businessId, [LABOUR_ROW], { label: "HST", rate: 13 });
  const changed = await estimateState(estimateId);
  const business = await businessState(businessId);
  expect(changed.tax_label_snapshot).toBe("HST");
  expect(Number(changed.tax_rate_snapshot)).toBe(13);
  // The deposit snapshot is untouched by a tax edit.
  expect(Number(changed.deposit_percent_snapshot)).toBe(25);
  // Estimate and business moved together, in one transaction.
  expect(business.tax_label).toBe("HST");
  expect(Number(business.tax_rate)).toBe(13);
});

test("the first hourly rate becomes the business default; a later override does not", async () => {
  const businessId = await newBusiness({ labour_rate: 0, markup_percent: 20 });
  const estimateId = await newEstimate(businessId);

  await save(admin, estimateId, businessId, [{ ...LABOUR_ROW, unit_price: 125 }], null, 125);
  expect(Number((await businessState(businessId)).labour_rate)).toBe(125);

  await save(admin, estimateId, businessId, [{ ...LABOUR_ROW, unit_price: 150 }], null, 150);
  expect(Number((await businessState(businessId)).labour_rate)).toBe(125);

  await save(admin, estimateId, businessId, [{ ...MATERIALS_ROW, markup_percent: 40 }]);
  expect(Number((await businessState(businessId)).markup_percent)).toBe(20);
});

// ── Rollback ─────────────────────────────────────────────────────────────────

test("a failed save leaves the previous rows, snapshots and defaults untouched", async () => {
  const businessId = await newBusiness({ tax_label: "GST", tax_rate: 5 });
  const estimateId = await newEstimate(businessId, { tax_label_snapshot: "GST", tax_rate_snapshot: 5 });

  await save(admin, estimateId, businessId, [LABOUR_ROW, MATERIALS_ROW]);
  const before = await rowsFor(estimateId);

  // A blank description violates the not-blank CHECK during the insert, after
  // the delete and the tax writes have already run in the same transaction.
  await expect(
    save(admin, estimateId, businessId, [{ ...LABOUR_ROW, description: "" }], { label: "HST", rate: 13 })
  ).rejects.toThrow();

  expect(await rowsFor(estimateId)).toEqual(before);
  expect((await estimateState(estimateId)).tax_label_snapshot).toBe("GST");
  expect((await businessState(businessId)).tax_label).toBe("GST");
});

// ── Ownership ────────────────────────────────────────────────────────────────

test("another business cannot save pricing onto this estimate", async () => {
  const businessId = await newBusiness();
  const otherBusinessId = await newBusiness();
  const estimateId = await newEstimate(businessId);

  await expect(save(admin, estimateId, otherBusinessId, [LABOUR_ROW])).rejects.toThrow(
    /ESTIMATE_NOT_FOUND_OR_NOT_OWNED/
  );
  expect(await rowsFor(estimateId)).toHaveLength(0);
});

// ── Concurrency ──────────────────────────────────────────────────────────────

test("concurrent saves serialize, and no partial row set is ever observable", async () => {
  test.setTimeout(60_000);
  const businessId = await newBusiness();
  const estimateId = await newEstimate(businessId);

  // A committed starting state, so a mid-transaction reader has something
  // definite to see.
  await save(admin, estimateId, businessId, [LABOUR_ROW, MATERIALS_ROW]);
  const beforeRows = await rowsFor(estimateId);
  expect(beforeRows).toHaveLength(2);

  const writerA = newClient();
  const writerB = newClient();
  const readerC = newClient();
  await writerA.connect();
  await writerB.connect();
  await readerC.connect();

  try {
    // A runs the save inside an open transaction and holds the row lock.
    await writerA.query("begin");
    await save(writerA, estimateId, businessId, [{ ...LABOUR_ROW, unit_price: 111 }]);

    // B attempts its own save and must wait for A's lock.
    const bSave = save(writerB, estimateId, businessId, [
      { ...LABOUR_ROW, unit_price: 222 },
      { ...MATERIALS_ROW, unit_price: 333 },
    ]);
    expect(await stillPending(bSave, 1_500), "B must block while A holds the estimate row lock").toBe(true);

    // C reads while A is mid-replacement: it must see the committed
    // pre-transaction rows, never the state between DELETE and INSERT.
    const duringRows = await rowsFor(estimateId, readerC);
    expect(duringRows, "a reader must never observe a partially replaced row set").toEqual(beforeRows);

    await writerA.query("commit");
    await bSave;

    // B ran against A's committed state and its own save is the whole story.
    const finalRows = await rowsFor(estimateId);
    expect(finalRows).toHaveLength(2);
    expect(finalRows.map((row) => row.item_type)).toEqual(["labour", "material"]);
    expect(Number(finalRows[0].unit_price)).toBe(222);
    expect(Number(finalRows[1].unit_price)).toBe(333);
  } finally {
    await writerA.query("rollback").catch(() => {});
    await writerA.end().catch(() => {});
    await writerB.end().catch(() => {});
    await readerC.end().catch(() => {});
  }
});
