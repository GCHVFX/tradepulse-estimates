import { CANONICAL_URL, CANONICAL_DOMAIN } from "@/lib/site-url";
import { SUPPORT_EMAIL } from "@/lib/email-addresses";

/**
 * Shared footer for the trade-specific SEO landing pages (trades,
 * electricians, plumbers). Extracted from three byte-identical inlined
 * copies. Two stacked <footer> elements, matching the original exactly:
 * a domain line hidden below sm: (these pages keep the fold tight on
 * mobile), then a Support/Terms/Privacy links bar that's always visible.
 * Deliberately kept separate from ContentPageFooter (plumbing-cost/
 * electrical-cost/plumbing-estimate-template): that cluster's domain line
 * is NOT hidden on mobile -- a real difference between the two page
 * groups, not drift, so it stays a distinct component rather than one
 * merged with an option to toggle it away.
 */
export function TradePageFooter() {
  return (
    <>
      <footer className="hidden sm:block text-center py-8 text-sm text-[#5C4A2E]">
        TradePulse Estimates,{" "}
        <a href={CANONICAL_URL} className="hover:text-[#26211B] transition-colors">
          {CANONICAL_DOMAIN}
        </a>
      </footer>

      <footer className="border-t border-[#C9B384] mt-16 py-6 px-5 text-center">
        <div className="flex items-center justify-center gap-6 text-xs text-[#5C4A2E] flex-wrap">
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-[#26211B] transition-colors">{SUPPORT_EMAIL}</a>
          <a href="/terms" className="hover:text-[#26211B] transition-colors">Terms of Service</a>
          <a href="/privacy" className="hover:text-[#26211B] transition-colors">Privacy Policy</a>
        </div>
      </footer>
    </>
  );
}
