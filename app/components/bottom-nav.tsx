"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Tag, Plus, FileText, User } from "lucide-react";

export const NEW_ESTIMATE_PATH = "/new";

interface BottomNavProps {
  onNewClick?: () => void;
}

export function BottomNav({ onNewClick }: BottomNavProps = {}) {
  const pathname = usePathname();
  const router = useRouter();

  // Published so any fixed bar above this nav can position and pad itself
  // against this nav's real height instead of a hardcoded guess. This nav's
  // own bottom padding is `env(safe-area-inset-bottom)`-driven (below), so
  // its rendered height varies by device -- a plain iPhone with no home
  // indicator and one with a safe-area inset do not render the same height,
  // which a static pixel constant elsewhere silently assumed away.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const publishHeight = () => {
      document.documentElement.style.setProperty("--tp-bottom-nav-height", `${el.offsetHeight}px`);
    };
    publishHeight();
    const observer = new ResizeObserver(publishHeight);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--tp-bottom-nav-height");
    };
  }, []);

  const handleNew = () => {
    if (onNewClick) {
      onNewClick();
    } else {
      router.push(NEW_ESTIMATE_PATH);
    }
  };

  // Conventional flat four-column bar. Every item shares the identical
  // column structure (py-2, a 42px icon slot, gap-1, label) so icons and
  // labels land on the same baseline across all four — New is emphasized
  // only by icon/label colour and a subtle background square inside its
  // slot, never by height, size, or position relative to the bar.
  const itemClass = (path: string) =>
    `flex min-h-11 flex-col items-center justify-center gap-1 py-2 transition-colors ${
      pathname === path ? "text-amber-500" : "text-zinc-300 hover:text-white"
    }`;

  return (
    <nav
      ref={navRef}
      aria-label="Primary navigation"
      className="flex border-t border-zinc-800 bg-zinc-950 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto grid w-full max-w-md grid-cols-4">
        <Link href="/rates" className={itemClass("/rates")}>
          <span className="flex h-[42px] w-[42px] items-center justify-center">
            <Tag className="h-6 w-6" aria-hidden="true" />
          </span>
          <span className="text-xs font-medium">Rates</span>
        </Link>

        <Link href="/estimates" className={itemClass("/estimates")}>
          <span className="flex h-[42px] w-[42px] items-center justify-center">
            <FileText className="h-6 w-6" aria-hidden="true" />
          </span>
          <span className="text-xs font-medium">Estimates</span>
        </Link>

        <button
          type="button"
          onClick={handleNew}
          aria-label="New estimate"
          className="flex min-h-11 flex-col items-center justify-center gap-1 py-2"
        >
          <span
            className="flex h-[42px] w-[42px] items-center justify-center rounded-xl"
            style={{ backgroundColor: "rgba(245, 158, 11, 0.15)" }}
          >
            <Plus className="h-6 w-6" style={{ color: "#f59e0b" }} aria-hidden="true" />
          </span>
          <span className="text-xs font-medium" style={{ color: "#f59e0b" }}>New</span>
        </button>

        <Link href="/profile" className={itemClass("/profile")}>
          <span className="flex h-[42px] w-[42px] items-center justify-center">
            <User className="h-6 w-6" aria-hidden="true" />
          </span>
          <span className="text-xs font-medium">Profile</span>
        </Link>
      </div>
    </nav>
  );
}
