// Shared parse/serialize logic for estimate summary markdown.
// Used by the in-app editable estimate body and by display surfaces
// (share page, PDF) so section order and totals match everywhere.

export interface ScopeItem {
  id: string;
  text: string;
}

export interface LineItem {
  id: string;
  label: string;
  cost: string;
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

export function computeTotals(lineItems: LineItem[], taxRate = 5): {
  subtotal: number;
  tax: number;
  total: number;
} {
  const subtotal = lineItems.reduce((sum, i) => sum + parseCost(i.cost), 0);
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
        .map(cells => ({ id: newId(), label: cells[0], cost: cells[1] }));
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

function lineItemsBlock(lineItems: LineItem[]): string {
  const table = [
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
// items and rounded to whole dollars.

export function formatEstimateForDisplay(summary: string): string {
  const p = parseSummary(summary);
  const parts: string[] = [];
  if (p.preamble) parts.push(syncPreambleTotal(p.preamble, p.lineItems, p.taxRate));
  parts.push(scopeBlock(p.scopeItems));
  parts.push(lineItemsBlock(p.lineItems));
  for (const s of p.beforePricingSections) parts.push(beforeBlock(s));
  parts.push(pricingBlock(p.lineItems, p.depositPercent, p.taxLabel, p.taxRate));
  for (const s of p.afterPricingSections) parts.push(`## ${s.heading}\n${s.content}`);
  return parts.join('\n\n');
}
