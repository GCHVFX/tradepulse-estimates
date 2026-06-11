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
          break;
        }
        const m = line.match(/Deposit.*?\((\d+)%\)/i);
        if (m) {
          depositPercent = parseInt(m[1]);
          break;
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

  return { preamble, scopeItems, lineItems, depositPercent, beforePricingSections, afterPricingSections };
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

function pricingBlock(lineItems: LineItem[], depositPercent: number): string {
  const subtotal = lineItems.reduce((sum, i) => sum + parseCost(i.cost), 0);
  const tax = Math.round(subtotal * 0.05);
  const total = subtotal + tax;
  const deposit = Math.round((total * depositPercent) / 100);
  const balance = total - deposit;

  const table = [
    '| | |',
    '|---|---|',
    `| Subtotal | ${formatDollars(subtotal)} |`,
    `| Tax (GST 5%) | ${formatDollars(tax)} |`,
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
): string {
  const parts: string[] = [];
  if (preamble) parts.push(preamble);
  parts.push(scopeBlock(scopeItems));
  parts.push(lineItemsBlock(lineItems));
  for (const s of beforePricingSections) parts.push(beforeBlock(s));
  parts.push(pricingBlock(lineItems, depositPercent));
  for (const s of afterPricingSections) parts.push(`## ${s.heading}\n${s.content}`);
  return parts.join('\n\n');
}

// ── Total calculator ──────────────────────────────────────────────────────────
// Same math as the in-app pricing summary: subtotal from line items, 5% GST
// rounded to whole dollars.

export function calculateEstimateTotal(summary: string): number {
  const p = parseSummary(summary);
  const subtotal = p.lineItems.reduce((sum, i) => sum + parseCost(i.cost), 0);
  const tax = Math.round(subtotal * 0.05);
  return Math.round(subtotal + tax);
}

// ── Display formatter ─────────────────────────────────────────────────────────
// Re-serializes a stored summary in the order the in-app estimate shows it
// (Pricing Summary directly after Line Items, assumptions after pricing) with
// the pricing table recomputed from line items and rounded to whole dollars,
// matching the in-app view exactly.

export function formatEstimateForDisplay(summary: string): string {
  const p = parseSummary(summary);
  const parts: string[] = [];
  if (p.preamble) parts.push(p.preamble);
  parts.push(scopeBlock(p.scopeItems));
  parts.push(lineItemsBlock(p.lineItems));
  parts.push(pricingBlock(p.lineItems, p.depositPercent));
  for (const s of p.beforePricingSections) parts.push(beforeBlock(s));
  for (const s of p.afterPricingSections) parts.push(`## ${s.heading}\n${s.content}`);
  return parts.join('\n\n');
}
