"use client";

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

  const handleNew = () => {
    if (onNewClick) {
      onNewClick();
    } else {
      router.push(NEW_ESTIMATE_PATH);
    }
  };

  return (
    <nav
      aria-label="Primary navigation"
      className="flex border-t border-zinc-800 bg-zinc-950 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex w-full max-w-md">
        <div className="flex w-[calc(50%-2.5rem)]">
        <Link
          href="/rates"
          className={`flex min-h-11 flex-1 flex-col items-center gap-1 pt-1 transition-colors ${
            pathname === "/rates" ? "text-amber-500" : "text-zinc-300 hover:text-white"
          }`}
        >
          <span className="flex h-[66px] items-center justify-center">
            <Tag className="h-6 w-6" aria-hidden="true" />
          </span>
          <span className="text-xs font-medium">Rates</span>
        </Link>

        <Link
          href="/estimates"
          className={`flex min-h-11 flex-1 flex-col items-center gap-1 pt-1 transition-colors ${
            pathname === "/estimates" ? "text-amber-500" : "text-zinc-300 hover:text-white"
          }`}
        >
          <span className="flex h-[66px] items-center justify-center">
            <FileText className="h-6 w-6" aria-hidden="true" />
          </span>
          <span className="text-xs font-medium">Estimates</span>
        </Link>
        </div>

      <button
        type="button"
        onClick={handleNew}
        aria-label="New estimate"
        className="flex min-h-11 w-20 shrink-0 flex-col items-center gap-1 pt-1"
      >
        <span
          className="flex h-[66px] w-[66px] items-center justify-center rounded-full"
          style={{ backgroundColor: "#f59e0b" }}
        >
          <Plus className="w-8 h-8" style={{ color: "#0D1B2E" }} aria-hidden="true" />
        </span>
        <span className="text-xs font-medium" style={{ color: "#f59e0b" }}>New</span>
      </button>

        <Link
          href="/profile"
          className={`flex min-h-11 w-[calc(50%-2.5rem)] flex-col items-center gap-1 pt-1 transition-colors ${
            pathname === "/profile" ? "text-amber-500" : "text-zinc-300 hover:text-white"
          }`}
        >
          <span className="flex h-[66px] items-center justify-center">
            <User className="h-6 w-6" aria-hidden="true" />
          </span>
          <span className="text-xs font-medium">Profile</span>
        </Link>
      </div>
    </nav>
  );
}
