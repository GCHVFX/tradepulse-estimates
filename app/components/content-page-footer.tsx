import { CANONICAL_URL, CANONICAL_DOMAIN } from "@/lib/site-url";
import { SUPPORT_EMAIL } from "@/lib/email-addresses";

/**
 * Shared footer for the long-form SEO content pages (plumbing-cost,
 * electrical-cost, plumbing-estimate-template). Extracted from three
 * copies that were identical except colour: plumbing-cost and
 * electrical-cost are light pages (#5C4A2E body, #26211B hover),
 * plumbing-estimate-template is dark-themed (#9A8F79 body, #F7F2E9
 * hover) -- a deliberate difference driven by that page's own theme, not
 * copy-paste drift, so it's a variant prop here rather than one color
 * silently picked for everyone.
 *
 * One combined <footer> (domain line always visible, not hidden on
 * mobile), unlike TradePageFooter's two stacked ones -- a real
 * difference between this page cluster and the trade-landing-page
 * cluster, kept as two separate components rather than merged.
 */
export function ContentPageFooter({ variant = "light" }: { variant?: "light" | "dark" }) {
  const textColor = variant === "dark" ? "#9A8F79" : "#5C4A2E";
  const linkClassName =
    variant === "dark"
      ? "hover:text-[#F7F2E9] transition-colors"
      : "hover:text-[#26211B] transition-colors";

  return (
    <footer className="text-center py-8 text-sm" style={{ color: textColor }}>
      <p>
        TradePulse Estimates,{" "}
        <a href={CANONICAL_URL} className={linkClassName}>
          {CANONICAL_DOMAIN}
        </a>
      </p>
      <div className="mt-2 flex items-center justify-center gap-4 text-xs flex-wrap">
        <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClassName}>{SUPPORT_EMAIL}</a>
        <a href="/terms" className={linkClassName}>Terms of Service</a>
        <a href="/privacy" className={linkClassName}>Privacy Policy</a>
      </div>
    </footer>
  );
}
