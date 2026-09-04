import Link from "next/link";
import { RowLockup } from "@/app/components/wordmark";

/**
 * The homepage's own footer -- extracted so it isn't the one page left
 * inlining raw markup once every other cluster has a shared component.
 * Currently used only by app/page.tsx (its #how-it-works/#pricing anchors
 * only resolve there), but kept as its own component rather than left
 * inline, matching MarketingNav's own prop shape (hasLoggedInUser,
 * hasAccess, ctaHref) for the same reason MarketingNav takes them.
 *
 * Two stacked <footer> elements, same as the original: a logo + nav row
 * with the auth-dependent CTA, then a separate Support/Terms/Privacy
 * links bar.
 */
export function MarketingFooter({
  hasLoggedInUser,
  hasAccess,
  ctaHref,
}: {
  hasLoggedInUser: boolean;
  hasAccess: boolean;
  ctaHref: string;
}) {
  return (
    <>
      <footer className="border-t border-[#C9B384] py-10 bg-[#F3E8D0]">
        <div className="mx-auto max-w-5xl px-6 sm:px-10 flex flex-col sm:flex-row items-center justify-between gap-6">
          {/* Mark A at every size, per Greg's call -- LogoMarkLight applies its own small-size treatment (thicker stroke, gridlines dropped) under 24px, no Mark C swap. 20/19 matches the reference sheet's own small/dense pairing (near 1:1, not an oversized icon shrunk-down in text only). Comfortably inside this row's ~189px budget at its tightest breakpoint (sm:, 640px) -- see HANDOFF.md for the measurement. */}
          <RowLockup variant="light" iconSize={20} textSize={19} />
          <nav className="flex flex-wrap items-center justify-center gap-6">
            <Link href="#how-it-works" className="text-sm text-[#5C4A2E] hover:text-[#26211B] transition-colors">How it works</Link>
            <Link href="#pricing" className="text-sm text-[#5C4A2E] hover:text-[#26211B] transition-colors">Pricing</Link>
            {hasLoggedInUser ? (
              <Link href={ctaHref}
                className="inline-flex h-9 items-center justify-center px-5 rounded-lg text-sm font-semibold text-white transition hover:opacity-90"
                style={{ background: "#0D1B2E" }}>
                {hasAccess ? "Go to App" : "Subscribe"}
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-sm text-[#5C4A2E] hover:text-[#26211B] transition-colors">Sign In</Link>
                <Link href="/signup"
                  className="inline-flex h-9 items-center justify-center px-5 rounded-lg text-sm font-semibold text-white transition hover:opacity-90"
                  style={{ background: "#0D1B2E" }}>
                  Start Free
                </Link>
              </>
            )}
          </nav>
        </div>
      </footer>

      <footer className="border-t border-[#C9B384] mt-16 py-6 px-5 text-center">
        <div className="flex items-center justify-center gap-6 text-xs text-[#5C4A2E] flex-wrap">
          <Link href="/contact" className="inline-flex min-h-11 items-center transition-colors hover:text-[#26211B]">Support</Link>
          <Link href="/terms" className="inline-flex min-h-11 items-center transition-colors hover:text-[#26211B]">Terms of Service</Link>
          <Link href="/privacy" className="inline-flex min-h-11 items-center transition-colors hover:text-[#26211B]">Privacy Policy</Link>
        </div>
      </footer>
    </>
  );
}
