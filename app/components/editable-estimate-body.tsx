'use client';

import { useState, useRef } from 'react';
import { EstimateMarkdown } from '@/app/components/estimate-markdown';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScopeItem {
  id: string;
  text: string;
}

interface LineItem {
  id: string;
  label: string;
  cost: string;
}

interface AssumptionItem {
  id: string;
  text: string;
}

interface BeforeSection {
  heading: string;
  bullets: AssumptionItem[];
  nonBullets: string;
}

interface UndoEntry {
  item: ScopeItem | LineItem | AssumptionItem;
  index: number;
  type: 'scope' | 'lineItem' | 'assumption';
  sectionHeading?: string;
}

interface ParsedSummary {
  preamble: string;
  scopeItems: ScopeItem[];
  lineItems: LineItem[];
  depositPercent: number;
  beforePricingSections: BeforeSection[];
  afterPricingSections: Array<{ heading: string; content: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const newId = () => Math.random().toString(36).slice(2, 9);

function parseCost(cost: string): number {
  return parseFloat(cost.replace(/[$,*]/g, '')) || 0;
}

function formatDollars(amount: number): string {
  return '$' + Math.round(amount).toLocaleString('en-CA');
}

// ── Parser ────────────────────────────────────────────────────────────────────

function parseSummary(rawSummary: string): ParsedSummary {
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
  const afterPricingSections: Array<{ heading: string; content: string }> = [];
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
        const m = line.match(/Deposit.*?\((\d+)%\)/i);
        if (m) {
          depositPercent = parseInt(m[1]);
          break;
        }
      }
      const noDepositLine = sec.lines.find(l => /no deposit required/i.test(l));
      if (noDepositLine) { depositPercent = 0; }
    } else {
      if (seenPricing) {
        afterPricingSections.push({ heading: h, content: sec.lines.join('\n').trim() });
      } else {
        const bullets = sec.lines
          .filter(l => /^[-*] /.test(l))
          .map(l => ({ id: newId(), text: l.replace(/^[-*] /, '') }));
        const nonBullets = sec.lines
          .filter(l => !/^[-*] /.test(l))
          .join('\n')
          .trim();
        beforePricingSections.push({ heading: h, bullets, nonBullets });
      }
    }
  }

  return { preamble, scopeItems, lineItems, depositPercent, beforePricingSections, afterPricingSections };
}

// ── Serializer ────────────────────────────────────────────────────────────────

function serializeSummary(
  preamble: string,
  scopeItems: ScopeItem[],
  lineItems: LineItem[],
  depositPercent: number,
  beforePricingSections: BeforeSection[],
  afterPricingSections: Array<{ heading: string; content: string }>,
): string {
  const subtotal = lineItems.reduce((sum, i) => sum + parseCost(i.cost), 0);
  const tax = Math.round(subtotal * 0.05);
  const total = subtotal + tax;
  const deposit = Math.round((total * depositPercent) / 100);
  const balance = total - deposit;

  const parts: string[] = [];
  if (preamble) parts.push(preamble);

  parts.push(`## Scope of Work\n${scopeItems.map(i => `- ${i.text}`).join('\n')}`);

  const liTable = [
    '| Item | Cost |',
    '|------|------|',
    ...lineItems.map(i => `| ${i.label} | ${i.cost} |`),
  ].join('\n');
  parts.push(`## Line Items\n${liTable}`);

  for (const s of beforePricingSections) {
    const bulletLines = s.bullets.map(b => `- ${b.text}`).join('\n');
    const sectionContent = [s.nonBullets, bulletLines].filter(Boolean).join('\n');
    parts.push(`## ${s.heading}\n${sectionContent}`);
  }

  const prTable = [
    '| | |',
    '|---|---|',
    `| Subtotal | ${formatDollars(subtotal)} |`,
    `| Tax (GST 5%) | ${formatDollars(tax)} |`,
    `| **Total** | **${formatDollars(total)}** |`,
    ...(depositPercent === 0
      ? [
          `| No deposit required | |`,
          `| Balance on completion | ${formatDollars(total)} |`,
        ]
      : [
          `| Deposit required (${depositPercent}%) | ${formatDollars(deposit)} |`,
          `| Balance on completion | ${formatDollars(balance)} |`,
        ]),
  ].join('\n');
  parts.push(`## Pricing Summary\n${prTable}`);

  for (const s of afterPricingSections) {
    parts.push(`## ${s.heading}\n${s.content}`);
  }

  return parts.join('\n\n');
}

// ── X button ──────────────────────────────────────────────────────────────────

function XBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 w-8 h-8 flex items-center justify-center text-red-400 hover:text-red-600 transition-colors"
      aria-label="Remove item"
    >
      <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-base font-bold text-zinc-900 mt-6 mb-2 uppercase tracking-wide">
      {children}
    </h2>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EditableEstimateBody({
  summary,
  estimateId,
}: {
  summary: string;
  estimateId: string;
}) {
  const parsedRef = useRef<ParsedSummary | null>(null);
  if (!parsedRef.current) parsedRef.current = parseSummary(summary);
  const { preamble, depositPercent, afterPricingSections } = parsedRef.current;

  const [scopeItems, setScopeItems] = useState<ScopeItem[]>(parsedRef.current.scopeItems);
  const [lineItems, setLineItems] = useState<LineItem[]>(parsedRef.current.lineItems);
  const [beforeSections, setBeforeSections] = useState<BeforeSection[]>(
    parsedRef.current.beforePricingSections,
  );
  const [undo, setUndo] = useState<UndoEntry | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newCost, setNewCost] = useState('');

  const subtotal = lineItems.reduce((sum, i) => sum + parseCost(i.cost), 0);
  const tax = Math.round(subtotal * 0.05);
  const total = subtotal + tax;
  const deposit = Math.round((total * depositPercent) / 100);
  const balance = total - deposit;

  function startCommitTimer(
    nextScope: ScopeItem[],
    nextLine: LineItem[],
    nextBefore: BeforeSection[],
  ) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setToastVisible(false);
      setUndo(null);
      const newSummary = serializeSummary(
        preamble,
        nextScope,
        nextLine,
        depositPercent,
        nextBefore,
        afterPricingSections,
      );
      fetch('/api/estimates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: estimateId, summary: newSummary }),
      });
    }, 4000);
  }

  function removeScope(id: string) {
    const idx = scopeItems.findIndex(i => i.id === id);
    const item = scopeItems[idx];
    const nextScope = scopeItems.filter(i => i.id !== id);
    setScopeItems(nextScope);
    setUndo({ item, index: idx, type: 'scope' });
    setToastVisible(true);
    startCommitTimer(nextScope, lineItems, beforeSections);
  }

  function removeLine(id: string) {
    const idx = lineItems.findIndex(i => i.id === id);
    const item = lineItems[idx];
    const nextLine = lineItems.filter(i => i.id !== id);
    setLineItems(nextLine);
    setUndo({ item, index: idx, type: 'lineItem' });
    setToastVisible(true);
    startCommitTimer(scopeItems, nextLine, beforeSections);
  }

  function handleAddItem() {
    if (!newLabel.trim() || !newCost.trim()) return;
    const item: LineItem = { id: newId(), label: newLabel.trim(), cost: newCost.trim() };
    const nextLine = [...lineItems, item];
    setLineItems(nextLine);
    setNewLabel('');
    setNewCost('');
    setShowAddItem(false);
    startCommitTimer(scopeItems, nextLine, beforeSections);
  }

  function removeAssumption(sectionHeading: string, id: string) {
    const nextBefore = beforeSections.map(s => {
      if (s.heading !== sectionHeading) return s;
      const idx = s.bullets.findIndex(b => b.id === id);
      const item = s.bullets[idx];
      setUndo({ item, index: idx, type: 'assumption', sectionHeading });
      return { ...s, bullets: s.bullets.filter(b => b.id !== id) };
    });
    setBeforeSections(nextBefore);
    setToastVisible(true);
    startCommitTimer(scopeItems, lineItems, nextBefore);
  }

  function handleUndo() {
    if (!undo) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;

    if (undo.type === 'scope') {
      setScopeItems(prev => {
        const next = [...prev];
        next.splice(undo.index, 0, undo.item as ScopeItem);
        return next;
      });
    } else if (undo.type === 'lineItem') {
      setLineItems(prev => {
        const next = [...prev];
        next.splice(undo.index, 0, undo.item as LineItem);
        return next;
      });
    } else if (undo.type === 'assumption' && undo.sectionHeading) {
      const heading = undo.sectionHeading;
      const idx = undo.index;
      const item = undo.item as AssumptionItem;
      setBeforeSections(prev =>
        prev.map(s => {
          if (s.heading !== heading) return s;
          const next = [...s.bullets];
          next.splice(idx, 0, item);
          return { ...s, bullets: next };
        }),
      );
    }

    setToastVisible(false);
    setUndo(null);
  }

  return (
    <>
      {/* Preamble */}
      {preamble && (
        <EstimateMarkdown content={preamble} />
      )}

      {/* Scope of Work */}
      <SectionHeading>Scope of Work</SectionHeading>
      <ul className="mb-3 space-y-1">
        {scopeItems.map(item => (
          <li key={item.id} className="flex items-start gap-2 text-sm text-zinc-700 leading-relaxed">
            <span className="text-amber-500 mt-0.5 shrink-0">•</span>
            <span className="flex-1">{item.text}</span>
            <XBtn onClick={() => removeScope(item.id)} />
          </li>
        ))}
      </ul>

      {/* Line Items */}
      <SectionHeading>Line Items</SectionHeading>
      <div className="mb-4 overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full text-sm">
          <thead className="bg-zinc-100">
            <tr>
              <th className="px-3 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide text-left">
                Item
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide text-left">
                Cost
              </th>
              <th style={{ width: 40, minWidth: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lineItems.map(item => (
              <tr key={item.id}>
                <td className="px-3 py-2.5 text-zinc-700 border-t border-zinc-200">{item.label}</td>
                <td className="px-3 py-2.5 text-zinc-700 border-t border-zinc-200 whitespace-nowrap">
                  {item.cost}
                </td>
                <td className="border-t border-zinc-200 pr-1" style={{ width: 40, minWidth: 40 }}>
                  <XBtn onClick={() => removeLine(item.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add item */}
      {showAddItem ? (
        <div className="mb-4 flex flex-col gap-2">
          <input
            type="text"
            className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]"
            placeholder="Item description"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            autoFocus
          />
          <input
            type="text"
            className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]"
            placeholder="Cost (e.g. $150)"
            value={newCost}
            onChange={(e) => setNewCost(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddItem()}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAddItem}
              disabled={!newLabel.trim() || !newCost.trim()}
              className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-sm rounded-lg py-2.5 transition-colors min-h-[44px]"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => { setShowAddItem(false); setNewLabel(''); setNewCost(''); }}
              className="flex-1 border border-zinc-200 text-zinc-600 hover:text-zinc-900 text-sm rounded-lg py-2.5 transition-colors min-h-[44px]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddItem(true)}
          className="mb-4 text-sm text-amber-600 hover:text-amber-500 transition-colors flex items-center gap-1.5 min-h-[44px]"
        >
          <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Add item
        </button>
      )}

      {/* Sections between line items and pricing (e.g. Assumptions and Exclusions) */}
      {beforeSections.map(s => (
        <div key={s.heading}>
          <SectionHeading>{s.heading}</SectionHeading>
          {s.nonBullets && (
            <EstimateMarkdown content={s.nonBullets} />
          )}
          {s.bullets.length > 0 && (
            <ul className="mb-3 space-y-1">
              {s.bullets.map(item => (
                <li
                  key={item.id}
                  className="flex items-start gap-2 text-sm text-zinc-700 leading-relaxed"
                >
                  <span className="text-amber-500 mt-0.5 shrink-0">•</span>
                  <span className="flex-1">{item.text}</span>
                  <XBtn onClick={() => removeAssumption(s.heading, item.id)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {/* Pricing Summary — always recalculated */}
      <SectionHeading>Pricing Summary</SectionHeading>
      <div className="mb-4 overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full text-sm">
          <tbody>
            {(
              [
                ['Subtotal', formatDollars(subtotal), false],
                ['Tax (GST 5%)', formatDollars(tax), false],
                ['Total', formatDollars(total), true],
                ...(depositPercent === 0
                  ? [
                      ['No deposit required', '', false] as [string, string, boolean],
                      ['Balance on completion', formatDollars(total), false] as [string, string, boolean],
                    ]
                  : [
                      [`Deposit required (${depositPercent}%)`, formatDollars(deposit), false] as [string, string, boolean],
                      ['Balance on completion', formatDollars(balance), false] as [string, string, boolean],
                    ]),
              ] as [string, string, boolean][]
            ).map(([label, amount, bold]) => (
              <tr key={label}>
                <td
                  className={`px-3 py-2.5 border-t border-zinc-200 ${
                    bold ? 'font-semibold text-zinc-900' : 'text-zinc-700'
                  }`}
                >
                  {label}
                </td>
                <td
                  className={`px-3 py-2.5 border-t border-zinc-200 text-right ${
                    bold ? 'font-semibold text-zinc-900' : 'text-zinc-700'
                  }`}
                >
                  {amount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Sections after pricing (Payment Terms, Notes) */}
      {afterPricingSections.map(s => (
        <div key={s.heading}>
          <SectionHeading>{s.heading}</SectionHeading>
          <EstimateMarkdown content={s.content} />
        </div>
      ))}

      {/* Toast */}
      {toastVisible && (
        <div className="fixed bottom-[5.5rem] left-0 right-0 z-50 flex justify-center px-4">
          <div className="w-full max-w-sm bg-zinc-800 rounded-2xl px-4 py-3 flex items-center justify-between shadow-lg">
            <span className="text-sm font-medium text-white">Item removed</span>
            <button
              onClick={handleUndo}
              className="text-sm font-bold text-amber-400 min-h-[44px] px-3 flex items-center"
            >
              Undo
            </button>
          </div>
        </div>
      )}
    </>
  );
}
