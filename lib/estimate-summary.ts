// No DEFAULT_CURRENCY import on purpose. Every money-emitting function in this
// module takes an explicit currency, so the module has no way to fall back to
// CAD. That is enforced by the compiler, not by convention.
import { formatCurrency, type Currency } from './currency';
import { normalizeTaxLabel, resolveEstimateTax, type EstimateTax, type TaxAuthority } from './estimate-tax';

// Shared parse/serialize logic for estimate summary markdown.
// Used by the in-app editable estimate body and by display surfaces
// (share page, PDF) so section order and totals match everywhere.

export interface ScopeItem {
  id: string;
  text: string;
}

// A line item is either quantity-based (quantity x unit rate, cost calculated)
// or a flat fee (one description, one hand-typed cost). Estimates saved before
// the structured format shipped only ever have label + cost, and stay that way.
export interface LineItem {
  id: string;
  label: string;
  cost: string;
  quantity?: string;
  unit?: string;
  rate?: string;
  // Set once, when the item is first created (AI parse or the structured
  // branch of the parser), and never re-derived from current field values
  // after that. See isQuantityItem() for why this can't just be computed
  // live from quantity/rate.
  quantityBased?: boolean;
}

export interface AssumptionItem {
  id: string;
  text: string;
}

export interface BeforeSection {
  heading: string;
  bullets: AssumptionItem[];
  nonBullets: string;
}

export interface AfterSection {
  heading: string;
  content: string;
}

export interface ParsedSummary {
  preamble: string;
  scopeItems: ScopeItem[];
  lineItems: LineItem[];
  /**
   * The percent recovered from the visible "Deposit required (X%)" wording.
   * Authoritative only for an estimate predating the deposit-rule marker
   * (depositRule undefined below). An estimate that carries a marker resolves
   * its percent against its current total with effectiveDepositPercent(),
   * because that total depends on which tax applies (lib/estimate-tax.ts),
   * which cannot be decided from the text at parse time.
   */
  depositPercent: number;
  /**
   * The estimate's own deposit rule, snapshotted at generation time. `null`
   * means "this estimate has no deposit rule" (still a known, deliberate
   * state). `undefined` means no deposit-rule marker was found at all --
   * an estimate generated before this existed, or a hand-built markdown
   * string in a test -- so depositPercent above is the legacy value instead
   * of something resolved from this field.
   */
  depositRule: DepositRule | null | undefined;
  /**
   * The tax row written into the stored Pricing Summary, or null when the
   * summary has none. Stored text, not an authority: the tax that actually
   * applies comes from resolveEstimateTax() in lib/estimate-tax.ts.
   */
  storedTax: EstimateTax | null;
  beforePricingSections: BeforeSection[];
  afterPricingSections: AfterSection[];
}

export const newId = () => Math.random().toString(36).slice(2, 9);

// Strips an optional CA$ / US$ / $ prefix plus grouping commas and the bold
// asterisks the pricing table uses. The currency prefix has to come off here:
// once formatDollars() emits "CA$1,234", a parser that only removed "$" would
// leave "CA1234" and parseFloat would yield NaN, silently zeroing the amount.
export function parseCost(cost: string): number {
  return parseFloat(cost.replace(/(?:CA|US)?\$/g, '').replace(/[,*]/g, '')) || 0;
}

export function formatDollars(amount: number, currency: Currency, options: { bare?: boolean } = {}): string {
  return formatCurrency(amount, currency, { decimals: 0, bare: options.bare });
}

export function parseQuantity(raw: string | undefined): number {
  if (!raw) return 0;
  return parseFloat(raw.replace(/[^0-9.\-]/g, '')) || 0;
}

// Whether an item is quantity-based (quantity x rate, cost calculated) or a
// flat fee (one hand-typed cost). Reads the stable quantityBased flag set at
// creation time, never re-derived live from the current quantity/rate values.
//
// Two failure modes if this were computed live from the current field values
// instead:
// - Requiring BOTH fields non-blank (AND): while editing, clearing one field
//   to retype it (e.g. deleting "10" to change the quantity) flips the item
//   to flat mid-edit. The editor's expand/collapse UI is gated on this same
//   function, so the edit panel -- the very inputs being typed into --
//   unmounts itself, with no way back in short of deleting the item.
// - Requiring EITHER field non-blank (OR): the AI sometimes fills in Qty and
//   Unit for a material but leaves Rate blank (or vice versa) rather than
//   leaving all three blank as instructed. That row would then be treated as
//   quantity-based with a zero rate, discarding the AI's stated cost and
//   silently zeroing it out.
// A flag set once at parse time, using a strict check, avoids both: it can't
// be flipped by a user mid-edit, and an AI row that's genuinely incomplete
// falls back to trusting its own stated cost instead of being recomputed to
// zero.
export function isQuantityItem(item: LineItem): boolean {
  return item.quantityBased === true;
}

export function formatMoney(amount: number, currency: Currency, options: { bare?: boolean } = {}): string {
  return formatCurrency(amount, currency, { decimals: 2, bare: options.bare });
}

// Cost for a quantity-based item is always quantity x unit rate, never the
// stored cost cell. Flat fees keep whatever cost was typed.
export function lineItemCost(item: LineItem): number {
  if (isQuantityItem(item)) {
    return parseQuantity(item.quantity) * parseCost(item.rate ?? '');
  }
  return parseCost(item.cost);
}

export function withComputedCost(item: LineItem, currency: Currency): LineItem {
  if (!isQuantityItem(item)) return item;
  return { ...item, cost: formatMoney(lineItemCost(item), currency) };
}

// "hrs" reads as "/hr", "gal" stays "/gal". Units are freeform text the model
// writes, so this only trims a trailing plural rather than trying to be clever.
function perUnit(unit: string): string {
  const u = unit.trim();
  return u.length > 1 && u.endsWith('s') ? u.slice(0, -1) : u;
}

// How a quantity-based item reads to the contractor and the customer:
// "Labour (8 hrs @ $65.00/hr)". The quantity lives in the description, the
// arithmetic stays in code.
export function lineItemDisplayLabel(item: LineItem, currency: Currency): string {
  if (!isQuantityItem(item)) return item.label;
  const quantity = (item.quantity ?? '').trim();
  const unit = (item.unit ?? '').trim();
  const rate = formatMoney(parseCost(item.rate ?? ''), currency, { bare: true });
  const detail = unit ? `${quantity} ${unit} @ ${rate}/${perUnit(unit)}` : `${quantity} @ ${rate}`;
  return `${item.label} (${detail})`;
}

export function computeSubtotal(lineItems: LineItem[]): number {
  return lineItems.reduce((sum, i) => sum + lineItemCost(i), 0);
}

// taxRate is required. It used to default to 5: a second, hidden tax default
// that could silently disagree with the business's Rates settings.
export function computeTotals(lineItems: LineItem[], taxRate: number): {
  subtotal: number;
  tax: number;
  total: number;
} {
  const subtotal = computeSubtotal(lineItems);
  const tax = Math.round(subtotal * (taxRate / 100));
  return { subtotal, tax, total: subtotal + tax };
}

function syncPreambleTotal(preamble: string, lineItems: LineItem[], taxRate: number, currency: Currency): string {
  if (!preamble) return preamble;
  const { total } = computeTotals(lineItems, taxRate);
  return preamble.replace(
    /(^|\n)(?:Estimated total|Total):[^\n]*(\s*)$/i,
    (_match, before: string, after: string) => `${before}Estimated total: ${formatDollars(total, currency, { bare: true })}${after}`,
  );
}

// ── Parser ────────────────────────────────────────────────────────────────────

export function parseSummary(rawSummary: string): ParsedSummary {
  const filtered = rawSummary.split('\n').filter(l => !l.startsWith('# ')).join('\n');
  const lines = filtered.split('\n');

  type RawSection = { heading: string | null; lines: string[] };
  const rawSections: RawSection[] = [];
  let cur: RawSection = { heading: null, lines: [] };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      rawSections.push(cur);
      cur = { heading: line.slice(3).trim(), lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  rawSections.push(cur);

  const preamble = rawSections[0].lines.join('\n').trim();
  let scopeItems: ScopeItem[] = [];
  let lineItems: LineItem[] = [];
  let depositPercent = 0;
  let depositRule: DepositRule | null | undefined = undefined;
  // No default. A summary without a tax row has no stored tax, and the
  // caller's tax authority decides what applies (lib/estimate-tax.ts).
  let storedTax: EstimateTax | null = null;
  const beforePricingSections: BeforeSection[] = [];
  const afterPricingSections: AfterSection[] = [];
  let seenPricing = false;

  for (const sec of rawSections.slice(1)) {
    const h = sec.heading ?? '';
    if (h.toLowerCase() === 'scope of work') {
      scopeItems = sec.lines
        .filter(l => /^[-*] /.test(l))
        .map(l => ({ id: newId(), text: l.replace(/^[-*] /, '') }));
    } else if (h.toLowerCase() === 'line items') {
      lineItems = sec.lines
        .filter(l => l.startsWith('|'))
        .map(l =>
          l
            .split('|')
            .map(c => c.trim())
            .filter((_, i, a) => i > 0 && i < a.length - 1),
        )
        .filter(
          cells =>
            cells.length >= 2 &&
            !cells[0].toLowerCase().startsWith('item') &&
            !/^[-: ]+$/.test(cells[0]),
        )
        .map(cells => {
          // Structured format: Item | Qty | Unit | Rate | Cost. Older estimates
          // only have Item | Cost and are read as flat fees.
          if (cells.length >= 5) {
            // The one place quantityBased gets decided: strictly, from the raw
            // cells, both present. A row where the AI left only one of the two
            // blank (inconsistent with the prompt, but seen in practice) is
            // treated as flat rather than a quantity item with a zero rate, so
            // its stated cost is trusted instead of being recomputed to zero.
            const quantityBased = Boolean(cells[1]?.trim()) && Boolean(cells[3]?.trim());
            const item: LineItem = {
              id: newId(),
              label: cells[0],
              quantity: cells[1],
              unit: cells[2],
              rate: cells[3],
              cost: cells[4],
              quantityBased,
            };
            // Keep the stored cost cell verbatim. It used to be recomputed
            // and re-formatted here, which forced the parser to pick a
            // currency it has no way to know. The value is dead either way:
            // lineItemCost() recomputes quantity x rate for every quantity
            // row, and both serializers re-format from that, so nothing
            // displays or stores this field for a quantity item.
            return item;
          }
          return { id: newId(), label: cells[0], cost: cells[1] };
        });
    } else if (h.toLowerCase() === 'pricing summary') {
      seenPricing = true;
      for (const line of sec.lines) {
        if (/no deposit required/i.test(line)) {
          depositPercent = 0;
        }
        const dm = line.match(/Deposit.*?\((\d+)%\)/i);
        if (dm) depositPercent = parseInt(dm[1]);
        const tm = line.match(/Tax\s*\(([^)]*?)\s+(\d+(?:\.\d+)?)%\)/i);
        if (tm) {
          storedTax = { label: normalizeTaxLabel(tm[1]), rate: parseFloat(tm[2]) };
        }
        const ruleMatch = parseDepositRuleMarker(line);
        if (ruleMatch !== undefined) {
          depositRule = ruleMatch;
        }
      }
      // An estimate carrying a deposit-rule marker never trusts the visible
      // "Deposit required (X%)" / "No deposit required" wording above for
      // the decision or the percentage. That resolution happens in
      // effectiveDepositPercent(), not here: it needs the estimate's total,
      // and the total needs the tax that applies, which only the caller's
      // tax authority can decide.
    } else {
      if (seenPricing) {
        afterPricingSections.push({ heading: h, content: sec.lines.join('\n').trim() });
      } else {
        const stripBoldLabel = (text: string) => text.replace(/^\*\*[^*]+:\*\*\s*/, '').trim();
        let bullets = sec.lines
          .filter(l => /^[-*] /.test(l))
          .map(l => ({ id: newId(), text: stripBoldLabel(l.replace(/^[-*] /, '')) }));
        let nonBullets = sec.lines
          .filter(l => !/^[-*] /.test(l))
          .join('\n')
          .trim();
        if (bullets.length === 0 && nonBullets.trim()) {
          const sentences = nonBullets
            .split(/(?<=[.!?])\s+/)
            .map(s => s.trim())
            .filter(Boolean);
          bullets = sentences.map(text => ({ id: newId(), text: stripBoldLabel(text) }));
          nonBullets = '';
        }
        beforePricingSections.push({ heading: h, bullets, nonBullets });
      }
    }
  }

  return { preamble, scopeItems, lineItems, depositPercent, depositRule, storedTax, beforePricingSections, afterPricingSections };
}

// ── Section builders ──────────────────────────────────────────────────────────

function scopeBlock(scopeItems: ScopeItem[]): string {
  return `## Scope of Work\n${scopeItems.map(i => `- ${i.text}`).join('\n')}`;
}

// What the contractor and the customer see: two columns, with the quantity and
// rate folded into the description. A five-column table is unreadable on a
// phone, and nobody needs to see the arithmetic broken out. The stored form
// keeps the parts separate so the app can do the multiplying (see
// lineItemsBlock).
function displayLineItemsBlock(lineItems: LineItem[], currency: Currency): string {
  const table = [
    '| Item | Cost |',
    '|------|------|',
    ...lineItems.map(i => `| ${lineItemDisplayLabel(i, currency)} | ${formatMoney(lineItemCost(i), currency, { bare: true })} |`),
  ].join('\n');
  return `## Line Items\n${table}`;
}

// Exported so lib/estimate-items.ts can compare its structured round trip
// against the one authoritative serializer instead of reimplementing it.
// Export only: the body and behaviour are unchanged.
export function lineItemsBlock(lineItems: LineItem[], currency: Currency): string {
  // Storage form. Only estimates that actually have quantity-based items get
  // the wider table; older estimates keep the exact two-column layout they were
  // saved in. Keeping quantity, unit, and rate as separate columns here is what
  // lets the cost be recalculated instead of trusted.
  const structured = lineItems.some(isQuantityItem);
  const table = structured
    ? [
        '| Item | Qty | Unit | Rate | Cost |',
        '|------|-----|------|------|------|',
        ...lineItems.map(i =>
          isQuantityItem(i)
            ? `| ${i.label} | ${i.quantity} | ${i.unit ?? ''} | ${i.rate} | ${formatMoney(lineItemCost(i), currency, { bare: true })} |`
            : `| ${i.label} |  |  |  | ${i.cost} |`,
        ),
      ].join('\n')
    : [
        '| Item | Cost |',
        '|------|------|',
        ...lineItems.map(i => `| ${i.label} | ${i.cost} |`),
      ].join('\n');
  return `## Line Items\n${table}`;
}

function beforeBlock(s: BeforeSection): string {
  const bulletLines = s.bullets.map(b => `- ${b.text}`).join('\n');
  const sectionContent = [s.nonBullets, bulletLines].filter(Boolean).join('\n');
  return `## ${s.heading}\n${sectionContent}`;
}

// ── Deterministic deposit ──────────────────────────────────────────────────
//
// Whether a deposit applies, and how much it is, must never come from the
// model's own writing. The model may describe the job however it likes;
// these two functions are the one place that decides the deposit, from the
// business's actual Rates settings and this estimate's own authoritative
// total (computeTotals().total, the same total every other calculation in
// this file already treats as authoritative -- no second total is invented
// here).

export interface DepositRule {
  /** Whole-number percent, e.g. 25 for 25%. */
  percent: number;
  /** A deposit applies only when the total is strictly greater than this
   *  (the business setting reads "required over $X", not "at or over"). */
  thresholdDollars: number;
}

const DEPOSIT_RULE_MARKER_RE = /^\[deposit-rule\]:\s*#\s*\(([^)]*)\)\s*$/i;

/**
 * The estimate's own deposit rule, carried inside the summary text as a
 * markdown link reference definition -- a construct every CommonMark-
 * compliant renderer (including the react-markdown pipeline this app
 * already uses) parses and consumes silently, never as visible output, with
 * no plugin or renderer change required. The hand-rolled PDF line renderer
 * (lib/generate-pdf.ts) does not go through a markdown parser, so it has its
 * own explicit skip for this exact line shape.
 *
 * This is not a second calculation path: it exists so the rule survives
 * every edit (parseSummary -> serializeSummary already round-trips the rest
 * of the document on every save), so the deposit can be re-resolved from
 * the estimate's *current* total after a line-item edit changes it, without
 * needing a new persisted column.
 */
function formatDepositRuleMarker(rule: DepositRule | null): string {
  return `[deposit-rule]: # (${rule ? `${rule.percent}:${rule.thresholdDollars}` : 'none'})`;
}

/** undefined = not a deposit-rule marker line at all. */
function parseDepositRuleMarker(line: string): DepositRule | null | undefined {
  const m = line.match(DEPOSIT_RULE_MARKER_RE);
  if (!m) return undefined;
  const raw = m[1].trim();
  if (raw.toLowerCase() === 'none') return null;
  const [percentRaw, thresholdRaw] = raw.split(':');
  const percent = parseFloat(percentRaw);
  const thresholdDollars = parseFloat(thresholdRaw);
  return Number.isFinite(percent) && Number.isFinite(thresholdDollars)
    ? { percent, thresholdDollars }
    : null;
}

/**
 * 0 means no deposit. A rule with no percent or no threshold configured
 * never applies -- the same "both must be set" check the generation prompt
 * already uses when it decides what to tell the model.
 */
export function resolveDepositPercent(total: number, rule: DepositRule | null | undefined): number {
  if (!rule || !rule.percent || !rule.thresholdDollars) return 0;
  return total > rule.thresholdDollars ? rule.percent : 0;
}

/**
 * The deposit percent that applies to a parsed estimate for the given priced
 * rows and tax rate. An estimate with a deposit-rule marker re-resolves it
 * against that total; one predating the marker keeps its legacy stored
 * percent, so an old estimate's rendering does not change.
 */
export function effectiveDepositPercent(parsed: ParsedSummary, lineItems: LineItem[], taxRate: number): number {
  if (parsed.depositRule === undefined) return parsed.depositPercent;
  return resolveDepositPercent(computeTotals(lineItems, taxRate).total, parsed.depositRule);
}

/**
 * Deposit and balance for a given total and (already-decided) percent,
 * rounded to the cent rather than the whole dollar: 25% of $2,990 is
 * $747.50, not $748. `total * depositPercent` is already in cents (the
 * percent-to-fraction /100 and dollars-to-cents *100 cancel out), so
 * rounding that product before dividing by 100 avoids floating-point drift.
 */
export function computeDepositAndBalance(
  total: number,
  depositPercent: number
): { deposit: number; balance: number } {
  if (!depositPercent) return { deposit: 0, balance: total };
  const deposit = Math.round(total * depositPercent) / 100;
  return { deposit, balance: total - deposit };
}

// Any sentence mentioning "deposit" is model-written and untrustworthy for
// the deposit decision or amount -- removed outright rather than repaired,
// since the model's phrasing is otherwise unconstrained.
function normalizePaymentTermsDeposit(
  content: string,
  depositPercent: number,
  deposit: number,
  currency: Currency
): string {
  const sentences = content
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !/deposit/i.test(s));

  const canonical =
    depositPercent > 0
      ? `A deposit of ${formatMoney(deposit, currency, { bare: true })} (${depositPercent}% of the total) is required before work begins.`
      : 'No deposit is required.';

  return [canonical, ...sentences].join(' ').trim();
}

/**
 * Rewrites afterPricingSections' Payment Terms entry, if present, so its
 * deposit sentence agrees with an already-resolved percent/amount. Exported
 * so both generation (applyDeterministicDeposit, on the model's raw Payment
 * Terms text) and the editor (after every save that could change the
 * resolved deposit) reconcile Payment Terms the same one way -- they cannot
 * drift apart from each other by each doing their own version of this.
 */
export function reconcilePaymentTermsDeposit(
  afterPricingSections: AfterSection[],
  depositPercent: number,
  deposit: number,
  currency: Currency
): AfterSection[] {
  return afterPricingSections.map(section =>
    /^payment terms$/i.test(section.heading.trim())
      ? { ...section, content: normalizePaymentTermsDeposit(section.content, depositPercent, deposit, currency) }
      : section
  );
}

/**
 * Rewrites a freshly generated estimate's Pricing Summary deposit row and
 * Payment Terms deposit sentence so both agree with the business's actual
 * deposit rule, regardless of what the model wrote for either one. Called
 * once, right after generation, before the estimate is first saved.
 *
 * Everything else in the document -- scope, line items, assumptions, the
 * rest of Payment Terms, Notes -- round-trips through parseSummary /
 * serializeSummary unchanged: the same round trip every line-item edit
 * already goes through, so no new formatting behaviour is introduced here.
 */
export function applyDeterministicDeposit(
  rawSummary: string,
  currency: Currency,
  rule: DepositRule | null | undefined,
  // The business's Rates tax. Generation only ever creates an undelivered
  // estimate, so Rates is the authority: any tax row the model wrote is
  // ignored and replaced here.
  tax: EstimateTax
): string {
  const parsed = parseSummary(rawSummary);
  const { total } = computeTotals(parsed.lineItems, tax.rate);
  const depositPercent = resolveDepositPercent(total, rule);
  const { deposit } = computeDepositAndBalance(total, depositPercent);

  const afterPricingSections = reconcilePaymentTermsDeposit(
    parsed.afterPricingSections,
    depositPercent,
    deposit,
    currency
  );

  return serializeSummary(
    parsed.preamble,
    parsed.scopeItems,
    parsed.lineItems,
    depositPercent,
    parsed.beforePricingSections,
    afterPricingSections,
    tax.label,
    tax.rate,
    currency,
    rule
  );
}

function pricingBlock(
  lineItems: LineItem[],
  depositPercent: number,
  taxLabel: string,
  taxRate: number,
  currency: Currency,
  depositRule?: DepositRule | null
): string {
  const { subtotal, tax, total } = computeTotals(lineItems, taxRate);
  const { deposit, balance } = computeDepositAndBalance(total, depositPercent);

  // Only the Total row identifies the currency explicitly (CA$/US$). Every
  // other row here is an intermediate value on the same estimate, so it
  // renders bare ($) rather than repeating the code down the whole table --
  // the Total row is the one place a customer needs it disambiguated.
  const table = [
    '| | |',
    '|---|---|',
    `| Subtotal | ${formatDollars(subtotal, currency, { bare: true })} |`,
    `| Tax (${taxLabel} ${parseFloat(taxRate.toFixed(2))}%) | ${formatDollars(tax, currency, { bare: true })} |`,
    `| **Total** | **${formatDollars(total, currency)}** |`,
    depositPercent === 0
      ? '| No deposit required | |'
      // Deposit is a percentage of the total, so it is not generally a whole
      // dollar amount (25% of $2,990 is $747.50) -- shown to the cent, unlike
      // Subtotal/Tax/Total above, which stay whole-dollar as before.
      : `| Deposit required (${depositPercent}%) | ${formatMoney(deposit, currency, { bare: true })} |`,
    `| Balance on completion | ${depositPercent === 0 ? formatDollars(total, currency, { bare: true }) : formatMoney(balance, currency, { bare: true })} |`,
  ].join('\n');
  const block = `## Pricing Summary\n${table}`;
  // depositRule is only appended when the caller actually knows it (an
  // estimate that predates this feature has none to preserve, and must not
  // gain one just by being re-rendered).
  return depositRule !== undefined ? `${block}\n${formatDepositRuleMarker(depositRule)}` : block;
}

// ── Serializer (storage order: assumptions before pricing) ───────────────────

export function serializeSummary(
  preamble: string,
  scopeItems: ScopeItem[],
  lineItems: LineItem[],
  depositPercent: number,
  beforePricingSections: BeforeSection[],
  afterPricingSections: AfterSection[],
  taxLabel: string,
  taxRate: number,
  currency: Currency,
  depositRule?: DepositRule | null,
): string {
  const parts: string[] = [];
  if (preamble) parts.push(syncPreambleTotal(preamble, lineItems, taxRate, currency));
  parts.push(scopeBlock(scopeItems));
  parts.push(lineItemsBlock(lineItems, currency));
  for (const s of beforePricingSections) parts.push(beforeBlock(s));
  parts.push(pricingBlock(lineItems, depositPercent, taxLabel, taxRate, currency, depositRule));
  for (const s of afterPricingSections) parts.push(`## ${s.heading}\n${s.content}`);
  return parts.join('\n\n');
}

// ── Total calculator ──────────────────────────────────────────────────────────

export function calculateEstimateTotal(summary: string, taxAuthority: TaxAuthority): number {
  const p = parseSummary(summary);
  return Math.round(computeTotals(p.lineItems, resolveEstimateTax(p.storedTax, taxAuthority).rate).total);
}

// ── Display formatter ─────────────────────────────────────────────────────────
// Re-serializes a stored summary in the spec order (assumptions before
// pricing: Scope of Work, Line Items, Assumptions and Exclusions, Pricing
// Summary, Payment Terms, Notes) with the pricing table recomputed from line
// items and rounded to whole dollars. Line items collapse to two columns here,
// which is what the share page and the PDF render.

// `currency` is required, not defaulted. A USD estimate rendered CA$ on the
// share page, in the PDF, and on /new because this function quietly fell back
// to CAD whenever a caller forgot to pass the snapshot. Every caller here has
// an estimate in hand, so every caller can supply its currency, and the
// compiler now says so.
// `taxAuthority` is required for the same reason: which tax applies depends on
// whether the estimate has been delivered (lib/estimate-tax.ts), and only the
// caller holds the estimate and its business.
export function formatEstimateForDisplay(summary: string, currency: Currency, taxAuthority: TaxAuthority): string {
  const p = parseSummary(summary);
  return formatParsedEstimateForDisplay(p, p.lineItems, currency, resolveEstimateTax(p.storedTax, taxAuthority));
}

/**
 * Render the prose from a stored summary with an explicit authoritative set
 * of priced rows. Structured estimates use this so the database rows own all
 * customer-visible arithmetic while the markdown remains the prose source.
 * A caller may replace only the Line Items block, which is how grouped mode
 * reuses the same totals and section-order implementation as detailed mode.
 */
export function formatEstimateForDisplayWithPricing(
  summary: string,
  lineItems: LineItem[],
  currency: Currency,
  taxAuthority: TaxAuthority,
  lineItemsDisplayBlock?: string
): string {
  const p = parseSummary(summary);
  return formatParsedEstimateForDisplay(
    p,
    lineItems,
    currency,
    resolveEstimateTax(p.storedTax, taxAuthority),
    lineItemsDisplayBlock
  );
}

// Currency sits ahead of the optional display block on purpose. It was last in
// the list and defaulted, which is how a caller that only wanted to override
// the Line Items block silently reset the currency to CAD at the same time.
function formatParsedEstimateForDisplay(
  p: ParsedSummary,
  lineItems: LineItem[],
  currency: Currency,
  tax: EstimateTax,
  lineItemsDisplayBlock?: string
): string {
  const parts: string[] = [];
  if (p.preamble) parts.push(syncPreambleTotal(p.preamble, lineItems, tax.rate, currency));
  parts.push(scopeBlock(p.scopeItems));
  parts.push(lineItemsDisplayBlock ?? displayLineItemsBlock(lineItems, currency));
  for (const s of p.beforePricingSections) parts.push(beforeBlock(s));
  // p.depositRule, not a fresh lookup: this re-render must not let a later
  // change to the business's Rates settings retroactively alter an estimate
  // that was already generated (same snapshot rule as currency and tax).
  parts.push(
    pricingBlock(lineItems, effectiveDepositPercent(p, lineItems, tax.rate), tax.label, tax.rate, currency, p.depositRule)
  );
  for (const s of p.afterPricingSections) parts.push(`## ${s.heading}\n${s.content}`);
  return parts.join('\n\n');
}
