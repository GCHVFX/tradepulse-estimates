import { expect, test } from "@playwright/test";
import {
  ESTIMATE_NOT_FOUND_OR_DENIED,
  ESTIMATE_READ_ONLY_CODE,
  ESTIMATE_READ_ONLY_MESSAGE,
  loadEstimatePricingInit,
  type EstimatePricingInitDependencies,
  type OwnedEstimateForPricingInit,
  type PricingInitRow,
} from "../../lib/estimate-pricing-init";

/**
 * GET /api/estimates/[id]/pricing (the read /new's same-page pricing editor
 * initializes from) is a new production read surface exposing an estimate's
 * pricing rows, currency and tax/deposit snapshots.
 *
 * loadEstimatePricingInit() is the ownership-first pure orchestrator behind
 * it, in the same shape as lib/estimate-deletion.ts's deleteOwnedEstimate():
 * pure functions over injected dependencies, so the refusal ordering --
 * refuse before any pricing/currency/snapshot read runs -- is provable
 * without a database, a live account, or any production Stripe/Supabase
 * side effect.
 *
 * This replaces an earlier version of this coverage that signed up two real
 * throwaway production accounts to prove the same thing end to end. That
 * version's assertions and where each now lives:
 *   - "the owner can read their own estimate's pricing" (200, correct id,
 *     rows array, pricing.complete false for a fresh estimate) -> replaced
 *     by "A" below, proven deterministically instead of over a live fetch.
 *   - "a signed-in user from another business cannot read this estimate's
 *     pricing, and no pricing data leaks in the refusal" (404, exact error
 *     body, no rows/pricing/estimate/defaults keys) -> replaced by "B" and
 *     "C" below -- C is strictly stronger than the live version, since it
 *     proves the downstream row-loading dependency is never even called,
 *     not just that the response body happened to omit those keys.
 *   - "an unauthenticated request is refused before any ownership check
 *     runs" (401, exact error body) -> this is the route's own
 *     `if (!user) return ... 401` check, the same trivial, already-
 *     established auth pattern (lib/supabase-server.ts's createApiClient +
 *     getUser()) every other route in this codebase uses identically, and
 *     sits entirely outside loadEstimatePricingInit() (which never sees an
 *     unauthenticated caller -- the route calls it only after auth
 *     succeeds). Not re-proven live here; a source assertion in this file's
 *     last test preserves that it still exists in the route, which is a
 *     downgrade from a live HTTP proof to a source check, not a silent drop.
 */

const OWNER_BUSINESS = "business-owner";
const ESTIMATE_ID = "estimate-123";

function completeContractorPricingEstimate(): OwnedEstimateForPricingInit {
  return {
    id: ESTIMATE_ID,
    pricing_source: "contractor_pricing",
    status: "draft",
    sent_at: null,
    copied_at: null,
    currency: "cad",
    tax_label_snapshot: "GST",
    tax_rate_snapshot: 5,
    deposit_percent_snapshot: 10,
    deposit_threshold_snapshot: 50,
  };
}

function completeRows(): PricingInitRow[] {
  return [
    { item_type: "labour", unit: null, quantity: 1, unit_price: 100, markup_percent: null, description: "Labour", display_order: 0, taxable: true },
    { item_type: "material", unit: null, quantity: 1, unit_price: 20, markup_percent: 25, description: "Materials", display_order: 1, taxable: true },
  ];
}

/**
 * Records every dependency call, so a refusal can be proven not to have
 * read anything downstream. findOwnedEstimate is scoped by businessId, the
 * same way the real .eq("business_id", businessId) filter is: a caller
 * whose businessId does not match the estimate's real owner gets null,
 * exactly like a cross-tenant Supabase query matching no row.
 */
function makeDeps(
  estimate: OwnedEstimateForPricingInit | null,
  rows: PricingInitRow[],
  ownerBusinessId: string = OWNER_BUSINESS
) {
  const calls: string[] = [];
  const deps: EstimatePricingInitDependencies = {
    async findOwnedEstimate(estimateId, businessId) {
      calls.push(`findOwnedEstimate:${estimateId}:${businessId}`);
      return estimate && estimate.id === estimateId && businessId === ownerBusinessId ? estimate : null;
    },
    async loadRows(estimateId) {
      calls.push(`loadRows:${estimateId}`);
      return rows;
    },
  };
  return { deps, calls };
}

test("A: the owner can read their own estimate's authoritative pricing state", async () => {
  const { deps } = makeDeps(completeContractorPricingEstimate(), completeRows());

  const result = await loadEstimatePricingInit(ESTIMATE_ID, OWNER_BUSINESS, deps);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.estimate.id).toBe(ESTIMATE_ID);
  expect(result.estimate.currency).toBe("cad");
  expect(result.estimate.isDelivered).toBe(false);
  expect(result.rows).toHaveLength(2);
  expect(result.pricing.complete).toBe(true);
  expect(result.pricing.totalCents).toBe(13125);
});

test("B: another business's estimate id is refused with the same not-found response PUT already uses", async () => {
  // findOwnedEstimate is scoped by businessId itself (matching the real
  // .eq("business_id", businessId) filter): a cross-tenant business id
  // simply never matches, exactly like a real cross-tenant Supabase query.
  const { deps } = makeDeps(completeContractorPricingEstimate(), completeRows());

  const result = await loadEstimatePricingInit(ESTIMATE_ID, "business-attacker", deps);

  expect(result).toEqual({ ok: false, status: 404, error: ESTIMATE_NOT_FOUND_OR_DENIED });
});

test("C: when ownership fails, no pricing/currency/snapshot read ever runs", async () => {
  const { deps, calls } = makeDeps(completeContractorPricingEstimate(), completeRows());

  await loadEstimatePricingInit(ESTIMATE_ID, "business-attacker", deps);

  expect(calls).toEqual([`findOwnedEstimate:${ESTIMATE_ID}:business-attacker`]);
  expect(calls.some((c) => c.startsWith("loadRows:"))).toBe(false);
});

test("D: a missing/nonexistent estimate id gets the identical refusal, not a distinct response", async () => {
  const { deps } = makeDeps(completeContractorPricingEstimate(), completeRows());

  const result = await loadEstimatePricingInit("estimate-does-not-exist", OWNER_BUSINESS, deps);

  expect(result).toEqual({ ok: false, status: 404, error: ESTIMATE_NOT_FOUND_OR_DENIED });
});

test("a legacy (non contractor_pricing) estimate is refused as read-only, distinctly from not-found, before its rows are read", async () => {
  const legacy: OwnedEstimateForPricingInit = { ...completeContractorPricingEstimate(), pricing_source: "markdown" };
  const { deps, calls } = makeDeps(legacy, completeRows());

  const result = await loadEstimatePricingInit(ESTIMATE_ID, OWNER_BUSINESS, deps);

  expect(result).toEqual({
    ok: false,
    status: 409,
    error: ESTIMATE_READ_ONLY_MESSAGE,
    code: ESTIMATE_READ_ONLY_CODE,
  });
  // Distinct from the not-found status, and no rows were ever loaded for an
  // estimate this editor cannot initialize from.
  expect(calls.some((c) => c.startsWith("loadRows:"))).toBe(false);
});

test("a fresh estimate with no persisted rows initializes empty and incomplete, using the estimate's own snapshots", async () => {
  const fresh = completeContractorPricingEstimate();
  const { deps } = makeDeps(fresh, []);

  const result = await loadEstimatePricingInit(ESTIMATE_ID, OWNER_BUSINESS, deps);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.rows).toEqual([]);
  expect(result.pricing.complete).toBe(false);
  expect(result.pricing.totalCents).toBe(0);
  // Still the estimate's own tax snapshot, not a business default guess.
  expect(result.estimate.taxRate).toBe(5);
});

test("a stored taxable = false row reaches the returned pricing calculation unchanged (Phase 2 slice 3B)", async () => {
  const rows: PricingInitRow[] = [
    { item_type: "labour", unit: null, quantity: 1, unit_price: 100, markup_percent: null, description: "Labour", display_order: 0, taxable: false },
    { item_type: "material", unit: null, quantity: 1, unit_price: 20, markup_percent: 25, description: "Materials", display_order: 1, taxable: true },
  ];
  const { deps } = makeDeps(completeContractorPricingEstimate(), rows);

  const result = await loadEstimatePricingInit(ESTIMATE_ID, OWNER_BUSINESS, deps);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // Subtotal: 100 (labour) + 25 (materials, 20 x 1.25) = 125. Only the
  // taxable materials row contributes: 5% of 25 = 1.25 -> 125 cents.
  expect(result.pricing.subtotalCents).toBe(12_500);
  expect(result.pricing.taxCents).toBe(125);
  expect(result.pricing.totalCents).toBe(12_625);
});

test("a delivered estimate is reported as delivered, not silently treated as undelivered", async () => {
  const delivered: OwnedEstimateForPricingInit = { ...completeContractorPricingEstimate(), sent_at: "2026-01-01T00:00:00Z" };
  const { deps } = makeDeps(delivered, completeRows());

  const result = await loadEstimatePricingInit(ESTIMATE_ID, OWNER_BUSINESS, deps);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.estimate.isDelivered).toBe(true);
});

test("E: the route passes the authenticated business id into the ownership-first helper, not the raw request", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const route = readFileSync(path.join(__dirname, "../../app/api/estimates/[id]/pricing/route.ts"), "utf8");

  expect(route).toContain("import { loadEstimatePricingInit } from \"@/lib/estimate-pricing-init\";");
  expect(route).toContain("const result = await loadEstimatePricingInit(id, business.id, {");
  // The unauthenticated case never reaches the helper at all -- preserved
  // here as a source check (see the file header comment above for why this
  // is a downgrade from the removed live test's HTTP-level proof, not a
  // silent drop).
  expect(route).toContain('if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));');
});

// ── Phase 2 slice 4: saved-item suggestions wired into this same read ──────
//
// Suggestion ranking itself is fully covered by pricebook-suggestions.spec.ts.
// These cases cover only the wiring: whether loadSuggestionCandidates runs at
// all, what it is called with, and that a suggestion failure/absence never
// blocks or changes the rest of this read.

function makeDepsWithSuggestions(
  estimate: OwnedEstimateForPricingInit | null,
  rows: PricingInitRow[],
  candidates: Array<{ id: string; name: string; description: string | null; category: string }>
) {
  const calls: string[] = [];
  const deps: EstimatePricingInitDependencies = {
    async findOwnedEstimate(estimateId, businessId) {
      calls.push(`findOwnedEstimate:${estimateId}:${businessId}`);
      return estimate && estimate.id === estimateId && businessId === OWNER_BUSINESS ? estimate : null;
    },
    async loadRows(estimateId) {
      calls.push(`loadRows:${estimateId}`);
      return rows;
    },
    async loadSuggestionCandidates(businessId) {
      calls.push(`loadSuggestionCandidates:${businessId}`);
      return candidates;
    },
  };
  return { deps, calls };
}

const SUGGESTION_CANDIDATES = [
  { id: "faucet", name: "Kitchen faucet replacement", description: "Replace kitchen faucet", category: "Faucets" },
];

test("F: blank or absent job text never calls loadSuggestionCandidates, and returns no suggestions", async () => {
  const { deps, calls } = makeDepsWithSuggestions(completeContractorPricingEstimate(), [], SUGGESTION_CANDIDATES);

  const withoutJobText = await loadEstimatePricingInit(ESTIMATE_ID, OWNER_BUSINESS, deps);
  expect(withoutJobText.ok).toBe(true);
  if (withoutJobText.ok) expect(withoutJobText.suggestions).toEqual([]);

  const withBlankJobText = await loadEstimatePricingInit(ESTIMATE_ID, OWNER_BUSINESS, deps, "   ");
  expect(withBlankJobText.ok).toBe(true);
  if (withBlankJobText.ok) expect(withBlankJobText.suggestions).toEqual([]);

  expect(calls.some((c) => c.startsWith("loadSuggestionCandidates:"))).toBe(false);
});

test("G: non-blank job text calls loadSuggestionCandidates exactly once, scoped to this business, and returns the matcher's ranking", async () => {
  const { deps, calls } = makeDepsWithSuggestions(completeContractorPricingEstimate(), [], SUGGESTION_CANDIDATES);

  const result = await loadEstimatePricingInit(
    ESTIMATE_ID,
    OWNER_BUSINESS,
    deps,
    "Replace the kitchen faucet, it is leaking"
  );

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.suggestions.map((s) => s.id)).toContain("faucet");
  expect(calls.filter((c) => c.startsWith("loadSuggestionCandidates:"))).toEqual([
    `loadSuggestionCandidates:${OWNER_BUSINESS}`,
  ]);
});

test("H: a business with no matching candidates gets an empty, non-error suggestions list", async () => {
  const { deps } = makeDepsWithSuggestions(completeContractorPricingEstimate(), [], []);

  const result = await loadEstimatePricingInit(ESTIMATE_ID, OWNER_BUSINESS, deps, "replace the kitchen faucet");

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.suggestions).toEqual([]);
});

test("I: an estimate refused for ownership or legacy reasons never calls loadSuggestionCandidates either", async () => {
  const { deps: deniedDeps, calls: deniedCalls } = makeDepsWithSuggestions(
    completeContractorPricingEstimate(),
    [],
    SUGGESTION_CANDIDATES
  );
  await loadEstimatePricingInit(ESTIMATE_ID, "business-attacker", deniedDeps, "kitchen faucet");
  expect(deniedCalls.some((c) => c.startsWith("loadSuggestionCandidates:"))).toBe(false);

  const legacy: OwnedEstimateForPricingInit = { ...completeContractorPricingEstimate(), pricing_source: "markdown" };
  const { deps: legacyDeps, calls: legacyCalls } = makeDepsWithSuggestions(legacy, [], SUGGESTION_CANDIDATES);
  await loadEstimatePricingInit(ESTIMATE_ID, OWNER_BUSINESS, legacyDeps, "kitchen faucet");
  expect(legacyCalls.some((c) => c.startsWith("loadSuggestionCandidates:"))).toBe(false);
});

test("J: the deployed route queries no money field and filters to active = true when loading suggestion candidates", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const route = readFileSync(path.join(__dirname, "../../app/api/estimates/[id]/pricing/route.ts"), "utf8");

  const fnStart = route.indexOf("async loadSuggestionCandidates(businessId) {");
  expect(fnStart).toBeGreaterThan(-1);
  const fnEnd = route.indexOf("},", fnStart);
  const fn = route.slice(fnStart, fnEnd);

  // The select() call itself carries no money or taxability field -- the
  // structural guarantee, checked on the call, not on the surrounding
  // comment prose (which legitimately names those fields to explain why).
  const selectMatch = fn.match(/\.select\("([^"]*)"\)/);
  expect(selectMatch, "the candidates query selects explicit columns").not.toBeNull();
  expect(selectMatch![1]).toBe("id, name, description, category");
  expect(fn).toContain('.eq("business_id", businessId)');
  expect(fn).toContain('.eq("active", true)');

  // The response actually carries the suggestions this wiring produced.
  expect(route).toContain("suggestions: result.suggestions,");
  // jobText is read from the query string, capped defensively, and never
  // required.
  expect(route).toContain('searchParams.get("jobText")');
});
