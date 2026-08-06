"use client";

import { useState } from "react";

export function DeleteAccountSection() {
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState("");

  const canDelete = confirmation === "DELETE" && !deleting && !deleted;

  async function handleDelete(): Promise<void> {
    if (!canDelete) return;

    setDeleting(true);
    setError("");

    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "We could not delete your account. Please try again.");
        return;
      }

      setDeleted(true);
      window.setTimeout(() => window.location.assign("/"), 750);
    } catch {
      setError("We could not delete your account. Please check your connection and try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="mt-8 border-t border-zinc-800 pt-8" aria-labelledby="delete-account-heading">
      <div className="rounded-xl border border-red-900/70 bg-red-950/20 p-4">
        <h2 id="delete-account-heading" className="text-base font-bold text-red-300">Delete account</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
          This permanently deletes your estimates, photos, customer information, business profile, and account access.
          Any active TradePulse subscription is cancelled. This cannot be undone.
        </p>
        <label htmlFor="delete-account-confirmation" className="mt-5 block text-sm font-medium text-zinc-200">
          Type <strong>DELETE</strong> to confirm
        </label>
        <input
          id="delete-account-confirmation"
          type="text"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          disabled={deleting}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="mt-2 w-full rounded-xl border border-red-900 bg-zinc-950 px-4 py-3 text-base text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-red-400 focus:ring-1 focus:ring-red-400 disabled:cursor-not-allowed disabled:opacity-60"
          placeholder="DELETE"
        />
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">
          For your security, this requires a recent sign-in. If prompted, sign out and sign back in before retrying.
        </p>
        {error && (
          <p className="mt-3 rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200" role="alert">
            {error}
          </p>
        )}
        {deleted && (
          <p className="mt-3 rounded-lg border border-emerald-800 bg-emerald-950 px-3 py-2 text-sm text-emerald-200" role="status">
            Your account was deleted. Returning to the homepage...
          </p>
        )}
        <button
          type="button"
          onClick={handleDelete}
          disabled={!canDelete}
          className="mt-5 flex min-h-11 w-full items-center justify-center rounded-xl border border-red-700 bg-red-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-red-500 active:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {deleting ? "Deleting account…" : deleted ? "Account deleted" : "Permanently delete account"}
        </button>
      </div>
    </section>
  );
}
