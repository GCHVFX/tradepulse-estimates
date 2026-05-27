"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/app/components/logo";

// ─── Types ────────────────────────────────────────────────────────────────────

type LineItem = { id: string; label: string; amount: number };

type Scenario = {
  prompt: string;
  title: string;
  customerName: string;
  phone: string;
  address: string;
  date: string;
  jobSummary: string;
  scopeBullets: string[];
  lineItemsInitial: LineItem[];
  deleteSequence: string[];
  paymentTerms: string;
};

// ─── Scenarios ────────────────────────────────────────────────────────────────

const SCENARIOS: Record<string, Scenario> = {
  plumbing: {
    prompt:
      "Main floor bathroom renovation with new vanity, tile flooring, toilet, paint, and fixture replacement.",
    title:       "Main Floor Bathroom Renovation",
    customerName: "Sarah Mitchell",
    phone:       "604-555-0182",
    address:     "1846 Maple Street",
    date:        "May 24, 2026",
    jobSummary:
      "A complete main floor bathroom renovation including new vanity, porcelain tile, toilet replacement, fresh paint, and updated fixtures.",
    scopeBullets: [
      "Demo and dispose of existing vanity, toilet, and all fixtures",
      'Install new 24" vanity with undermount sink and chrome faucet',
      "Remove flooring and install 12×24 porcelain tile",
      "Paint walls and ceiling, replace towel bar, mirror, and vanity light",
    ],
    // demo at row 0, paint at row 4 — maximises visible cursor travel; labour at row 5, never deleted
    lineItemsInitial: [
      { id: "demo",   label: "Demo and disposal",           amount: 320  },
      { id: "vanity", label: "Vanity and faucet",           amount: 650  },
      { id: "tile",   label: "Tile and flooring materials", amount: 760  },
      { id: "toilet", label: "Toilet supply and install",   amount: 480  },
      { id: "paint",  label: "Paint and supplies",          amount: 110  },
      { id: "labour", label: "Labour (12 hours @ $100/hr)", amount: 1200 },
    ],
    deleteSequence: ["demo", "paint"],
    paymentTerms:
      "Deposit due before work begins. Balance due on completion. E-transfer accepted.",
  },

  "electrical-panel": {
    prompt:
      "Upgrade older 100 amp electrical panel to 200 amp service. Homeowner wants room for a future heat pump and EV charger. Include permit, panel replacement, grounding, inspection, and cleanup.",
    title:       "200 Amp Panel Upgrade",
    customerName: "Mark Jensen",
    phone:       "604-555-0148",
    address:     "7218 Cedar Avenue",
    date:        "May 26, 2026",
    jobSummary:
      "Upgrade the existing 100 amp electrical panel to a 200 amp service panel. Work includes permit coordination, panel replacement, grounding and bonding updates, inspection, testing, and cleanup.",
    scopeBullets: [
      "Coordinate permit and utility disconnect for panel replacement",
      "Remove existing 100 amp panel and install new 200 amp panel",
      "Update grounding and bonding as required for inspection",
      "Label circuits, test panel, and complete final cleanup",
    ],
    lineItemsInitial: [
      { id: "permit",     label: "Permit and coordination",        amount: 350  },
      { id: "panel",      label: "200 amp panel and breakers",     amount: 1450 },
      { id: "labour",     label: "Labour for panel upgrade",       amount: 2400 },
      { id: "grounding",  label: "Grounding and bonding updates",  amount: 650  },
      { id: "utility",    label: "Utility disconnect and reconnect", amount: 400 },
      { id: "inspection", label: "Inspection and final testing",   amount: 300  },
    ],
    // permit (row 0) and inspection (row 5) — maximises cursor travel; panel, labour, grounding, utility never deleted
    deleteSequence: ["permit", "inspection"],
    paymentTerms:
      "Deposit due before work begins. Balance due on completion. E-transfer accepted.",
  },
};

// ─── Reveal timing ────────────────────────────────────────────────────────────

// Reveal steps: 1=job summary, 2-5=scope bullets, 6-11=line item rows, 12-14=pricing rows,
// 15=payment terms, 16=estimate saved
const REVEAL_DELAYS: Record<number, number> = {
  1:  550,  // job summary — pause so viewer reads it
  2:  340,  // scope bullet 1
  3:  300,  // scope bullet 2
  4:  300,  // scope bullet 3
  5:  580,  // scope bullet 4 — section break before line items
  6:  300,  // line item row 1 (table appears here)
  7:  270,  // row 2
  8:  270,  // row 3
  9:  270,  // row 4
  10: 270,  // row 5
  11: 550,  // row 6 (labour) — section break before pricing
  12: 280,  // subtotal
  13: 250,  // tax
  14: 320,  // total — section break before payment
  15: 320,  // payment terms
  16: 250,  // estimate saved
};

const TOTAL_STEPS = 16;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getCenter(el: HTMLElement): { left: number; top: number } {
  const r = el.getBoundingClientRect();
  return { left: r.left + r.width / 2, top: r.top + r.height / 2 };
}

function calcPricing(items: LineItem[]) {
  const subtotal = items.reduce((s, it) => s + it.amount, 0);
  const tax      = Math.round(subtotal * 0.05);
  return { subtotal, tax, total: subtotal + tax };
}

function fmt(n: number) {
  return "$" + n.toLocaleString("en-CA");
}

type Phase = "idle" | "typing" | "generating" | "ready" | "deleting" | "sheet" | "done";

// ─── Sub-components ───────────────────────────────────────────────────────────

function DemoSpinner() {
  return (
    <svg className="animate-spin w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function DemoBottomNav() {
  return (
    <nav className="bg-zinc-950 border-t border-zinc-800 flex" aria-label="Demo navigation">
      <div className="flex-1 flex flex-col items-center gap-1 pt-2.5 pb-7 text-amber-500">
        <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
          <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 7v6M7 10h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="text-xs font-medium">New</span>
      </div>
      <div className="flex-1 flex flex-col items-center gap-1 pt-2.5 pb-7 text-zinc-500">
        <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
          <rect x="3.5" y="2.5" width="13" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="text-xs font-medium">Estimates</span>
      </div>
      <div className="flex-1 flex flex-col items-center gap-1 pt-2.5 pb-7 text-zinc-500">
        <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
          <path d="M10 2v2M10 16v2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M2 10h2M16 10h2M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="text-xs font-medium">Rates</span>
      </div>
      <div className="flex-1 flex flex-col items-center gap-1 pt-2.5 pb-7 text-zinc-500">
        <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
          <circle cx="10" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 17c0-3.314 3.134-6 7-6s7 2.686 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="text-xs font-medium">Profile</span>
      </div>
    </nav>
  );
}

interface DeleteTableProps {
  items: LineItem[];
  deleteRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
}

function DeleteTable({ items, deleteRefs }: DeleteTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 mt-2">
      <div className="flex items-center bg-zinc-100 border-b border-zinc-200 px-3 py-2.5">
        <span className="flex-1 text-xs font-semibold text-zinc-500 uppercase tracking-wide">Item</span>
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide w-16 text-right pr-7">Total</span>
      </div>
      {items.map((item) => (
        <div key={item.id} className="flex items-center border-t border-zinc-200 px-3 py-2.5">
          <span className="flex-1 text-sm text-zinc-700 leading-snug pr-2">{item.label}</span>
          <span className="text-sm text-zinc-700 w-16 text-right shrink-0">{fmt(item.amount)}</span>
          <button
            ref={(el) => {
              if (el) deleteRefs.current.set(item.id, el);
              else deleteRefs.current.delete(item.id);
            }}
            type="button"
            className="ml-1 w-7 h-7 flex items-center justify-center text-red-400 shrink-0"
            aria-label={`Remove ${item.label}`}
          >
            <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3" aria-hidden="true">
              <path d="M2 2l8 8M10 2L2 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

interface PricingTableProps {
  pricing: ReturnType<typeof calcPricing>;
  visibleRows: number;
}

function PricingTable({ pricing, visibleRows }: PricingTableProps) {
  const rows = [
    { label: "Subtotal", value: fmt(pricing.subtotal), bold: false },
    { label: "Tax (5%)", value: fmt(pricing.tax),      bold: false },
    { label: "Total",    value: fmt(pricing.total),    bold: true  },
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 mt-2">
      {rows.slice(0, visibleRows).map((row) => (
        <div
          key={row.label}
          className={`flex justify-between items-center border-t border-zinc-200 first:border-0 px-3 ${row.bold ? "py-3" : "py-2.5"}`}
        >
          <span className={row.bold ? "text-base font-bold text-zinc-900" : "text-sm text-zinc-600"}>{row.label}</span>
          <span className={row.bold ? "text-base font-bold text-zinc-900" : "text-sm text-zinc-700"}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function DemoInner() {
  const params        = useSearchParams();
  const autoplay      = params.get("autoplay") === "1";
  const loop          = params.get("loop") === "1";
  const scenarioParam = params.get("scenario") ?? "plumbing";
  const scenario: Scenario = SCENARIOS[scenarioParam] ?? SCENARIOS.plumbing;

  const [phase, setPhase]               = useState<Phase>("idle");
  const [view, setView]                 = useState<"form" | "estimate">("form");
  const [typedPrompt, setTypedPrompt]   = useState("");
  const [revealStep, setRevealStep]     = useState(0);
  const [lineItems, setLineItems]       = useState<LineItem[]>(scenario.lineItemsInitial);
  const [showSheet, setShowSheet]       = useState(false);
  const [cursorPos, setCursorPos]       = useState<{ left: number; top: number } | null>(null);
  const [cursorVisible, setCursorVisible] = useState(false);
  const [cursorClick, setCursorClick]   = useState(false);

  const scrollRef      = useRef<HTMLElement | null>(null);
  const lineItemsRef   = useRef<HTMLDivElement | null>(null);
  const pricingRef     = useRef<HTMLDivElement | null>(null);
  const generateBtnRef = useRef<HTMLButtonElement | null>(null);
  const sendBtnRef     = useRef<HTMLButtonElement | null>(null);
  const deleteRefs     = useRef<Map<string, HTMLButtonElement>>(new Map());
  const cancelRef      = useRef(false);
  const startedRef     = useRef(false);
  const runRef         = useRef<() => Promise<void>>(async () => {});

  const scrollBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, []);

  const scrollToElement = useCallback((target: HTMLElement) => {
    requestAnimationFrame(() => {
      const main = scrollRef.current;
      if (!main) return;
      const mainRect   = main.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const newTop     = main.scrollTop + targetRect.top - mainRect.top - 80;
      main.scrollTo({ top: Math.max(0, newTop), behavior: "smooth" });
    });
  }, []);

  const moveCursor = useCallback(async (x: number, y: number, instant = false) => {
    setCursorPos({ left: x, top: y });
    if (instant) {
      setCursorVisible(true);
      await sleep(150);
    } else {
      await sleep(500);
    }
  }, []);

  const tapCursor = useCallback(async () => {
    setCursorClick(true);
    await sleep(120);
    setCursorClick(false);
    await sleep(180);
  }, []);

  const hideCursor = useCallback(() => {
    setCursorVisible(false);
  }, []);

  const runSequence = useCallback(async () => {
    cancelRef.current = false;

    // Reset
    setView("form");
    setTypedPrompt("");
    setRevealStep(0);
    setLineItems(scenario.lineItemsInitial);
    setShowSheet(false);
    hideCursor();
    setPhase("typing");

    // Phase 1: type prompt
    for (const char of scenario.prompt) {
      if (cancelRef.current) return;
      setTypedPrompt((p) => p + char);
      await sleep(17 + Math.random() * 9);
    }
    await sleep(230);

    // Tap Generate Estimate
    if (generateBtnRef.current) {
      const pos = getCenter(generateBtnRef.current);
      await moveCursor(pos.left, pos.top, true);
      await sleep(130);
      await tapCursor();
    }
    hideCursor();
    setView("estimate");
    setPhase("generating");
    await sleep(150);

    // Phase 2: reveal each row/bullet one at a time with consistent pacing
    for (let step = 1; step <= TOTAL_STEPS; step++) {
      if (cancelRef.current) return;
      setRevealStep(step);
      scrollBottom();
      await sleep(REVEAL_DELAYS[step] ?? 300);
    }

    // Full estimate visible — pause so viewer can read it
    setPhase("ready");
    await sleep(550);

    // Scroll back up to show line items for editing
    if (lineItemsRef.current) scrollToElement(lineItemsRef.current);
    await sleep(950);

    // Phase 3: delete two items with visible cursor travel between them
    setPhase("deleting");
    for (let di = 0; di < scenario.deleteSequence.length; di++) {
      if (cancelRef.current) return;
      const itemId = scenario.deleteSequence[di];
      const btn    = deleteRefs.current.get(itemId);
      if (!btn) continue;
      // 600ms sleep after first delete lets React re-render before we read
      // the second button's position
      const pos = getCenter(btn);
      await moveCursor(pos.left, pos.top, di === 0);
      await sleep(200);
      await tapCursor();
      setLineItems((prev) => prev.filter((it) => it.id !== itemId));
      await sleep(460);
    }

    // Scroll to updated pricing summary
    if (pricingRef.current) scrollToElement(pricingRef.current);
    await sleep(620);

    // Tap Send Estimate
    if (sendBtnRef.current) {
      const pos = getCenter(sendBtnRef.current);
      await moveCursor(pos.left, pos.top);
      await sleep(180);
      await tapCursor();
    }
    hideCursor();
    setShowSheet(true);
    setPhase("sheet");
    await sleep(3700);

    setShowSheet(false);
    setPhase("done");
    await sleep(500);

    if (loop) {
      await sleep(600);
      runRef.current();
    } else {
      setPhase("idle");
    }
  }, [scenario, loop, scrollBottom, scrollToElement, moveCursor, tapCursor, hideCursor]);

  runRef.current = runSequence;

  useEffect(() => () => { cancelRef.current = true; }, []);

  useEffect(() => {
    if (autoplay && !startedRef.current) {
      startedRef.current = true;
      runSequence();
    }
  }, [autoplay, runSequence]);

  const handlePlay = () => {
    cancelRef.current  = false;
    startedRef.current = true;
    runSequence();
  };
  const handlePause = () => { cancelRef.current = true; };
  const handleReset = () => {
    cancelRef.current = true;
    setView("form");
    setTypedPrompt("");
    setRevealStep(0);
    setLineItems(scenario.lineItemsInitial);
    setShowSheet(false);
    hideCursor();
    setPhase("idle");
    startedRef.current = false;
  };

  const isGenerating = phase === "generating";

  // Compute what's visible from the single revealStep counter
  const visibleBullets     = Math.max(0, Math.min(revealStep - 1, scenario.scopeBullets.length));
  const displayedItems     = lineItems.slice(0, Math.max(0, revealStep - 5));
  const visiblePricingRows = Math.max(0, Math.min(revealStep - 11, 3));
  const pricing            = calcPricing(lineItems);

  return (
    <div className="h-dvh bg-zinc-950 text-white flex flex-col relative overflow-hidden select-none">

      {/* Animated cursor dot */}
      {cursorVisible && cursorPos && (
        <div
          className="fixed z-[200] pointer-events-none rounded-full"
          style={{
            left:       cursorPos.left,
            top:        cursorPos.top,
            width:      22,
            height:     22,
            background: "rgba(0,0,0,0.45)",
            boxShadow:  "0 1px 6px rgba(0,0,0,0.35)",
            transform:  `translate(-50%, -50%) scale(${cursorClick ? 0.68 : 1})`,
            transition: "left 420ms cubic-bezier(0.25,0,0.35,1), top 420ms cubic-bezier(0.25,0,0.35,1), transform 100ms ease-out",
          }}
        />
      )}

      {/* ── Form view ──────────────────────────────────────────────────────── */}
      {view === "form" && (
        <div className="h-full flex flex-col">
          <header className="px-5 pt-6 pb-4 shrink-0">
            <Logo />
          </header>

          <main className="flex-1 min-h-0 px-5 pb-52 overflow-y-auto flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <textarea
                readOnly
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3.5 text-white placeholder-zinc-500 text-base leading-relaxed resize-none focus:outline-none min-h-36 pointer-events-none"
                rows={5}
                value={typedPrompt}
                placeholder="Describe the job"
              />
              <p className="text-xs text-zinc-500">
                A sentence or two is enough. The more detail you give, the better the estimate.
              </p>
            </div>

            {(
              [
                { label: "Customer name", value: scenario.customerName },
                { label: "Phone",         value: scenario.phone        },
                { label: "Job address",   value: scenario.address      },
              ] as { label: string; value: string }[]
            ).map(({ label, value }) => (
              <div key={label} className="flex flex-col gap-1">
                <span className="text-xs text-zinc-400">{label}</span>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm">
                  {value}
                </div>
              </div>
            ))}
          </main>

          <div className="fixed bottom-0 left-0 right-0">
            <div className="px-5 pt-4 pb-3 bg-zinc-950 border-t border-zinc-800">
              <button
                ref={generateBtnRef}
                type="button"
                disabled={!typedPrompt.trim()}
                className="w-full bg-amber-500 disabled:opacity-40 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
              >
                Generate Estimate
              </button>
            </div>
            <DemoBottomNav />
          </div>
        </div>
      )}

      {/* ── Estimate view ──────────────────────────────────────────────────── */}
      {view === "estimate" && (
        <div className="h-full flex flex-col">
          <header className="px-5 pt-5 pb-2 shrink-0" />

          <main ref={scrollRef} className="flex-1 min-h-0 px-5 pb-52 overflow-y-auto">
            <div className="mt-2 pb-2">
              <div className="bg-white rounded-2xl p-5 mt-2">

                {/* Title + customer info — static, always visible */}
                <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-500">
                  Estimate
                </span>
                <h1 className="mt-1 text-3xl font-bold tracking-tight leading-tight text-zinc-900 break-words">
                  {scenario.title}
                </h1>
                <div className="mt-3 mb-4 pb-4 border-b border-zinc-100 space-y-1.5">
                  <div className="grid grid-cols-[4.5rem_1fr] gap-x-2 text-sm">
                    <span className="text-zinc-400">Customer</span>
                    <span className="font-semibold text-zinc-800">{scenario.customerName}</span>
                  </div>
                  <div className="grid grid-cols-[4.5rem_1fr] gap-x-2 text-sm">
                    <span className="text-zinc-400">Address</span>
                    <span className="text-zinc-600">{scenario.address}</span>
                  </div>
                  <div className="grid grid-cols-[4.5rem_1fr] gap-x-2 text-sm">
                    <span className="text-zinc-400">Date</span>
                    <span className="text-zinc-600">{scenario.date}</span>
                  </div>
                </div>

                {/* Step 1: Job Summary */}
                {revealStep >= 1 && (
                  <div className="mb-3">
                    <h2
                      className="text-base font-bold mb-2 uppercase tracking-wide text-zinc-900 pl-3"
                      style={{ borderLeft: "3px solid #f59e0b" }}
                    >
                      Job Summary
                    </h2>
                    <p className="text-sm leading-relaxed text-zinc-700 mb-0">{scenario.jobSummary}</p>
                  </div>
                )}

                {/* Steps 2–5: Scope of Work bullets */}
                {visibleBullets > 0 && (
                  <div className="mt-4 mb-1">
                    <h2
                      className="text-base font-bold mb-2 uppercase tracking-wide text-zinc-900 pl-3"
                      style={{ borderLeft: "3px solid #f59e0b" }}
                    >
                      Scope of Work
                    </h2>
                    <ul className="mb-3 space-y-1 pl-1">
                      {scenario.scopeBullets.slice(0, visibleBullets).map((bullet, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-zinc-700 leading-relaxed">
                          <span className="shrink-0 text-amber-500 mt-0.5">•</span>
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Steps 6–11: Line Items — rows appear one at a time */}
                {displayedItems.length > 0 && (
                  <div ref={lineItemsRef} className="mt-4 mb-1">
                    <h2
                      className="text-base font-bold mb-2 uppercase tracking-wide text-zinc-900 pl-3"
                      style={{ borderLeft: "3px solid #f59e0b" }}
                    >
                      Line Items
                    </h2>
                    <DeleteTable items={displayedItems} deleteRefs={deleteRefs} />
                  </div>
                )}

                {/* Steps 12–14: Pricing Summary — rows appear one at a time, updates after deletion */}
                {visiblePricingRows > 0 && (
                  <div ref={pricingRef} className="mt-4 mb-1">
                    <h2
                      className="text-base font-bold mb-2 uppercase tracking-wide text-zinc-900 pl-3"
                      style={{ borderLeft: "3px solid #f59e0b" }}
                    >
                      Pricing Summary
                    </h2>
                    <PricingTable pricing={pricing} visibleRows={visiblePricingRows} />
                  </div>
                )}

                {/* Step 15: Payment Terms */}
                {revealStep >= 15 && (
                  <div className="mt-4 mb-1">
                    <h2
                      className="text-base font-bold mb-2 uppercase tracking-wide text-zinc-900 pl-3"
                      style={{ borderLeft: "3px solid #f59e0b" }}
                    >
                      Payment Terms
                    </h2>
                    <p className="text-sm text-zinc-700 leading-snug">
                      {scenario.paymentTerms}
                    </p>
                  </div>
                )}

                {/* Step 16: Estimate saved */}
                {revealStep >= 16 && (
                  <p className="mt-5 text-xs text-zinc-400 flex items-center gap-1.5">
                    <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 text-green-500 shrink-0" aria-hidden="true">
                      <path d="M3 8l3.5 3.5L13 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Estimate saved
                  </p>
                )}

              </div>
            </div>
          </main>

          <div className="fixed bottom-0 left-0 right-0">
            <div className="px-5 pt-4 pb-3 bg-zinc-950 border-t border-zinc-800 flex flex-col gap-3">
              {isGenerating && (
                <div className="flex items-center justify-center gap-2 text-zinc-400 text-sm">
                  <DemoSpinner />
                  <span>Writing estimate...</span>
                </div>
              )}
              {!isGenerating && (
                <button
                  type="button"
                  className="w-full bg-zinc-800 text-white font-semibold text-base rounded-xl py-4 min-h-[56px]"
                >
                  Edit job
                </button>
              )}
              <button
                ref={sendBtnRef}
                type="button"
                disabled={isGenerating}
                className="w-full bg-amber-500 disabled:opacity-40 text-zinc-950 font-bold text-base rounded-xl py-4 min-h-[56px]"
              >
                Send Estimate
              </button>
            </div>
            <DemoBottomNav />
          </div>
        </div>
      )}

      {/* ── Send sheet ─────────────────────────────────────────────────────── */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 ${
          showSheet ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
      />
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 rounded-t-2xl transition-transform duration-300 ease-out ${
          showSheet ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex justify-center pt-3">
          <div className="w-10 h-1 rounded-full bg-zinc-700" />
        </div>
        <div className="px-5 pt-3 pb-2 flex items-center min-h-[52px]">
          <span className="text-white font-semibold text-base">Send Estimate</span>
        </div>
        <div className="px-5 pb-10 pt-2 flex flex-col gap-2">
          {(
            [
              {
                icon: (
                  <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-zinc-300" aria-hidden="true">
                    <path d="M3 4h14a1 1 0 011 1v8a1 1 0 01-1 1H5l-3 2V5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                ),
                label: "Send via SMS",
                sub:   "Text a link to the estimate",
              },
              {
                icon: (
                  <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-zinc-300" aria-hidden="true">
                    <rect x="2" y="5" width="16" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M2 7l8 5 8-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ),
                label: "Send via Email",
                sub:   "Email a link to the estimate",
              },
              {
                icon: (
                  <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-zinc-300" aria-hidden="true">
                    <path d="M8 4H5a1 1 0 00-1 1v11a1 1 0 001 1h10a1 1 0 001-1v-3M8 4h7a1 1 0 011 1v3M8 4v4h8V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M11 11h4m-2-2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                ),
                label: "Copy Link",
                sub:   "Share a link to this estimate",
              },
            ] as { icon: React.ReactNode; label: string; sub: string }[]
          ).map(({ icon, label, sub }) => (
            <div key={label} className="flex items-center gap-4 bg-zinc-800 rounded-xl px-4 py-4 min-h-[64px]">
              <span className="w-10 h-10 rounded-lg bg-zinc-700 flex items-center justify-center shrink-0">
                {icon}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium text-sm">{label}</p>
                <p className="text-zinc-500 text-xs mt-0.5">{sub}</p>
              </div>
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-zinc-600 shrink-0" aria-hidden="true">
                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          ))}
        </div>
      </div>

      {/* ── Hidden controls ─────────────────────────────────────────────────── */}
      <div className="fixed top-4 right-4 z-[300] flex gap-2 opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button onClick={handlePlay}  className="bg-zinc-800 text-white text-xs px-3 py-1.5 rounded-lg">Play</button>
        <button onClick={handlePause} className="bg-zinc-800 text-white text-xs px-3 py-1.5 rounded-lg">Pause</button>
        <button onClick={handleReset} className="bg-zinc-800 text-white text-xs px-3 py-1.5 rounded-lg">Reset</button>
      </div>
    </div>
  );
}

export default function DemoPage() {
  return (
    <Suspense>
      <DemoInner />
    </Suspense>
  );
}
