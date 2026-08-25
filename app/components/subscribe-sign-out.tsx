"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

/**
 * The way off /subscribe.
 *
 * Without this the page is a dead end for an account that has no access. The
 * proxy sends every other authenticated route back to /subscribe, and an
 * account with no Stripe subscription gets neither the billing-portal button
 * nor the "continue trial" link, so the page renders with no navigation at
 * all. The only ways out were paying or clearing cookies.
 *
 * This does not weaken the gate. Signing out does not grant access to
 * anything; it just lets someone reach /login as a different account.
 */
export function SubscribeSignOut() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={async () => {
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.signOut();
        router.push("/login");
        router.refresh();
      }}
      className="w-full text-zinc-400 hover:text-zinc-300 text-sm py-3 transition-colors min-h-[44px]"
    >
      Sign out
    </button>
  );
}
