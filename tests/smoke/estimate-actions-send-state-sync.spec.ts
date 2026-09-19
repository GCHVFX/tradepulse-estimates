import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import {
  PRICING_CHANGE_EVENT,
  readPricingComplete,
  shouldShowStickyActionBar,
} from "../../app/components/estimate-actions";
import {
  formSnapshot,
  hasUnsavedPricingChanges,
  initContractorPricingEditorState,
  isPricingSendReady,
  removeConfirmedItem,
  toPricingRequestPayload,
  updateConfirmedItem,
  withReconstructionGate,
  type ContractorPricingFormState,
  type ContractorPricingRowInput,
} from "../../lib/contractor-pricing-form";
import { parseContractorPricingRequest, toCanonicalRows } from "../../lib/contractor-pricing-request";
import { calculateContractorPricing } from "../../lib/contractor-pricing";
import { isDelivered } from "../../lib/estimate-delivery";

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

/** The draft exactly as the pricing route would accept and store it. */
function parseSavedPayload(form: ContractorPricingFormState) {
  const parsed = parseContractorPricingRequest(JSON.parse(JSON.stringify(toPricingRequestPayload(form))));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

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

/**
 * The /estimates/[id] draft lifecycle, driven through the real functions on
 * both sides of the server/client boundary:
 *
 * - ContractorPricingEditor: initContractorPricingEditorState,
 *   hasUnsavedPricingChanges, isPricingSendReady, and its readiness publisher
 *   (dispatch PRICING_CHANGE_EVENT {complete: sendReady} whenever sendReady
 *   changes, not on mount).
 * - ContractorPricingDraftEditor: Save Pricing bar while the reported
 *   sendReady is false.
 * - EstimateActions: liveComplete seeded from the page's estimateComplete,
 *   updated by readPricingComplete from that event, and its sticky bar
 *   decision shouldShowStickyActionBar. That bar is the only place Send (and
 *   so Copy Link, SMS and email, which live in the sheet it opens) is
 *   reachable for an undelivered draft.
 *
 * Simulated: only React itself (state commits and effects) and `window`,
 * which a real EventTarget stands in for. No DOM, no network, no database.
 */
function detailPageDraft(rows: ContractorPricingRowInput[]) {
  const snapshots = { taxRatePercent: 5, depositPercent: null, depositThresholdDollars: null };
  const seed = withReconstructionGate(calculateContractorPricing(rows, snapshots), rows).complete;

  // EstimateActions
  let liveComplete = seed;
  const target = new EventTarget();
  target.addEventListener(PRICING_CHANGE_EVENT, (e) => {
    liveComplete = readPricingComplete(e);
  });

  // ContractorPricingEditor
  const initial = initContractorPricingEditorState(rows, { label: "GST", rate: 5 }, { labourRate: 95, markupPercent: 20 });
  let form = initial.form;
  let savedSnapshot = initial.savedSnapshot;
  let status: "idle" | "saving" | "saved" | "error" = "idle";
  let persistedComplete = seed;
  const sendReady = () =>
    isPricingSendReady({ status, isDirty: hasUnsavedPricingChanges(form, savedSnapshot), persistedComplete });
  let published = sendReady();
  function commit() {
    const ready = sendReady();
    if (ready === published) return;
    published = ready;
    target.dispatchEvent(new CustomEvent(PRICING_CHANGE_EVENT, { detail: { complete: ready } }));
  }

  return {
    get form() {
      return form;
    },
    edit(next: ContractorPricingFormState) {
      form = next;
      commit();
    },
    /** save(): status "saving", and the draft as sent. */
    startSave(): ContractorPricingFormState {
      status = "saving";
      commit();
      return form;
    },
    /** The PUT /pricing response for `sent`, computed the way the route does. */
    finishSave(sent: ContractorPricingFormState, ok: boolean) {
      if (ok) {
        persistedComplete = calculateContractorPricing(toCanonicalRows(parseSavedPayload(sent)), snapshots).complete;
        savedSnapshot = formSnapshot(sent);
        status = "saved";
      } else {
        status = "error";
      }
      commit();
    },
    screen() {
      const draftSaveBar = !sendReady(); // ContractorPricingDraftEditor
      const sendBar = shouldShowStickyActionBar({
        isQuoteRequest: false,
        isDone: false,
        localStatus: "draft",
        sendBlocked: !liveComplete,
      });
      return { draftSaveBar, sendBar, saving: status === "saving" };
    },
  };
}

const completeGeneric: ContractorPricingRowInput[] = [
  { item_type: "labour", unit: null, quantity: 1, unit_price: 400, markup_percent: null, description: "Labour", display_order: 0, taxable: true },
  { item_type: "material", unit: null, quantity: 1, unit_price: 100, markup_percent: 20, description: "Materials", display_order: 1, taxable: true },
];

test("detail page draft: exactly one primary action at every step -- Send when clean and complete, Save Pricing when dirty, saving, incomplete or failed", () => {
  const page = detailPageDraft(completeGeneric);

  // 1. Reopened clean + complete: Send, no Save bar.
  expect(page.screen()).toEqual({ draftSaveBar: false, sendBar: true, saving: false });

  // 2. First substantive edit: Save Pricing, Send (and every delivery path behind it) gone.
  page.edit({ ...page.form, fixedAmount: "450" });
  expect(page.screen()).toEqual({ draftSaveBar: true, sendBar: false, saving: false });

  // Saving: still Save Pricing (disabled, "Saving..."), still no Send.
  const sent = page.startSave();
  expect(page.screen()).toEqual({ draftSaveBar: true, sendBar: false, saving: true });

  // 3. Successful complete save: Send again, Save bar gone.
  page.finishSave(sent, true);
  expect(page.screen()).toEqual({ draftSaveBar: false, sendBar: true, saving: false });

  // 4. Successful incomplete save: Save Pricing.
  page.edit({ ...page.form, materialsCost: "" });
  const incomplete = page.startSave();
  page.finishSave(incomplete, true);
  expect(page.screen()).toEqual({ draftSaveBar: true, sendBar: false, saving: false });

  // 5. Failed save: Save Pricing, no Send.
  page.edit({ ...page.form, materialsCost: "100" });
  const failed = page.startSave();
  page.finishSave(failed, false);
  expect(page.screen()).toEqual({ draftSaveBar: true, sendBar: false, saving: false });

  // ...and a retry that succeeds complete restores Send.
  const retry = page.startSave();
  page.finishSave(retry, true);
  expect(page.screen()).toEqual({ draftSaveBar: false, sendBar: true, saving: false });
});

test("detail page draft: a clean but incomplete draft opens on Save Pricing, never Send", () => {
  const page = detailPageDraft([]);
  expect(page.screen()).toEqual({ draftSaveBar: true, sendBar: false, saving: false });
});

test("detail page draft: an edit typed while a save is in flight keeps Send hidden after that save succeeds", () => {
  // The race the old save()-time dispatch of data.pricing.complete lost: it
  // re-enabled Send although the screen held edits the server never saw.
  const page = detailPageDraft(completeGeneric);
  page.edit({ ...page.form, fixedAmount: "450" });
  const sent = page.startSave();
  page.edit({ ...page.form, fixedAmount: "500" }); // typed during the save
  page.finishSave(sent, true);
  expect(page.screen()).toEqual({ draftSaveBar: true, sendBar: false, saving: false });
});

test("detail page draft: editing back to exactly the persisted values restores Send, so the page is never left with no primary action", () => {
  const page = detailPageDraft(completeGeneric);
  const original = page.form;
  page.edit({ ...original, fixedAmount: "450" });
  expect(page.screen().sendBar).toBe(false);
  page.edit(original);
  expect(page.screen()).toEqual({ draftSaveBar: false, sendBar: true, saving: false });
});

test("detail page draft: a reopened saved-item estimate behaves the same (first edit hides Send, complete re-save restores it)", () => {
  const page = detailPageDraft([
    { item_type: "labour", unit: "ea", quantity: 1, unit_price: 110, markup_percent: null, description: "Kitchen faucet replacement", display_order: 0, taxable: true },
    { item_type: "material", unit: "ea", quantity: 1, unit_price: 0, markup_percent: 0, description: "Kitchen faucet replacement", display_order: 1, taxable: true },
  ]);
  expect(page.screen().sendBar).toBe(true);
  page.edit(updateConfirmedItem(page.form, page.form.confirmedItems[0].id, "labourUnitPrice", "120"));
  expect(page.screen()).toEqual({ draftSaveBar: true, sendBar: false, saving: false });
  const sent = page.startSave();
  page.finishSave(sent, true);
  expect(page.screen()).toEqual({ draftSaveBar: false, sendBar: true, saving: false });
  page.edit(removeConfirmedItem(page.form, page.form.confirmedItems[0].id));
  expect(page.screen().sendBar).toBe(false);
});

test("delivery entry points: for an undelivered draft, every control that can reach PATCH /api/estimates delivery, send-sms or send-email sits inside the sticky bar that sendBlocked hides", () => {
  const actions = code("app/components/estimate-actions.tsx");
  const barStart = actions.indexOf("{showStickyActionBar && (");
  const barEnd = actions.indexOf("<SendEstimateSheet", barStart);
  expect(barStart).toBeGreaterThan(-1);
  expect(barEnd).toBeGreaterThan(barStart);

  // Opening the send sheet (Copy Link -> PATCH /api/estimates, SMS ->
  // /api/send-sms, Email -> /api/send-email) happens only from inside the bar.
  const opens = [...actions.matchAll(/setShowSendSheet\(true\)|onClick=\{handleSendClick\}/g)].map((m) => m.index ?? -1);
  expect(opens.length).toBeGreaterThan(0);
  for (const index of opens) {
    if (actions.slice(index - 40, index).includes("function handleSendClick")) continue;
    expect(index).toBeGreaterThan(barStart);
    expect(index).toBeLessThan(barEnd);
  }
  // The sheet only opens on that state.
  expect(actions).toContain("isOpen={showSendSheet}");

  // Mark Job Done (PATCH status: "done", which the route treats as a
  // delivery) is also inside the bar, and only in its already-sent branch.
  const markDone = actions.indexOf("onClick={handleMarkDone}");
  expect(markDone).toBeGreaterThan(actions.indexOf(') : localStatus === "sent" ? (', barStart));
  expect(markDone).toBeLessThan(barEnd);

  // The draft branch of that bar does not render while sendBlocked.
  expect(shouldShowStickyActionBar({ isQuoteRequest: false, isDone: false, localStatus: "draft", sendBlocked: true })).toBe(false);
});

test("ContractorPricingDraftEditor: owns the editor ref, hides the inline Save, awaits the editor's own save(), and requests nothing through a window event", () => {
  const wrapper = code("app/components/contractor-pricing-draft-editor.tsx");
  expect(wrapper.startsWith('"use client";')).toBe(true);
  expect(wrapper).toContain("const editorRef = useRef<ContractorPricingEditorHandle>(null);");
  expect(wrapper).toContain("ref={editorRef}");
  expect(wrapper).toContain("hideInlineSaveButton");
  expect(wrapper).toContain("onStateChange={setEditorState}");
  expect(wrapper).toContain("await editorRef.current?.save();");
  expect(wrapper).toContain("const showSaveBar = editorState !== null && !editorState.sendReady;");
  expect(wrapper).toContain('{saving ? "Saving..." : "Save Pricing"}');
  // Only the editor's projection is stored; no parallel dirty/saving/error state.
  expect([...wrapper.matchAll(/useState</g)]).toHaveLength(1);
  // No save-request event of any kind.
  expect(wrapper).not.toContain("dispatchEvent");
  expect(wrapper).not.toContain("addEventListener");
  expect(wrapper).not.toMatch(/import[^;]*PRICING_CHANGE_EVENT/);
  expect(wrapper).not.toContain("new CustomEvent");

  const editor = code("app/components/contractor-pricing-editor.tsx");
  expect(editor).toContain("save: () => Promise<void>;");

  // Used only for an undelivered contractor_pricing draft.
  const page = code("app/estimates/[id]/page.tsx");
  expect([...page.matchAll(/<ContractorPricingDraftEditor/g)]).toHaveLength(1);
  const draftIndex = page.indexOf("<ContractorPricingDraftEditor");
  expect(page.lastIndexOf("{isDelivered(estimate) ? (", draftIndex)).toBeGreaterThan(page.lastIndexOf("isContractorPricing && contractorPricing ? (", draftIndex));
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

test("ContractorPricingEditor dispatches the shared event with its resolved sendReady, built from the server's own completeness, never a recomputed total", () => {
  const editor = code("app/components/contractor-pricing-editor.tsx");

  expect(editor).toContain('import { PRICING_CHANGE_EVENT } from "@/app/components/estimate-actions";');
  // One dispatch, carrying sendReady.
  expect([...editor.matchAll(/new CustomEvent\(PRICING_CHANGE_EVENT/g)]).toHaveLength(1);
  expect(editor).toContain("new CustomEvent(PRICING_CHANGE_EVENT, { detail: { complete: sendReady } })");
  // sendReady's persisted completeness is `pricing`, which only ever holds
  // the page's server-computed initialPricing or the PUT /pricing response
  // (setPricing(data.pricing), after the `if (!response.ok || !data.pricing)`
  // guard) -- never a total>0 guess.
  expect(editor).toContain("persistedComplete: pricing.complete");
  expect([...editor.matchAll(/setPricing\(/g)]).toHaveLength(1);
  expect(editor.indexOf("setPricing(data.pricing);")).toBeGreaterThan(editor.indexOf("if (!response.ok || !data.pricing) {"));
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

// ── First delivery from /estimates/[id] re-reads the page from the server ──
//
// After the first delivery, page.tsx must re-render from persisted state so
// the draft editor (and its Save Pricing bar) gives way to the delivered
// view. Copy Link calls router.refresh(); SMS and email already navigate with
// router.push(`/estimates/${id}?sent=1`), which re-renders the same page from
// the server. Source-level: the harness has no router or React renderer.

function sheetFunction(name: string): string {
  const sheet = code("app/components/send-estimate-sheet.tsx");
  const start = sheet.indexOf(`async function ${name}() {`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const end = sheet.indexOf("\n  }\n", start);
  return sheet.slice(start, end);
}

test("Copy Link: a successful first delivery refreshes the page once, after the PATCH succeeded and after the copy attempt", () => {
  const fn = sheetFunction("handleCopyLink");
  expect(fn).toContain("let deliveredNow = false;");
  expect([...fn.matchAll(/router\.refresh\(\)/g)]).toHaveLength(1);
  expect(fn).toContain("if (deliveredNow) router.refresh();");

  const refusal = fn.indexOf("if (!res.ok) {");
  const setDelivered = fn.indexOf("deliveredNow = true;");
  const firstDeliveryBranch = fn.indexOf("if (isFirstDelivery) {\n        onSent?.();");
  const clipboard = fn.indexOf("const copiedOk = await writeToClipboard(shareUrl);");
  const refresh = fn.indexOf("if (deliveredNow) router.refresh();");
  expect(refusal).toBeGreaterThan(-1);
  expect(firstDeliveryBranch).toBeGreaterThan(refusal);
  expect(setDelivered).toBeGreaterThan(firstDeliveryBranch);
  expect(clipboard).toBeGreaterThan(setDelivered);
  expect(refresh).toBeGreaterThan(clipboard);
  // A clipboard failure still refreshes: the delivery already happened.
  expect(refresh).toBeLessThan(fn.indexOf("if (!copiedOk) {"));
});

test("Copy Link: a failed delivery (network error or refused PATCH) returns before anything can mark it delivered or refresh", () => {
  const fn = sheetFunction("handleCopyLink");
  const setDelivered = fn.indexOf("deliveredNow = true;");
  const networkCatch = fn.indexOf("} catch {");
  const networkReturn = fn.indexOf("return;", networkCatch);
  const refusal = fn.indexOf("if (!res.ok) {");
  const refusalReturn = fn.indexOf("return;", refusal);
  expect(networkCatch).toBeGreaterThan(-1);
  expect(networkReturn).toBeLessThan(setDelivered);
  expect(refusalReturn).toBeLessThan(setDelivered);
  // A re-copy of an already-delivered estimate is not a first delivery.
  expect(fn).toContain('const isFirstDelivery = !currentStatus || currentStatus === "draft";');
});

for (const [name, route] of [
  ["handleSendSMS", "/api/send-sms"],
  ["handleSendEmail", "/api/send-email"],
] as const) {
  test(`${name}: only a successful ${route} response re-reads the page (router.push to ?sent=1); a failure throws first and never navigates`, () => {
    const fn = sheetFunction(name);
    expect(fn).toContain(`fetch("${route}", {`);
    const refusal = fn.indexOf("if (!res.ok) {");
    const throwIndex = fn.indexOf("throw new Error(", refusal);
    const push = fn.indexOf("router.push(`/estimates/${estimateId}?sent=1`);");
    const catchIndex = fn.indexOf("} catch (err) {");
    expect(refusal).toBeGreaterThan(-1);
    expect(throwIndex).toBeGreaterThan(refusal);
    expect(push).toBeGreaterThan(throwIndex);
    expect(push).toBeLessThan(catchIndex);
    expect(fn.slice(catchIndex)).not.toContain("router.");
    // No second re-read racing the navigation.
    expect(fn).not.toContain("router.refresh()");
  });
}

test("a page re-read never re-triggers a delivery: the three delivery handlers run only from their buttons, and the sheet has no effect that sends", () => {
  const sheet = code("app/components/send-estimate-sheet.tsx");
  for (const name of ["handleCopyLink", "handleSendSMS", "handleSendEmail"]) {
    const uses = [...sheet.matchAll(new RegExp(`\\b${name}\\b`, "g"))].length;
    expect(uses, `${name}: its definition plus exactly one onClick`).toBe(2);
    expect(sheet).toContain(`onClick={${name}}`);
  }
  // The sheet's only effects reset form fields and panels; none of them fetch.
  const effects = [...sheet.matchAll(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g)].map((m) => m[0]);
  expect(effects.length).toBeGreaterThan(0);
  for (const effect of effects) expect(effect).not.toContain("fetch(");
});

test("the delivery confirmation survives the re-read: the sheet and EstimateActions stay mounted through router.refresh() and a search-param-only router.push", () => {
  // The confirmation ("Copied!", the copy error, "Estimate sent") is the
  // sheet's own state. The sheet is rendered by EstimateActions outside its
  // sticky bar, so it stays mounted whichever bar branch shows.
  const actions = code("app/components/estimate-actions.tsx");
  const barStart = actions.indexOf("{showStickyActionBar && (");
  const sheetIndex = actions.indexOf("<SendEstimateSheet");
  const barClose = actions.lastIndexOf("      )}", sheetIndex);
  expect(sheetIndex).toBeGreaterThan(barClose);
  expect(barClose).toBeGreaterThan(barStart);

  // router.refresh() keeps the URL, so nothing is re-keyed. For SMS/email's
  // push to ?sent=1, this installed Next.js keys the page segment without
  // search params, so the same page instance (and its client state) is
  // reconciled with fresh server data rather than remounted. Pinned to the
  // framework source, so an upgrade that changes it fails here.
  const layoutRouter = readFileSync(
    path.join(root, "node_modules/next/dist/client/components/layout-router.js"),
    "utf8"
  );
  expect(layoutRouter).toContain("createRouterCacheKey)(activeSegment, true) // no search params");

  const sheet = code("app/components/send-estimate-sheet.tsx");
  expect(sheet).toContain('{copied ? "Copied!" : "Copy Link"}');
  expect(sheet).toContain("Estimate sent");
});

test("after a first delivery the draft Save Pricing bar cannot coexist with Resend: the persisted state the refresh reads is delivered, and page.tsx renders the draft editor only when undelivered", () => {
  // What each first-delivery route persists, read by the one delivery predicate.
  expect(isDelivered({ status: "sent", copied_at: "2026-09-18T00:00:00Z", sent_at: null })).toBe(true); // Copy Link
  expect(isDelivered({ status: "sent", copied_at: null, sent_at: "2026-09-18T00:00:00Z" })).toBe(true); // SMS / email
  expect(isDelivered({ status: "draft", copied_at: null, sent_at: null })).toBe(false);

  const page = code("app/estimates/[id]/page.tsx");
  const branch = page.indexOf("{isDelivered(estimate) ? (");
  const draftEditor = page.indexOf("<ContractorPricingDraftEditor");
  expect(branch).toBeGreaterThan(-1);
  expect(draftEditor).toBeGreaterThan(page.indexOf(") : (", branch));
  // The Save Pricing bar lives only inside ContractorPricingDraftEditor,
  // which that branch unmounts for a delivered estimate.
  expect(code("app/components/contractor-pricing-draft-editor.tsx")).toContain('{saving ? "Saving..." : "Save Pricing"}');
  expect(page).not.toContain('"use client"');
});
