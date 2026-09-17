import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { PRICING_CHANGE_EVENT, readPricingComplete } from "../../app/components/estimate-actions";

/**
 * Phase 1 slice 5C: the isZeroTotal/estimate-total-change staleness
 * (specs/contractor-owned-pricing.md implementation note 4, HANDOFF.md's
 * 2026-09-17 slice 5B entry).
 *
 * ContractorPricingEditor and EstimateActions are siblings on
 * app/estimates/[id]/page.tsx, not parent/child, so a save in one cannot
 * reach the other through props -- only through the window event the
 * (now-retired) legacy editor originally used. After the pricing rewrite
 * nothing dispatched that event any more, so a saved estimate's Send button
 * stayed disabled until a full page reload.
 *
 * No browser, no jsdom, no live account (this repo's Supabase project is
 * production; see HANDOFF.md), and no new dependency: Node's own
 * EventTarget/CustomEvent (available natively, no DOM required) is enough to
 * exercise the actual value-extraction function EstimateActions registers,
 * imported here directly rather than re-typed as a string pattern. That
 * function is deliberately hook-free -- calling the real component would
 * throw ("invalid hook call") outside of React's render context, but
 * readPricingComplete() has no hook in it, so it runs as plain code. The
 * useState/useEffect wiring around it (which does need React) is verified as
 * source, the same convention already used throughout tests/smoke/ for
 * client-component wiring (estimate-resending.spec.ts,
 * generation-contractor-pricing.spec.ts) -- but the actual bug here, whether
 * a dispatched event really changes what the send-gating value would be, is
 * proven as real behaviour below, not by grep.
 */

const root = path.join(__dirname, "../..");
const code = (file: string) => readFileSync(path.join(root, file), "utf8");

// ── Genuine runtime behaviour, no source matching ───────────────────────────

test("dispatching the real estimate-total-change event actually flips the send-gating value, both directions, ignoring any total", () => {
  // Mirrors exactly what EstimateActions' useEffect wires up (same event
  // name, same handler function, imported for real -- not re-implemented
  // here), minus React itself: a real EventTarget standing in for `window`,
  // a real CustomEvent, dispatched exactly the way ContractorPricingEditor's
  // save() dispatches it.
  let liveComplete = false; // 1. Starts blocked: mirrors useState(estimateComplete ?? false) when the page loaded with an incomplete estimate.
  const target = new EventTarget();
  function handlePricingChange(e: Event) {
    liveComplete = readPricingComplete(e);
  }
  target.addEventListener(PRICING_CHANGE_EVENT, handlePricingChange);

  expect(!liveComplete).toBe(true); // sendBlocked = !liveComplete: blocked at start.

  // 2. The exact save-success dispatch from contractor-pricing-editor.tsx:
  // enables Send, synchronously, with no navigation or reload involved --
  // this is a plain in-process event dispatch and callback, nothing else.
  target.dispatchEvent(new CustomEvent(PRICING_CHANGE_EVENT, { detail: { complete: true } }));
  expect(!liveComplete).toBe(false);

  // 3. Editing back to incomplete and saving again blocks it once more.
  target.dispatchEvent(new CustomEvent(PRICING_CHANGE_EVENT, { detail: { complete: false } }));
  expect(!liveComplete).toBe(true);

  // 4. No total-based recomputation: a total on the same detail object,
  // however it disagrees with `complete`, never changes the outcome --
  // readPricingComplete() reads nothing but `.complete`.
  target.dispatchEvent(new CustomEvent(PRICING_CHANGE_EVENT, { detail: { complete: true, total: 0 } }));
  expect(liveComplete).toBe(true);
  target.dispatchEvent(new CustomEvent(PRICING_CHANGE_EVENT, { detail: { complete: false, total: 999 } }));
  expect(liveComplete).toBe(false);
});

// ── Source-level wiring: connects the proven function above to React state
// and to the JSX Send button, which cannot be exercised without a DOM ------

test("ContractorPricingEditor dispatches the shared event and the server's own completeness, never a recomputed one", () => {
  const editor = code("app/components/contractor-pricing-editor.tsx");

  expect(editor).toContain('import { PRICING_CHANGE_EVENT } from "@/app/components/estimate-actions";');
  const dispatchIndex = editor.indexOf("new CustomEvent(PRICING_CHANGE_EVENT");
  expect(dispatchIndex).toBeGreaterThan(-1);

  // The dispatched detail is read straight off the PUT /pricing response
  // this exact save just received (data.pricing), not derived from form
  // state, not a second total>0 guess.
  expect(editor).toContain("detail: { complete: data.pricing.complete }");

  // Dispatched only on the success path, after the response is known to
  // carry a pricing object (the same `if (!response.ok || !data.pricing)`
  // guard above already throws otherwise).
  const successGuardIndex = editor.indexOf("if (!response.ok || !data.pricing) {");
  expect(successGuardIndex).toBeGreaterThan(-1);
  expect(dispatchIndex).toBeGreaterThan(successGuardIndex);
});

test("EstimateActions wires the proven handler to React state and to the Send button, with no second completeness definition", () => {
  const actions = code("app/components/estimate-actions.tsx");

  expect(actions).toContain("const [liveComplete, setLiveComplete] = useState(estimateComplete ?? false);");
  expect(actions).toContain("setLiveComplete(readPricingComplete(e));");
  expect(actions).toContain(`window.addEventListener(PRICING_CHANGE_EVENT, handlePricingChange);`);
  expect(actions).toContain("const sendBlocked = !liveComplete;");

  // The old heuristic, and the total-mirroring state it depended on, are
  // both gone rather than left running dead alongside the new signal.
  expect(actions).not.toContain("isZeroTotal");
  expect(actions).not.toContain("liveTotal");
  expect(actions).not.toMatch(/detail\.total/);

  // Send button visibility/disabled state is driven by the one flag.
  expect(actions).toContain("{sendBlocked && (");
  expect(actions).toContain("disabled={sendBlocked}");
});

test("the estimate detail page computes estimateComplete from the same authority the share page uses, not a total guess", () => {
  const page = code("app/estimates/[id]/page.tsx");

  const totalIndex = page.indexOf("const estimateTotal = contractorDocument");
  const completeIndex = page.indexOf("const estimateComplete = contractorDocument");
  expect(totalIndex).toBeGreaterThan(-1);
  expect(completeIndex).toBeGreaterThan(totalIndex);
  expect(page).toContain("const estimateComplete = contractorDocument ? contractorDocument.ready : estimateTotal > 0;");
  expect(page).toContain("estimateComplete={estimateComplete}");

  // contractorDocument.ready is itself sourced from
  // calculateContractorPricing's `complete` (lib/customer-pricing.ts's
  // toCustomerPricing: `ready: pricing.complete && ...`), not recomputed
  // here -- this page never imports calculateContractorPricing's `missing`
  // or `complete` fields directly for this purpose.
  expect(page).not.toMatch(/estimateComplete[^;]*\.missing/);
});

test("the estimateTotal>0 fallback in estimateComplete is unreachable for a contractor_pricing estimate", () => {
  const page = code("app/estimates/[id]/page.tsx");

  // contractorDocument is null only when !isContractorPricing: every
  // contractor_pricing estimate gets a real (possibly ready:false) object
  // back from contractorCustomerDocument(), never null, so the ternary's
  // false branch can only ever run for legacy/website_quote_intake.
  expect(page).toContain(
    "const contractorDocument = isContractorPricing\n    ? contractorCustomerDocument(estimate, contractorRows, estimateCurrency)\n    : null;"
  );

  const doc = code("lib/customer-pricing.ts");
  // ContractorCustomerDocument's own type: both arms are objects, neither is
  // null/undefined, so `contractorDocument` is truthy whenever it is not
  // literally the `: null` above.
  expect(doc).toContain("| { ready: true; document: string; totalCents: number }");
  expect(doc).toContain("| { ready: false; missing: PricingGap[] };");
  expect(doc).not.toMatch(/ContractorCustomerDocument\s*=\s*[^|]*\|\s*null/);
});

test("legacy's send-gating is unchanged: still total > 0, no completeness concept introduced for it", () => {
  const page = code("app/estimates/[id]/page.tsx");
  // For a legacy estimate contractorDocument is null, so the ternary's
  // false branch -- estimateTotal > 0 -- is exactly the same check
  // EstimateActions used to compute inline as isZeroTotal.
  expect(page).toContain("contractorDocument ? contractorDocument.ready : estimateTotal > 0");
});
