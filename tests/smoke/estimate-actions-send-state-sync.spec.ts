import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import {
  PRICING_CHANGE_EVENT,
  readPricingComplete,
  shouldShowStickyActionBar,
} from "../../app/components/estimate-actions";

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

// ── The sticky bar's own show/hide decision, also real behaviour ───────────

test("the sticky Send bar is absent while an undelivered contractor_pricing draft is incomplete, and appears the instant the save response says it is complete", () => {
  // Same real EventTarget/CustomEvent dispatch as above, now carried all the
  // way through to the actual render decision (shouldShowStickyActionBar),
  // for the one state this fix targets: a plain draft, not a website-quote
  // conversion, not done, not already sent.
  const draftState = { isQuoteRequest: false, isDone: false, localStatus: "" };
  let liveComplete = false;
  const target = new EventTarget();
  target.addEventListener(PRICING_CHANGE_EVENT, (e) => {
    liveComplete = readPricingComplete(e);
  });

  // 1. Incomplete at page load: no fixed Send overlay to render at all.
  expect(shouldShowStickyActionBar({ ...draftState, sendBlocked: !liveComplete })).toBe(false);

  // 4. The exact save-success dispatch flips it on immediately -- no
  // navigation, no reload, just the same in-process callback as above.
  target.dispatchEvent(new CustomEvent(PRICING_CHANGE_EVENT, { detail: { complete: true } }));
  expect(shouldShowStickyActionBar({ ...draftState, sendBlocked: !liveComplete })).toBe(true);

  // 5. Editing back to incomplete and saving again removes it.
  target.dispatchEvent(new CustomEvent(PRICING_CHANGE_EVENT, { detail: { complete: false } }));
  expect(shouldShowStickyActionBar({ ...draftState, sendBlocked: !liveComplete })).toBe(false);
});

test("shouldShowStickyActionBar still shows the bar for every other state regardless of sendBlocked", () => {
  // isDone, already-sent, and a website-quote conversion are all either not
  // contractor_pricing or already delivered (which requires having already
  // passed the completeness gate this fix hides the bar for), so hiding the
  // bar for the incomplete-draft case cannot hide an action any of these
  // need. sendBlocked: true here is deliberately the "would otherwise hide
  // it" value, to prove these branches override that.
  expect(
    shouldShowStickyActionBar({ isQuoteRequest: true, isDone: false, localStatus: "", sendBlocked: true })
  ).toBe(true);
  expect(
    shouldShowStickyActionBar({ isQuoteRequest: false, isDone: true, localStatus: "", sendBlocked: true })
  ).toBe(true);
  expect(
    shouldShowStickyActionBar({ isQuoteRequest: false, isDone: false, localStatus: "sent", sendBlocked: true })
  ).toBe(true);
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

test("EstimateActions wires the proven handler to React state and to the sticky bar's own show/hide decision, with no second completeness definition", () => {
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

  // The sticky bar's presence is gated by the proven function (computed once
  // and reused, not re-called at the render site -- see
  // estimate-action-bar-safe-area-spacing.spec.ts for that), and the button
  // inside it (reached only when the bar renders at all) still carries the
  // same disabled attribute as a defensive second check.
  expect(actions).toContain(
    "const showStickyActionBar = shouldShowStickyActionBar({ isQuoteRequest, isDone, localStatus, sendBlocked });"
  );
  expect(actions).toContain("{showStickyActionBar && (");
  expect(actions).toContain("disabled={sendBlocked}");

  // The duplicate warning this fix removes is gone, not just unreachable.
  expect(actions).not.toContain("Add pricing to your line items before sending.");
});

test("the missing-inputs guidance is not duplicated: it exists exactly once, inline with the pricing editor", () => {
  const actions = code("app/components/estimate-actions.tsx");
  const editor = code("app/components/contractor-pricing-editor.tsx");

  // The exact rendered string (with its trailing colon), not a comment
  // mentioning it -- estimate-actions.tsx's own comment above the render
  // gate quotes this phrase for context, which is not a duplicate render.
  expect(actions).not.toContain("Still needed before you can send this:");
  expect(editor).toContain("Still needed before you can send this:");

  // Inline with the editor's own scrollable content, not inside any fixed
  // element -- the editor renders no `position: fixed` bar of its own
  // (checked as a className pattern, not the bare word: "fixed price" is
  // ordinary labour-method copy elsewhere in this same file).
  expect(editor).not.toMatch(/className="[^"]*\bfixed\b/);
});

test("the estimate detail page computes estimateComplete from the gated contractorPricing, not a total guess", () => {
  const page = code("app/estimates/[id]/page.tsx");

  const totalIndex = page.indexOf("const estimateTotal = contractorDocument");
  const completeIndex = page.indexOf("const estimateComplete = contractorPricing");
  expect(totalIndex).toBeGreaterThan(-1);
  expect(completeIndex).toBeGreaterThan(totalIndex);
  expect(page).toContain("const estimateComplete = contractorPricing ? contractorPricing.complete : estimateTotal > 0;");
  expect(page).toContain("estimateComplete={estimateComplete}");

  // Pre-push follow-up (post-350b248): estimateComplete now deliberately
  // reads contractorPricing.complete, not contractorDocument.ready --
  // contractorPricing is additionally passed through withReconstructionGate
  // (lib/contractor-pricing-form.ts), which contractorDocument's own
  // independent calculateContractorPricing call inside
  // contractorCustomerDocument() has no knowledge of. Both read the
  // identical rows and snapshots and agree in every case except a malformed
  // 'ea' pairing, where contractorPricing.complete is correctly false and
  // contractorDocument.ready is not.
  expect(page).toContain("const contractorPricing = isContractorPricing\n    ? withReconstructionGate(");
  expect(page).not.toContain("const estimateComplete = contractorDocument ? contractorDocument.ready : estimateTotal > 0;");

  // Still not recomputed from `.missing` directly at this call site.
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
  // For a legacy estimate contractorPricing is null (set together with
  // contractorDocument, both exactly when isContractorPricing), so the
  // ternary's false branch -- estimateTotal > 0 -- is exactly the same
  // check EstimateActions used to compute inline as isZeroTotal.
  expect(page).toContain("contractorPricing ? contractorPricing.complete : estimateTotal > 0");
});
