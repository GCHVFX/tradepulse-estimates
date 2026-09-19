import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  PRICE_BOOK_ITEM_UNAVAILABLE,
  resolvePriceBookItem,
  type OwnedActivePriceBookItem,
  type ResolvePriceBookItemDependencies,
} from "../../lib/pricebook-suggestion-resolve";

/**
 * Phase 2 slice 4: the single-item resolve endpoint acceptance calls at the
 * moment a contractor taps a matcher suggestion (specs/contractor-owned-
 * pricing.md's "acceptance / resolution security boundary").
 *
 * resolvePriceBookItem() is the pure ownership-first orchestrator behind
 * GET /api/price-book-items/[id], in the same shape as
 * lib/estimate-pricing-init.ts's loadEstimatePricingInit(): the real
 * tenant/active filtering is the injected dependency's job (a real
 * `.eq("business_id", ...).eq("active", true)` query at the route), proven
 * here as a source check on the deployed route, not re-run against a live
 * database.
 */

const OWNER_BUSINESS = "business-owner";
const ITEM_ID = "item-123";

function activeOwnedItem(overrides: Partial<OwnedActivePriceBookItem> = {}): OwnedActivePriceBookItem {
  return {
    id: ITEM_ID,
    name: "Kitchen faucet replacement",
    labour_price: 325,
    material_price: 0,
    taxable: true,
    ...overrides,
  };
}

function makeDeps(item: OwnedActivePriceBookItem | null) {
  const calls: string[] = [];
  const deps: ResolvePriceBookItemDependencies = {
    async findActiveOwnedItem(itemId, businessId) {
      calls.push(`findActiveOwnedItem:${itemId}:${businessId}`);
      return item;
    },
  };
  return { deps, calls };
}

// ── 9: owned active item resolves to its current authoritative values ──────

test("9: an owned, active item returns its current labour, material and taxable values", async () => {
  const { deps } = makeDeps(activeOwnedItem({ labour_price: 145, material_price: 18, taxable: false }));

  const result = await resolvePriceBookItem(ITEM_ID, OWNER_BUSINESS, deps);

  expect(result).toEqual({
    ok: true,
    item: {
      id: ITEM_ID,
      description: "Kitchen faucet replacement",
      labourUnitPrice: 145,
      materialUnitPrice: 18,
      taxable: false,
    },
  });
});

// ── 7 & 8: a foreign-business or inactive item never resolves ──────────────

test("7 and 8: a foreign-business item and an inactive item both refuse identically, with no leaked distinction", async () => {
  // The dependency itself is where tenant/active filtering happens (a real
  // `.eq("business_id", businessId).eq("active", true)` at the route) --
  // both a foreign-business id and an inactive id return null from it, the
  // same as a typo'd id. This proves the orchestrator's own refusal: it
  // never distinguishes "foreign" from "inactive" from "missing".
  const { deps: foreignDeps } = makeDeps(null);
  const { deps: inactiveDeps } = makeDeps(null);
  const { deps: missingDeps } = makeDeps(null);

  const foreign = await resolvePriceBookItem(ITEM_ID, "business-attacker", foreignDeps);
  const inactive = await resolvePriceBookItem(ITEM_ID, OWNER_BUSINESS, inactiveDeps);
  const missing = await resolvePriceBookItem("item-does-not-exist", OWNER_BUSINESS, missingDeps);

  const refusal = { ok: false, status: 404, error: PRICE_BOOK_ITEM_UNAVAILABLE };
  expect(foreign).toEqual(refusal);
  expect(inactive).toEqual(refusal);
  expect(missing).toEqual(refusal);
});

// ── 10: no stale suggestion price can ever win ──────────────────────────────

test("10: the resolve result always reflects the dependency's current read, never anything cached from suggestion generation", async () => {
  // resolvePriceBookItem's own signature has no parameter through which a
  // suggestion's price could travel in -- this is a structural guarantee,
  // not a runtime check, but this test still proves the resolved output is
  // exactly and only whatever the dependency returns right now.
  const { deps: firstDeps } = makeDeps(activeOwnedItem({ labour_price: 100, material_price: 10 }));
  const firstResult = await resolvePriceBookItem(ITEM_ID, OWNER_BUSINESS, firstDeps);
  expect(firstResult.ok && firstResult.item.labourUnitPrice).toBe(100);

  // The price changed in the price book between suggestion display and tap.
  const { deps: secondDeps } = makeDeps(activeOwnedItem({ labour_price: 250, material_price: 40 }));
  const secondResult = await resolvePriceBookItem(ITEM_ID, OWNER_BUSINESS, secondDeps);
  expect(secondResult.ok && secondResult.item.labourUnitPrice).toBe(250);
  expect(secondResult.ok && secondResult.item.materialUnitPrice).toBe(40);
});

test("resolvePriceBookItem's own type structurally cannot accept a suggestion or a price as input", () => {
  const source = readFileSync("lib/pricebook-suggestion-resolve.ts", "utf8");
  const signatureStart = source.indexOf("export async function resolvePriceBookItem(");
  const signatureEnd = source.indexOf(")", signatureStart) + 1;
  const signature = source.slice(signatureStart, signatureEnd);

  expect(signature).toContain("itemId: string");
  expect(signature).toContain("businessId: string");
  expect(signature).toContain("deps: ResolvePriceBookItemDependencies");
  // No fourth parameter through which a client-supplied price could arrive.
  expect(signature.split(",")).toHaveLength(3);
});

// ── Route wiring: auth, ownership, active filter ────────────────────────────

test("6: the deployed route authenticates the caller before anything else", () => {
  const route = readFileSync("app/api/price-book-items/[id]/route.ts", "utf8");
  expect(route).toContain('if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));');
  // The auth check is the first thing the handler does after obtaining the user.
  const authIndex = route.indexOf("await supabase.auth.getUser();");
  const unauthorizedIndex = route.indexOf('{ error: "Unauthorized" }');
  const businessQueryIndex = route.indexOf('.from("tpe_businesses")');
  expect(authIndex).toBeGreaterThan(-1);
  expect(unauthorizedIndex).toBeGreaterThan(authIndex);
  expect(businessQueryIndex).toBeGreaterThan(unauthorizedIndex);
});

test("the deployed route's item query is scoped to id, business_id and active = true, selecting no source id and returning only what acceptance needs", () => {
  const route = readFileSync("app/api/price-book-items/[id]/route.ts", "utf8");

  const fnStart = route.indexOf("async findActiveOwnedItem(itemId, businessId) {");
  expect(fnStart, "the route wires a findActiveOwnedItem dependency").toBeGreaterThan(-1);
  const fnEnd = route.indexOf("},", fnStart);
  const fn = route.slice(fnStart, fnEnd);

  expect(fn).toContain('.from("tpe_pricebook_items")');
  expect(fn).toContain('.select("id, name, labour_price, material_price, taxable")');
  expect(fn).toContain('.eq("id", itemId)');
  expect(fn).toContain('.eq("business_id", businessId)');
  expect(fn).toContain('.eq("active", true)');

  // The response carries only what acceptance needs -- no price-book id
  // persists past this call, and this is the whole response shape.
  expect(route).toContain("return applyTo(NextResponse.json({ item: result.item }));");
});

test("the route reuses lib/pricebook-suggestion-resolve.ts rather than a second ownership implementation", () => {
  const route = readFileSync("app/api/price-book-items/[id]/route.ts", "utf8");
  expect(route).toContain('import { resolvePriceBookItem } from "@/lib/pricebook-suggestion-resolve";');
  expect(route).toContain("const result = await resolvePriceBookItem(id, business.id, {");
});
