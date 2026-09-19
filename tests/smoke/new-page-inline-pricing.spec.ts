import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";

/**
 * Same-page pricing on /new (specs/contractor-owned-pricing.md's Phase 1
 * work, extended after the production phone check found a black route-
 * transition flash tapping Add Pricing on Android Chrome, then corrected
 * again after discovering the first version initialized the editor from
 * current business Rates instead of the estimate's own authoritative
 * pricing). Add Pricing no longer navigates on the healthy path at all:
 * ContractorPricingEditor -- the exact same component the detail page uses,
 * not a second implementation -- renders directly on /new once GET
 * /api/estimates/{id}/pricing (the estimate's own persisted state, not the
 * business's current Rates) has loaded for the estimate just generated.
 *
 * Pure source-text coverage, the same convention this suite already uses
 * for /new (see generation-contractor-pricing.spec.ts's header comment):
 * the component itself cannot be rendered in a spec here. This proves the
 * wiring in source, not the rendered/scrolled result on a real device --
 * the black-flash fix, the scroll behaviour, and the stale-request race
 * protection can only be confirmed by a production phone check or careful
 * manual reasoning, not by a test in this suite.
 */

const root = path.join(__dirname, "../..");
const code = (file: string) => readFileSync(path.join(root, file), "utf8");

test("the healthy Add Pricing path never navigates; #pricing exists only in the GET-failure fallbacks", () => {
  const newPage = code("app/new/page.tsx");

  // Two #pricing occurrences (the inline card's error box and the sticky
  // bar's error branch), and each must sit inside error-state JSX, not the
  // loading/ready-state actions.
  const matches = [...newPage.matchAll(/#pricing/g)];
  expect(matches.length).toBe(2);

  for (const match of matches) {
    const idx = match.index!;
    const before = newPage.slice(Math.max(0, idx - 1200), idx);
    expect(before).toContain('pricingLoadState === "error"');
  }
});

test("/new renders the existing ContractorPricingEditor, not a second pricing implementation", () => {
  const newPage = code("app/new/page.tsx");

  expect(newPage).toContain('import { ContractorPricingEditor } from "@/app/components/contractor-pricing-editor";');
  expect(newPage).toContain("<ContractorPricingEditor");

  // Gated on the estimate being saved and the authoritative fetch having
  // actually succeeded -- never an empty/partially initialized editor
  // while generation is running or the fetch is still in flight or failed.
  expect(newPage).toContain('const pricingReady = saved && savedEstimateId && !generating && !error && pricingLoadState === "ready" && pricingInit;');
  expect(newPage).toContain("{pricingReady && pricingInit && (");

  // No local reimplementation of the pricing pipeline: /new performs no
  // arithmetic of its own at all now -- calculateContractorPricing() only
  // ever runs server-side, inside the shared GET/PUT route, and its result
  // is used as-is.
  expect(newPage).not.toContain("calculateContractorPricing");
  expect(newPage).not.toMatch(/subtotalCents\s*=\s*[^;]*[+*]/);
});

test("the /new editor instance uses the estimate's own authoritative delivered state and is keyed to the estimate id", () => {
  const newPage = code("app/new/page.tsx");

  expect(newPage).toContain("isDelivered={pricingInit.isDelivered}");
  expect(newPage).toContain("initialRows={pricingInit.initialRows}");
  expect(newPage).toContain("initialPricing={pricingInit.initialPricing}");
  // Structural reset for a second/different generated estimate: a fresh key
  // forces React to fully remount the editor rather than reusing state.
  expect(newPage).toContain("key={savedEstimateId}");
});

test("authoritative pricing-init data comes from the estimate's own GET route, not the business's current Rates", () => {
  const newPage = code("app/new/page.tsx");

  // Phase 2 slice 4: the base URL is unchanged, only extended with an
  // optional jobText query param when the contractor's own job text is
  // available in session.
  expect(newPage).toContain("fetch(pricingInitUrl)");
  expect(newPage).toContain("`/api/estimates/${savedEstimateId}/pricing`");
  expect(newPage).toContain("`/api/estimates/${savedEstimateId}/pricing?jobText=");
  // The earlier, corrected mistake: /new must never call /api/price-book
  // (current business Rates) to initialize this editor.
  expect(newPage).not.toContain("/api/price-book");

  const pricingRoute = code("app/api/estimates/[id]/pricing/route.ts");
  expect(pricingRoute).toContain("export async function GET(");
  // Ownership-first, via the same pure orchestrator estimate-pricing-init.ts
  // tests directly: no arithmetic or ownership check duplicated in the
  // route itself.
  expect(pricingRoute).toContain('import { loadEstimatePricingInit } from "@/lib/estimate-pricing-init";');
  expect(pricingRoute).toContain("const result = await loadEstimatePricingInit(id, business.id, {");
  expect(pricingRoute).toContain("loadRows: loadContractorPricingRows,");
  expect(pricingRoute).toContain('.eq("business_id", businessId)');
});

test("the estimate_currency addition to /api/price-book was reverted", () => {
  const priceBook = code("app/api/price-book/route.ts");
  expect(priceBook).not.toContain("estimate_currency");
  expect(priceBook).not.toContain("currencyOrDefault");
});

test("the authoritative fetch runs once per estimate id (and on an explicit retry), not on every pricing-input change", () => {
  const newPage = code("app/new/page.tsx");

  const effectStart = newPage.indexOf("fetch(pricingInitUrl)");
  const depsIndex = newPage.indexOf("}, [savedEstimateId, pricingRetryToken]);", effectStart);
  expect(effectStart).toBeGreaterThan(-1);
  expect(depsIndex).toBeGreaterThan(effectStart);

  // Retry re-runs the exact same effect via a token bump, not a second
  // fetch implementation.
  expect(newPage).toContain("function retryPricingInit() {");
  expect(newPage).toContain("setPricingRetryToken((t) => t + 1);");
});

test("stale-response protection: a cancelled flag prevents an old estimate's response from overwriting a newer one", () => {
  const newPage = code("app/new/page.tsx");

  const effectStart = newPage.indexOf("let cancelled = false;");
  expect(effectStart).toBeGreaterThan(-1);
  const effectEnd = newPage.indexOf("}, [savedEstimateId, pricingRetryToken]);");
  const effectBody = newPage.slice(effectStart, effectEnd);

  expect(effectBody).toContain("if (cancelled) return;");
  expect(effectBody).toContain("cancelled = true;");
  // This is source evidence the guard exists, not proof it actually wins a
  // real A-then-B race in a running browser -- this repo has no component
  // harness that can drive two overlapping async effects and observe which
  // one applies. That is unverified by any automated test here.
});

test("pricingComplete initializes from the persisted GET response, and updates again only via the reused PRICING_CHANGE_EVENT authority", () => {
  const newPage = code("app/new/page.tsx");

  // Initialized from the fetch itself -- an existing/regenerated estimate
  // that was already saved complete must show Continue to Send immediately,
  // not wait for another Save.
  expect(newPage).toContain("setPricingComplete(d.pricing.complete);");

  expect(newPage).toContain(
    'import { PRICING_CHANGE_EVENT, readPricingComplete } from "@/app/components/estimate-actions";'
  );
  expect(newPage).toContain("setPricingComplete(readPricingComplete(e));");
  expect(newPage).toContain("window.addEventListener(PRICING_CHANGE_EVENT, handlePricingChange);");

  // No second completeness definition: /new never reads a draft/preview
  // pricing object's own .missing/.complete to decide Continue to Send.
  expect(newPage).not.toContain("preview.complete");
  expect(newPage).not.toContain("preview.missing");
});

test("pricingComplete and the authoritative fetch both reset whenever a genuinely new estimate replaces the current one", () => {
  const newPage = code("app/new/page.tsx");

  // The generate flow: only for a real new id, never a regenerate (which
  // keeps the same id and must not disturb its pricing).
  const resetBlockMatch = newPage.match(
    /if \(!regenerateId\) \{\s*setSavedEstimateId\(null\);[\s\S]*?setPricingComplete\(false\);\s*\}/
  );
  expect(resetBlockMatch, "pricingComplete resets alongside savedEstimateId for a new (non-regenerate) estimate").not.toBeNull();

  // The fetch effect itself keys on savedEstimateId, so setting it to null
  // (above) already clears the previous estimate's loaded state/error via
  // the effect's own early-return branch.
  expect(newPage).toContain("if (!savedEstimateId) {");
  expect(newPage).toContain('setPricingLoadState("idle");');
  expect(newPage).toContain("setPricingInit(null);");

  // Starting an entirely new job from BottomNav's New button.
  const handleNewEstimateStart = newPage.indexOf("function handleNewEstimate() {");
  const handleNewEstimateEnd = newPage.indexOf("clearPhotos();", handleNewEstimateStart);
  expect(handleNewEstimateStart).toBeGreaterThan(-1);
  const handleNewEstimateBody = newPage.slice(handleNewEstimateStart, handleNewEstimateEnd);
  expect(handleNewEstimateBody).toContain("setSavedEstimateId(null);");
  expect(handleNewEstimateBody).toContain("setPricingComplete(false);");
});

test("Add Pricing smoothly scrolls to the existing #pricing element on this same page, once ready, honouring reduced motion", () => {
  const newPage = code("app/new/page.tsx");

  const fnStart = newPage.indexOf("function scrollToPricing() {");
  expect(fnStart).toBeGreaterThan(-1);
  const fnEnd = newPage.indexOf("});", newPage.indexOf("scrollIntoView", fnStart)) + "});".length;
  const fn = newPage.slice(fnStart, fnEnd);

  expect(fn).toContain('window.matchMedia("(prefers-reduced-motion: reduce)").matches');
  expect(fn).toContain("document.getElementById(\"pricing\")?.scrollIntoView({");
  expect(fn).toContain('behavior: prefersReducedMotion ? "auto" : "smooth",');
  expect(fn).toContain('block: "start",');
});

test("the detail page's own #pricing mount/hash fallback (ec57bcb) remains instant, untouched by the same-page smooth scroll", () => {
  const editor = code("app/components/contractor-pricing-editor.tsx");

  const fnStart = editor.indexOf("shouldScrollToPricing(window.location.hash)");
  const scrollCallStart = editor.indexOf("scrollIntoView", fnStart);
  const scrollCallEnd = editor.indexOf(");", scrollCallStart) + ");".length;
  const scrollCall = editor.slice(scrollCallStart, scrollCallEnd);

  expect(scrollCall).toBe('scrollIntoView({ block: "start" });');
  expect(scrollCall).not.toContain("smooth");
  expect(scrollCall).not.toContain("prefers-reduced-motion");
});

test("the sticky primary action has exactly six mutually exclusive states, never two at once", () => {
  const newPage = code("app/new/page.tsx");

  const stickyBarStart = newPage.indexOf("{!saved || !savedEstimateId ? (");
  const stickyBarEnd = newPage.indexOf("<BottomNav onNewClick={onNewEstimate} />", stickyBarStart);
  expect(stickyBarStart).toBeGreaterThan(-1);
  expect(stickyBarEnd).toBeGreaterThan(stickyBarStart);
  const stickyBar = newPage.slice(stickyBarStart, stickyBarEnd);

  // Not saved / no id yet -> disabled.
  expect(stickyBar).toContain('!saved || !savedEstimateId ? (');
  // Loading -> disabled, explicit copy.
  expect(stickyBar).toContain('pricingLoadState === "loading" ? (');
  expect(stickyBar).toContain("Loading pricing...");
  // Failed -> the one exceptional route-transition fallback.
  expect(stickyBar).toContain('pricingLoadState === "error" ? (');
  expect(stickyBar).toContain("href={`/estimates/${savedEstimateId}#pricing`}");
  // Legacy or delivered -> a plain View Estimate link, no pricing action.
  expect(stickyBar).toContain('pricingLoadState === "legacy" || pricingLoadState === "delivered" ? (');
  expect(stickyBar).toContain("View Estimate");
  // Complete -> Continue to Send, to the plain detail-page URL, no hash.
  expect(stickyBar).toContain("pricingComplete ? (");
  expect(stickyBar).toContain("Continue to Send");
  expect(stickyBar).toContain("href={`/estimates/${savedEstimateId}`}");
  // Otherwise (ready, incomplete) -> same-page scroll.
  expect(stickyBar).toContain("onClick={scrollToPricing}");

  // Exactly six ternary branch points chaining the six mutually exclusive
  // states together as one single expression, never two independent
  // conditions that could both render at once.
  expect(stickyBar).toContain('{!saved || !savedEstimateId ? (');
  expect(stickyBar).toContain(') : pricingLoadState === "loading" ? (');
  expect(stickyBar).toContain(') : pricingLoadState === "error" ? (');
  expect(stickyBar).toContain(') : pricingLoadState === "legacy" || pricingLoadState === "delivered" ? (');
  expect(stickyBar).toContain(") : pricingComplete ? (");
  expect(stickyBar).toContain(") : (");
});

test("Send itself is not on /new: no send-sheet, send-sms, send-email, or Send button wiring was reintroduced", () => {
  const newPage = code("app/new/page.tsx");
  expect(newPage).not.toContain("Send Estimate");
  expect(newPage).not.toContain("SendEstimateSheet");
  expect(newPage).not.toContain("send-sms");
  expect(newPage).not.toContain("send-email");
});

test("the detail-page editor, its PUT route, and the ec57bcb hash-scroll fallback are untouched", () => {
  const editor = code("app/components/contractor-pricing-editor.tsx");
  expect(editor).toContain("shouldScrollToPricing(window.location.hash)");
  expect(editor).toContain('<div id="pricing" ref={pricingRef} className="mb-4 flex flex-col gap-6 scroll-mt-6">');

  const pricingRoute = code("app/api/estimates/[id]/pricing/route.ts");
  expect(pricingRoute).toContain("export async function PUT(");
  expect(pricingRoute).toContain('"tpe_save_contractor_pricing"');
});

// ── Legacy (read-only) and delivered (defensive) handling on /new ───────────

test("a legacy estimate's distinct 409/ESTIMATE_READ_ONLY response is never collapsed into the generic transient-failure state", () => {
  const newPage = code("app/new/page.tsx");

  expect(newPage).toContain('if (res.status === 409) {');
  expect(newPage).toContain('if (body?.code === "ESTIMATE_READ_ONLY") return { kind: "legacy" as const };');
  expect(newPage).toContain('setPricingLoadState("legacy");');
});

test("legacy state renders no editor and no Retry -- only an explanation and a plain link to the detail page", () => {
  const newPage = code("app/new/page.tsx");

  const legacyStart = newPage.indexOf('pricingLoadState === "legacy" && (');
  const legacyEnd = newPage.indexOf('pricingLoadState === "delivered" && (', legacyStart);
  expect(legacyStart).toBeGreaterThan(-1);
  expect(legacyEnd).toBeGreaterThan(legacyStart);
  const legacyBlock = newPage.slice(legacyStart, legacyEnd);

  expect(legacyBlock).toContain("previous pricing system");
  expect(legacyBlock).toContain("href={`/estimates/${savedEstimateId}`}");
  expect(legacyBlock).not.toContain("onRetryPricingInit");
  expect(legacyBlock).not.toContain("ContractorPricingEditor");
  expect(legacyBlock).not.toContain("#pricing");
});

test("a delivered estimate is never mounted into the editor and isDelivered is never hardcoded false to force it", () => {
  const newPage = code("app/new/page.tsx");

  // Defensive: the generate/regenerate route already refuses a delivered
  // estimate, so this branch should be unreachable in normal use, but the
  // authoritative value is still trusted, never overridden.
  expect(newPage).toContain("if (est.isDelivered) {");
  expect(newPage).toContain('setPricingLoadState("delivered");');
  // The editor only ever mounts after this branch has already returned, so
  // the literal `false` passed to it is reached code, not a hardcoded
  // override of a real `true`.
  const deliveredCheckIndex = newPage.indexOf("if (est.isDelivered) {");
  const editorPropIndex = newPage.indexOf("isDelivered: false,");
  expect(editorPropIndex).toBeGreaterThan(deliveredCheckIndex);

  const deliveredStart = newPage.indexOf('pricingLoadState === "delivered" && (');
  const deliveredEnd = newPage.indexOf("{pricingReady && pricingInit && (", deliveredStart);
  expect(deliveredStart).toBeGreaterThan(-1);
  expect(deliveredEnd).toBeGreaterThan(deliveredStart);
  const deliveredBlock = newPage.slice(deliveredStart, deliveredEnd);

  expect(deliveredBlock).toContain("already gone to the customer");
  expect(deliveredBlock).toContain("href={`/estimates/${savedEstimateId}`}");
  expect(deliveredBlock).not.toContain("onRetryPricingInit");
  expect(deliveredBlock).not.toContain("ContractorPricingEditor");
});

test("the sticky bar treats legacy and delivered identically: a plain View Estimate link, never Add Pricing or Continue to Send", () => {
  const newPage = code("app/new/page.tsx");

  expect(newPage).toContain('pricingLoadState === "legacy" || pricingLoadState === "delivered" ? (');
  const branchStart = newPage.indexOf('pricingLoadState === "legacy" || pricingLoadState === "delivered" ? (');
  const branchEnd = newPage.indexOf(") : pricingComplete ? (", branchStart);
  expect(branchEnd).toBeGreaterThan(branchStart);
  const branch = newPage.slice(branchStart, branchEnd);

  expect(branch).toContain("View Estimate");
  expect(branch).toContain("href={`/estimates/${savedEstimateId}`}");
  expect(branch).not.toContain("Add Pricing");
  expect(branch).not.toContain("Continue to Send");
});

// ── Pre-push audit fixes (Phase 2 slice 4, post-0229e5a) ────────────────────

test("the suggestion match source is the contractor's typed jobDescription only, never photoAnalysis", () => {
  const newPage = code("app/new/page.tsx");

  // generationJobText is set from jobDescription alone -- not the
  // description || photoAnalysis fallback the generation request itself
  // still legitimately uses for its own, unrelated purpose.
  expect(newPage).toContain("setGenerationJobText(jobDescription.trim());");
  expect(newPage).not.toContain("setGenerationJobText(description);");

  // The generation request itself is untouched: it still legitimately
  // falls back to photoAnalysis for photo-only input.
  expect(newPage).toContain("const description = jobDescription.trim() || photoAnalysis;");
});

test("jobText is capped client-side at 1000 characters before it enters the query string", () => {
  const newPage = code("app/new/page.tsx");

  expect(newPage).toContain("const MATCH_JOB_TEXT_MAX_LENGTH = 1000;");
  // The exact truncation point: matchJobText is built by slicing
  // generationJobText to the cap, and pricingInitUrl is built from
  // matchJobText, never from the uncapped generationJobText directly.
  expect(newPage).toContain(
    "const matchJobText = generationJobText.trim().slice(0, MATCH_JOB_TEXT_MAX_LENGTH);"
  );
  expect(newPage).toContain("encodeURIComponent(matchJobText)");
  expect(newPage).not.toContain("encodeURIComponent(generationJobText.trim())");
});
