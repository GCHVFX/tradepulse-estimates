"use client";

import { useState } from "react";

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
  const [include, setInclude] = useState(includePhotos);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (photoUrls.length === 0) return null;

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

  return (
    <div className="mt-6">
      {include && (
        <div className="mt-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Photos</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photoUrls.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt="Job site photo"
                className="aspect-square w-full rounded-xl border border-zinc-200 object-cover"
              />
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
