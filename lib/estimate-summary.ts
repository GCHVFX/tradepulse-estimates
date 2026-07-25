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
  depositPercent: number;
  taxLabel: string;
  taxRate: number;
  beforePricingSections: BeforeSection[];
  afterPricingSections: AfterSection[];
}

export const newId = () => Math.random().toString(36).slice(2, 9);

export function parseCost(cost: string): number {
  return parseFloat(cost.replace(/[$,*]/g, '')) || 0;
}

export function formatDollars(amount: number): string {
  return '$' + Math.round(amount).toLocaleString('en-CA');
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

export function formatMoney(amount: number): string {
  return '$' + amount.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Cost for a quantity-based item is always quantity x unit rate, never the
// stored cost cell. Flat fees keep whatever cost was typed.
export function lineItemCost(item: LineItem): number {
  if (isQuantityItem(item)) {
    return parseQuantity(item.quantity) * parseCost(item.rate ?? '');
  }
  return parseCost(item.cost);
}

export function withComputedCost(item: LineItem): LineItem {
  if (!isQuantityItem(item)) return item;
  return { ...item, cost: formatMoney(lineItemCost(item)) };
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
export function lineItemDisplayLabel(item: LineItem): string {
  if (!isQuantityItem(item)) return item.label;
  const quantity = (item.quantity ?? '').trim();
  const unit = (item.unit ?? '').trim();
  const rate = formatMoney(parseCost(item.rate ?? ''));
  const detail = unit ? `${quantity} ${unit} @ ${rate}/${perUnit(unit)}` : `${quantity} @ ${rate}`;
  return `${item.label} (${detail})`;
}

export function computeTotals(lineItems: LineItem[], taxRate = 5): {
  subtotal: number;
  tax: number;
  total: number;
} {
  const subtotal = lineItems.reduce((sum, i) => sum + lineItemCost(i), 0);
  const tax = Math.round(subtotal * (taxRate / 100));
  return { subtotal, tax, total: subtotal + tax };
}

function syncPreambleTotal(preamble: string, lineItems: LineItem[], taxRate = 5): string {
  if (!preamble) return preamble;
  const { total } = computeTotals(lineItems, taxRate);
  return preamble.replace(
    /(^|\n)(?:Estimated total|Total):[^\n]*(\s*)$/i,
    (_match, before: string, after: string) => `${before}Estimated total: ${formatDollars(total)}${after}`,
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
  let taxLabel = 'GST';
  let taxRate = 5;
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
            return quantityBased ? withComputedCost(item) : item;
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
          taxLabel = tm[1].replace(/[a-zA-Z]+/g, w => w.toUpperCase()).trim();
          taxRate = parseFloat(tm[2]);
        }
      }
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

  return { preamble, scopeItems, lineItems, depositPercent, taxLabel, taxRate, beforePricingSections, afterPricingSections };
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
function displayLineItemsBlock(lineItems: LineItem[]): string {
  const table = [
    '| Item | Cost |',
    '|------|------|',
    ...lineItems.map(i => `| ${lineItemDisplayLabel(i)} | ${formatMoney(lineItemCost(i))} |`),
  ].join('\n');
  return `## Line Items\n${table}`;
}

function lineItemsBlock(lineItems: LineItem[]): string {
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
            ? `| ${i.label} | ${i.quantity} | ${i.unit ?? ''} | ${i.rate} | ${formatMoney(lineItemCost(i))} |`
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

function pricingBlock(lineItems: LineItem[], depositPercent: number, taxLabel = 'GST', taxRate = 5): string {
  const { subtotal, tax, total } = computeTotals(lineItems, taxRate);
  const deposit = Math.round((total * depositPercent) / 100);
  const balance = total - deposit;

  const table = [
    '| | |',
    '|---|---|',
    `| Subtotal | ${formatDollars(subtotal)} |`,
    `| Tax (${taxLabel} ${parseFloat(taxRate.toFixed(2))}%) | ${formatDollars(tax)} |`,
    `| **Total** | **${formatDollars(total)}** |`,
    depositPercent === 0
      ? '| No deposit required | |'
      : `| Deposit required (${depositPercent}%) | ${formatDollars(deposit)} |`,
    `| Balance on completion | ${depositPercent === 0 ? formatDollars(total) : formatDollars(balance)} |`,
  ].join('\n');
  return `## Pricing Summary\n${table}`;
}

// ── Serializer (storage order: assumptions before pricing) ───────────────────

export function serializeSummary(
  preamble: string,
  scopeItems: ScopeItem[],
  lineItems: LineItem[],
  depositPercent: number,
  beforePricingSections: BeforeSection[],
  afterPricingSections: AfterSection[],
  taxLabel = 'GST',
  taxRate = 5,
): string {
  const parts: string[] = [];
  if (preamble) parts.push(syncPreambleTotal(preamble, lineItems, taxRate));
  parts.push(scopeBlock(scopeItems));
  parts.push(lineItemsBlock(lineItems));
  for (const s of beforePricingSections) parts.push(beforeBlock(s));
  parts.push(pricingBlock(lineItems, depositPercent, taxLabel, taxRate));
  for (const s of afterPricingSections) parts.push(`## ${s.heading}\n${s.content}`);
  return parts.join('\n\n');
}

// ── Total calculator ──────────────────────────────────────────────────────────

export function calculateEstimateTotal(summary: string): number {
  const p = parseSummary(summary);
  return Math.round(computeTotals(p.lineItems, p.taxRate).total);
}

// ── Display formatter ─────────────────────────────────────────────────────────
// Re-serializes a stored summary in the spec order (assumptions before
// pricing: Scope of Work, Line Items, Assumptions and Exclusions, Pricing
// Summary, Payment Terms, Notes) with the pricing table recomputed from line
// items and rounded to whole dollars. Line items collapse to two columns here,
// which is what the share page and the PDF render.

export function formatEstimateForDisplay(summary: string): string {
  const p = parseSummary(summary);
  const parts: string[] = [];
  if (p.preamble) parts.push(syncPreambleTotal(p.preamble, p.lineItems, p.taxRate));
  parts.push(scopeBlock(p.scopeItems));
  parts.push(displayLineItemsBlock(p.lineItems));
  for (const s of p.beforePricingSections) parts.push(beforeBlock(s));
  parts.push(pricingBlock(p.lineItems, p.depositPercent, p.taxLabel, p.taxRate));
  for (const s of p.afterPricingSections) parts.push(`## ${s.heading}\n${s.content}`);
  return parts.join('\n\n');
}
