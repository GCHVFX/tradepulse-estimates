"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { formatPhoneInput } from "@/lib/format-phone";

type Step = "profile" | "rates";

interface PriceBookItem {
  id: string;
  name: string;
  unit_price: number;
}

export function OnboardingForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("profile");

  const [companyName, setCompanyName] = useState("");
  const [preparedBy, setPreparedBy] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [labourRate, setLabourRate] = useState("");
  const [markup, setMarkup] = useState("");
  const [depositPercent, setDepositPercent] = useState("");
  const [depositThreshold, setDepositThreshold] = useState("");

  const [items, setItems] = useState<PriceBookItem[]>([]);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (step === "rates") {
      fetch("/api/price-book")
        .then((r) => r.json())
        .then(
          (d: {
            rates?: {
              labour_rate?: number;
              markup_percent?: number;
              deposit_percent?: number;
              deposit_threshold?: number;
            };
            items?: PriceBookItem[];
          }) => {
            if (d.rates?.labour_rate) setLabourRate(String(d.rates.labour_rate));
            if (d.rates?.markup_percent) setMarkup(String(d.rates.markup_percent));
            if (d.rates?.deposit_percent) {
              setDepositPercent(String(d.rates.deposit_percent));
            }
            if (d.rates?.deposit_threshold) {
              setDepositThreshold(String(d.rates.deposit_threshold));
            }
            if (d.items) setItems(d.items);
          }
        )
        .catch(() => {});
    }
  }, [step]);

  const inputClass =
    "w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3.5 text-white placeholder-zinc-600 text-base focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[56px]";

  async function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setLogoError("PNG or JPG only.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setLogoError("Image must be under 2MB.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setLogoUploading(true);
    setLogoError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload-logo", {
        method: "POST",
        body: formData,
      });

      let data: { logoUrl?: string; error?: string } | null = null;

      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        throw new Error(data?.error ?? `Upload failed (${res.status}).`);
      }

      if (!data?.logoUrl) {
        throw new Error("Upload failed. No logo URL returned.");
      }

      setLogoUrl(data.logoUrl);
    } catch (err) {
      setLogoError(
        err instanceof Error ? err.message : "Upload failed. Try again."
      );
    } finally {
      setLogoUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleProfileNext() {
    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: companyName,
          prepared_by: preparedBy,
          phone,
          email,
          logo_url: logoUrl,
        }),
      });

      if (!res.ok) throw new Error("Failed to save profile");
      setStep("rates");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setSaving(false);
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

      const d = (await res.json()) as { item: PriceBookItem };
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

  async function handleDeleteItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await fetch(`/api/price-book-items?id=${id}`, { method: "DELETE" });
  }

  async function handleRatesDone() {
    setSaving(true);

    try {
      await fetch("/api/price-book", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          labour_rate: parseFloat(labourRate) || 0,
          markup_percent: parseFloat(markup) || 0,
          deposit_percent: parseFloat(depositPercent) || 0,
          deposit_threshold: parseFloat(depositThreshold) || 0,
        }),
      });

      router.push("/new");
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
      setSaving(false);
    }
  }

  if (step === "profile") {
    return (
      <div className="flex flex-col gap-5 flex-1">
        <div className="flex gap-2 mb-2">
          <div className="flex-1 h-1 rounded-full bg-amber-500" />
          <div className="flex-1 h-1 rounded-full bg-zinc-800" />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex gap-3 items-end">
            <div className="flex flex-col gap-1.5 shrink-0">
              <label className="text-sm font-medium text-zinc-400">Company logo</label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={logoUploading}
                className="w-20 min-h-[56px] h-[56px] bg-zinc-900 border border-zinc-700 border-dashed rounded-xl flex items-center justify-center transition-colors hover:border-zinc-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {logoUploading ? (
                  <svg
                    className="animate-spin w-5 h-5 text-zinc-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                ) : logoUrl ? (
                  <Image
                    src={logoUrl}
                    alt="Company logo"
                    width={80}
                    height={56}
                    className="w-full h-full object-contain rounded-xl"
                    unoptimized
                  />
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="w-6 h-6 text-zinc-600"
                    aria-hidden="true"
                  >
                    <rect
                      x="3"
                      y="3"
                      width="18"
                      height="18"
                      rx="2"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <circle
                      cx="8.5"
                      cy="8.5"
                      r="1.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M21 15l-5-5L5 21"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            </div>

            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-sm font-medium text-zinc-400">
                Company name <span className="text-zinc-500">(optional)</span>
              </label>
              <input
                type="text"
                className={inputClass}
                placeholder="Smith Plumbing Co."
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                autoFocus
                autoComplete="organization"
              />
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={handleLogoSelect}
          />

          {logoError && <p className="text-red-400 text-sm">{logoError}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-400">Your name</label>
          <input
            type="text"
            className={inputClass}
            placeholder="John Smith"
            value={preparedBy}
            onChange={(e) => setPreparedBy(e.target.value)}
            autoComplete="name"
          />
          <p className="text-zinc-600 text-xs">Shows as “Prepared by” on estimates.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-400">Business phone</label>
          <input
            type="tel"
            className={inputClass}
            placeholder="000-000-0000"
            value={phone}
            onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
            autoComplete="tel"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-400">Business email</label>
          <input
            type="email"
            className={inputClass}
            placeholder="hello@smithplumbing.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <p className="text-zinc-600 text-xs">Appears on estimates so customers can reach you.</p>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <p className="text-sm text-zinc-400">
          This information appears on your estimates. You can add or update it anytime in{" "}
          <Link href="/profile" className="text-amber-500 hover:text-amber-400 transition-colors">
            Profile
          </Link>.
        </p>

        <div className="mt-auto">
          <button
            type="button"
            onClick={handleProfileNext}
            disabled={saving}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
          >
            {saving ? "Saving..." : "Next"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 flex-1">
      <div className="flex gap-2 mb-2">
        <div className="flex-1 h-1 rounded-full bg-amber-500" />
        <div className="flex-1 h-1 rounded-full bg-amber-500" />
      </div>

      <div>
        <h2 className="text-lg font-semibold">Set your rates</h2>
        <p className="text-zinc-500 text-sm mt-1">
          The AI uses these to price estimates accurately. You can update them any time in Rates.
        </p>
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col gap-1.5 flex-1">
          <label className="text-sm font-medium text-zinc-400">Labour rate ($/hr)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm pointer-events-none select-none">
              $
            </span>
            <input
              type="number"
              className={`${inputClass} pl-7`}
              placeholder="85"
              value={labourRate}
              onChange={(e) => setLabourRate(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5 flex-1">
          <label className="text-sm font-medium text-zinc-400">Materials markup (%)</label>
          <input
            type="number"
            className={inputClass}
            placeholder="20"
            value={markup}
            onChange={(e) => setMarkup(e.target.value)}
          />
          <p className="text-zinc-600 text-xs">Applied on top of material costs in estimates.</p>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex flex-col gap-1.5 flex-1">
          <label className="text-sm font-medium text-zinc-400">Deposit %</label>
          <input
            type="number"
            className={inputClass}
            placeholder="25"
            value={depositPercent}
            onChange={(e) => setDepositPercent(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5 flex-1">
          <label className="text-sm font-medium text-zinc-400">Minimum job amount</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm pointer-events-none select-none">
              $
            </span>
            <input
              type="number"
              className={`${inputClass} pl-7`}
              placeholder="500"
              value={depositThreshold}
              onChange={(e) => setDepositThreshold(e.target.value)}
            />
          </div>
          <p className="text-zinc-600 text-xs">Require deposit on jobs over this amount.</p>
        </div>
      </div>

      <div className="border-t border-zinc-800" />

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-zinc-400">Common line items</p>

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
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm pointer-events-none select-none">
                $
              </span>
              <input
                type="number"
                className={`${inputClass} pl-7`}
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
          <p className="text-zinc-600 text-sm">
            No items yet. Add your common line items and the AI will use them when estimating.
          </p>
        )}

        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3"
          >
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{item.name}</p>
              <p className="text-zinc-500 text-xs mt-0.5">${item.unit_price.toFixed(2)}</p>
            </div>
            <button
              type="button"
              onClick={() => handleDeleteItem(item.id)}
              className="text-zinc-600 hover:text-red-400 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
              aria-label="Remove item"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
                <path
                  d="M3 4h10M6 4V3h4v1M5 4l.5 9h5L11 4"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        ))}

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

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="mt-auto flex flex-col gap-3">
        <button
          type="button"
          onClick={handleRatesDone}
          disabled={saving}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
        >
          {saving ? "Setting up..." : "Start Using TradePulse"}
        </button>
        <button
          type="button"
          onClick={() => {
            router.push("/new");
            router.refresh();
          }}
          className="w-full text-zinc-500 hover:text-zinc-300 text-sm py-3 transition-colors"
        >
          Skip for now
        </button>
        <button
          type="button"
          onClick={() => setStep("profile")}
          className="w-full text-zinc-600 hover:text-zinc-400 text-sm py-2 transition-colors"
        >
          ← Back
        </button>
      </div>
    </div>
  );
}