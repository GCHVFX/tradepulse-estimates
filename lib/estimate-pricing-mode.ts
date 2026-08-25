import {
  computeTotals,
  formatEstimateForDisplay,
  formatEstimateForDisplayWithPricing,
  parseSummary,
  type LineItem,
} from "./estimate-summary";
import type { Currency } from "./currency";
import {
  groupItemsForDisplay,
  renderGroupedLineItemsBlock,
  type GroupedPriceLine,
} from "./estimate-groups";

export type CustomerPricingMode = "detailed" | "grouped";

export interface StructuredPricingItem {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  lineTotal: number;
  groupLabel: string | null;
  customerVisible: boolean;
  displayOrder: number;
}

export interface EstimatePricingRecord {
  id: string;
  businessId: string;
  pricingSource: string;
  customerPricingMode: string;
  status: string;
  sentAt: string | null;
  copiedAt: string | null;
  completedAt: string | null;
  paymentStatus: string | null;
  invoiceAmount: number | null;
  reviewRequestedAt: string | null;
  summary: string;
  // The estimate's immutable snapshot. Part of the record, not an option, so
  // no pricing view can be built without one.
  currency: Currency;
}

export type CustomerPricingError =
  | "STRUCTURED_ROWS_MISSING"
  | "CUSTOMER_VISIBLE_ROWS_MISSING"
  | "INVALID_PRICING_MODE"
  | "GROUPED_PRICING_DISABLED"
  | "STRUCTURED_SUBTOTAL_MISMATCH";

export interface CustomerPricingView {
  ok: boolean;
  error: CustomerPricingError | null;
  requestedMode: string;
  renderedMode: CustomerPricingMode;
  summary: string;
  detailedSubtotal: number;
  groupedSubtotal: number | null;
  tax: number;
  total: number;
  deposit: number;
  groups: GroupedPriceLine[];
}

const MONEY_EPSILON = 0.000001;

export function isCustomerPricingMode(value: unknown): value is CustomerPricingMode {
  return value === "detailed" || value === "grouped";
}

function moneyMatches(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= MONEY_EPSILON;
}

function isProtectedEstimate(estimate: EstimatePricingRecord): boolean {
  return (
    estimate.status !== "draft" ||
    estimate.sentAt !== null ||
    estimate.copiedAt !== null ||
    estimate.completedAt !== null ||
    estimate.paymentStatus !== null ||
    estimate.invoiceAmount !== null ||
    estimate.reviewRequestedAt !== null
  );
}

export function canEditCustomerPricingMode(
  estimate: EstimatePricingRecord,
  structuredItemCount: number,
  featureEnabled: boolean
): boolean {
  return (
    featureEnabled &&
    estimate.pricingSource === "structured" &&
    structuredItemCount > 0 &&
    !isProtectedEstimate(estimate)
  );
}

function toLineItem(item: StructuredPricingItem, sourceLineItem?: LineItem): LineItem {
  const quantityBased =
    sourceLineItem?.quantityBased === true ||
    item.unit !== null ||
    !moneyMatches(item.quantity, 1) ||
    !moneyMatches(item.unitPrice, item.lineTotal);

  return {
    id: `structured-${item.displayOrder}`,
    label: item.description,
    // Keep full database precision for arithmetic. The shared display formatter
    // applies the same two-decimal presentation as the markdown path later.
    cost: String(item.lineTotal),
    quantity: quantityBased ? String(item.quantity) : undefined,
    unit: quantityBased ? item.unit ?? "" : undefined,
    rate: quantityBased ? String(item.unitPrice) : undefined,
    quantityBased,
  };
}

function matchSourceLineItems(
  items: StructuredPricingItem[],
  sourceLineItems: LineItem[]
): Array<LineItem | undefined> {
  let sourceCursor = 0;
  return items.map((item) => {
    const matchIndex = sourceLineItems.findIndex(
      (lineItem, index) =>
        index >= sourceCursor && lineItem.label === item.description
    );
    if (matchIndex === -1) return undefined;
    sourceCursor = matchIndex + 1;
    return sourceLineItems[matchIndex];
  });
}

function fallbackView(
  estimate: EstimatePricingRecord,
  error: CustomerPricingError | null,
  detailedSubtotal: number,
  tax: number,
  total: number,
  deposit: number
): CustomerPricingView {
  return {
    ok: error === null,
    error,
    requestedMode: estimate.customerPricingMode,
    renderedMode: "detailed",
    summary: formatEstimateForDisplay(estimate.summary, estimate.currency),
    detailedSubtotal,
    groupedSubtotal: null,
    tax,
    total,
    deposit,
    groups: [],
  };
}

/**
 * One customer-pricing view model for the contractor preview, public share
 * page, and PDF. It never returns structured rows or internal metadata.
 */
export function buildCustomerPricingView({
  estimate,
  items,
  featureEnabled,
}: {
  estimate: EstimatePricingRecord;
  items: StructuredPricingItem[];
  featureEnabled: boolean;
}): CustomerPricingView {
  const parsed = parseSummary(estimate.summary);
  const markdownTotals = computeTotals(parsed.lineItems, parsed.taxRate);
  const markdownDeposit = Math.round(markdownTotals.total * (parsed.depositPercent / 100));

  if (estimate.pricingSource !== "structured") {
    return fallbackView(
      estimate,
      null,
      markdownTotals.subtotal,
      markdownTotals.tax,
      markdownTotals.total,
      markdownDeposit
    );
  }

  if (!isCustomerPricingMode(estimate.customerPricingMode)) {
    return fallbackView(
      estimate,
      "INVALID_PRICING_MODE",
      markdownTotals.subtotal,
      markdownTotals.tax,
      markdownTotals.total,
      markdownDeposit
    );
  }

  if (items.length === 0) {
    return fallbackView(
      estimate,
      "STRUCTURED_ROWS_MISSING",
      markdownTotals.subtotal,
      markdownTotals.tax,
      markdownTotals.total,
      markdownDeposit
    );
  }

  const orderedItems = [...items].sort((left, right) => left.displayOrder - right.displayOrder);
  const visibleItems = orderedItems.filter((item) => item.customerVisible);
  if (visibleItems.length === 0) {
    return fallbackView(
      estimate,
      "CUSTOMER_VISIBLE_ROWS_MISSING",
      markdownTotals.subtotal,
      markdownTotals.tax,
      markdownTotals.total,
      markdownDeposit
    );
  }

  const structuredSubtotal = orderedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const visibleSubtotal = visibleItems.reduce((sum, item) => sum + item.lineTotal, 0);
  if (
    !moneyMatches(structuredSubtotal, markdownTotals.subtotal) ||
    !moneyMatches(visibleSubtotal, structuredSubtotal)
  ) {
    return fallbackView(
      estimate,
      "STRUCTURED_SUBTOTAL_MISMATCH",
      markdownTotals.subtotal,
      markdownTotals.tax,
      markdownTotals.total,
      markdownDeposit
    );
  }

  const sourceLineItems = matchSourceLineItems(visibleItems, parsed.lineItems);
  const detailedLineItems = visibleItems.map((item, index) =>
    toLineItem(item, sourceLineItems[index])
  );
  const detailedTotals = computeTotals(detailedLineItems, parsed.taxRate);
  const deposit = Math.round(detailedTotals.total * (parsed.depositPercent / 100));
  if (!moneyMatches(detailedTotals.subtotal, structuredSubtotal)) {
    return fallbackView(
      estimate,
      "STRUCTURED_SUBTOTAL_MISMATCH",
      markdownTotals.subtotal,
      markdownTotals.tax,
      markdownTotals.total,
      markdownDeposit
    );
  }

  if (estimate.customerPricingMode === "grouped" && !featureEnabled) {
    return fallbackView(
      estimate,
      "GROUPED_PRICING_DISABLED",
      detailedTotals.subtotal,
      detailedTotals.tax,
      detailedTotals.total,
      deposit
    );
  }

  const groupable = visibleItems.map((item) => ({
    total: item.lineTotal,
    groupLabel: item.groupLabel,
  }));
  const groups = groupItemsForDisplay(groupable);
  const groupedSubtotal = groups.reduce((sum, group) => sum + group.total, 0);

  if (!moneyMatches(groupedSubtotal, detailedTotals.subtotal)) {
    return fallbackView(
      estimate,
      "STRUCTURED_SUBTOTAL_MISMATCH",
      markdownTotals.subtotal,
      markdownTotals.tax,
      markdownTotals.total,
      markdownDeposit
    );
  }

  const renderedMode = estimate.customerPricingMode;
  const summary = formatEstimateForDisplayWithPricing(
    estimate.summary,
    detailedLineItems,
    estimate.currency,
    renderedMode === "grouped"
      ? renderGroupedLineItemsBlock(groupable, estimate.currency)
      : undefined
  );

  return {
    ok: true,
    error: null,
    requestedMode: renderedMode,
    renderedMode,
    summary,
    detailedSubtotal: detailedTotals.subtotal,
    groupedSubtotal,
    tax: detailedTotals.tax,
    total: detailedTotals.total,
    deposit,
    groups: renderedMode === "grouped" ? groups : [],
  };
}

export interface CustomerPricingModeDependencies {
  featureEnabled: boolean;
  findBusinessIdForUser(userId: string): Promise<string | null>;
  findEstimateForBusiness(
    estimateId: string,
    businessId: string
  ): Promise<EstimatePricingRecord | null>;
  loadStructuredItems(estimateId: string): Promise<StructuredPricingItem[]>;
  persistMode(update: {
    estimateId: string;
    businessId: string;
    mode: CustomerPricingMode;
  }): Promise<{ updated: boolean; error?: string }>;
}

export interface CustomerPricingModeUpdateResult {
  ok: boolean;
  status: number;
  mode?: CustomerPricingMode;
  error?: string;
  internalError?: string;
}

function refusal(status: number, error: string): CustomerPricingModeUpdateResult {
  return { ok: false, status, error };
}

/** Secure persistence coordinator, with the database boundary injected. */
export async function updateCustomerPricingMode(
  input: { userId: string | null; estimateId: string; requestedMode: unknown },
  dependencies: CustomerPricingModeDependencies
): Promise<CustomerPricingModeUpdateResult> {
  if (!input.userId) return refusal(401, "Unauthorized");
  if (!isCustomerPricingMode(input.requestedMode)) {
    return refusal(400, "Pricing mode must be detailed or grouped");
  }
  if (input.requestedMode === "grouped" && !dependencies.featureEnabled) {
    return refusal(409, "Grouped pricing is not available");
  }

  const businessId = await dependencies.findBusinessIdForUser(input.userId);
  if (!businessId) return refusal(404, "Estimate not found or access denied");

  const estimate = await dependencies.findEstimateForBusiness(input.estimateId, businessId);
  if (!estimate) return refusal(404, "Estimate not found or access denied");
  if (estimate.pricingSource !== "structured") {
    return refusal(409, "Grouped pricing requires a structured estimate");
  }
  if (isProtectedEstimate(estimate)) {
    return refusal(409, "Customer pricing can no longer be changed for this estimate");
  }

  const items = await dependencies.loadStructuredItems(input.estimateId);
  if (items.length === 0) {
    return refusal(409, "Structured pricing rows are missing");
  }

  const requestedView = buildCustomerPricingView({
    estimate: { ...estimate, customerPricingMode: input.requestedMode },
    items,
    featureEnabled: dependencies.featureEnabled,
  });
  if (!requestedView.ok) {
    return refusal(409, "Customer pricing could not be verified");
  }

  if (estimate.customerPricingMode === input.requestedMode) {
    return { ok: true, status: 200, mode: input.requestedMode };
  }

  const persisted = await dependencies.persistMode({
    estimateId: input.estimateId,
    businessId,
    mode: input.requestedMode,
  });
  if (!persisted.updated) {
    return {
      ok: false,
      status: persisted.error ? 500 : 409,
      error: persisted.error
        ? "Could not save customer pricing"
        : "The estimate changed before customer pricing could be saved",
      internalError: persisted.error,
    };
  }

  return { ok: true, status: 200, mode: input.requestedMode };
}
