/**
 * READ-ONLY production audit of stored estimate-summary formats.
 *
 * Slice 2b of the grouped-pricing plan. This script answers one question:
 * do real stored estimates convert into structured line items without changing
 * any total? It changes nothing. It exists to decide whether the schema slice
 * is safe to start.
 *
 * SAFETY MODEL
 * ------------
 *   1. Dry run by default. Contacting production requires an explicit
 *      AUDIT_CONFIRM_READONLY=yes in the environment.
 *   2. The Supabase client is wrapped in a Proxy that throws on every known
 *      write method (insert, update, upsert, delete, rpc, and the storage and
 *      auth admin surfaces). A write cannot be issued even by mistake.
 *   3. Only SELECT is ever performed, through .select() on the wrapped client.
 *   4. Column selection is narrow. No customer names, emails, phones, or
 *      addresses are fetched. Business names are fetched ONLY to build an
 *      in-memory redaction list and are never written anywhere.
 *   5. Raw estimate summaries are never printed to the terminal.
 *   6. Sanitised fixtures are written only with an explicit --export flag, and
 *      only after the aggregate pass succeeds.
 *   7. Non-zero exit on unsafe configuration or an unhandled parse failure.
 *
 * USAGE (compiled, since the repo has no ts-node or tsx):
 *   npx tsc scripts/audit-estimate-summary-formats.ts lib/estimate-summary.ts \
 *     lib/estimate-items.ts --outDir <tmp> --module commonjs --target es2020 \
 *     --skipLibCheck --esModuleInterop --resolveJsonModule
 *   AUDIT_CONFIRM_READONLY=yes node <tmp>/scripts/audit-estimate-summary-formats.js
 *   AUDIT_CONFIRM_READONLY=yes node <tmp>/scripts/audit-estimate-summary-formats.js --export
 *
 * This script is not imported by any application code and is not part of the
 * build. It is a one-off operator tool.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseSummary, computeTotals } from "../lib/estimate-summary";
import {
  parsedToItems,
  itemsToLineItemsBlock,
  validateConversionTotals,
  isReservedTotalLabel,
  type ConversionValidation,
} from "../lib/estimate-items";

// ── Safety ────────────────────────────────────────────────────────────────────

const WRITE_METHODS = new Set([
  "insert",
  "update",
  "upsert",
  "delete",
  "rpc",
  "auth",
  "storage",
  "functions",
  "realtime",
  "channel",
  "removeChannel",
  "removeAllChannels",
]);

class ReadOnlyViolation extends Error {
  constructor(method: string) {
    super(
      `BLOCKED: "${method}" is a write or side-effecting operation. This audit is strictly read-only.`
    );
    this.name = "ReadOnlyViolation";
  }
}

/**
 * Wrap a Supabase client so only reads can escape. Any attempt to reach a write
 * method throws immediately rather than returning a builder that could execute.
 */
function readOnly<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const key = String(prop);
      if (WRITE_METHODS.has(key)) throw new ReadOnlyViolation(key);
      const value = Reflect.get(target, prop, receiver);
      if (key === "from" && typeof value === "function") {
        return (...args: unknown[]) => {
          const builder = (value as (...a: unknown[]) => object).apply(target, args);
          return readOnly(builder);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
}

// ── Classification ────────────────────────────────────────────────────────────
//
// This is an AUDIT CLASSIFIER, not a second authoritative parser. It reads the
// raw markdown only to describe shapes that ParsedSummary deliberately erases,
// such as header order and column count. Nothing in the application uses it and
// it never decides a price.

export type PrimaryFormat =
  | "five-column"
  | "legacy-two-column"
  | "multi-option-sections"
  | "no-line-items-section"
  | "empty-line-items"
  | "unknown";

export type DetectedProblem =
  | "no-h1"
  | "group-column-present"
  | "unsupported-header-order"
  | "unexpected-extra-columns"
  | "missing-header-row"
  | "repeated-header-row"
  | "stray-subtotal-row"
  | "stray-tax-row"
  | "stray-deposit-row"
  | "duplicate-total-rows"
  | "invalid-currency"
  | "empty-description"
  | "negative-amount"
  | "pipe-or-malformed-table";

interface Classification {
  primaryFormat: PrimaryFormat;
  problems: DetectedProblem[];
  tableRowCount: number;
  columnCount: number | null;
  /** How many `## Line Items...` headings exist, exact or variant. */
  lineItemsHeadingCount: number;
  /**
   * Shape-redacted samples of cells that failed the currency check. Digits
   * become 9 and letters become X, so the shape is auditable without exposing
   * any content.
   */
  currencySamples: string[];
}

/** Digits to 9, letters to X. Enough to see the shape, never the content. */
function redactShape(text: string): string {
  return text.replace(/\d/g, "9").replace(/[A-Za-z]/g, "X").slice(0, 40);
}

function extractLineItemsSection(summary: string): string[] | null {
  const lines = summary.split("\n");
  const start = lines.findIndex((l) => /^##\s+Line Items\s*$/i.test(l.trim()));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

function splitRow(line: string): string[] {
  return line
    .split("|")
    .map((c) => c.trim())
    .filter((_, i, a) => i > 0 && i < a.length - 1);
}

function classify(summary: string): Classification {
  const problems: DetectedProblem[] = [];
  const currencySamples: string[] = [];
  if (!/^#\s+\S/m.test(summary)) problems.push("no-h1");

  // Any heading that starts "## Line Items", exact or with an option suffix.
  const lineItemsHeadingCount = (summary.match(/^##\s+Line Items\b.*$/gim) ?? []).length;

  const section = extractLineItemsSection(summary);
  if (section === null) {
    // A multi-option estimate carries several "## Line Items - Option N"
    // headings and no bare "## Line Items". parseSummary() matches the heading
    // exactly, so it finds no priced rows at all and the estimate totals zero.
    return {
      primaryFormat: lineItemsHeadingCount > 0 ? "multi-option-sections" : "no-line-items-section",
      problems,
      tableRowCount: 0,
      columnCount: null,
      lineItemsHeadingCount,
      currencySamples,
    };
  }

  const pipeLines = section.filter((l) => l.trim().startsWith("|"));
  if (pipeLines.length === 0) {
    return {
      primaryFormat: "empty-line-items",
      problems,
      tableRowCount: 0,
      columnCount: null,
      lineItemsHeadingCount,
      currencySamples,
    };
  }

  const rows = pipeLines.map(splitRow);
  const header = rows[0] ?? [];
  const headerLower = header.map((c) => c.toLowerCase());
  const columnCount = Math.max(...rows.map((r) => r.length));

  const looksLikeHeader = headerLower[0] === "item" || headerLower[0] === "description";
  if (!looksLikeHeader) problems.push("missing-header-row");
  if (headerLower.includes("group") || headerLower.includes("work package")) {
    problems.push("group-column-present");
    if (headerLower[0] !== "item") problems.push("unsupported-header-order");
  }

  // Data rows use the SAME exclusion rule parseSummary() applies, so the audit
  // counts what the real parser counts. That rule drops the dashed separator
  // and any row whose first cell starts with "item", which is how a repeated
  // header row inside one section is skipped. Without matching it here the
  // audit reports false invalid-currency hits on header cells such as "Cost".
  const dataRows = rows.filter(
    (r, i) =>
      i > 0 &&
      !/^[-: ]+$/.test(r[0] ?? "") &&
      !(r[0] ?? "").toLowerCase().startsWith("item")
  );
  const repeatedHeaderRows = rows.filter(
    (r, i) => i > 0 && (r[0] ?? "").toLowerCase().startsWith("item")
  ).length;
  if (repeatedHeaderRows > 0) problems.push("repeated-header-row");

  let reservedCount = 0;
  for (const row of dataRows) {
    const label = row[0] ?? "";
    const amount = row[row.length - 1] ?? "";

    if (isReservedTotalLabel(label)) {
      reservedCount += 1;
      if (/^\s*\**\s*sub\s*-?\s*total/i.test(label)) problems.push("stray-subtotal-row");
      else if (/^\s*\**\s*(tax|gst|hst|pst|qst|vat)\b/i.test(label)) problems.push("stray-tax-row");
      else if (/^\s*\**\s*deposit/i.test(label)) problems.push("stray-deposit-row");
      else problems.push("duplicate-total-rows");
    }

    if (label.trim() === "") problems.push("empty-description");

    const cleaned = amount.replace(/[$,*]/g, "").trim();
    if (cleaned !== "" && !/^-?\d*\.?\d+$/.test(cleaned)) {
      problems.push("invalid-currency");
      currencySamples.push(redactShape(amount));
    }
    if (/^-/.test(cleaned) && /^-?\d*\.?\d+$/.test(cleaned)) problems.push("negative-amount");
  }
  if (reservedCount > 1) problems.push("duplicate-total-rows");

  let primaryFormat: PrimaryFormat;
  if (columnCount >= 5) primaryFormat = "five-column";
  else if (columnCount === 2) primaryFormat = "legacy-two-column";
  else primaryFormat = "unknown";

  if (columnCount > 5) problems.push("unexpected-extra-columns");

  // Ragged rows mean a stray pipe or a broken table.
  const widths = new Set(rows.filter((r) => !/^[-: ]+$/.test(r[0] ?? "")).map((r) => r.length));
  if (widths.size > 1) problems.push("pipe-or-malformed-table");

  return {
    primaryFormat,
    problems: [...new Set(problems)],
    tableRowCount: dataRows.length,
    columnCount,
    lineItemsHeadingCount,
    currencySamples,
  };
}

// ── Sanitisation ──────────────────────────────────────────────────────────────

/**
 * Deterministic. The same input always yields the same output, so re-running the
 * audit does not churn the fixture file.
 */
export function sanitiseSummary(summary: string, businessNames: string[]): string {
  let out = summary;

  // Longest first, so "Acme Plumbing Ltd" is replaced before "Acme".
  for (const name of [...businessNames].sort((a, b) => b.length - a.length)) {
    const trimmed = name.trim();
    if (trimmed.length < 3) continue;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), "Example Trades Ltd");
  }

  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "customer@example.test");
  out = out.replace(/https?:\/\/\S+/g, "https://example.test/link");
  out = out.replace(/\bwww\.\S+/gi, "example.test");
  // North American phone numbers in the usual shapes.
  out = out.replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "604-555-0100");
  // Canadian postal codes.
  out = out.replace(/\b[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d\b/g, "V5K 0A1");
  // Street addresses.
  out = out.replace(
    /\b\d{1,6}[A-Za-z]?\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)*\s+(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Way|Court|Crt|Crescent|Cres|Place|Pl|Terrace|Terr|Highway|Hwy)\b\.?/gi,
    "123 Example Street"
  );
  out = out.replace(/\b(Unit|Suite|Apt|Apartment)\s*#?\s*[\w-]+/gi, "Unit 1");

  return out;
}

/** Residual-risk scan. Flags anything that still looks personal after sanitising. */
export function residualPiiFindings(text: string): string[] {
  const found: string[] = [];
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text.replace(/customer@example\.test/g, "")))
    found.push("email-like");
  if (/\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(text.replace(/604-555-0100/g, "")))
    found.push("phone-like");
  if (/\b[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d\b/.test(text.replace(/V5K 0A1/g, "")))
    found.push("postal-code-like");
  if (/https?:\/\//.test(text.replace(/https:\/\/example\.test\/link/g, "")))
    found.push("url-like");
  return found;
}

/** One-way, salted per run family so no production id can be recovered from the repo. */
function auditId(productionId: string): string {
  return createHash("sha256").update(`tpe-audit-v1:${productionId}`).digest("hex").slice(0, 10);
}

// ── Audit ─────────────────────────────────────────────────────────────────────

interface EstimateRow {
  id: string;
  created_at: string;
  updated_at: string | null;
  status: string;
  sent_at: string | null;
  payment_status: string | null;
  invoice_amount: number | null;
  summary: string | null;
}

interface AuditRecord {
  auditId: string;
  status: string;
  isSent: boolean;
  isCustomerVisible: boolean;
  classification: Classification;
  validation: ConversionValidation;
  reparsedRowCount: number;
  reparsedSubtotal: number;
  sanitised: string;
  residualPii: string[];
}

function auditOne(row: EstimateRow, businessNames: string[]): AuditRecord {
  const summary = row.summary ?? "";
  const classification = classify(summary);

  const parsed = parseSummary(summary);
  const items = parsedToItems(parsed);
  const rendered = itemsToLineItemsBlock(items);
  const reparsed = parseSummary(rendered);
  const validation = validateConversionTotals(parsed);

  const sanitised = sanitiseSummary(summary, businessNames);

  return {
    auditId: auditId(row.id),
    status: row.status,
    isSent: row.sent_at !== null,
    // Anything the customer could already have seen: sent, done, or invoiced.
    isCustomerVisible:
      row.sent_at !== null ||
      row.status === "sent" ||
      row.status === "done" ||
      row.payment_status !== null,
    classification,
    validation,
    reparsedRowCount: reparsed.lineItems.length,
    reparsedSubtotal: computeTotals(reparsed.lineItems, parsed.taxRate).subtotal,
    sanitised,
    residualPii: residualPiiFindings(sanitised),
  };
}

function pct(n: number, total: number): string {
  return total === 0 ? "0.0%" : `${((n / total) * 100).toFixed(1)}%`;
}

function tally<T extends string>(values: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

async function main(): Promise<number> {
  const exportFixtures = process.argv.includes("--export");

  if (process.env.AUDIT_CONFIRM_READONLY !== "yes") {
    console.log("DRY RUN. Production was NOT contacted.");
    console.log("This script performs SELECT queries only and blocks all write methods.");
    console.log("To run for real: AUDIT_CONFIRM_READONLY=yes node <compiled>/scripts/audit-estimate-summary-formats.js [--export]");
    return 0;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("UNSAFE CONFIGURATION: Supabase URL or service role key missing.");
    return 2;
  }

  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? "unknown";
  console.log(`Supabase project ref: ${ref}`);
  console.log("Mode: READ-ONLY. Write methods are blocked by proxy.\n");

  const raw: SupabaseClient = createClient(url, key);
  const db = readOnly(raw);

  // Prove the guard is live before touching any data.
  try {
    (db as unknown as { rpc: () => void }).rpc();
    console.error("SAFETY CHECK FAILED: a write method was reachable. Aborting.");
    return 2;
  } catch (err) {
    if (!(err instanceof ReadOnlyViolation)) {
      console.error("SAFETY CHECK FAILED: unexpected error from guard.", err);
      return 2;
    }
    console.log("Safety check passed: write methods throw ReadOnlyViolation.\n");
  }

  // Business names are fetched ONLY to build an in-memory redaction list.
  // No other business field is read, and this list is never written out.
  const { data: businesses, error: bizErr } = await db
    .from("tpe_businesses")
    .select("name");
  if (bizErr) {
    console.error("Query failed (businesses):", bizErr.message);
    return 2;
  }
  const businessNames = (businesses ?? [])
    .map((b: { name: string | null }) => b.name ?? "")
    .filter(Boolean);
  console.log(`Redaction list built from ${businessNames.length} business names (not persisted).`);

  // Narrow column selection. No customer name, email, phone, or address.
  const pageSize = 200;
  const rows: EstimateRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("tpe_estimates")
      .select("id, created_at, updated_at, status, sent_at, payment_status, invoice_amount, summary")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      console.error("Query failed (estimates):", error.message);
      return 2;
    }
    const page = (data ?? []) as EstimateRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  console.log(`Fetched ${rows.length} estimates.\n`);

  const records: AuditRecord[] = [];
  for (const row of rows) {
    try {
      records.push(auditOne(row, businessNames));
    } catch (err) {
      // An unhandled parse failure is itself an audit result, and a blocking one.
      console.error(`UNHANDLED failure on estimate ${auditId(row.id)}:`, err);
      return 3;
    }
  }

  // ── Aggregates ──
  const total = records.length;
  const passing = records.filter((r) => r.validation.ok);
  const failing = records.filter((r) => !r.validation.ok);
  const sent = records.filter((r) => r.isCustomerVisible);

  console.log("=== STATUS DISTRIBUTION ===");
  for (const [k, v] of Object.entries(tally(records.map((r) => r.status))))
    console.log(`  ${k}: ${v} (${pct(v, total)})`);
  console.log(`  customer-visible (sent/done/invoiced): ${sent.length} (${pct(sent.length, total)})`);

  console.log("\n=== PRIMARY FORMAT DISTRIBUTION ===");
  for (const [k, v] of Object.entries(tally(records.map((r) => r.classification.primaryFormat))))
    console.log(`  ${k}: ${v} (${pct(v, total)})`);

  console.log("\n=== DETECTED PROBLEMS (estimates may have several) ===");
  const problemTally = tally(records.flatMap((r) => r.classification.problems));
  if (Object.keys(problemTally).length === 0) console.log("  none");
  for (const [k, v] of Object.entries(problemTally)) console.log(`  ${k}: ${v} (${pct(v, total)})`);

  const currencyShapes = records.flatMap((r) => r.classification.currencySamples);
  if (currencyShapes.length > 0) {
    console.log("  invalid-currency cell SHAPES (digits to 9, letters to X):");
    for (const [k, v] of Object.entries(tally(currencyShapes))) console.log(`    ${JSON.stringify(k)} x${v}`);
  }

  const multiOption = records.filter((r) => r.classification.primaryFormat === "multi-option-sections");
  if (multiOption.length > 0) {
    console.log(`\n  multi-option estimates: ${multiOption.length}`);
    for (const r of multiOption)
      console.log(
        `    ${r.auditId}: ${r.classification.lineItemsHeadingCount} Line Items headings, status=${r.status}, customerVisible=${r.isCustomerVisible}`
      );
  }

  console.log("\n=== CONVERSION INVARIANT ===");
  console.log(`  total:   ${total}`);
  console.log(`  passing: ${passing.length} (${pct(passing.length, total)})`);
  console.log(`  failing: ${failing.length} (${pct(failing.length, total)})`);

  const subtotalMismatch = records.filter((r) => r.validation.subtotalDifference !== 0);
  const taxMismatch = records.filter((r) => r.validation.taxDifference !== 0);
  const totalMismatch = records.filter((r) => r.validation.grandTotalDifference !== 0);
  const byteMismatch = records.filter((r) => !r.validation.lineItemBlockByteIdentical);
  const rowCountMismatch = records.filter((r) => r.validation.itemCount !== r.reparsedRowCount);

  console.log(`  subtotal mismatches:    ${subtotalMismatch.length}`);
  console.log(`  tax mismatches:         ${taxMismatch.length}`);
  console.log(`  grand total mismatches: ${totalMismatch.length}`);
  console.log(`  block not byte-identical: ${byteMismatch.length}`);
  console.log(`  row count changed on reparse: ${rowCountMismatch.length}`);

  const maxSub = Math.max(0, ...records.map((r) => Math.abs(r.validation.subtotalDifference)));
  const maxTot = Math.max(0, ...records.map((r) => Math.abs(r.validation.grandTotalDifference)));
  console.log(`  max |subtotal difference|:    ${maxSub}`);
  console.log(`  max |grand total difference|: ${maxTot}`);

  console.log("\n=== SENT / CUSTOMER-VISIBLE BREAKDOWN ===");
  console.log(`  customer-visible passing: ${sent.filter((r) => r.validation.ok).length}`);
  console.log(`  customer-visible failing: ${sent.filter((r) => !r.validation.ok).length}`);
  const mutable = records.filter((r) => !r.isCustomerVisible);
  console.log(`  unsent/draft passing:     ${mutable.filter((r) => r.validation.ok).length}`);
  console.log(`  unsent/draft failing:     ${mutable.filter((r) => !r.validation.ok).length}`);

  console.log("\n=== MIGRATION ELIGIBILITY (lazy, unsent only, must pass) ===");
  const eligible = records.filter((r) => r.validation.ok && !r.isCustomerVisible);
  const blockedSent = records.filter((r) => r.validation.ok && r.isCustomerVisible);
  const manual = failing;
  console.log(`  eligible for lazy migration: ${eligible.length} (${pct(eligible.length, total)})`);
  console.log(`  blocked, customer-visible:   ${blockedSent.length} (${pct(blockedSent.length, total)})`);
  console.log(`  requiring manual review:     ${manual.length} (${pct(manual.length, total)})`);

  console.log("\n=== ABORT REASON TALLY ===");
  const reasonTally = tally(
    failing.flatMap((r) => r.validation.malformedRows.map((m) => m.reason as string))
  );
  if (Object.keys(reasonTally).length === 0) console.log("  none");
  for (const [k, v] of Object.entries(reasonTally)) console.log(`  ${k}: ${v}`);
  const structuralTally = tally(failing.flatMap((r) => r.validation.unsupportedStructures));
  for (const [k, v] of Object.entries(structuralTally)) console.log(`  [structure] ${k}: ${v}`);

  console.log("\n=== RESIDUAL PII SCAN (post-sanitisation) ===");
  const withPii = records.filter((r) => r.residualPii.length > 0);
  console.log(`  records with residual findings: ${withPii.length}`);
  for (const [k, v] of Object.entries(tally(records.flatMap((r) => r.residualPii))))
    console.log(`  ${k}: ${v}`);

  if (!exportFixtures) {
    console.log("\nAggregate mode complete. No files written. Re-run with --export to write fixtures.");
    return 0;
  }

  // ── Export ──
  // One representative per unique shape, not every duplicate estimate.
  const seen = new Set<string>();
  const selected: AuditRecord[] = [];
  for (const r of records) {
    const shape = [
      r.classification.primaryFormat,
      [...r.classification.problems].sort().join("+"),
      r.validation.ok ? "pass" : "fail",
      r.isCustomerVisible ? "visible" : "mutable",
      r.classification.columnCount ?? "n",
    ].join("|");
    if (seen.has(shape)) continue;
    seen.add(shape);
    selected.push(r);
  }

  const blocked = selected.filter((r) => r.residualPii.length > 0);
  if (blocked.length > 0) {
    console.error(
      `\nEXPORT REFUSED: ${blocked.length} selected fixtures still contain possible personal information.`
    );
    return 4;
  }

  const body = selected
    .map((r, i) => {
      const id = `prod-${String(i + 1).padStart(2, "0")}-${r.classification.primaryFormat}`;
      const expectFailure = r.validation.ok
        ? ""
        : `\n    expectFailureContaining: ${JSON.stringify(
            r.validation.malformedRows[0]?.reason ??
              r.validation.unsupportedStructures[0] ??
              "abort"
          )},`;
      return `  {
    name: ${JSON.stringify(id)},
    describes: ${JSON.stringify(
      `Production shape: ${r.classification.primaryFormat}${
        r.classification.problems.length ? `, problems: ${r.classification.problems.join(", ")}` : ""
      } (${r.isCustomerVisible ? "customer-visible" : "mutable"})`
    )},
    kind: ${JSON.stringify(r.validation.ok ? "valid" : "negative")},${expectFailure}
    expect: { itemCount: ${r.validation.itemCount} },
    summary: ${JSON.stringify(r.sanitised)},
  },`;
    })
    .join("\n");

  const file = `/**
 * SANITISED production estimate summaries, exported by
 * scripts/audit-estimate-summary-formats.ts on ${new Date().toISOString().slice(0, 10)}.
 *
 * DO NOT EDIT BY HAND. Regenerate with the audit script.
 *
 * Every value here has been through sanitiseSummary(): business names, emails,
 * phone numbers, URLs, postal codes, and street addresses are replaced with
 * deterministic placeholders. No production id appears; fixture names are local
 * sequence numbers. No customer names, contact details, or addresses were
 * fetched from the database in the first place.
 *
 * One representative per unique shape, not every stored estimate.
 */
import type { EstimateFixture } from "./index";

export const productionFixtures: EstimateFixture[] = [
${body}
];
`;

  const outPath = "tests/fixtures/estimate-summaries/production-sanitised.ts";
  writeFileSync(outPath, file, "utf8");
  console.log(`\nWrote ${selected.length} sanitised fixtures to ${outPath}`);
  console.log("No production row was read for write, and nothing was modified.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("Audit failed:", err);
    process.exit(1);
  });
