'use client';

import { useState } from 'react';

// Generic, hand-drawn trade icons matching the stroke style already used
// elsewhere on the homepage (viewBox 0 0 20 20, stroke, no fill).

function WrenchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
      <path d="M13.5 3.5a3.5 3.5 0 00-4.6 4.2L4 12.6V16h3.4l4.9-4.9a3.5 3.5 0 004.2-4.6l-2.6 2.6-2-2 2.6-2.6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
      <path d="M11 2L4 11h5l-1 7 7-9h-5l1-7z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RollerIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
      <rect x="3" y="4" width="10" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M15 6.5h1.5A1.5 1.5 0 0118 8v2a1.5 1.5 0 01-1.5 1.5H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 9v3M6 12a2 2 0 00-2 2v3h4v-3a2 2 0 00-2-2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface TradeExample {
  trade: string;
  icon: React.ReactNode;
  job: string;
  scope: readonly string[];
  lineItems: readonly string[];
}

const EXAMPLES: readonly TradeExample[] = [
  {
    trade: 'Plumbing',
    icon: <WrenchIcon />,
    job: 'Customer wants a leaking kitchen faucet replaced before it damages the cabinet.',
    scope: [
      'Shut off water supply and remove old faucet',
      'Install new faucet and check all connections',
      'Test for leaks under full water pressure',
    ],
    lineItems: ['Labour', 'Faucet and supply lines', 'Disposal of old fixture'],
  },
  {
    trade: 'Electrical',
    icon: <BoltIcon />,
    job: 'Customer needs two extra outlets added in a home office.',
    scope: [
      'Run new wiring from the nearest junction box',
      'Install and secure two new outlets',
      'Test circuits and confirm breaker load',
    ],
    lineItems: ['Labour', 'Outlets and cover plates', 'Wire and conduit'],
  },
  {
    trade: 'Painting',
    icon: <RollerIcon />,
    job: 'Customer wants the living room and hallway repainted after a move.',
    scope: [
      'Patch and sand wall imperfections',
      'Prime bare or patched areas',
      'Apply two coats of finish paint',
    ],
    lineItems: ['Labour', 'Paint and primer', 'Prep materials and drop sheets'],
  },
];

export function TradeExamples() {
  const [active, setActive] = useState(0);
  const example = EXAMPLES[active];

  return (
    <div>
      {/* Tabs. The three pills (icon + label, full text, no shrinking) need
          376.6px unbroken -- measured via getBoundingClientRect, not
          guessed. Centered content is allowed to overflow into this
          section's own 24px side padding without clipping (that's why
          390px/412px were already fine pre-fix, eating a few px of
          padding on each side) -- the real math, confirmed against the
          measured numbers at 320/375/390px: clipping starts below
          viewport 376.6px, not at the `sm:` (640px) breakpoint. An
          earlier pass here used `sm:` for the switchover and caught its
          own mistake in review: that unnecessarily put 390-412px (already
          fine) into scroll mode too, right after the nav-wordmark fix's
          own lesson about not guessing a breakpoint. `max-[379px]:` (a
          few px of margin above the exact 376.6px threshold) is used
          instead, so nothing changes at any width where this already
          displayed correctly. Below that width, this row scrolls
          horizontally rather than shrinking text/icons to force a fit
          (illegible the same way the nav fix's first pass under-shot) --
          every tab stays fully legible and tappable at its natural size,
          and it scales cleanly if a fourth trade is ever added.
          `justify-start` while scrollable is deliberate: `justify-center`
          on an overflowing flex row clips the portion that would sit
          "before center," making the first tab unreachable by scrolling
          even though the row itself scrolls -- confirmed this was
          actually happening (Plumbing's icon was cut off on the left,
          not just Painting on the right, contrary to how the bug was
          originally described). */}
      <div
        role="tablist"
        aria-label="Trade examples"
        className="flex justify-center gap-2 mb-6 max-[379px]:justify-start max-[379px]:overflow-x-auto max-[379px]:snap-x max-[379px]:snap-proximity max-[379px]:[&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {EXAMPLES.map((e, i) => (
          <button
            key={e.trade}
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className="min-h-11 inline-flex items-center gap-2 px-4 rounded-lg text-sm font-semibold transition shrink-0 snap-start"
            style={
              i === active
                ? { background: '#0D1B2E', color: 'white' }
                : { background: '#F1F5F9', color: '#475569' }
            }
          >
            {e.icon}
            {e.trade}
          </button>
        ))}
      </div>

      {/* Panel */}
      <div className="rounded-2xl border border-slate-200 p-6 sm:p-8 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-slate-900 font-semibold">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#FEF3C7', color: '#92400E' }}>
              {example.icon}
            </span>
            {example.trade}
          </div>
          <span
            className="text-xs font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full"
            style={{ background: 'rgba(245,158,11,0.12)', color: '#92400E' }}
          >
            Example
          </span>
        </div>

        <p className="text-sm text-slate-600 leading-relaxed italic mb-5">&ldquo;{example.job}&rdquo;</p>

        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Scope excerpt</p>
        <ul className="space-y-1.5 mb-5">
          {example.scope.map(line => (
            <li key={line} className="flex items-start gap-2 text-sm text-slate-600">
              <span className="mt-1.5 w-1 h-1 rounded-full bg-amber-500 shrink-0" />
              {line}
            </li>
          ))}
        </ul>

        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Line items</p>
        <div className="flex flex-wrap gap-2">
          {example.lineItems.map(item => (
            <span key={item} className="text-xs font-medium text-slate-600 bg-slate-100 rounded-md px-2.5 py-1">
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
