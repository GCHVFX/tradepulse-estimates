import Link from "next/link";
import { RowLockup } from "@/app/components/wordmark";

/**
 * Shared header for the trade-specific SEO landing pages (trades,
 * electricians, plumbers). Extracted from three byte-identical inlined
 * copies -- deliberately kept separate from MarketingNav, not swapped for
 * it: this header has no hamburger menu, no #how-it-works/#pricing anchors
 * (which only resolve on the homepage), and isn't sticky. Those are real
 * differences from the homepage nav, not copy-paste drift, so this is its
 * own small component rather than a MarketingNav variant.
 */
export function TradePageHeader() {
  return (
    <header className="flex items-center justify-between px-6 pt-6 pb-2 max-w-lg mx-auto w-full">
      <RowLockup variant="light" iconSize={44} textSize={36} />
      <Link
        href="/login"
        className="text-sm font-medium text-[#5C4A2E] hover:text-[#26211B] transition-colors"
      >
        Sign in
      </Link>
    </header>
  );
}
