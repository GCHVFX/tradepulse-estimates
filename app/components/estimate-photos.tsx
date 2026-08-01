"use client";

import { useState } from "react";
import { Spinner } from "@/app/components/spinner";

export interface EstimatePhoto {
  /** Short-lived signed URL. Display only, never an identifier. */
  url: string;
  /** Stable storage identifier. This is what the delete API matches on. */
  storagePath: string;
}

export function EstimatePhotos({
  estimateId,
  photos,
  includePhotos,
  isPro,
}: {
  estimateId: string;
  photos: EstimatePhoto[];
  includePhotos: boolean;
  isPro: boolean;
}) {
  const [items, setItems] = useState<EstimatePhoto[]>(photos);
  const [include, setInclude] = useState(includePhotos);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());

  if (items.length === 0) return null;

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

  // The API matches the photo row on storage_path, so that is what gets sent.
  // This previously sent `{ url }` holding a signed URL, which the route
  // rejected with a 400 every time, making photo removal impossible.
  async function removePhoto(photo: EstimatePhoto) {
    setDeleting(photo.storagePath);
    setError("");
    try {
      const res = await fetch(`/api/estimates/${estimateId}/photos`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_path: photo.storagePath }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not remove that photo. Try again.");
        return;
      }
      // Only drop it from the UI once the server confirms both the storage
      // object and the row are gone. A failed delete leaves the photo visible.
      setItems((prev) => prev.filter((p) => p.storagePath !== photo.storagePath));
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
            {items.map((photo) => (
              <div key={photo.storagePath} className="relative">
                {failedUrls.has(photo.url) ? (
                  <div className="aspect-square w-full rounded-xl border border-zinc-200 bg-zinc-100 flex items-center justify-center">
                    <p className="text-zinc-400 text-xs text-center px-2">Photo could not be loaded</p>
                  </div>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={photo.url}
                    alt="Job site photo"
                    className="aspect-square w-full rounded-xl border border-zinc-200 object-cover"
                    onError={() => setFailedUrls((prev) => new Set(prev).add(photo.url))}
                  />
                )}
                {deleting === photo.storagePath && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40">
                    <Spinner className="h-6 w-6 text-white" />
                  </div>
                )}
                {isPro && (
                  <button
                    type="button"
                    aria-label="Remove photo"
                    onClick={() => removePhoto(photo)}
                    disabled={deleting === photo.storagePath}
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
