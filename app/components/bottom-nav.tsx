"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DollarSign, Tag, Plus, FileText, User } from "lucide-react";
import { useBusinessProfile } from "@/lib/hooks/use-business-profile";

interface BottomNavProps {
  onNewClick?: () => void;
}

export function BottomNav({ onNewClick }: BottomNavProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const { isPro, isLoading } = useBusinessProfile();

  const handleNew = () => {
    if (onNewClick) {
      onNewClick();
    } else {
      router.push('/new');
    }
  };

  return (
    <nav className="bg-zinc-950 border-t border-zinc-800 flex">
      <Link
        href="/payments"
        className={`relative flex-1 flex flex-col items-center gap-1 pt-2.5 pb-7 min-h-[56px] transition-colors ${
          pathname === "/payments" ? "text-amber-500" : "text-zinc-300 hover:text-white"
        }`}
      >
        {!isLoading && !isPro && (
          <span className="absolute top-1 right-2 text-[9px] font-bold leading-none text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded px-1 py-0.5">
            PRO
          </span>
        )}
        <DollarSign className="w-6 h-6" aria-hidden="true" />
        <span className="text-xs font-medium">Payments</span>
      </Link>

      <Link
        href="/rates"
        className={`flex-1 flex flex-col items-center gap-1 pt-2.5 pb-7 min-h-[56px] transition-colors ${
          pathname === "/rates" ? "text-amber-500" : "text-zinc-300 hover:text-white"
        }`}
      >
        <Tag className="w-6 h-6" aria-hidden="true" />
        <span className="text-xs font-medium">Rates</span>
      </Link>

      <button
        type="button"
        onClick={handleNew}
        className="flex-1 flex flex-col items-center justify-end gap-1 pb-7"
      >
        <span
          className="flex items-center justify-center w-16 h-16 rounded-full -mt-5"
          style={{ backgroundColor: "#f59e0b" }}
        >
          <Plus className="w-8 h-8" style={{ color: "#0D1B2E" }} aria-hidden="true" />
        </span>
        <span className="text-[11px] font-medium" style={{ color: "#f59e0b" }}>New</span>
      </button>

      <Link
        href="/estimates"
        className={`flex-1 flex flex-col items-center gap-1 pt-2.5 pb-7 min-h-[56px] transition-colors ${
          pathname === "/estimates" ? "text-amber-500" : "text-zinc-300 hover:text-white"
        }`}
      >
        <FileText className="w-6 h-6" aria-hidden="true" />
        <span className="text-xs font-medium">Estimates</span>
      </Link>

      <Link
        href="/profile"
        className={`flex-1 flex flex-col items-center gap-1 pt-2.5 pb-7 min-h-[56px] transition-colors ${
          pathname === "/profile" ? "text-amber-500" : "text-zinc-300 hover:text-white"
        }`}
      >
        <User className="w-6 h-6" aria-hidden="true" />
        <span className="text-xs font-medium">Profile</span>
      </Link>
    </nav>
  );
}
