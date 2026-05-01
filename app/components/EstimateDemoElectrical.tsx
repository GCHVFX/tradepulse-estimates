'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Assets ───────────────────────────────────────────────────────────────────

const TP_LOGO = '/estimates-logo.png';

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen = 'form' | 'loading' | 'estimate';

interface StreamItem {
  t: 'logo' | 'badge' | 'title' | 'meta' | 'divider' | 'p' | 'h' | 'b' | 'lbl' | 'thead' | 'tr' | 'pr';
  text?: string;
  date?: boolean;
  cells?: readonly [string, string];
  bold?: boolean;
  delay: number;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const TYPING_TEXT = 'Replace bathroom exhaust fan, install GFCI outlet in kitchen, add dimmer switch in living room. House is a 1990s build.';

const ITEMS: StreamItem[] = [
  { t: 'logo',    delay: 500 },
  { t: 'badge',   delay: 300 },
  { t: 'title',   text: 'Bathroom Fan, Kitchen GFCI Outlet, and Living Room Dimmer', delay: 400 },
  { t: 'meta',    text: 'Prepared for: Mark Thiessen', delay: 220 },
  { t: 'meta',    text: 'Date: ', date: true, delay: 180 },
  { t: 'divider', delay: 300 },
  { t: 'p',       text: 'We will replace your existing bathroom exhaust fan, install a GFCI-protected outlet in your kitchen, and add a dimmer switch to your living room. All work meets current electrical code.', delay: 700 },
  { t: 'h',       text: 'SCOPE OF WORK', delay: 400 },
  { t: 'b',       text: 'Remove existing bathroom exhaust fan and disconnect from ductwork', delay: 240 },
  { t: 'b',       text: 'Install new bathroom exhaust fan (6-inch, 80 CFM) with damper and mounting hardware', delay: 240 },
  { t: 'b',       text: 'Reconnect and seal ductwork to new fan', delay: 220 },
  { t: 'b',       text: 'Install new GFCI outlet in kitchen (includes new outlet box and cover plate if needed)', delay: 240 },
  { t: 'b',       text: 'Install new dimmer switch in living room (includes switch box and cover plate if needed)', delay: 240 },
  { t: 'b',       text: 'Test all new fixtures and switches for proper operation', delay: 220 },
  { t: 'b',       text: 'Clean up work area and remove old materials', delay: 200 },
  { t: 'h',       text: 'LINE ITEMS', delay: 400 },
  { t: 'thead',   delay: 180 },
  { t: 'tr',      cells: ['Labour (4 hours @ $65/hr)', '$260'], delay: 240 },
  { t: 'tr',      cells: ['Bathroom exhaust fan (6-inch, 80 CFM with damper)', '$185'], delay: 240 },
  { t: 'tr',      cells: ['GFCI outlet and cover plate', '$35'], delay: 220 },
  { t: 'tr',      cells: ['Dimmer switch (LED-compatible) and cover plate', '$42'], delay: 220 },
  { t: 'tr',      cells: ['Ductwork sealant and miscellaneous fasteners', '$18'], delay: 300 },
  { t: 'h',       text: 'PRICING SUMMARY', delay: 400 },
  { t: 'pr',      cells: ['Subtotal', '$540'], delay: 240 },
  { t: 'pr',      cells: ['Tax (GST 5%)', '$27'], delay: 220 },
  { t: 'pr',      cells: ['Total', '$567'], bold: true, delay: 260 },
  { t: 'pr',      cells: ['Balance on completion', '$567'], delay: 220 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const todayStr = () =>
  new Date().toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });

// ─── Component ────────────────────────────────────────────────────────────────

export function EstimateDemoElectrical() {
  const [screen, setScreen]           = useState<Screen>('form');
  const [tboxActive, setTboxActive]   = useState(false);
  const [btnReady, setBtnReady]       = useState(false);
  const [showSavedRow, setShowSavedRow] = useState(false);
  const [showEditBtn, setShowEditBtn] = useState(false);
  const [sendReady, setSendReady]     = useState(false);

  const ttextRef    = useRef<HTMLSpanElement>(null);
  const scrollRef   = useRef<HTMLDivElement>(null);
  const streamRef   = useRef<HTMLDivElement>(null);
  const tblRef      = useRef<HTMLDivElement | null>(null);
  const pricingRef  = useRef<HTMLDivElement | null>(null);
  const cancelRef   = useRef(false);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Stream renderer ────────────────────────────────────────────────────────

  const showItem = useCallback((item: StreamItem): HTMLElement | null => {
    const stream = streamRef.current;
    if (!stream) return null;

    let el: HTMLElement | null = null;

    switch (item.t) {
      case 'logo': {
        el = document.createElement('div');
        el.style.cssText = 'text-align:center;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #f3f4f6';
        el.innerHTML = `<img src="/circuit-and-co-electrical.png" alt="Circuit & Co. Electrical" style="width:190px;height:auto"/>`;
        break;
      }
      case 'badge': {
        el = document.createElement('span');
        el.style.cssText = 'display:inline-flex;border-radius:999px;border:1px solid rgba(245,158,11,.3);background:rgba(245,158,11,.1);padding:3px 10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:#f59e0b;margin-bottom:6px';
        el.textContent = 'Estimate';
        break;
      }
      case 'title': {
        el = document.createElement('h1');
        el.style.cssText = 'margin:4px 0 10px;font-size:22px;font-weight:800;color:#111827;line-height:1.2';
        el.textContent = item.text ?? '';
        break;
      }
      case 'meta': {
        el = document.createElement('div');
        el.style.cssText = 'font-size:12px;color:#6b7280;line-height:1.9';
        el.textContent = item.date ? (item.text ?? '') + todayStr() : (item.text ?? '');
        break;
      }
      case 'divider': {
        el = document.createElement('div');
        el.style.cssText = 'border-bottom:1px solid #f3f4f6;margin:8px 0 14px';
        break;
      }
      case 'p': {
        el = document.createElement('div');
        el.style.cssText = 'font-size:13px;color:#374151;line-height:1.75;margin-bottom:14px';
        el.textContent = item.text ?? '';
        break;
      }
      case 'h': {
        tblRef.current = null;
        pricingRef.current = null;
        el = document.createElement('div');
        el.style.cssText = 'font-size:11px;font-weight:800;color:#18181b;letter-spacing:.1em;text-transform:uppercase;margin-top:18px;margin-bottom:8px';
        el.textContent = item.text ?? '';
        break;
      }
      case 'b': {
        el = document.createElement('div');
        el.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin-bottom:5px;font-size:13px;color:#374151;line-height:1.5';
        el.innerHTML = `<span style="color:#f59e0b;flex-shrink:0;margin-top:2px">&#8226;</span><span style="flex:1">${item.text ?? ''}</span>`;
        break;
      }
      case 'lbl': {
        el = document.createElement('div');
        el.style.cssText = 'font-size:13px;font-weight:700;color:#374151;margin-bottom:5px;margin-top:12px';
        el.textContent = item.text ?? '';
        break;
      }
      case 'thead': {
        const tbl = document.createElement('div');
        tbl.style.cssText = 'border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;margin:4px 0';
        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;justify-content:space-between;padding:8px 12px;background:#f4f4f5;border-bottom:1px solid #e5e7eb';
        hdr.innerHTML = '<span style="font-size:11px;font-weight:700;color:#71717a;letter-spacing:.06em">ITEM</span><span style="font-size:11px;font-weight:700;color:#71717a;letter-spacing:.06em">COST</span>';
        tbl.appendChild(hdr);
        tblRef.current = tbl;
        el = tbl;
        break;
      }
      case 'tr': {
        if (!tblRef.current) return null;
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#374151';
        r.innerHTML = `<span style="flex:1;padding-right:8px">${item.cells?.[0] ?? ''}</span><span style="font-weight:600;color:#18181b;white-space:nowrap">${item.cells?.[1] ?? ''}</span>`;
        tblRef.current.appendChild(r);
        return null;
      }
      case 'pr': {
        if (!pricingRef.current) {
          const pricing = document.createElement('div');
          pricing.style.cssText = 'border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;margin:4px 0';
          pricingRef.current = pricing;
          el = pricing;
        }
        const r = document.createElement('div');
        r.style.cssText = 'display:flex;justify-content:space-between;padding:9px 12px;border-bottom:1px solid #f3f4f6;font-size:13px';
        r.innerHTML = `<span style="color:${item.bold ? '#18181b;font-weight:700' : '#6b7280'}">${item.cells?.[0] ?? ''}</span><span style="${item.bold ? 'font-weight:800;color:#f59e0b' : 'color:#374151'}">${item.cells?.[1] ?? ''}</span>`;
        pricingRef.current.appendChild(r);
        if (!el) return null;
        break;
      }
    }

    if (!el) return null;
    el.classList.add('tp-demo-enter');
    stream.appendChild(el);
    void el.offsetHeight; // trigger reflow
    el.classList.add('tp-demo-show');
    return el;
  }, []);

  const scrollBottom = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, []);

  // ── Stream runner – triggered when estimate screen mounts ──────────────────

  useEffect(() => {
    if (screen !== 'estimate') return;

    cancelRef.current = false;
    tblRef.current = null;
    pricingRef.current = null;
    if (streamRef.current) streamRef.current.innerHTML = '';
    if (scrollRef.current) scrollRef.current.scrollTop = 0;

    const run = async () => {
      for (const item of ITEMS) {
        if (cancelRef.current) return;
        showItem(item);
        scrollBottom();
        await sleep(item.delay);
      }
      if (cancelRef.current) return;
      await sleep(300);
      setShowSavedRow(true);
      scrollBottom();
      await sleep(120);
      setShowEditBtn(true);
      setSendReady(true);
    };

    run();

    return () => { cancelRef.current = true; };
  }, [screen, showItem, scrollBottom]);

  // ── Auto-type ──────────────────────────────────────────────────────────────

  useEffect(() => {
    cancelRef.current = false;
    const run = async () => {
      await sleep(800);
      setTboxActive(true);
      for (let i = 1; i <= TYPING_TEXT.length; i++) {
        if (cancelRef.current) return;
        if (ttextRef.current) ttextRef.current.textContent = TYPING_TEXT.slice(0, i);
        await sleep(58);
      }
      setBtnReady(true);
    };
    run();
    return () => { cancelRef.current = true; };
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleGenerate = useCallback(() => {
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    setBtnReady(false);
    setShowSavedRow(false);
    setShowEditBtn(false);
    setSendReady(false);

    setTimeout(() => {
      setScreen('loading');
      setTimeout(() => setScreen('estimate'), 1800);
    }, 280);
  }, []);

  // ── Auto-trigger after typing finishes ─────────────────────────────────────

  useEffect(() => {
    if (!btnReady) return;
    autoTimerRef.current = setTimeout(() => {
      handleGenerate();
    }, 5000);
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
  }, [btnReady, handleGenerate]);

  const handleSend = useCallback(() => {
    setSendReady(false);
    setTimeout(() => window.open('https://trytradepulse.com/signup', '_blank'), 250);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes tp-demo-spin    { to { transform: rotate(360deg); } }
        @keyframes tp-demo-blink   { 0%,100% { opacity:1; } 50% { opacity:0; } }
        @keyframes tp-demo-ripple {
          0%   { box-shadow: 0 0 0 0 rgba(245,158,11,0.7), 0 0 0 0 rgba(245,158,11,0.4); }
          70%  { box-shadow: 0 0 0 10px rgba(245,158,11,0), 0 0 0 20px rgba(245,158,11,0); }
          100% { box-shadow: 0 0 0 0 rgba(245,158,11,0), 0 0 0 0 rgba(245,158,11,0); }
        }
        @keyframes tp-demo-send    {
          0%,100% { box-shadow:0 0 0 0 rgba(245,158,11,.7),0 6px 20px rgba(245,158,11,.3); transform:scale(1); }
          50%     { box-shadow:0 0 0 10px rgba(245,158,11,0),0 6px 32px rgba(245,158,11,.55); transform:scale(1.03); }
        }
        .tp-spin       { width:18px;height:18px;border:2.5px solid #f59e0b;border-top-color:transparent;border-radius:50%;animation:tp-demo-spin .8s linear infinite;display:inline-block;flex-shrink:0; }
        .tp-spin-lg    { width:24px;height:24px;border-width:3px; }
        .tp-cursor     { color:#f59e0b;animation:tp-demo-blink .7s ease infinite; }
        .tp-btn-pulse  { animation:tp-demo-ripple 1.5s ease-out infinite; }
        .tp-send-pulse { animation:tp-demo-send 1.2s ease infinite; }
        .tp-demo-enter { opacity:0;transform:translateY(3px); }
        .tp-demo-show  { opacity:1;transform:translateY(0);transition:opacity .3s ease,transform .3s ease; }
      `}</style>

      {/* Phone shell */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '.75rem 0 2rem' }}>
        <div style={{
          width: 320,
          height: 680,
          background: '#09090b',
          borderRadius: 32,
          overflow: 'hidden',
          border: '6px solid #1e293b',
          fontFamily: 'var(--font-dm-sans), DM Sans, sans-serif',
          display: 'flex',
          flexDirection: 'column',
        }}>

          {/* App header */}
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px 10px', background:'#09090b', flexShrink:0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={TP_LOGO} alt="" width={34} height={34} style={{ flexShrink:0, objectFit:'contain' }} />
            <div>
              <div style={{ color:'#fff', fontWeight:700, fontSize:15, lineHeight:1.2 }}>TradePulse</div>
              <div style={{ color:'#f59e0b', fontSize:11 }}>Estimates</div>
            </div>
          </div>

          {/* Screens */}
          <div style={{ position:'relative', flex:1, minHeight:0, overflow:'hidden' }}>

            {/* ── Form ── */}
            {screen === 'form' && (
              <div style={{ position:'absolute', inset:0, overflowY:'auto', padding:'4px 14px 14px', background:'#09090b' }}>
                {/* Job description box */}
                <div style={{
                  background: '#111827',
                  border: `2px solid ${tboxActive ? '#f59e0b' : '#27272a'}`,
                  borderRadius: 14,
                  padding: '12px 14px',
                  minHeight: 110,
                  marginBottom: 8,
                  transition: 'border-color .3s',
                }}>
                  <span ref={ttextRef} style={{ color:'#fff', fontSize:14, lineHeight:1.6, wordBreak:'break-word' }} />
                  <span className="tp-cursor">|</span>
                </div>

                <p style={{ color:'#52525b', fontSize:11, margin:'0 0 14px', lineHeight:1.4 }}>
                  A sentence or two is enough. The more detail you give, the better the estimate.
                </p>

                {/* Fields */}
                {[
                  ['Customer name', 'Mark Thiessen'],
                  ['Phone', '902-555-0219'],
                  ['Job address', '141 Birchwood Lane'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div style={{ color:'#a1a1aa', fontSize:11, marginBottom:4 }}>{label}</div>
                    <div style={{ background:'#18181b', border:'1px solid #27272a', borderRadius:12, padding:'10px 12px', color:'#fff', fontSize:14, marginBottom:10 }}>{value}</div>
                  </div>
                ))}

                {/* Generate button */}
                <button
                  onClick={handleGenerate}
                  disabled={!btnReady}
                  className={btnReady ? 'tp-btn-pulse' : ''}
                  style={{
                    width: '100%',
                    padding: 16,
                    background: '#f59e0b',
                    border: 'none',
                    borderRadius: 14,
                    color: '#000',
                    fontWeight: 800,
                    fontSize: 16,
                    fontFamily: 'inherit',
                    opacity: btnReady ? 1 : 0.4,
                    cursor: btnReady ? 'pointer' : 'not-allowed',
                    transition: 'opacity .3s',
                  }}
                >
                  Generate Estimate
                </button>
              </div>
            )}

            {/* ── Loading ── */}
            {screen === 'loading' && (
              <div style={{ position:'absolute', inset:0, background:'#09090b', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:12 }}>
                <div className="tp-spin tp-spin-lg" />
                <div style={{ color:'#f59e0b', fontSize:14, fontWeight:500 }}>Writing your estimate...</div>
              </div>
            )}

            {/* ── Estimate ── */}
            {screen === 'estimate' && (
              <div ref={scrollRef} style={{ position:'absolute', inset:0, overflowY:'auto', background:'#09090b' }}>
                <div style={{ padding:'6px 12px 16px' }}>
                  <div style={{ background:'white', borderRadius:16, padding:'18px 16px' }}>
                    <div ref={streamRef} />
                    {showSavedRow && (
                      <div style={{ display:'flex', marginTop:16, alignItems:'center', gap:6, color:'#16a34a', fontSize:12 }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                          <path d="M3 8l3.5 3.5L13 4.5" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Estimate saved
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action bar */}
          {screen === 'estimate' && (
            <div style={{ flexShrink:0, padding:'8px 14px 10px', background:'#09090b', borderTop:'1px solid #18181b' }}>
              {!showEditBtn ? (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:8 }}>
                  <div className="tp-spin" />
                  <span style={{ color:'#71717a', fontSize:13 }}>Writing estimate...</span>
                </div>
              ) : (
                <button style={{
                  display:'block', width:'100%', padding:13,
                  background:'#1f2937', border:'none', borderRadius:12,
                  color:'#fff', fontWeight:600, fontSize:14, fontFamily:'inherit',
                  marginBottom:8, cursor:'pointer',
                }}>
                  Edit job
                </button>
              )}
              <button
                onClick={sendReady ? handleSend : undefined}
                disabled={!sendReady}
                className={sendReady ? 'tp-send-pulse' : ''}
                style={{
                  width:'100%', padding:16,
                  background:'#f59e0b', border:'none', borderRadius:14,
                  color:'#000', fontSize:16, fontWeight:800, fontFamily:'inherit',
                  opacity: sendReady ? 1 : 0.35,
                  cursor: sendReady ? 'pointer' : 'not-allowed',
                  transition: 'opacity .4s',
                }}
              >
                Send Estimate
              </button>
            </div>
          )}

          {/* Nav bar */}
          <div style={{ display:'flex', justifyContent:'space-around', padding:'6px 8px 10px', background:'#09090b', borderTop:'1px solid #18181b', flexShrink:0 }}>
            <NavItem icon={<svg width="20" height="20" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="9" stroke="#f59e0b" strokeWidth="1.8"/><line x1="11" y1="7" x2="11" y2="15" stroke="#f59e0b" strokeWidth="1.8" strokeLinecap="round"/><line x1="7" y1="11" x2="15" y2="11" stroke="#f59e0b" strokeWidth="1.8" strokeLinecap="round"/></svg>} label="New" active />
            <NavItem icon={<svg width="20" height="20" viewBox="0 0 22 22" fill="none"><rect x="4" y="2" width="14" height="18" rx="2" stroke="#52525b" strokeWidth="1.6"/><line x1="7.5" y1="7" x2="14.5" y2="7" stroke="#52525b" strokeWidth="1.3" strokeLinecap="round"/><line x1="7.5" y1="10.5" x2="14.5" y2="10.5" stroke="#52525b" strokeWidth="1.3" strokeLinecap="round"/><line x1="7.5" y1="14" x2="12" y2="14" stroke="#52525b" strokeWidth="1.3" strokeLinecap="round"/></svg>} label="Estimates" />
            <NavItem icon={<svg width="20" height="20" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="3.5" stroke="#52525b" strokeWidth="1.6"/><line x1="11" y1="2" x2="11" y2="5.5" stroke="#52525b" strokeWidth="1.6" strokeLinecap="round"/><line x1="11" y1="16.5" x2="11" y2="20" stroke="#52525b" strokeWidth="1.6" strokeLinecap="round"/><line x1="2" y1="11" x2="5.5" y2="11" stroke="#52525b" strokeWidth="1.6" strokeLinecap="round"/><line x1="16.5" y1="11" x2="20" y2="11" stroke="#52525b" strokeWidth="1.6" strokeLinecap="round"/><line x1="4.6" y1="4.6" x2="7.1" y2="7.1" stroke="#52525b" strokeWidth="1.6" strokeLinecap="round"/><line x1="14.9" y1="14.9" x2="17.4" y2="17.4" stroke="#52525b" strokeWidth="1.6" strokeLinecap="round"/><line x1="17.4" y1="4.6" x2="14.9" y2="7.1" stroke="#52525b" strokeWidth="1.6" strokeLinecap="round"/><line x1="7.1" y1="14.9" x2="4.6" y2="17.4" stroke="#52525b" strokeWidth="1.6" strokeLinecap="round"/></svg>} label="Rates" />
            <NavItem icon={<svg width="20" height="20" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="8" r="3.5" stroke="#52525b" strokeWidth="1.6"/><path d="M4 20 Q4 14 11 14 Q18 14 18 20" stroke="#52525b" strokeWidth="1.6" strokeLinecap="round" fill="none"/></svg>} label="Profile" />
          </div>

        </div>
      </div>
    </>
  );
}

// ─── NavItem ──────────────────────────────────────────────────────────────────

function NavItem({ icon, label, active = false }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
      {icon}
      <span style={{ fontSize:9, color: active ? '#f59e0b' : '#52525b' }}>{label}</span>
    </div>
  );
}
