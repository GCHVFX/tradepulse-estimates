import "server-only";

import type { Database } from "./database.types";
import { estimateCurrencyOf } from "./currency-db";
import { isGroupedPricingEnabled } from "./estimate-groups";
import {
  buildCustomerPricingView,
  canEditCustomerPricingMode,
  type EstimatePricingRecord,
  type StructuredPricingItem,
} from "./estimate-pricing-mode";
import { supabaseAdmin } from "./supabase-server";

type EstimateRow = Database["public"]["Tables"]["tpe_estimates"]["Row"];
type EstimatePricingInput = Pick<
  EstimateRow,
  | "id"
  | "business_id"
  | "pricing_source"
  | "customer_pricing_mode"
  | "status"
  | "sent_at"
  | "copied_at"
  | "completed_at"
  | "payment_status"
  | "invoice_amount"
  | "review_requested_at"
  | "summary"
  | "currency"
>;

type StructuredItemRow = Pick<
  Database["public"]["Tables"]["tpe_estimate_items"]["Row"],
  | "description"
  | "quantity"
  | "unit"
  | "unit_price"
  | "line_total"
  | "group_label"
  | "customer_visible"
  | "display_order"
>;

export function toEstimatePricingRecord(estimate: EstimatePricingInput): EstimatePricingRecord {
  return {
    id: estimate.id,
    businessId: estimate.business_id,
    pricingSource: estimate.pricing_source,
    customerPricingMode: estimate.customer_pricing_mode,
    status: estimate.status,
    sentAt: estimate.sent_at,
    copiedAt: estimate.copied_at,
    completedAt: estimate.completed_at,
    paymentStatus: estimate.payment_status,
    invoiceAmount: estimate.invoice_amount,
    reviewRequestedAt: estimate.review_requested_at,
    summary: estimate.summary ?? "",
    // The database boundary, and the only place a CAD fallback belongs. The
    // column is `not null default 'cad'`, so this only fires for a row that
    // predates the column or arrives unreadable. Every layer above this one
    // takes the currency as a required argument.
    currency: estimateCurrencyOf(estimate),
  };
}

function toStructuredPricingItem(item: StructuredItemRow): StructuredPricingItem {
  return {
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unitPrice: item.unit_price,
    lineTotal: item.line_total,
    groupLabel: item.group_label,
    customerVisible: item.customer_visible,
    displayOrder: item.display_order,
  };
}

export async function loadStructuredPricingItems(
  estimateId: string
): Promise<StructuredPricingItem[]> {
  const { data, error } = await supabaseAdmin
    .from("tpe_estimate_items")
    .select(
      "description, quantity, unit, unit_price, line_total, group_label, customer_visible, display_order"
    )
    .eq("estimate_id", estimateId)
    .order("display_order", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(toStructuredPricingItem);
}

export async function loadCustomerPricingView(estimate: EstimatePricingInput) {
  const record = toEstimatePricingRecord(estimate);
  const featureEnabled = isGroupedPricingEnabled();
  let items: StructuredPricingItem[] = [];
  let loadError: string | null = null;

  if (record.pricingSource === "structured") {
    try {
      items = await loadStructuredPricingItems(record.id);
    } catch (error) {
      loadError = error instanceof Error ? error.message : "Unknown structured item load error";
      console.error("[estimate-pricing] structured item load failed", {
        estimateId: record.id,
        error: loadError,
      });
    }
  }

  const selected = buildCustomerPricingView({ estimate: record, items, featureEnabled });
  const detailed = buildCustomerPricingView({
    estimate: { ...record, customerPricingMode: "detailed" },
    items,
    featureEnabled,
  });
  const grouped = buildCustomerPricingView({
    estimate: { ...record, customerPricingMode: "grouped" },
    items,
    featureEnabled,
  });

  if (!selected.ok) {
    console.error("[estimate-pricing] customer pricing failed closed", {
      estimateId: record.id,
      pricingSource: record.pricingSource,
      requestedMode: record.customerPricingMode,
      error: loadError ? "STRUCTURED_ITEM_LOAD_FAILED" : selected.error,
      itemCount: items.length,
      detailedSubtotal: selected.detailedSubtotal,
      groupedSubtotal: selected.groupedSubtotal,
    });
  }

  return {
    selected,
    detailedSummary: detailed.summary,
    groupedSummary: grouped.ok ? grouped.summary : detailed.summary,
    canEditMode:
      detailed.ok &&
      grouped.ok &&
      canEditCustomerPricingMode(record, items.length, featureEnabled),
  };
}
