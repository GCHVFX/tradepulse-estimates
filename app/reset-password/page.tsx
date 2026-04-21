"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/app/components/logo";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

const inputClass =
  "w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3.5 text-white placeholder-zinc-600 text-base focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]";

type PageState = "loading" | "ready" | "expired";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      const supabase = createSupabaseBrowserClient();

      try {
        const { data, error } = await supabase.auth.getSession();

        if (cancelled) return;

        if (error || !data.session) {
          setPageState("expired");
          return;
        }

        setPageState("ready");
      } catch {
        if (!cancelled) {
          setPageState("expired");
        }
      }
    };

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUpdate() {
    setError("");

    if (!password.trim() || !confirmPassword.trim()) {
      setError("Please enter and confirm your new password.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    router.push("/new");
    router.refresh();
  }

  if (pageState === "loading") {
    return (
      <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
        <header className="px-5 pt-10 pb-6 shrink-0">
          <Logo />
        </header>
        <main className="flex-1 px-5 flex flex-col gap-6 pt-4">
          <p className="text-zinc-400 text-sm">Verifying your reset link...</p>
        </main>
      </div>
    );
  }

  if (pageState === "expired") {
    return (
      <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
        <header className="px-5 pt-10 pb-6 shrink-0">
          <Logo />
        </header>
        <main className="flex-1 px-5 flex flex-col gap-6 pt-4">
          <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-4 text-red-300 text-sm leading-relaxed">
            This reset link has expired or is invalid. Please{" "}
            <Link
              href="/login"
              className="text-amber-500 hover:text-amber-400 transition-colors underline"
            >
              request a new one
            </Link>
            .
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
      <header className="px-5 pt-10 pb-6 shrink-0">
        <Logo />
      </header>

      <main className="flex-1 px-5 flex flex-col gap-6 pt-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Set new password</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Choose a new password for your account.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-400">
              New password
            </label>
            <input
              type="password"
              className={inputClass}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="new-password"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-400">
              Confirm password
            </label>
            <input
              type="password"
              className={inputClass}
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleUpdate();
                }
              }}
            />
          </div>

          {error && (
            <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3.5 text-red-300 text-sm">
              {error}
            </div>
          )}
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 px-5 pb-10 pt-4 bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent">
        <button
          type="button"
          onClick={() => void handleUpdate()}
          disabled={!password.trim() || !confirmPassword.trim() || loading}
          className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
        >
          {loading ? "Updating..." : "Update Password"}
        </button>
      </div>
    </div>
  );
}
