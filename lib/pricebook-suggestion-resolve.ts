/**
 * Resolves one saved price-book item's authoritative current values at the
 * moment a contractor accepts a matcher suggestion (Phase 2 slice 4,
 * specs/contractor-owned-pricing.md's "nothing the matcher produces may
 * touch a dollar total until the contractor taps it", extended to
 * acceptance itself). The suggestion object the contractor tapped carries no
 * price and is never trusted for one -- this is the only place a saved
 * item's price and taxability are actually read, and they are read fresh
 * here, every time, never cached from suggestion generation.
 *
 * Pure orchestration over an injected dependency, the same shape as
 * lib/estimate-pricing-init.ts's loadEstimatePricingInit() and
 * lib/estimate-deletion.ts's deleteOwnedEstimate(): ownership and active
 * status are the dependency's job (a real `.eq("business_id", ...).eq(
 * "active", true)` filter at the call site), and this module never sees a
 * price it did not just read.
 */

/** What acceptance needs to build a confirmed line item. No price-book id. */
export interface ResolvedPriceBookItem {
  id: string;
  description: string;
  labourUnitPrice: number;
  materialUnitPrice: number;
  taxable: boolean;
}

/** The stored row, exactly as read -- only ever for an owned, active item. */
export interface OwnedActivePriceBookItem {
  id: string;
  name: string;
  labour_price: number;
  material_price: number;
  taxable: boolean;
}

export interface ResolvePriceBookItemDependencies {
  /**
   * Only an item that belongs to this business and is currently active.
   * A foreign-business id, a missing id and an inactive id all resolve to
   * null here -- indistinguishable to the caller, so none of them can leak
   * which case actually happened.
   */
  findActiveOwnedItem(itemId: string, businessId: string): Promise<OwnedActivePriceBookItem | null>;
}

export const PRICE_BOOK_ITEM_UNAVAILABLE = "Item not found or unavailable";

export type ResolvePriceBookItemResult =
  | { ok: true; item: ResolvedPriceBookItem }
  | { ok: false; status: 404; error: string };

export async function resolvePriceBookItem(
  itemId: string,
  businessId: string,
  deps: ResolvePriceBookItemDependencies
): Promise<ResolvePriceBookItemResult> {
  const owned = await deps.findActiveOwnedItem(itemId, businessId);

  // Foreign-business and inactive both land here, identically -- no tenant
  // or existence information leaks either way.
  if (!owned) {
    return { ok: false, status: 404, error: PRICE_BOOK_ITEM_UNAVAILABLE };
  }

  return {
    ok: true,
    item: {
      id: owned.id,
      description: owned.name,
      labourUnitPrice: owned.labour_price,
      materialUnitPrice: owned.material_price,
      taxable: owned.taxable,
    },
  };
}
