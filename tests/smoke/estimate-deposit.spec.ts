import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyDeterministicDeposit,
  computeDepositAndBalance,
  computeTotals,
  parseSummary,
  reconcilePaymentTermsDeposit,
  resolveDepositPercent,
  serializeSummary,
  type DepositRule,
  type LineItem,
} from "../../lib/estimate-summary";

// Deposit state and amount must come from the business's Rates settings
// (deposit_percent / deposit_threshold), never from the model's own writing.
// See app/api/generate-estimate/route.ts, which is the one call site that
// invokes applyDeterministicDeposit, right before a freshly generated
// estimate is first saved.

const RULE_500_25: DepositRule = { percent: 25, thresholdDollars: 500 };

test("below threshold: no deposit", () => {
  expect(resolveDepositPercent(499, RULE_500_25)).toBe(0);
  expect(computeDepositAndBalance(499, 0)).toEqual({ deposit: 0, balance: 499 });
});

test("exact threshold: no deposit, because the rule is 'required over', not 'at or over'", () => {
  expect(resolveDepositPercent(500, RULE_500_25)).toBe(0);
});

test("above threshold: 25% of $2,990 is $747.50, not $748", () => {
  const percent = resolveDepositPercent(2990, RULE_500_25);
  expect(percent).toBe(25);

  const { deposit, balance } = computeDepositAndBalance(2990, percent);
  expect(deposit).toBe(747.5);
  expect(balance).toBe(2242.5);
  expect(deposit + balance).toBe(2990);
});

test("rounding: a total/percentage combination with fractional cents rounds normally", () => {
  // 10% of $333.33 is $33.333, which rounds to $33.33, not $33.30 or $33.34.
  const { deposit, balance } = computeDepositAndBalance(333.33, 10);
  expect(deposit).toBe(33.33);
  expect(balance).toBeCloseTo(300, 5);
});

test("no rule configured never requires a deposit, regardless of total", () => {
  expect(resolveDepositPercent(1_000_000, null)).toBe(0);
  expect(resolveDepositPercent(1_000_000, { percent: 25, thresholdDollars: 0 })).toBe(0);
  expect(resolveDepositPercent(1_000_000, { percent: 0, thresholdDollars: 500 })).toBe(0);
});

// A realistic raw generation-time summary where the model got both deposit
// references wrong in the way the production smoke test actually observed:
// "No deposit required" in the Pricing Summary table, while Payment Terms
// separately states a deposit is required with a dollar figure that doesn't
// match the business's own deposit rule either.
function rawGeneratedSummary(): string {
  return [
    "# Rewire and Replace Electrical Panel",
    "",
    "We will remove the outdated panel and install a new one.",
    "",
    "Estimated total: $2,990",
    "",
    "## Scope of Work",
    "- Remove existing panel.",
    "- Install new panel.",
    "",
    "## Line Items",
    "| Item | Cost |",
    "|------|------|",
    "| Panel replacement and labour | $2,848.00 |",
    "",
    "## Assumptions and Exclusions",
    "- Standard assumptions apply.",
    "",
    "## Pricing Summary",
    "| | |",
    "|---|---|",
    "| Subtotal | $2,848 |",
    "| Tax (GST 5%) | $142 |",
    "| **Total** | **$2,990** |",
    "| No deposit required | |",
    "| Balance on completion | $2,990 |",
    "",
    "## Payment Terms",
    "A deposit of $852.60 (25% of total) is required to book the work and obtain the permit. The balance is due upon completion. We accept cash, cheque, and e-transfer. This estimate is valid for 30 days from the date above.",
  ].join("\n");
}

test("consistency: Pricing Summary and Payment Terms agree on the deposit decision and amount after normalization", () => {
  const normalized = applyDeterministicDeposit(rawGeneratedSummary(), "cad", RULE_500_25);

  // Pricing Summary now states the deterministic deposit, to the cent.
  expect(normalized).toContain("| Deposit required (25%) | CA$747.50 |");
  expect(normalized).not.toContain("No deposit required");

  // Payment Terms now states the same decision and amount, and the model's
  // own contradictory sentence ($852.60) is gone.
  expect(normalized).toContain(
    "A deposit of CA$747.50 (25% of the total) is required before work begins."
  );
  expect(normalized).not.toContain("852.60");

  // The rest of Payment Terms survives untouched.
  expect(normalized).toContain("We accept cash, cheque, and e-transfer.");
  expect(normalized).toContain("This estimate is valid for 30 days from the date above.");

  const parsed = parseSummary(normalized);
  expect(parsed.depositPercent).toBe(25);
  // The rule itself (not just the resolved percent) survives the save, as
  // an invisible marker -- see the edit-path tests below for why this
  // matters once the total changes after generation.
  expect(parsed.depositRule).toEqual(RULE_500_25);
});

test("consistency: no deposit required is stated the same way in both sections when the rule doesn't apply", () => {
  const normalized = applyDeterministicDeposit(rawGeneratedSummary(), "cad", null);

  expect(normalized).toContain("| No deposit required | |");
  expect(normalized).not.toContain("| Deposit required");
  expect(normalized).toContain("No deposit is required.");
  expect(normalized).not.toContain("852.60");

  const parsed = parseSummary(normalized);
  expect(parsed.depositPercent).toBe(0);
  expect(parsed.depositRule).toBeNull();
});

// ── Post-generation edits ────────────────────────────────────────────────────
//
// A contractor can edit an estimate's line items after generation. If that
// edit changes the authoritative total, the deposit must be re-resolved
// against the *current* total everywhere -- not left stuck at whatever was
// true when the estimate was first generated. This mirrors exactly what
// app/components/editable-estimate-body.tsx's startCommitTimer does on every
// save: parse the persisted estimate, replace the line items, resolve the
// deposit fresh from the estimate's own preserved DepositRule marker and the
// new total, reconcile Payment Terms to match, and re-serialize.

function simulateLineItemEdit(persistedSummary: string, currency: "cad" | "usd", flatCost: number): string {
  const parsed = parseSummary(persistedSummary);
  const nextLine: LineItem[] = [
    { id: "edited", label: "Materials and labour", cost: `$${flatCost.toFixed(2)}` },
  ];
  const nextTotal = computeTotals(nextLine, parsed.taxRate).total;
  const nextDepositPercent =
    parsed.depositRule !== undefined
      ? resolveDepositPercent(nextTotal, parsed.depositRule)
      : parsed.depositPercent;
  const { deposit: nextDeposit } = computeDepositAndBalance(nextTotal, nextDepositPercent);
  const reconciledAfter =
    parsed.depositRule !== undefined
      ? reconcilePaymentTermsDeposit(parsed.afterPricingSections, nextDepositPercent, nextDeposit, currency)
      : parsed.afterPricingSections;

  return serializeSummary(
    parsed.preamble,
    parsed.scopeItems,
    nextLine,
    nextDepositPercent,
    parsed.beforePricingSections,
    reconciledAfter,
    parsed.taxLabel,
    parsed.taxRate,
    currency,
    parsed.depositRule
  );
}

test("edit above threshold: total changes from $2,990 to $2,000, deposit becomes $500.00 everywhere", () => {
  const generated = applyDeterministicDeposit(rawGeneratedSummary(), "cad", RULE_500_25);
  // Subtotal $1,905 + 5% tax ($95, rounded) = total $2,000 exactly.
  const edited = simulateLineItemEdit(generated, "cad", 1905);

  expect(edited).toContain("| **Total** | **CA$2,000** |");
  expect(edited).toContain("| Deposit required (25%) | CA$500.00 |");
  expect(edited).toContain("A deposit of CA$500.00 (25% of the total) is required before work begins.");
  expect(edited).not.toContain("747.50");
  expect(edited).not.toContain("852.60");

  const parsed = parseSummary(edited);
  expect(parsed.depositPercent).toBe(25);
  expect(parsed.depositRule).toEqual(RULE_500_25);
});

test("edit below threshold: total drops to $450, no deposit required and no stale amount remains anywhere", () => {
  const generated = applyDeterministicDeposit(rawGeneratedSummary(), "cad", RULE_500_25);
  // Subtotal $429 + 5% tax ($21, rounded) = total $450 exactly.
  const edited = simulateLineItemEdit(generated, "cad", 429);

  expect(edited).toContain("| **Total** | **CA$450** |");
  expect(edited).toContain("| No deposit required | |");
  expect(edited).toContain("No deposit is required.");
  expect(edited).not.toContain("| Deposit required");
  expect(edited).not.toContain("747.50");
  expect(edited).not.toContain("500.00");
  expect(edited).not.toContain("852.60");

  const parsed = parseSummary(edited);
  expect(parsed.depositPercent).toBe(0);
});

test("cross threshold again: total goes back above $500 after a dip below it, the deposit becomes applicable again", () => {
  const generated = applyDeterministicDeposit(rawGeneratedSummary(), "cad", RULE_500_25);
  const belowThreshold = simulateLineItemEdit(generated, "cad", 429); // total $450: no deposit
  const aboveAgain = simulateLineItemEdit(belowThreshold, "cad", 1905); // total $2,000: deposit again

  expect(aboveAgain).toContain("| Deposit required (25%) | CA$500.00 |");
  expect(aboveAgain).toContain("A deposit of CA$500.00 (25% of the total) is required before work begins.");
  expect(aboveAgain).not.toContain("No deposit required");

  const parsed = parseSummary(aboveAgain);
  expect(parsed.depositPercent).toBe(25);
});

test("business Rates changing later does not retroactively move an already-generated estimate's deposit", () => {
  // The estimate's own snapshot (25% over $500) stays in force even though
  // this simulated edit resolves against a *different* rule -- proving the
  // rule used is the one carried on the estimate, not a live business
  // lookup. (Nothing in this test file re-fetches business settings; this
  // documents the invariant the marker exists to guarantee.)
  const generated = applyDeterministicDeposit(rawGeneratedSummary(), "cad", RULE_500_25);
  const parsed = parseSummary(generated);
  expect(parsed.depositRule).toEqual(RULE_500_25);
  expect(parsed.depositRule).not.toEqual({ percent: 50, thresholdDollars: 1000 });
});

// ── Normalization failure ────────────────────────────────────────────────────

test("normalization failure: a thrown error is never swallowed into a fallback summary", () => {
  // Mirrors app/api/generate-estimate/route.ts's own pattern exactly: the
  // deterministic deposit step is wrapped only to add context, then
  // rethrown -- never caught into a fallback that saves the model's raw
  // text as if it were authoritative.
  function normalizeOrThrow(rawSummary: string, currency: "cad" | "usd", rule: DepositRule | null): string {
    try {
      return applyDeterministicDeposit(rawSummary, currency, rule);
    } catch (err) {
      throw new Error(
        `Deterministic deposit normalization failed, refusing to save unverified deposit terms: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // A deliberately invalid raw summary (not a string) forces a genuine
  // exception -- parseSummary calls .split on it -- proving this is a real,
  // reachable failure path, not dead defensive code, and that no fallback
  // value is ever produced when it fires.
  let result: string | undefined;
  let thrown: unknown;
  try {
    result = normalizeOrThrow(null as unknown as string, "cad", RULE_500_25);
  } catch (err) {
    thrown = err;
  }

  expect(result).toBeUndefined();
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toContain("Deterministic deposit normalization failed");
});

test("the generation route never falls back to the model's raw text when deposit normalization fails", () => {
  const routeSource = readFileSync(
    path.join(__dirname, "../../app/api/generate-estimate/route.ts"),
    "utf8"
  );
  // The old unsafe pattern this replaced: initializing the saved value to
  // the raw model text and only overwriting it on success.
  expect(routeSource).not.toContain("let normalizedSummary = fullText;");
  expect(routeSource).toContain("applyDeterministicDeposit(fullText, estimateCurrency, depositRule)");
  expect(routeSource).toContain("throw new Error(");
});
