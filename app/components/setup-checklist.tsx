"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface SetupChecklistProps {
  businessId: string;
  hasBusinessName: boolean;
  hasEstimates: boolean;
  hasWebsiteQuotes: boolean;
}

const DISMISS_KEY = "tpe_setup_checklist_dismissed";

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-green-400 shrink-0" aria-hidden="true">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 10.5l2 2L13.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-zinc-600 shrink-0" aria-hidden="true">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function SetupChecklist({ businessId, hasBusinessName, hasEstimates, hasWebsiteQuotes }: SetupChecklistProps) {
  const [dismissed, setDismissed] = useState(true);
  const [hasPricebook, setHasPricebook] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showIntegration, setShowIntegration] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");

    fetch("/api/price-book")
      .then((r) => r.json())
      .then((d: { items?: unknown[] }) => {
        setHasPricebook((d.items ?? []).length > 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (dismissed || loading) return null;

  const steps = [
    { done: hasBusinessName, label: "Set up your business profile", href: "/profile" },
    { done: hasPricebook, label: "Add your rates and price book", href: "/rates" },
    { done: hasWebsiteQuotes, label: "Connect your website", href: null },
    { done: hasEstimates, label: "Create your first estimate", href: "/new" },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  function handleCopy() {
    navigator.clipboard.writeText(businessId).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mb-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-white font-semibold text-sm">Get started with TradePulse</p>
          <p className="text-zinc-400 text-xs mt-0.5">
            {allDone ? "You're all set." : `${doneCount} of ${steps.length} complete`}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center -mr-2 -mt-2"
          aria-label="Dismiss checklist"
        >
          <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="px-4 pb-1">
        <div className="w-full h-1 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-amber-500 rounded-full transition-all duration-500"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>
      </div>

      <ul className="px-4 py-3 flex flex-col gap-1">
        {steps.map((step) => {
          const isWebsite = step.href === null;

          if (isWebsite) {
            return (
              <li key={step.label}>
                <button
                  type="button"
                  onClick={() => setShowIntegration(!showIntegration)}
                  className="w-full flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-zinc-800/60 transition-colors min-h-[44px] text-left"
                >
                  {step.done ? <CheckIcon /> : <EmptyIcon />}
                  <span className={`text-sm flex-1 ${step.done ? "text-zinc-400 line-through" : "text-white"}`}>
                    {step.label}
                  </span>
                  <span className={`text-xs font-medium ${step.done ? "text-green-400" : "text-zinc-500"}`}>
                    {step.done ? "Connected" : "Not connected"}
                  </span>
                  <svg viewBox="0 0 16 16" fill="none" className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${showIntegration ? "rotate-180" : ""}`} aria-hidden="true">
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {showIntegration && (
                  <div className="ml-10 mr-2 mb-2 mt-1 flex flex-col gap-3">
                    <p className="text-zinc-400 text-xs leading-relaxed">
                      Add a quote form to your contractor website. When a customer submits a request,
                      it appears here as a draft estimate for you to review, price, and send. Nothing is auto-sent.
                    </p>
                    <div>
                      <p className="text-zinc-500 text-xs font-medium mb-1">Website connection code</p>
                      <p className="text-zinc-400 text-xs mb-2">
                        Give this code to whoever is setting up your website.
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 rounded-lg bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300 break-all">
                          {businessId}
                        </code>
                        <button
                          type="button"
                          onClick={handleCopy}
                          className="shrink-0 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-xs text-zinc-300 transition-colors min-h-[36px]"
                        >
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <details className="mt-2">
                        <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400 transition-colors">
                          Developer setup
                        </summary>
                        <p className="mt-1 text-xs text-zinc-500">
                          Set as an environment variable: <code className="text-zinc-400">TP_BUSINESS_ID={businessId}</code>
                        </p>
                      </details>
                    </div>
                  </div>
                )}
              </li>
            );
          }

          return (
            <li key={step.label}>
              <Link
                href={step.href}
                className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-zinc-800/60 transition-colors min-h-[44px]"
              >
                {step.done ? <CheckIcon /> : <EmptyIcon />}
                <span className={`text-sm ${step.done ? "text-zinc-400 line-through" : "text-white"}`}>
                  {step.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
