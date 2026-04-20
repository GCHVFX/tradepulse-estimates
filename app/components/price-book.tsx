"use client";

import { useState, useEffect } from "react";

interface PriceBookItem {
  id: string;
  name: string;
  unit_price: number;
}

interface Rates {
  labour_rate: number;
  markup_percent: number;
  deposit_percent: number;
  deposit_threshold: number;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function PriceBook() {
  const [rates, setRates] = useState<Rates>({ labour_rate: 0, markup_percent: 0, deposit_percent: 0, deposit_threshold: 0 });
  const [items, setItems] = useState<PriceBookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [rateStatus, setRateStatus] = useState<SaveStatus>("idle");

  // New item form
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // Edit item
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/price-book")
      .then((r) => r.json())
      .then((d: { rates: Rates; items: PriceBookItem[] }) => {
        setRates(d.rates);
        setItems(d.items);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSaveRates() {
    setRateStatus("saving");
    try {
      const res = await fetch("/api/price-book", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rates),
      });
      if (!res.ok) throw new Error("Failed");
      setRateStatus("saved");
      setTimeout(() => setRateStatus("idle"), 2000);
    } catch {
      setRateStatus("error");
    }
  }

  async function handleAddItem() {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/price-book-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          unit_price: parseFloat(newPrice) || 0,
        }),
      });
      const d = await res.json() as { item: PriceBookItem };
      setItems((prev) => [...prev, d.item]);
      setNewName("");
      setNewPrice("");
      setShowAddForm(false);
    } catch {
      // silent fail
    } finally {
      setAdding(false);
    }
  }

  function handleStartEdit(item: PriceBookItem) {
    setEditingId(item.id);
    setEditName(item.name);
    setEditPrice(item.unit_price ? String(item.unit_price) : "");
  }

  function handleCancelEdit() {
    setEditingId(null);
  }

  async function handleSaveEdit() {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/price-book-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, name: editName, unit_price: parseFloat(editPrice) || 0 }),
      });
      const d = await res.json() as { item: PriceBookItem };
      setItems((prev) => prev.map((i) => i.id === editingId ? d.item : i));
      setEditingId(null);
    } catch {
      // silent fail
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await fetch(`/api/price-book-items?id=${id}`, { method: "DELETE" });
  }

  const inputClass =
    "w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]";

  if (loading) {
    return <div className="h-20 bg-zinc-800 rounded-xl animate-pulse" />;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Labour rate + markup */}
      <div className="flex flex-col gap-4">
        <div className="flex gap-4">
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-sm font-medium text-zinc-400">Labour rate ($/hr)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm pointer-events-none select-none">$</span>
              <input
                type="number"
                className={inputClass + " pl-7"}
                placeholder="85"
                value={rates.labour_rate || ""}
                onChange={(e) => setRates((r) => ({ ...r, labour_rate: parseFloat(e.target.value) || 0 }))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-sm font-medium text-zinc-400">Materials markup (%)</label>
            <input
              type="number"
              className={inputClass}
              placeholder="20"
              value={rates.markup_percent || ""}
              onChange={(e) => setRates((r) => ({ ...r, markup_percent: parseFloat(e.target.value) || 0 }))}
            />
            <p className="text-zinc-500 text-xs">Applied on top of material costs in estimates.</p>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-sm font-medium text-zinc-400">Deposit %</label>
            <input
              type="number"
              className={inputClass}
              placeholder="25"
              value={rates.deposit_percent || ""}
              onChange={(e) => setRates((r) => ({ ...r, deposit_percent: parseFloat(e.target.value) || 0 }))}
            />
          </div>
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-sm font-medium text-zinc-400">Minimum job amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm pointer-events-none select-none">$</span>
              <input
                type="number"
                className={inputClass + " pl-7"}
                placeholder="500"
                value={rates.deposit_threshold || ""}
                onChange={(e) => setRates((r) => ({ ...r, deposit_threshold: parseFloat(e.target.value) || 0 }))}
              />
            </div>
            <p className="text-zinc-500 text-xs">Require deposit on jobs over this amount.</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSaveRates}
          disabled={rateStatus === "saving"}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold text-sm rounded-xl py-3 transition-colors min-h-[44px] flex items-center justify-center gap-2"
        >
          {rateStatus === "saving" ? "Saving..." : rateStatus === "saved" ? "Saved" : "Save Rates"}
        </button>
      </div>

      {/* Divider */}
      <div className="border-t border-zinc-800" />

      {/* Custom line items */}
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-400">Common line items</p>
          <p className="text-xs text-zinc-500 mt-1">
            Material prices on estimates include your markup. Customers see final prices only.
          </p>
        </div>

        {showAddForm && (
          <div className="flex flex-col gap-2 p-3 bg-zinc-900 rounded-xl border border-zinc-800">
            <input
              type="text"
              className={inputClass}
              placeholder="Item name (e.g. Service call fee)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm pointer-events-none select-none">$</span>
              <input
                type="number"
                className={inputClass + " pl-7"}
                placeholder="0.00"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAddItem}
                disabled={!newName.trim() || adding}
                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-semibold text-sm rounded-lg py-2.5 transition-colors min-h-[40px]"
              >
                {adding ? "Adding..." : "Add"}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white text-sm rounded-lg py-2.5 transition-colors min-h-[40px]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {items.length === 0 && !showAddForm && (
          <p className="text-zinc-500 text-sm">No items yet. Add your common line items and the AI will use them when estimating.</p>
        )}

        {items.map((item) =>
          editingId === item.id ? (
            <div key={item.id} className="flex flex-col gap-2 p-3 bg-zinc-900 rounded-xl border border-amber-500/40">
              <input
                type="text"
                className={inputClass}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
              />
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm pointer-events-none select-none">$</span>
                <input
                  type="number"
                  className={inputClass + " pl-7"}
                  placeholder="0.00"
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={!editName.trim() || saving}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-semibold text-sm rounded-lg py-2.5 transition-colors min-h-[40px]"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white text-sm rounded-lg py-2.5 transition-colors min-h-[40px]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{item.name}</p>
                <p className="text-zinc-500 text-xs mt-0.5">
                  ${item.unit_price.toFixed(2)}
                </p>
              </div>
              <div className="flex items-center shrink-0">
                <button
                  type="button"
                  onClick={() => handleStartEdit(item)}
                  className="text-zinc-600 hover:text-zinc-300 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                  aria-label="Edit item"
                >
                  <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5" aria-hidden="true">
                    <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteItem(item.id)}
                  className="text-zinc-600 hover:text-red-400 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                  aria-label="Delete item"
                >
                  <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
                    <path d="M3 4h10M6 4V3h4v1M5 4l.5 9h5L11 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          )
        )}

        {!showAddForm && (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="w-full border border-dashed border-amber-500/40 bg-amber-500/5 text-amber-500 hover:border-amber-500 hover:bg-amber-500/10 font-medium text-sm rounded-xl py-3 transition-colors min-h-[44px] flex items-center justify-center gap-2"
          >
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Add item
          </button>
        )}
      </div>
    </div>
  );
}
