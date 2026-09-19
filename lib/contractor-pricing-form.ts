/**
 * The contractor pricing editor's state, kept out of React so the rules that
 * matter can be tested directly (specs/contractor-owned-pricing.md sections 5,
 * 6, 7, 11 and 12).
 *
 * Pure. No React, no network, no database, no markdown. It never calculates a
 * price: every figure the contractor sees comes from the backend's
 * calculateContractorPricing() result.
 *
 * BLANK IS NOT ZERO. Every money field is held as the text the contractor
 * actually typed. An empty field means unknown and produces no row; "0" means
 * they entered zero and produces a real row worth nothing. Parsing early, or
 * defaulting a blank to 0, would erase that difference and quietly turn an
 * unanswered question into a priced answer.
 */

import {
  LINE_ITEM_UNIT,
  toCanonicalRows,
  type ChargeInput,
  type ConfirmedLineItemInput,
  type ContractorPricingRequest,
  type LabourInput,
  type MaterialsInput,
} from "./contractor-pricing-request";
import { calculateContractorPricing, type ContractorPricing, type PricingGap } from "./contractor-pricing";

export type LabourMethod = "hourly" | "fixed";

export interface ChargeFieldState {
  /** Local only, for React keys and removal. Never sent. */
  id: string;
  description: string;
  amount: string;
}

/**
 * One contractor-accepted saved line item (Phase 2 slice 4). Owns exactly
 * what the confirmed draft owns (specs/contractor-owned-pricing.md's
 * "accepted item ownership" rule): description, quantity and both unit
 * prices, copied out at acceptance. No price-book id lives here -- once
 * accepted, this is the estimate's own data, not a live reference back to
 * the price book.
 */
export interface ConfirmedLineItemFieldState {
  /** Local only, for React keys and Remove. Never sent. */
  id: string;
  description: string;
  quantity: string;
  labourUnitPrice: string;
  materialUnitPrice: string;
  /** Copied from the saved item at acceptance. Not exposed as an editable control in slice 4. */
  taxable: boolean;
}

export interface ContractorPricingFormState {
  /** null until the contractor picks one. Never defaulted. */
  labourMethod: LabourMethod | null;
  hours: string;
  hourlyRate: string;
  fixedAmount: string;
  materialsCost: string;
  markupPercent: string;
  charges: ChargeFieldState[];
  taxLabel: string;
  taxRate: string;
  /** True only after the contractor edits tax in this session. */
  taxEdited: boolean;
  /**
   * Confirmed saved line items (Phase 2 slice 4). Mode is derived from this
   * list, not a separate flag: `confirmedItems.length > 0` means saved-item
   * mode, mutually exclusive with generic Labour/Materials (Option C, slice
   * 3A). Charges and tax coexist with either mode.
   */
  confirmedItems: ConfirmedLineItemFieldState[];
  /**
   * True when this estimate's persisted 'ea' rows could not be reliably
   * reconstructed into confirmed items on load (an orphan row, a mismatched
   * pair, or 'ea' rows mixed with a generic labour/material row -- see
   * reconstructConfirmedItems()). A defensive state only: never fabricated
   * from ambiguous data and never silently downgraded to generic pricing.
   */
  pricingAttentionNeeded: boolean;
}

/** A stored row, as the save route returns it. */
export interface ContractorPricingRowInput {
  item_type: string;
  unit: string | null;
  quantity: number;
  unit_price: number;
  markup_percent: number | null;
  description: string;
  display_order: number;
  taxable: boolean;
}

export interface EstimateTaxSnapshot {
  label: string | null;
  rate: number | null;
}

export interface BusinessPricingDefaults {
  /** tpe_businesses.labour_rate. 0 means not configured. */
  labourRate: number;
  /** tpe_businesses.markup_percent. 0 is a real, valid markup. */
  markupPercent: number;
}

let chargeCounter = 0;
function nextChargeId(): string {
  chargeCounter += 1;
  return `charge-${chargeCounter}`;
}

let lineItemCounter = 0;
function nextLineItemId(): string {
  lineItemCounter += 1;
  return `line-item-${lineItemCounter}`;
}

/** The text for a stored number. Trailing zeros are not invented. */
function toField(value: number): string {
  return String(value);
}

/** Trimmed text as a number, or null when blank or unreadable. */
function numberOrNull(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function isHourlyRow(row: ContractorPricingRowInput): boolean {
  return (row.unit ?? "").trim().toLowerCase() === "hr";
}

/** A confirmed saved line item's row, per its LINE_ITEM_UNIT encoding. */
function isLineItemRow(row: ContractorPricingRowInput): boolean {
  return (row.unit ?? "").trim().toLowerCase() === LINE_ITEM_UNIT;
}

export type ConfirmedItemsReconstruction =
  | { ok: true; items: ConfirmedLineItemFieldState[] }
  | { ok: false };

/**
 * Reload reconstruction (specs/contractor-owned-pricing.md's "reload
 * reconstruction rule"). GET /api/estimates/[id]/pricing already returns
 * every persisted row; this rebuilds confirmed items from the adjacent
 * labour/material 'ea' pairs toCanonicalRows() wrote, never guessing.
 *
 * A pair is exactly two adjacent 'ea' rows, ordered by display_order: labour
 * immediately followed by material, same description, same quantity, same
 * taxable. Two pairs sharing a description stay two separate items -- pairing
 * is positional, not description-keyed. Anything that does not fit this
 * shape (an orphan row, a mismatched pair, or 'ea' rows coexisting with a
 * generic labour/material row, which Option C forbids) refuses reconstruction
 * outright rather than manufacturing editable draft state from an ambiguous
 * persisted state.
 */
export function reconstructConfirmedItems(
  rows: readonly ContractorPricingRowInput[]
): ConfirmedItemsReconstruction {
  const lineItemRows = [...rows].filter(isLineItemRow).sort((a, b) => a.display_order - b.display_order);
  if (lineItemRows.length === 0) return { ok: true, items: [] };

  const hasGenericLabourOrMaterial = rows.some(
    (row) => !isLineItemRow(row) && (row.item_type === "labour" || row.item_type === "material")
  );
  if (hasGenericLabourOrMaterial) return { ok: false };

  if (lineItemRows.length % 2 !== 0) return { ok: false };

  const items: ConfirmedLineItemFieldState[] = [];
  for (let i = 0; i < lineItemRows.length; i += 2) {
    const labourRow = lineItemRows[i];
    const materialRow = lineItemRows[i + 1];
    if (labourRow.item_type !== "labour" || materialRow.item_type !== "material") return { ok: false };
    if (labourRow.description !== materialRow.description) return { ok: false };
    if (labourRow.quantity !== materialRow.quantity) return { ok: false };
    if (labourRow.taxable !== materialRow.taxable) return { ok: false };
    // toCanonicalRows() always writes a confirmed item's material row with
    // markup_percent = 0 explicitly (never null, never anything else) --
    // tpe_pricebook_items.material_price is already a final selling price.
    // Anything else here (null, NaN, or a real markup) is not a row this
    // feature wrote, so it is not a valid pair, not a value to silently
    // zero out.
    //
    // Compared defensively against both a JS number 0 and the numeric
    // string "0": ContractorPricingRowInput declares markup_percent as
    // `number | null`, matching the generated Supabase schema type for this
    // `numeric` column, but that generated type describes the declared
    // Postgres column type, not a runtime guarantee about what the
    // supabase-js/PostgREST JSON response actually deserializes it as for
    // every caller of this pure function -- this module has no network
    // layer of its own to verify that against. A plain `!== 0` would
    // wrongly flag every legitimate saved-item material row as malformed if
    // it ever arrives as the string "0" instead of the number 0. `null` is
    // deliberately NOT included as an accepted value: unlike the numeric
    // string case, a missing value is never coerced into a valid zero.
    const materialMarkup: unknown = materialRow.markup_percent;
    if (materialMarkup !== 0 && materialMarkup !== "0") return { ok: false };

    items.push({
      id: nextLineItemId(),
      description: labourRow.description,
      quantity: toField(labourRow.quantity),
      labourUnitPrice: toField(labourRow.unit_price),
      materialUnitPrice: toField(materialRow.unit_price),
      taxable: labourRow.taxable,
    });
  }

  return { ok: true, items };
}

/**
 * Applies this same reconstruction result to an already-computed
 * completeness/pricing result -- the single definition of "needs attention"
 * used both by this editor (via pricingAttentionNeeded, above) and by every
 * server-side delivery/completeness check (lib/estimate-pricing-server.ts's
 * contractorPricingCompleteness() and app/estimates/[id]/page.tsx's own
 * SSR completeness computation). A contractor_pricing estimate whose
 * persisted 'ea' rows cannot be reliably paired into confirmed items must
 * never be reported complete or sendable anywhere, not just refused editing
 * here.
 *
 * Deliberately kept in this plain module rather than lib/estimate-pricing-
 * server.ts (which is `import "server-only"`-flagged and therefore cannot be
 * imported into a plain unit test): this function itself does no I/O, so it
 * belongs wherever reconstructConfirmedItems does, not wherever its callers
 * happen to also fetch rows from.
 *
 * Callers must only ever call this for a `contractor_pricing` estimate --
 * every current call site is already gated behind that classification before
 * this runs. `rows` for a 'structured' or 'markdown' estimate may
 * legitimately hold unrelated 'ea' rows (e.g. item_type='other',
 * markup_percent=null) this invariant was never meant to apply to, and this
 * function must not be called with those.
 */
export function withReconstructionGate(
  pricing: ContractorPricing,
  rows: readonly ContractorPricingRowInput[]
): ContractorPricing {
  if (reconstructConfirmedItems(rows).ok) return pricing;
  return { ...pricing, complete: false };
}

/**
 * Build the form from what is stored. A missing row stays missing: nothing
 * here invents a labour method, a cost or a rate.
 */
export function initContractorPricingForm(
  rows: readonly ContractorPricingRowInput[],
  tax: EstimateTaxSnapshot,
  defaults: BusinessPricingDefaults
): ContractorPricingFormState {
  const reconstruction = reconstructConfirmedItems(rows);

  if (!reconstruction.ok) {
    // Defensive attention state: no editable Labour/Materials/confirmed-item
    // draft is manufactured from rows this form cannot reliably interpret.
    return {
      labourMethod: null,
      hours: "",
      hourlyRate: "",
      fixedAmount: "",
      materialsCost: "",
      markupPercent: toField(defaults.markupPercent),
      charges: [],
      taxLabel: tax.label ?? "",
      taxRate: tax.rate === null ? "" : toField(tax.rate),
      taxEdited: false,
      confirmedItems: [],
      pricingAttentionNeeded: true,
    };
  }

  // Confirmed-item 'ea' rows are excluded here: reconstruction above already
  // proved they cannot coexist with a generic labour/material row, so this
  // lookup only ever finds the generic Phase 1 shape when it is actually in
  // use.
  const genericRows = rows.filter((row) => !isLineItemRow(row));
  const labourRow = genericRows.find((row) => row.item_type === "labour");
  const materialsRow = genericRows.find((row) => row.item_type === "material");
  const chargeRows = genericRows.filter((row) => row.item_type === "other");

  const hourly = labourRow ? isHourlyRow(labourRow) : false;

  return {
    labourMethod: labourRow ? (hourly ? "hourly" : "fixed") : null,
    hours: labourRow && hourly ? toField(labourRow.quantity) : "",
    hourlyRate: labourRow && hourly ? toField(labourRow.unit_price) : "",
    fixedAmount: labourRow && !hourly ? toField(labourRow.unit_price) : "",
    materialsCost: materialsRow ? toField(materialsRow.unit_price) : "",
    // A stored markup of 0 shows as "0", not blank. With no materials row yet,
    // the business default is offered, which is a suggestion the contractor can
    // change and not a row: a markup alone never creates one.
    markupPercent: materialsRow
      ? toField(materialsRow.markup_percent ?? 0)
      : toField(defaults.markupPercent),
    charges: chargeRows.map((row) => ({
      id: nextChargeId(),
      description: row.description,
      amount: toField(row.unit_price),
    })),
    taxLabel: tax.label ?? "",
    taxRate: tax.rate === null ? "" : toField(tax.rate),
    taxEdited: false,
    confirmedItems: reconstruction.items,
    pricingAttentionNeeded: false,
  };
}

/**
 * Choosing a method replaces the previous labour input rather than keeping
 * both, so an estimate can never carry two labour rows. A new hourly input is
 * offered the business rate when there is one; a business rate of 0 means the
 * contractor has none configured, so the field stays blank and blocking.
 */
export function chooseLabourMethod(
  state: ContractorPricingFormState,
  method: LabourMethod,
  defaults: BusinessPricingDefaults
): ContractorPricingFormState {
  if (method === state.labourMethod) return state;
  if (method === "hourly") {
    return {
      ...state,
      labourMethod: "hourly",
      hours: "",
      hourlyRate: defaults.labourRate > 0 ? toField(defaults.labourRate) : "",
      fixedAmount: "",
    };
  }
  return { ...state, labourMethod: "fixed", hours: "", hourlyRate: "", fixedAmount: "" };
}

export function addCharge(state: ContractorPricingFormState): ContractorPricingFormState {
  return { ...state, charges: [...state.charges, { id: nextChargeId(), description: "", amount: "" }] };
}

export function removeCharge(state: ContractorPricingFormState, id: string): ContractorPricingFormState {
  return { ...state, charges: state.charges.filter((charge) => charge.id !== id) };
}

export function updateCharge(
  state: ContractorPricingFormState,
  id: string,
  field: "description" | "amount",
  value: string
): ContractorPricingFormState {
  return {
    ...state,
    charges: state.charges.map((charge) => (charge.id === id ? { ...charge, [field]: value } : charge)),
  };
}

/** Any tax change marks the estimate's tax as explicitly edited. */
export function editTax(
  state: ContractorPricingFormState,
  field: "taxLabel" | "taxRate",
  value: string
): ContractorPricingFormState {
  return { ...state, [field]: value, taxEdited: true };
}

/**
 * The one saved-item resolve payload acceptance needs
 * (lib/pricebook-suggestion-resolve.ts's ResolvedPriceBookItem). No
 * price-book id: it never travels past this call.
 */
export interface AcceptedSuggestionValues {
  description: string;
  labourUnitPrice: number;
  materialUnitPrice: number;
  taxable: boolean;
}

/**
 * Accept a resolved suggestion into the draft (specs/contractor-owned-
 * pricing.md's acceptance-order rule: call this only after both the
 * destructive-switch confirmation, when required, and a successful resolve
 * have already happened -- never before). Clears generic Labour/Materials
 * outright, the same "no hidden backup of discarded generic pricing" state a
 * later removeConfirmedItem() back to zero items relies on, and appends the
 * new item at quantity 1, matching a fresh saved-item acceptance every time.
 */
export function acceptSuggestedItem(
  state: ContractorPricingFormState,
  resolved: AcceptedSuggestionValues
): ContractorPricingFormState {
  return {
    ...state,
    labourMethod: null,
    hours: "",
    hourlyRate: "",
    fixedAmount: "",
    materialsCost: "",
    markupPercent: "",
    confirmedItems: [
      ...state.confirmedItems,
      {
        id: nextLineItemId(),
        description: resolved.description,
        quantity: "1",
        labourUnitPrice: toField(resolved.labourUnitPrice),
        materialUnitPrice: toField(resolved.materialUnitPrice),
        taxable: resolved.taxable,
      },
    ],
  };
}

/**
 * Removing the last confirmed item returns to generic mode on its own --
 * mode is derived from confirmedItems.length, not a stored flag -- and never
 * restores whatever generic values acceptSuggestedItem() cleared.
 */
export function removeConfirmedItem(state: ContractorPricingFormState, id: string): ContractorPricingFormState {
  return { ...state, confirmedItems: state.confirmedItems.filter((item) => item.id !== id) };
}

export function updateConfirmedItem(
  state: ContractorPricingFormState,
  id: string,
  field: "description" | "quantity" | "labourUnitPrice" | "materialUnitPrice",
  value: string
): ContractorPricingFormState {
  return {
    ...state,
    confirmedItems: state.confirmedItems.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
  };
}

function labourPayload(state: ContractorPricingFormState): LabourInput | null {
  if (state.labourMethod === "hourly") {
    const hours = numberOrNull(state.hours);
    if (hours === null) return null;
    // Hours typed with no rate yet: the hours are kept and the save reports
    // labour-rate-missing, rather than throwing away what was typed. This is
    // the one place a blank becomes 0, and only because the contractor has
    // already committed to hourly and entered the hours.
    return { method: "hourly", hours, rate: numberOrNull(state.hourlyRate) ?? 0 };
  }
  if (state.labourMethod === "fixed") {
    const amount = numberOrNull(state.fixedAmount);
    if (amount === null) return null;
    return { method: "fixed", amount };
  }
  return null;
}

function materialsPayload(state: ContractorPricingFormState): MaterialsInput | null {
  const cost = numberOrNull(state.materialsCost);
  if (cost === null) return null;
  return { cost, markupPercent: numberOrNull(state.markupPercent) ?? 0 };
}

function chargesPayload(state: ContractorPricingFormState): ChargeInput[] {
  const charges: ChargeInput[] = [];
  for (const charge of state.charges) {
    const description = charge.description.trim();
    // A half-typed row is not a charge. It stays on screen and is simply not
    // sent, so a blank description can never be persisted.
    if (description === "") continue;
    charges.push({ description, amount: numberOrNull(charge.amount) ?? 0 });
  }
  return charges;
}

/**
 * Quantity is never inferred and never silently 0 -- a blank or unreadable
 * quantity falls back to 1, the same neutral default a fresh acceptance
 * starts at, rather than a request the route would reject outright for a
 * momentary blank field mid-edit.
 */
function confirmedItemsPayload(state: ContractorPricingFormState): ConfirmedLineItemInput[] {
  return state.confirmedItems.map((item) => ({
    description: item.description.trim(),
    quantity: numberOrNull(item.quantity) ?? 1,
    labourUnitPrice: numberOrNull(item.labourUnitPrice) ?? 0,
    materialUnitPrice: numberOrNull(item.materialUnitPrice) ?? 0,
    taxable: item.taxable,
  }));
}

/**
 * The full-state PUT body. labour, materials and charges are always present,
 * because the request replaces everything; tax appears only when this session
 * actually changed it, where absent means "keep the estimate's snapshot".
 *
 * Mode is derived from confirmedItems.length, the same rule the rest of this
 * module uses: saved-item mode sends null labour, null materials and the
 * confirmed items; generic mode sends the generic inputs and an empty
 * lineItems -- Option C's mutual exclusion (slice 3A) is enforced here by
 * construction, never by sending both and hoping the route rejects it.
 */
export function toPricingRequestPayload(state: ContractorPricingFormState): ContractorPricingRequest {
  const usingConfirmedItems = state.confirmedItems.length > 0;

  const payload: ContractorPricingRequest = {
    labour: usingConfirmedItems ? null : labourPayload(state),
    materials: usingConfirmedItems ? null : materialsPayload(state),
    charges: chargesPayload(state),
    tax: null,
    lineItems: usingConfirmedItems ? confirmedItemsPayload(state) : [],
  };

  if (!state.taxEdited) return payload;
  return { ...payload, tax: { label: state.taxLabel.trim(), rate: numberOrNull(state.taxRate) ?? 0 } };
}

/**
 * Whether the current draft has any real, entered generic Labour or
 * Materials value -- the exact semantic test behind the mode-switch
 * confirmation (specs/contractor-owned-pricing.md's "mode switching" rule).
 * Reuses labourPayload()/materialsPayload() rather than a second heuristic:
 * a selected method with a blank amount already parses to null there
 * (`labourMethod !== null` alone must never trigger the warning), and a
 * markup typed with no materials cost already parses to null there too (a
 * markup default alone must never trigger it either).
 */
export function hasEnteredGenericPricing(state: ContractorPricingFormState): boolean {
  return labourPayload(state) !== null || materialsPayload(state) !== null;
}

/** The estimate's own resolved tax and deposit snapshot, as Save would use them. */
export interface PricingPreviewSnapshots {
  taxRatePercent: number | null;
  depositPercent: number | null;
  depositThresholdDollars: number | null;
}

/**
 * The one place that decides what pricing figures the contractor is shown.
 * Delivered: the persisted, saved pricing -- a draft edit must never claim
 * the customer already sees it. Undelivered: a live preview of what Save
 * would produce right now, computed through the exact same pipeline Save
 * uses (toPricingRequestPayload -> toCanonicalRows -> calculateContractorPricing),
 * so nothing here is a second definition of the arithmetic. The tax rate
 * follows the same rule the PUT payload already encodes: this session's edit
 * when there is one, the estimate's own snapshot otherwise.
 */
export function resolveContractorPricingPreview(
  state: ContractorPricingFormState,
  options: {
    isDelivered: boolean;
    persistedPricing: ContractorPricing;
    snapshots: PricingPreviewSnapshots;
  }
): ContractorPricing {
  if (options.isDelivered) return options.persistedPricing;

  const payload = toPricingRequestPayload(state);
  return calculateContractorPricing(toCanonicalRows(payload), {
    taxRatePercent: payload.tax ? payload.tax.rate : options.snapshots.taxRatePercent,
    depositPercent: options.snapshots.depositPercent,
    depositThresholdDollars: options.snapshots.depositThresholdDollars,
  });
}

/** What the contractor is told is still missing. Backend reasons only. */
const MISSING_LABELS: Record<PricingGap, string> = {
  "labour-missing": "Add labour",
  "labour-rate-missing": "Add your hourly rate",
  "materials-missing": "Add materials, or enter 0",
  "tax-snapshot-missing": "Set the tax rate",
};

export function missingLabels(missing: readonly PricingGap[]): string[] {
  return missing.map((reason) => MISSING_LABELS[reason]);
}

/**
 * What the contractor is told about sending, as one derived value instead of
 * three independent displays reading three different sources.
 *
 * "none": nothing to show; existing Send behaviour continues normally.
 * "missing-items": specific gaps to fill in, before Save.
 * "save-to-send": the draft is already complete, but Save has not run yet --
 * Send stays governed by the last saved state regardless, so this is
 * guidance, not a promise.
 */
export type ContractorPricingGuidance =
  | { kind: "none" }
  | { kind: "missing-items"; labels: string[] }
  | { kind: "save-to-send" };

/**
 * Delivered: guidance is persisted pricing only, on the same `isDelivered`
 * flag the pricing flow already carries (no second delivered definition).
 * An unsaved draft edit can never surface here -- a delivered estimate
 * cannot be repriced, so "save-to-send" would be actively wrong advice, and
 * this branch never returns it. A delivered estimate is complete by
 * construction (every delivery path gates on persisted completeness before
 * writing delivery state, and repricing after delivery is rejected, so
 * nothing in the app can un-complete it afterward) -- the missing-items arm
 * below is defensive against that invariant ever being violated, not a
 * reachable case today.
 *
 * Undelivered: the live draft is checked first. A previously-saved-complete
 * estimate that has since been edited into an incomplete draft must show
 * that incompleteness, not silently claim nothing is wrong because the last
 * save happened to be complete.
 */
export function resolveContractorPricingGuidance(options: {
  isDelivered: boolean;
  preview: ContractorPricing;
  persistedPricing: ContractorPricing;
}): ContractorPricingGuidance {
  if (options.isDelivered) {
    return options.persistedPricing.missing.length > 0
      ? { kind: "missing-items", labels: missingLabels(options.persistedPricing.missing) }
      : { kind: "none" };
  }

  if (options.preview.missing.length > 0) {
    return { kind: "missing-items", labels: missingLabels(options.preview.missing) };
  }
  if (options.persistedPricing.missing.length > 0) return { kind: "save-to-send" };
  return { kind: "none" };
}

/** Cents to dollars, for display only. No pricing decision is made here. */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

/**
 * Not a pricing rule -- the one decision behind the Add Pricing anchor
 * fallback (app/components/contractor-pricing-editor.tsx). Plain browser
 * hash navigation to `/estimates/{id}#pricing` proved unreliable on Android
 * Chrome for this client-rendered section, so the editor checks this itself
 * on mount and scrolls there directly when the hash asked for it.
 */
export function shouldScrollToPricing(hash: string | undefined): boolean {
  return hash === "#pricing";
}

/**
 * A stable snapshot of every field that matters for detecting unsaved
 * changes -- everything except `taxEdited`. `taxEdited` is a meta flag that
 * `save()` itself resets to `false` immediately after every successful save
 * (see that function's own comment: "tax is no longer a pending edit"), so
 * including it here would make the very next render after a successful tax
 * edit read as "changed" even though no field value actually moved.
 */
export function formSnapshot(state: ContractorPricingFormState): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- deliberately discarded below
  const { taxEdited, ...rest } = state;
  return JSON.stringify(rest);
}

/**
 * Whether the draft has changed since `savedSnapshot` was taken. `null` is
 * never dirty. The editor itself no longer passes `null`: it starts from
 * initContractorPricingEditorState()'s snapshot of the persisted rows it
 * loaded (see that function for why).
 */
export function hasUnsavedPricingChanges(
  state: ContractorPricingFormState,
  savedSnapshot: string | null
): boolean {
  if (savedSnapshot === null) return false;
  return formSnapshot(state) !== savedSnapshot;
}

/**
 * The editor's starting point: the form built from the persisted rows it
 * loaded, and that same form's snapshot as the dirty baseline.
 *
 * The loaded rows ARE the last saved state, so they are the baseline. A null
 * baseline ("nothing saved yet this mount") made every edit on a reopened,
 * already-complete estimate read as clean, so Send stayed visible on
 * /estimates/[id] while the screen showed prices the customer would never get.
 * Both values come from one form object, so the charge and line-item ids
 * inside the snapshot match the ids the editor then holds in state.
 */
export function initContractorPricingEditorState(
  rows: readonly ContractorPricingRowInput[],
  tax: EstimateTaxSnapshot,
  defaults: BusinessPricingDefaults
): { form: ContractorPricingFormState; savedSnapshot: string } {
  const form = initContractorPricingForm(rows, tax, defaults);
  return { form, savedSnapshot: formSnapshot(form) };
}

/**
 * Whether a finished save should bring the editor's save feedback into view:
 * a failed save (its error text), or a save that worked but left pricing
 * incomplete (the "Still needed before you can send this" guidance, which is
 * the only explanation there is -- an incomplete save is not an error). A
 * complete save reveals nothing: Send becoming available is its feedback.
 */
export function shouldRevealSaveFeedback(
  status: "idle" | "saving" | "saved" | "error",
  persistedComplete: boolean
): boolean {
  return status === "error" || (status === "saved" && !persistedComplete);
}
