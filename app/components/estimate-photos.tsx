"use client";

import { useState } from "react";
import { Spinner } from "@/app/components/spinner";

export function EstimatePhotos({
  estimateId,
  photoUrls,
  includePhotos,
  isPro,
}: {
  estimateId: string;
  photoUrls: string[];
  includePhotos: boolean;
  isPro: boolean;
}) {
  const [urls, setUrls] = useState<string[]>(photoUrls);
  const [include, setInclude] = useState(includePhotos);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (urls.length === 0) return null;

  async function toggle() {
    const next = !include;
    setSaving(true);
    setError("");
    setInclude(next); // optimistic
    try {
      const res = await fetch("/api/estimates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: estimateId, include_photos: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setInclude(!next); // revert
      setError("Could not update. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function removePhoto(url: string) {
    setDeleting(url);
    setError("");
    try {
      const res = await fetch(`/api/estimates/${estimateId}/photos`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) throw new Error();
      setUrls((prev) => prev.filter((u) => u !== url));
    } catch {
      setError("Could not remove that photo. Try again.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="mt-6">
      {include && (
        <div className="mt-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Photos</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {urls.map((url) => (
              <div key={url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt="Job site photo"
                  className="aspect-square w-full rounded-xl border border-zinc-200 object-cover"
                />
                {deleting === url && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40">
                    <Spinner className="h-6 w-6 text-white" />
                  </div>
                )}
                {isPro && (
                  <button
                    type="button"
                    aria-label="Remove photo"
                    onClick={() => removePhoto(url)}
                    disabled={deleting === url}
                    className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-700 shadow-sm hover:text-zinc-950 disabled:opacity-50 transition-colors"
                  >
                    <svg viewBox="0 0 12 12" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                      <path
                        d="M2.5 2.5l7 7M9.5 2.5l-7 7"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isPro && (
        <button
          type="button"
          onClick={toggle}
          disabled={saving}
          className="mt-3 text-sm font-medium text-amber-600 hover:text-amber-500 disabled:opacity-50 min-h-[44px]"
        >
          {include ? "Remove photos from estimate" : "Add photos to estimate"}
        </button>
      )}

      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
