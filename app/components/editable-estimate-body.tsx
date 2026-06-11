'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import {
  newId,
  parseCost,
  formatDollars,
  parseSummary,
  serializeSummary,
} from '@/lib/estimate-summary';
import type {
  ScopeItem,
  LineItem,
  AssumptionItem,
  BeforeSection,
} from '@/lib/estimate-summary';

// ── Types ─────────────────────────────────────────────────────────────────────

interface UndoEntry {
  item: ScopeItem | LineItem | AssumptionItem;
  index: number;
  type: 'scope' | 'lineItem' | 'assumption';
  sectionHeading?: string;
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
    <h2 className="text-base font-bold text-zinc-900 mt-6 mb-2 uppercase tracking-wide border-l-[3px] border-amber-500 pl-2.5">
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
  const parsed = useMemo(() => parseSummary(summary), [summary]);
  const { depositPercent } = parsed;

  const [preambleText, setPreambleText] = useState<string>(() => parsed.preamble);
  const [scopeItems, setScopeItems] = useState<ScopeItem[]>(() => parsed.scopeItems);
  const [lineItems, setLineItems] = useState<LineItem[]>(() => parsed.lineItems);
  const [beforeSections, setBeforeSections] = useState<BeforeSection[]>(
    () => parsed.beforePricingSections,
  );
  const [afterSections, setAfterSections] = useState<Array<{ heading: string; content: string }>>(
    () => parsed.afterPricingSections,
  );
  const [undo, setUndo] = useState<UndoEntry | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newCost, setNewCost] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [focusId, setFocusId] = useState<string | null>(null);

  // Leave-page warning when a save is pending
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (timerRef.current !== null) e.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // The AI writes a plain "Total: $X" line at the end of the job summary.
  // Split it out of the textarea so it can render bold; rejoined on save.
  const preambleTotalMatch = preambleText.match(/(?:^|\n)(Total:[^\n]*)\s*$/i);
  const preambleTotalLine = preambleTotalMatch ? preambleTotalMatch[1].trim() : null;
  const preambleBody = preambleTotalMatch
    ? preambleText.slice(0, preambleTotalMatch.index)
    : preambleText;

  const subtotal = lineItems.reduce((sum, i) => sum + parseCost(i.cost), 0);
  const tax = Math.round(subtotal * 0.05);
  const total = subtotal + tax;
  const deposit = Math.round((total * depositPercent) / 100);
  const balance = total - deposit;

  function startCommitTimer(
    nextScope: ScopeItem[],
    nextLine: LineItem[],
    nextBefore: BeforeSection[],
    nextAfter: Array<{ heading: string; content: string }>,
    nextPreamble: string,
  ) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      setToastVisible(false);
      setUndo(null);
      const newSummary = serializeSummary(
        nextPreamble,
        nextScope,
        nextLine,
        depositPercent,
        nextBefore,
        nextAfter,
      );
      setSaveStatus('saving');
      try {
        const res = await fetch('/api/estimates', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: estimateId, summary: newSummary }),
        });
        if (!res.ok) throw new Error('Save failed');
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setSaveStatus('error');
      }
    }, 4000);
  }

  function removeScope(id: string) {
    const idx = scopeItems.findIndex(i => i.id === id);
    const item = scopeItems[idx];
    const nextScope = scopeItems.filter(i => i.id !== id);
    setScopeItems(nextScope);
    setUndo({ item, index: idx, type: 'scope' });
    setToastVisible(true);
    startCommitTimer(nextScope, lineItems, beforeSections, afterSections, preambleText);
  }

  function removeLine(id: string) {
    const idx = lineItems.findIndex(i => i.id === id);
    const item = lineItems[idx];
    const nextLine = lineItems.filter(i => i.id !== id);
    setLineItems(nextLine);
    setUndo({ item, index: idx, type: 'lineItem' });
    setToastVisible(true);
    startCommitTimer(scopeItems, nextLine, beforeSections, afterSections, preambleText);
  }

  function updateScope(id: string, text: string) {
    const nextScope = scopeItems.map(i => (i.id === id ? { ...i, text } : i));
    setScopeItems(nextScope);
    startCommitTimer(nextScope, lineItems, beforeSections, afterSections, preambleText);
  }

  function addScopeItem() {
    const item: ScopeItem = { id: newId(), text: '' };
    setFocusId(item.id);
    setScopeItems([...scopeItems, item]);
  }

  function updateAssumption(sectionHeading: string, id: string, text: string) {
    const nextBefore = beforeSections.map(s => {
      if (s.heading !== sectionHeading) return s;
      if (id === '__nonbullets__') return { ...s, nonBullets: text };
      return { ...s, bullets: s.bullets.map(b => (b.id === id ? { ...b, text } : b)) };
    });
    setBeforeSections(nextBefore);
    startCommitTimer(scopeItems, lineItems, nextBefore, afterSections, preambleText);
  }

  function addAssumption(sectionHeading: string) {
    const item: AssumptionItem = { id: newId(), text: '' };
    setFocusId(item.id);
    setBeforeSections(
      beforeSections.map(s =>
        s.heading === sectionHeading ? { ...s, bullets: [...s.bullets, item] } : s,
      ),
    );
  }

  function updateLine(id: string, field: 'label' | 'cost', value: string) {
    const nextLine = lineItems.map(i => (i.id === id ? { ...i, [field]: value } : i));
    setLineItems(nextLine);
    startCommitTimer(scopeItems, nextLine, beforeSections, afterSections, preambleText);
  }

  function handleAddItem() {
    if (!newLabel.trim() || !newCost.trim()) return;
    const rawCost = parseFloat(newCost.replace(/[^0-9.]/g, ''));
    const formattedCost = isNaN(rawCost) ? newCost.trim() : '$' + rawCost.toFixed(2);
    const item: LineItem = { id: newId(), label: newLabel.trim(), cost: formattedCost };
    const nextLine = [...lineItems, item];
    setLineItems(nextLine);
    setNewLabel('');
    setNewCost('');
    setShowAddItem(false);
    startCommitTimer(scopeItems, nextLine, beforeSections, afterSections, preambleText);
  }

  function removeAssumption(sectionHeading: string, id: string) {
    const nextBefore = beforeSections.map(s => {
      if (s.heading !== sectionHeading) return s;
      if (id === '__nonbullets__') {
        return { ...s, nonBullets: '' };
      }
      const idx = s.bullets.findIndex(b => b.id === id);
      const item = s.bullets[idx];
      setUndo({ item, index: idx, type: 'assumption', sectionHeading });
      return { ...s, bullets: s.bullets.filter(b => b.id !== id) };
    });
    setBeforeSections(nextBefore);
    setToastVisible(true);
    startCommitTimer(scopeItems, lineItems, nextBefore, afterSections, preambleText);
  }

  function updateAfterSection(heading: string, content: string) {
    const nextAfter = afterSections.map(s => (s.heading === heading ? { ...s, content } : s));
    setAfterSections(nextAfter);
    startCommitTimer(scopeItems, lineItems, beforeSections, nextAfter, preambleText);
  }

  function updatePreamble(value: string) {
    setPreambleText(value);
    startCommitTimer(scopeItems, lineItems, beforeSections, afterSections, value);
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
      {/* Preamble (job summary) — inline editable; Total line rendered bold below */}
      <textarea
        ref={el => {
          if (el) {
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
          }
        }}
        value={preambleBody}
        onChange={e =>
          updatePreamble(
            preambleTotalLine
              ? `${e.target.value.replace(/\n$/, '')}\n\n${preambleTotalLine}`
              : e.target.value,
          )
        }
        aria-label="Edit job summary"
        className="mb-3 w-full resize-none overflow-hidden border border-zinc-200 rounded-lg px-3 py-2.5 text-sm text-zinc-700 leading-relaxed focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
      />
      {preambleTotalLine && (
        <p className="mb-3 font-semibold text-zinc-900 text-base">{preambleTotalLine}</p>
      )}

      {/* Scope of Work */}
      <SectionHeading>Scope of Work</SectionHeading>
      <ul className="mb-1 space-y-1">
        {scopeItems.map(item => (
          <li key={item.id} className="flex items-start gap-2 text-sm text-zinc-700 leading-relaxed">
            <span className="text-amber-500 mt-2 shrink-0">•</span>
            <textarea
              ref={el => {
                if (el) {
                  el.style.height = 'auto';
                  el.style.height = `${el.scrollHeight}px`;
                }
              }}
              rows={1}
              value={item.text}
              autoFocus={item.id === focusId}
              onChange={e => updateScope(item.id, e.target.value)}
              aria-label="Edit scope item"
              className="flex-1 block resize-none overflow-hidden bg-transparent rounded-lg border border-transparent px-2 py-1.5 text-sm text-zinc-700 leading-relaxed focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
            <XBtn onClick={() => removeScope(item.id)} />
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={addScopeItem}
        className="mb-4 text-sm text-amber-600 hover:text-amber-500 transition-colors flex items-center gap-1.5 min-h-[44px]"
      >
        <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Add item
      </button>

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
                <td className="border-t border-zinc-200">
                  <textarea
                    ref={el => {
                      if (el) {
                        el.style.height = 'auto';
                        el.style.height = `${el.scrollHeight}px`;
                      }
                    }}
                    rows={1}
                    value={item.label}
                    onChange={e => updateLine(item.id, 'label', e.target.value)}
                    aria-label="Item description"
                    className="block w-full resize-none overflow-hidden bg-transparent rounded-lg border border-transparent px-3 py-2.5 text-sm text-zinc-700 leading-snug focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]"
                  />
                </td>
                <td className="border-t border-zinc-200">
                  <input
                    type="text"
                    value={item.cost}
                    onChange={e => updateLine(item.id, 'cost', e.target.value)}
                    aria-label="Item cost"
                    className="w-24 bg-transparent rounded-lg border border-transparent px-3 py-2.5 text-sm text-zinc-700 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]"
                  />
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
          <div className="relative flex items-center">
            <span className="absolute left-3 text-sm text-zinc-500 pointer-events-none select-none">$</span>
            <input
              type="text"
              inputMode="decimal"
              className="w-full border border-zinc-200 rounded-lg pl-6 pr-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]"
              placeholder="0"
              value={newCost}
              onChange={(e) => setNewCost(e.target.value.replace(/[^0-9.]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && handleAddItem()}
            />
          </div>
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

      {/* Assumptions & Exclusions (and any other sections before pricing in source) */}
      {beforeSections.map(s => (
        <div key={s.heading}>
          <SectionHeading>{s.heading}</SectionHeading>
          {s.nonBullets && (
            <ul className="mb-1 space-y-1">
              <li className="flex items-start gap-2 text-sm text-zinc-700 leading-relaxed">
                <span className="text-amber-500 mt-2 shrink-0">•</span>
                <textarea
                  ref={el => {
                    if (el) {
                      el.style.height = 'auto';
                      el.style.height = `${el.scrollHeight}px`;
                    }
                  }}
                  rows={1}
                  value={s.nonBullets}
                  onChange={e => updateAssumption(s.heading, '__nonbullets__', e.target.value)}
                  aria-label={`Edit ${s.heading} item`}
                  className="flex-1 block resize-none overflow-hidden bg-transparent rounded-lg border border-transparent px-2 py-1.5 text-sm text-zinc-700 leading-relaxed focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                />
                <XBtn onClick={() => removeAssumption(s.heading, '__nonbullets__')} />
              </li>
            </ul>
          )}
          {s.bullets.length > 0 && (
            <ul className="mb-1 space-y-1">
              {s.bullets.map(item => (
                <li
                  key={item.id}
                  className="flex items-start gap-2 text-sm text-zinc-700 leading-relaxed"
                >
                  <span className="text-amber-500 mt-2 shrink-0">•</span>
                  <textarea
                    ref={el => {
                      if (el) {
                        el.style.height = 'auto';
                        el.style.height = `${el.scrollHeight}px`;
                      }
                    }}
                    rows={1}
                    value={item.text}
                    autoFocus={item.id === focusId}
                    onChange={e => updateAssumption(s.heading, item.id, e.target.value)}
                    aria-label={`Edit ${s.heading} item`}
                    className="flex-1 block resize-none overflow-hidden bg-transparent rounded-lg border border-transparent px-2 py-1.5 text-sm text-zinc-700 leading-relaxed focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  />
                  <XBtn onClick={() => removeAssumption(s.heading, item.id)} />
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => addAssumption(s.heading)}
            className="mb-4 text-sm text-amber-600 hover:text-amber-500 transition-colors flex items-center gap-1.5 min-h-[44px]"
          >
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Add item
          </button>
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
                depositPercent === 0
                  ? ['No deposit required', '', false]
                  : [`Deposit required (${depositPercent}%)`, formatDollars(deposit), false],
                ['Balance on completion', depositPercent === 0 ? formatDollars(total) : formatDollars(balance), false],
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

      {/* Sections after pricing (Payment Terms, Notes) — inline editable */}
      {afterSections.map(s => (
        <div key={s.heading}>
          <SectionHeading>
            {s.heading}
            <span className="ml-1.5 text-amber-500 text-sm" aria-hidden="true">
              {'✏︎'}
            </span>
          </SectionHeading>
          <textarea
            ref={el => {
              if (el) {
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }
            }}
            value={s.content}
            onChange={e => updateAfterSection(s.heading, e.target.value)}
            aria-label={`Edit ${s.heading}`}
            className="mb-3 w-full resize-none overflow-hidden border border-zinc-200 rounded-lg px-3 py-2.5 text-sm text-zinc-700 leading-relaxed focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
        </div>
      ))}

      {/* Save status */}
      {saveStatus !== 'idle' && (
        <p className={`text-xs mt-1 mb-2 ${saveStatus === 'error' ? 'text-red-500' : 'text-zinc-400'}`}>
          {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Could not save'}
        </p>
      )}

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
