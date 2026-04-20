"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteEstimateLink({ estimateId }: { estimateId: string }) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch(`/api/estimates?id=${estimateId}`, { method: "DELETE" });
      router.push("/estimates");
      router.refresh();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (confirmDelete) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <p className="text-xs text-zinc-400">Delete this estimate?</p>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors min-h-[44px] px-3"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40 transition-colors min-h-[44px] px-3"
          >
            {deleting ? "Deleting..." : "Yes, delete"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirmDelete(true)}
      className="w-full text-xs text-red-700 hover:text-red-500 text-center py-4 transition-colors"
    >
      Delete estimate
    </button>
  );
}
