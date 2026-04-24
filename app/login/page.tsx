"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/app/components/logo";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

const inputClass =
  "w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3.5 text-white placeholder-zinc-600 text-base focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState("");

  function getNextPath() {
    if (typeof window === "undefined") return "/new";
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    if (!next || !next.startsWith("/")) return "/new";
    return next;
  }

  async function handleSignIn() {
    setError("");
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push(getNextPath());
    router.refresh();
  }

  async function handleResetPassword() {
    setResetError("");
    setResetLoading(true);
    const supabase = createSupabaseBrowserClient();
    const redirectTo = "https://www.trytradepulse.com/auth/callback?next=/reset-password";
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) {
      setResetError(error.message);
      setResetLoading(false);
      return;
    }
    setResetSent(true);
    setResetLoading(false);
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
      <header className="px-5 pt-10 pb-6 shrink-0">
        <Logo />
      </header>

      {showForgot ? (
        <>
          <main className="flex-1 px-5 flex flex-col gap-6 pt-4">
            <div>
              <h1 className="text-2xl font-bold text-white">Reset password</h1>
              <p className="text-zinc-500 text-sm mt-1">We&apos;ll send a reset link to your email.</p>
            </div>

            {resetSent ? (
              <div className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-4 text-zinc-300 text-sm leading-relaxed">
                If an account exists with that email, you&apos;ll receive a reset link shortly.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-zinc-400">Email</label>
                  <input
                    type="email"
                    className={inputClass}
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                    autoComplete="email"
                    onKeyDown={(e) => e.key === "Enter" && handleResetPassword()}
                  />
                </div>
                {resetError && (
                  <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3.5 text-red-300 text-sm">
                    {resetError}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowForgot(false)}
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors text-left min-h-[44px] flex items-center"
            >
              ← Back to sign in
            </button>
          </main>

          {!resetSent && (
            <div className="fixed bottom-0 left-0 right-0 px-5 pb-10 pt-4 bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent">
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={!email.trim() || resetLoading}
                className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
              >
                {resetLoading ? "Sending..." : "Send reset link"}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <main className="flex-1 px-5 flex flex-col gap-6 pt-4">
            <div>
              <h1 className="text-2xl font-bold text-white">Sign in</h1>
              <p className="text-zinc-500 text-sm mt-1">Welcome back.</p>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-zinc-400">Email</label>
                <input
                  type="email"
                  className={inputClass}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                  autoComplete="email"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-zinc-400">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    className={inputClass + " pr-11"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors p-1"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
                        <path d="M2.5 2.5l15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        <path
                          d="M6.37 6.43A7.5 7.5 0 001.5 10s3.5 7 8.5 7a7.6 7.6 0 004.15-1.23M8.59 4.1A7.4 7.4 0 0110 4c5 0 8.5 6 8.5 6a9.2 9.2 0 01-2.15 2.72"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M7.76 7.84a2.5 2.5 0 003.38 3.43"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
                        <path
                          d="M1.5 10S5 3.5 10 3.5 18.5 10 18.5 10 15 16.5 10 16.5 1.5 10 1.5 10z"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3.5 text-red-300 text-sm">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-500">
                  No account?{" "}
                  <Link href="/signup" className="text-amber-500 hover:text-amber-400 transition-colors">
                    Sign up
                  </Link>
                </p>
                <button
                  type="button"
                  onClick={() => setShowForgot(true)}
                  className="text-sm text-amber-500 hover:text-amber-400 transition-colors py-2"
                >
                  Forgot password?
                </button>
              </div>
            </div>
          </main>

          <div className="fixed bottom-0 left-0 right-0 px-5 pb-10 pt-4 bg-gradient-to-t from-zinc-950 via-zinc-950/95 to-transparent">
            <button
              type="button"
              onClick={handleSignIn}
              disabled={!email.trim() || !password.trim() || loading}
              className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
