"use client";

import { useState } from "react";

interface FaqItem {
  q: string;
  a: string;
}

/**
 * Closed by default, one answer open at a time -- opening a question closes
 * whichever other one was open. Content-visibility behaviour only; the
 * kraft/hairline box treatment (bg-[#F3E8D0], border-[#C9B384]) is the same
 * as the plain list this replaced.
 */
export function FaqAccordion({ items }: { items: readonly FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      {items.map((item, i) => {
        const isOpen = openIndex === i;
        return (
          <div key={item.q} className="rounded-xl bg-[#F3E8D0] border border-[#C9B384] overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenIndex(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="w-full flex items-center justify-between gap-4 text-left p-6"
            >
              <h3 className="font-semibold text-[#26211B]">{item.q}</h3>
              <svg
                viewBox="0 0 20 20"
                fill="none"
                className="w-5 h-5 shrink-0 transition-transform"
                style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                aria-hidden="true"
              >
                <path d="M5 7.5l5 5 5-5" stroke="#5C4A2E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {isOpen && (
              <p className="px-6 pb-6 text-sm text-[#5C4A2E] leading-relaxed">{item.a}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
