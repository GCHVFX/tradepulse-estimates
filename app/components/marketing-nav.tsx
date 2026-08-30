"use client";

import { useState } from "react";
import Link from "next/link";
import { RowLockup } from "@/app/components/wordmark";

/**
 * The marketing site's public nav. Client component (needs the mobile menu's
 * open/close state) -- app/page.tsx stays a server component and passes down
 * only the plain values it needs (never the Supabase user object itself,
 * which isn't serializable across that boundary and isn't needed here since
 * only its truthiness matters to this nav).
 *
 * Below the sm: breakpoint, "How it works" / "Pricing" / "Sign in" collapse
 * into a hamburger menu. The primary CTA (Start Free / Go to App / Subscribe)
 * always stays visible in the bar itself, per the redesign-session brief.
 */
export function MarketingNav({
  hasLoggedInUser,
  hasAccess,
  ctaHref,
}: {
  hasLoggedInUser: boolean;
  hasAccess: boolean;
  ctaHref: string;
}) {
  const [open, setOpen] = useState(false);

  const ctaClassName =
    "inline-flex items-center justify-center h-9 px-4 sm:px-5 rounded-lg text-sm font-semibold text-white transition hover:opacity-90";

  const primaryCta = hasLoggedInUser ? (
    <Link href={ctaHref} className={ctaClassName} style={{ background: "#0D1B2E" }}>
      {hasAccess ? "Go to App" : "Subscribe"}
    </Link>
  ) : (
    <Link href="/signup" className={ctaClassName} style={{ background: "#0D1B2E" }}>
      Start Free
    </Link>
  );

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50"
      style={{ background: "rgba(243,232,208,0.85)", backdropFilter: "blur(12px)", borderBottom: "1px solid #C9B384" }}
    >
      <div className="flex items-center justify-between px-6 py-2 sm:py-4 sm:px-10">
        {/* Text shrinks under 640px via the .nav-lockup CSS rule in page.tsx's
            style block -- at 36px the wordmark alone (313px) leaves no room
            for anything else in a 375px-wide nav. Icon stays 44px; only the
            text shrinks, so Mark A's own 40px-and-up treatment is untouched. */}
        <span className="nav-lockup">
          <RowLockup variant="light" iconSize={44} textSize={36} />
        </span>

        <div className="flex items-center gap-3 sm:gap-6">
          <Link href="#how-it-works" className="hidden sm:block text-sm text-[#5C4A2E] hover:text-[#26211B] transition-colors">How it works</Link>
          <Link href="#pricing" className="hidden sm:block text-sm text-[#5C4A2E] hover:text-[#26211B] transition-colors">Pricing</Link>
          {!hasLoggedInUser && (
            <Link href="/login" className="hidden sm:block text-sm font-medium text-[#5C4A2E] hover:text-[#26211B] transition-colors">Sign in</Link>
          )}
          {primaryCta}
          <button
            type="button"
            className="sm:hidden inline-flex items-center justify-center w-9 h-9 -mr-1 rounded-lg text-[#26211B]"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? (
              <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
                <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {open && (
        <div
          className="sm:hidden absolute top-full left-0 right-0 px-6 pb-3 flex flex-col shadow-lg"
          style={{ background: "#F3E8D0", borderBottom: "1px solid #C9B384" }}
        >
          <Link href="#how-it-works" onClick={() => setOpen(false)} className="min-h-11 flex items-center text-sm text-[#5C4A2E]">How it works</Link>
          <Link href="#pricing" onClick={() => setOpen(false)} className="min-h-11 flex items-center text-sm text-[#5C4A2E]">Pricing</Link>
          {!hasLoggedInUser && (
            <Link href="/login" onClick={() => setOpen(false)} className="min-h-11 flex items-center text-sm font-medium text-[#5C4A2E]">Sign in</Link>
          )}
        </div>
      )}
    </nav>
  );
}
