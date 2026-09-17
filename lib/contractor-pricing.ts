/**
 * The one deterministic pricing calculation for contractor-owned pricing
 * (Phase 1, specs/contractor-owned-pricing.md section 8).
 *
 * Pure and isomorphic. It does not fetch, save, infer, repair or default
 * business data, does not parse markdown, does not look at source or status,
 * and does not mutate its inputs. Give it the canonical pricing rows and the
 * estimate's own snapshots and it returns every figure plus what is missing.
 *
 * MONEY UNITS. The database stores dollars: `tpe_estimate_items.quantity`,
 * `unit_price` and `line_total` are `numeric` with no fixed scale, as do the
 * snapshot columns. Integer cents exist only inside this module and in what it
 * returns. Nothing converts back and persists cents.
 *
 * ROUNDING. Each component rounds once, at its own line result, and the
 * subtotal is the sum of those already-rounded components. That is not the
 * same as rounding the sum of the unrounded components, and the difference is
 * a real cent on some inputs; this order is the authority.
 */

/** One canonical pricing row, exactly as it is stored. Dollars, not cents. */
export interface PricingRow {
  /** 'labour', 'material' or 'other'. Anything else is ignored here. */
  item_type: string;
  /** 'hr' means hourly labour. null means a fixed amount. */
  unit: string | null;
  /** Hours for an hourly labour row; 1 for every other row. */
  quantity: number;
  /** The hourly rate, the fixed amount, the pre-markup material cost, or the charge amount. */
  unit_price: number;
  /** The percentage applied to a material row. null elsewhere. */
  markup_percent?: number | null;
}

/** The estimate's own snapshots. Never the live business settings. */
export interface PricingSnapshots {
  /** tax_rate_snapshot, a whole-number percent. null means not set yet. */
  taxRatePercent: number | null;
  /** deposit_percent_snapshot, a whole-number percent. */
  depositPercent: number | null;
  /** deposit_threshold_snapshot, in dollars. */
  depositThresholdDollars: number | null;
}

export type PricingGap =
  | "labour-missing"
  | "labour-rate-missing"
  | "materials-missing"
  | "tax-snapshot-missing";

export interface ContractorPricing {
  labourCents: number;
  materialsCents: number;
  chargesCents: number;
  /**
   * Each optional charge's own amount, in the order the charge rows were
   * given. `chargesCents` is their sum. Exposed so a customer document can
   * list charges one by one without converting a row to cents itself.
   */
  chargeLineCents: number[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  /** True when `missing` is empty. Completeness gates delivery, never saving. */
  complete: boolean;
  missing: PricingGap[];
}

/** Dollars to cents, rounded once. */
function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

function isHourly(row: PricingRow): boolean {
  return (row.unit ?? "").trim().toLowerCase() === "hr";
}

/**
 * An hourly row is hours times rate, rounded once at the line result, never
 * through an intermediate rounded dollar value. A fixed row is its amount;
 * its quantity is always 1 and is not multiplied in.
 */
function labourRowCents(row: PricingRow): number {
  return isHourly(row) ? toCents(row.quantity * row.unit_price) : toCents(row.unit_price);
}

/** Pre-markup cost times the applied percentage, rounded once. */
function materialRowCents(row: PricingRow): number {
  const markup = row.markup_percent ?? 0;
  return toCents(row.unit_price * (1 + markup / 100));
}

export function calculateContractorPricing(
  rows: readonly PricingRow[],
  snapshots: PricingSnapshots
): ContractorPricing {
  const labourRows = rows.filter((row) => row.item_type === "labour");
  const materialRows = rows.filter((row) => row.item_type === "material");
  const chargeRows = rows.filter((row) => row.item_type === "other");

  const labourCents = labourRows.reduce((sum, row) => sum + labourRowCents(row), 0);
  const materialsCents = materialRows.reduce((sum, row) => sum + materialRowCents(row), 0);
  const chargeLineCents = chargeRows.map((row) => toCents(row.unit_price));
  const chargesCents = chargeLineCents.reduce((sum, cents) => sum + cents, 0);

  const subtotalCents = labourCents + materialsCents + chargesCents;

  // A null tax snapshot is an incomplete pricing state, not 0%. It reports no
  // tax so the figures stay readable, and `missing` is what blocks delivery.
  const taxCents =
    snapshots.taxRatePercent === null
      ? 0
      : Math.round((subtotalCents * snapshots.taxRatePercent) / 100);

  const totalCents = subtotalCents + taxCents;

  const depositCents = resolveDepositCents(totalCents, snapshots);
  const balanceCents = totalCents - depositCents;

  const missing: PricingGap[] = [];
  if (labourRows.length === 0) missing.push("labour-missing");
  if (labourRows.some((row) => isHourly(row) && row.unit_price <= 0)) {
    missing.push("labour-rate-missing");
  }
  if (materialRows.length === 0) missing.push("materials-missing");
  if (snapshots.taxRatePercent === null) missing.push("tax-snapshot-missing");

  return {
    labourCents,
    materialsCents,
    chargesCents,
    chargeLineCents,
    subtotalCents,
    taxCents,
    totalCents,
    depositCents,
    balanceCents,
    complete: missing.length === 0,
    missing,
  };
}

/**
 * No deposit unless both settings are present and above zero. The threshold is
 * stored in dollars, so it converts to cents before the comparison, and the
 * rule is "over the threshold", never "at or over".
 */
function resolveDepositCents(totalCents: number, snapshots: PricingSnapshots): number {
  const { depositPercent, depositThresholdDollars } = snapshots;
  if (depositPercent === null || depositThresholdDollars === null) return 0;
  if (depositPercent <= 0 || depositThresholdDollars <= 0) return 0;

  const thresholdCents = toCents(depositThresholdDollars);
  if (totalCents <= thresholdCents) return 0;
  return Math.round((totalCents * depositPercent) / 100);
}
