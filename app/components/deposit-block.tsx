"use client";

import { useState } from "react";

interface DepositBlockProps {
  estimateId: string | null;
  initialAmount: string;
}

export function DepositBlock({ estimateId, initialAmount }: DepositBlockProps) {
  const [amount, setAmount] = useState(initialAmount);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialAmount);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!estimateId) {
      setAmount(draft);
      setEditing(false);
      return;
    }
    setSaving(true);
    await fetch("/api/estimates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: estimateId, deposit_amount: draft }),
    });
    setSaving(false);
    setAmount(draft);
    setEditing(false);
  }

  const display = amount && amount !== "0" ? amount : "None";

  return (
    <div className="mt-4 border border-zinc-200 rounded-xl px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-700 font-medium">Deposit required</span>
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-32 border border-zinc-300 rounded-lg px-3 py-1.5 text-sm text-zinc-700 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
              placeholder="e.g. $500"
              autoFocus
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="text-sm font-medium text-amber-600 hover:text-amber-500 disabled:opacity-50 min-h-[44px] px-1"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setDraft(amount); setEditing(true); }}
            className="text-sm text-zinc-700 hover:text-zinc-900 min-h-[44px] px-1"
          >
            {display}
          </button>
        )}
      </div>
    </div>
  );
}
