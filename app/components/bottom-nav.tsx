"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useBusinessProfile } from "@/lib/hooks/use-business-profile";

interface BottomNavProps {
  onNewClick?: () => void;
}

export function BottomNav({ onNewClick }: BottomNavProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isPro, isLoading } = useBusinessProfile();
  const [upgrading, setUpgrading] = useState(false);

  async function handleUpgradeTap() {
    setUpgrading(true);
    try {
      const res = await fetch("/api/billing/upgrade", { method: "POST" });
      const data = await res.json() as { upgraded?: boolean; redirectUrl?: string };
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      if (data.upgraded) {
        router.push("/payments");
        router.refresh();
        return;
      }
    } catch {
      // fall through
    }
    setUpgrading(false);
  }

  const handleNew = () => {
    if (onNewClick) {
      onNewClick();
    } else {
      router.push('/new');
    }
  };

  return (
    <nav className="bg-zinc-950 border-t border-zinc-800 flex">
      <button
        type="button"
        onClick={handleNew}
        className={`flex-1 flex flex-col items-center gap-1 pt-2.5 pb-7 min-h-[44px] transition-colors ${
          pathname === "/new" ? "text-amber-500" : "text-zinc-300 hover:text-white"
        }`}
      >
        <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
          <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 7v6M7 10h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="text-xs font-medium">New</span>
      </button>

      <Link
        href="/estimates"
        className={`flex-1 flex flex-col items-center gap-1 pt-2.5 pb-7 min-h-[44px] transition-colors ${
          pathname === "/estimates" ? "text-amber-500" : "text-zinc-300 hover:text-white"
        }`}
      >
        <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
          <rect x="3.5" y="2.5" width="13" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="text-xs font-medium">Estimates</span>
      </Link>

      {!isLoading && !isPro ? (
        <button
          type="button"
          disabled={upgrading}
          onClick={handleUpgradeTap}
          className="relative flex-1 flex flex-col items-center gap-1 pt-2.5 pb-7 min-h-[44px] transition-colors text-zinc-300 hover:text-white"
        >
          <span className="absolute top-1 right-2 text-[9px] font-bold leading-none text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded px-1 py-0.5">
            PRO
          </span>
          <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
            <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 5.5v9M12.25 7.5c-.45-.7-1.25-1.1-2.25-1.1-1.25 0-2.25.7-2.25 1.7 0 2.3 4.5 1.2 4.5 3.5 0 1-1 1.7-2.25 1.7-1 0-1.8-.4-2.25-1.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="text-xs font-medium">Payments</span>
        </button>
      ) : (
        <Link
          href="/payments"
          className={`relative flex-1 flex flex-col items-center gap-1 pt-2.5 pb-7 min-h-[44px] transition-colors ${
            pathname === "/payments" ? "text-amber-500" : "text-zinc-300 hover:text-white"
          }`}
        >
          <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
            <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 5.5v9M12.25 7.5c-.45-.7-1.25-1.1-2.25-1.1-1.25 0-2.25.7-2.25 1.7 0 2.3 4.5 1.2 4.5 3.5 0 1-1 1.7-2.25 1.7-1 0-1.8-.4-2.25-1.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="text-xs font-medium">Payments</span>
        </Link>
      )}

      <Link
        href="/rates"
        className={`flex-1 flex flex-col items-center gap-1 pt-2.5 pb-7 min-h-[44px] transition-colors ${
          pathname === "/rates" ? "text-amber-500" : "text-zinc-300 hover:text-white"
        }`}
      >
        <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
          <path d="M10 2v2M10 16v2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M2 10h2M16 10h2M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="text-xs font-medium">Rates</span>
      </Link>

      <Link
        href="/profile"
        className={`flex-1 flex flex-col items-center gap-1 pt-2.5 pb-7 min-h-[44px] transition-colors ${
          pathname === "/profile" ? "text-amber-500" : "text-zinc-300 hover:text-white"
        }`}
      >
        <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
          <circle cx="10" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 17c0-3.314 3.134-6 7-6s7 2.686 7 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="text-xs font-medium">Profile</span>
      </Link>
    </nav>
  );
}
