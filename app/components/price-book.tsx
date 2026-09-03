"use client";

import { useState, useEffect, useRef } from "react";
import { parseCSV } from "@/lib/csv-parse";
import { matchColumns, normalizeHeader, type MatchableField } from "@/lib/csv-column-match";

const MAPPING_FIELD_LABELS: Record<MatchableField, string> = {
  name: "Item Name *",
  rate: "Rate / Price *",
  category: "Category",
  unit: "Unit",
};
const MAPPING_FIELDS: MatchableField[] = ["name", "rate", "category", "unit"];

interface PriceBookItem {
  id: string;
  name: string;
  unit_price: number;
  material_price: number;
}

interface Rates {
  labour_rate: number;
  markup_percent: number;
  deposit_percent: number;
  deposit_threshold: number;
  tax_label: string;
  tax_rate: number;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function PriceBook() {
  const [rates, setRates] = useState<Rates>({ labour_rate: 0, markup_percent: 0, deposit_percent: 0, deposit_threshold: 0, tax_label: 'GST', tax_rate: 5 });
  const [items, setItems] = useState<PriceBookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [rateStatus, setRateStatus] = useState<SaveStatus>("idle");

  // Auto-save for rates
  const rateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevRatesRef = useRef<Rates | null>(null);

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

  // Import
  interface ImportRow {
    name: string;
    description: string;
    category: string;
    price: number;
    materialPrice: number;
    taxable: boolean;
    active: boolean;
    error: string;
    /** Rate/Price column was confidently matched, but this row's own cell
     * was genuinely empty in the source file -- a gap in the customer's
     * data, not a column-matching failure. Still imports at $0, but must
     * stay visibly distinct from a correctly-priced item, never silently
     * indistinguishable from one. */
    priceBlank: boolean;
  }
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; updated: number; errors: string[] } | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // CSV column mapping fallback: shown instead of a preview whenever Name
  // or Rate/Price can't be confidently matched (exactly or via the
  // synonym map in lib/csv-column-match.ts) -- required, not optional,
  // since importing without a real price column is exactly the silent
  // $0.00 corruption bug this exists to prevent.
  const [csvHeaders, setCsvHeaders] = useState<string[] | null>(null);
  const [csvRawRows, setCsvRawRows] = useState<Record<string, string>[] | null>(null);
  const [showMapping, setShowMapping] = useState(false);
  // "" = not yet chosen. Category/Unit may stay "" (optional); Name/Rate
  // must be set before the mapping screen's confirm button is enabled.
  const [mapping, setMapping] = useState<Record<MatchableField, string>>({ name: "", rate: "", category: "", unit: "" });

  useEffect(() => {
    fetch("/api/price-book")
      .then((r) => r.json())
      .then((d: { rates: Rates; items: PriceBookItem[] }) => {
        setRates(d.rates);
        setItems(d.items);
        prevRatesRef.current = d.rates;
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Auto-save rates 1 s after last change
  useEffect(() => {
    if (prevRatesRef.current === null) return; // still loading
    if (JSON.stringify(rates) === JSON.stringify(prevRatesRef.current)) return;
    prevRatesRef.current = rates;

    if (rateTimerRef.current) clearTimeout(rateTimerRef.current);
    rateTimerRef.current = setTimeout(async () => {
      rateTimerRef.current = null;
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
    }, 1000);
    return () => {
      if (rateTimerRef.current) clearTimeout(rateTimerRef.current);
    };
  }, [rates]);

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

  function downloadTemplate() {
    const csv = [
      "name,description,category,price,taxable,active,keywords",
      '"Toilet replacement labour","Remove existing toilet and install replacement",Toilets,450,true,true,"toilet replace install removal"',
      '"Toilet materials allowance","Wax ring bolts supply line basic materials",Toilets,65,true,true,"wax ring toilet bolts supply line materials"',
      '"Old toilet disposal","Haul away and dispose of old toilet",Toilets,85,true,true,"toilet disposal haul away"',
      '"Faucet cartridge replacement","Replace faucet cartridge and test for leaks",Faucets,225,true,true,"faucet cartridge repair replace leak dripping"',
      '"Drain clearing","Clear blocked drain where accessible",Drains,250,true,true,"clog blocked slow drain clearing"',
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pricebook-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function resolveCol(headers: string[], aliases: string[]): string | null {
    const normalizedAliases = aliases.map(normalizeHeader);
    for (const header of headers) {
      const norm = normalizeHeader(header);
      if (normalizedAliases.includes(norm)) return header;
    }
    return null;
  }

  function csvVal(row: Record<string, string>, col: string | null): string {
    return col ? (row[col] ?? "").trim() : "";
  }

  function parseMoney(val: string): number {
    if (!val) return 0;
    const cleaned = val
      .replace(/[$,]/g, "")
      .replace(/\s*(CAD|USD|CDN)\s*/gi, "")
      .trim();
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }

  function csvBool(row: Record<string, string>, col: string | null, fallback: boolean): boolean {
    const v = csvVal(row, col).toLowerCase();
    if (!v) return fallback;
    if (v === "false" || v === "0" || v === "no" || v === "inactive" || v === "disabled") return false;
    return true;
  }

  /**
   * Builds the import preview from already-resolved columns -- shared by
   * both the direct auto-matched path and the manual-mapping confirm path,
   * so a customer who mapped columns by hand gets exactly the same row
   * handling (including the blank-price flag below) as an automatic match.
   *
   * `cols.name` and `cols.rate` are the caller's contract: both must be a
   * real header string, never null/empty, by the time this runs. Category
   * and Unit may be null (optional, fall back to blank/"General").
   */
  function buildImportRows(
    allHeaders: string[],
    rows: Record<string, string>[],
    cols: { name: string; rate: string; category: string | null; unit: string | null },
    claimedHeaders: Set<string>
  ): { rows: ImportRow[]; legacyColumns: string[] } {
    const remaining = allHeaders.filter((h) => !claimedHeaders.has(h));
    const descCol = resolveCol(remaining, ["description", "details", "notes", "scope"]);
    const labourCol = resolveCol(remaining, ["labour_price", "labor_price", "labour", "labor", "labour_rate", "labor_rate"]);
    const materialCol = resolveCol(remaining, ["material_price", "materials", "parts", "parts_price", "material_cost"]);
    const taxCol = resolveCol(remaining, ["taxable", "tax", "gst", "charge_tax"]);
    const activeCol = resolveCol(remaining, ["active", "enabled", "status"]);
    const keywordsCol = resolveCol(remaining, ["keywords", "aliases", "tags"]);
    const legacyColumns = [descCol, labourCol, materialCol, taxCol, activeCol, keywordsCol].filter(
      (h): h is string => !!h
    );

    const importRows = rows.map((row) => {
      const name = csvVal(row, cols.name);
      const labourStr = csvVal(row, labourCol);
      const priceStr = csvVal(row, cols.rate);
      const labourPrice = parseMoney(labourStr) || parseMoney(priceStr);
      const materialStr = csvVal(row, materialCol);
      const materialPrice = parseMoney(materialStr);
      const desc = csvVal(row, descCol);
      const keywords = csvVal(row, keywordsCol);
      // No dedicated `unit` column on tpe_pricebook_items -- folded into
      // the description, labelled, rather than silently discarded. Same
      // pattern this file already uses for `keywords` below.
      const unitVal = csvVal(row, cols.unit);
      const unitLabel = unitVal ? `Unit: ${unitVal}` : "";
      const fullDesc = [desc, unitLabel, keywords].filter(Boolean).join(" | ");
      return {
        name,
        description: fullDesc,
        category: csvVal(row, cols.category) || "General",
        price: labourPrice,
        materialPrice,
        taxable: csvBool(row, taxCol, true),
        active: csvBool(row, activeCol, true),
        error: !name ? "Name is required" : "",
        // The Rate column IS matched (guaranteed by this function's own
        // contract) -- a blank cell here is a real gap in this row's own
        // data, not a column-match failure, so it's flagged, not an error.
        priceBlank: !labourStr && !priceStr,
      };
    });

    return { rows: importRows, legacyColumns };
  }

  function handleCSVFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const { headers, rows } = parseCSV(reader.result as string);
      const match = matchColumns(headers);

      setImportResult(null);
      setImportRows(null);
      setShowMapping(false);

      if (!match.isComplete) {
        // Name and/or Rate couldn't be confidently matched -- do not
        // import anything, including partially. Show the customer their
        // actual headers and let them map the required fields by hand.
        // Applies even to a completely unrecognized file: this screen is
        // the fallback for "accept whatever the customer has," not a
        // dead end.
        setCsvHeaders(headers);
        setCsvRawRows(rows);
        setMapping({
          name: match.columns.name ?? "",
          rate: match.columns.rate ?? "",
          category: match.columns.category ?? "",
          unit: match.columns.unit ?? "",
        });
        setShowMapping(true);
        return;
      }

      const claimed = new Set(
        [match.columns.name, match.columns.rate, match.columns.category, match.columns.unit].filter(
          (h): h is string => !!h
        )
      );
      const { rows: parsed, legacyColumns } = buildImportRows(
        headers,
        rows,
        {
          name: match.columns.name!,
          rate: match.columns.rate!,
          category: match.columns.category ?? null,
          unit: match.columns.unit ?? null,
        },
        claimed
      );

      setImportRows(parsed);
      const recognized = new Set([...claimed, ...legacyColumns]);
      const unrecognized = headers.filter((h) => !recognized.has(h) && !match.ambiguousHeaders.includes(h) && h.trim());
      if (unrecognized.length > 0 || match.ambiguousHeaders.length > 0) {
        const notes: string[] = [];
        if (unrecognized.length > 0) notes.push(`Unrecognized columns skipped: ${unrecognized.join(", ")}`);
        if (match.ambiguousHeaders.length > 0) notes.push(`Ambiguous columns skipped: ${match.ambiguousHeaders.join(", ")}`);
        setImportResult({ imported: 0, updated: 0, errors: notes });
      }
    };
    reader.readAsText(file);
    if (csvInputRef.current) csvInputRef.current.value = "";
  }

  function handleConfirmMapping() {
    if (!csvHeaders || !csvRawRows || !mapping.name || !mapping.rate) return;
    const claimed = new Set([mapping.name, mapping.rate, mapping.category, mapping.unit].filter(Boolean));
    const { rows: parsed } = buildImportRows(
      csvHeaders,
      csvRawRows,
      { name: mapping.name, rate: mapping.rate, category: mapping.category || null, unit: mapping.unit || null },
      claimed
    );
    setImportRows(parsed);
    setImportResult(null);
    setShowMapping(false);
  }

  function handleCancelMapping() {
    setShowMapping(false);
    setCsvHeaders(null);
    setCsvRawRows(null);
    setMapping({ name: "", rate: "", category: "", unit: "" });
  }

  async function handleConfirmImport() {
    if (!importRows) return;
    const valid = importRows.filter((r) => !r.error);
    if (valid.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch("/api/price-book-items/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: valid.map((r) => ({
            name: r.name,
            description: r.description || undefined,
            category: r.category,
            price: r.price,
            material_price: r.materialPrice,
            taxable: r.taxable,
            active: r.active,
          })),
        }),
      });
      const data = await res.json() as { imported: number; updated: number; errors: string[] };
      setImportResult(data);
      const listRes = await fetch("/api/price-book");
      const listData = await listRes.json() as { items: PriceBookItem[] };
      setItems(listData.items);
      setImportRows(null);
    } catch {
      setImportResult({ imported: 0, updated: 0, errors: ["Import failed. Try again."] });
    } finally {
      setImporting(false);
    }
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
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm pointer-events-none select-none">$</span>
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
            <p className="text-zinc-400 text-xs">Applied on top of material costs in estimates.</p>
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
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm pointer-events-none select-none">$</span>
              <input
                type="number"
                className={inputClass + " pl-7"}
                placeholder="500"
                value={rates.deposit_threshold || ""}
                onChange={(e) => setRates((r) => ({ ...r, deposit_threshold: parseFloat(e.target.value) || 0 }))}
              />
            </div>
            <p className="text-zinc-400 text-xs">Require deposit on jobs over this amount.</p>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-sm font-medium text-zinc-400">Tax label</label>
            <input
              type="text"
              className={inputClass}
              placeholder="GST"
              value={rates.tax_label}
              onChange={(e) => setRates((r) => ({ ...r, tax_label: e.target.value }))}
              onBlur={() => setRates((r) => ({ ...r, tax_label: r.tax_label.replace(/[a-zA-Z]+/g, w => w.toUpperCase()).trim() || 'GST' }))}
            />
            <p className="text-zinc-400 text-xs">e.g. GST, HST, GST + PST</p>
          </div>
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-sm font-medium text-zinc-400">Tax rate (%)</label>
            <input
              type="number"
              className={inputClass}
              placeholder="5"
              value={rates.tax_rate || ""}
              onChange={(e) => setRates((r) => ({ ...r, tax_rate: parseFloat(e.target.value) || 0 }))}
            />
            <p className="text-zinc-400 text-xs">Applied to estimate line items.</p>
          </div>
        </div>

        {rateStatus !== "idle" && (
          <p className={`text-xs text-right ${rateStatus === "error" ? "text-red-400" : rateStatus === "saved" ? "text-green-400" : "text-zinc-400"}`}>
            {rateStatus === "saving" ? "Saving..." : rateStatus === "saved" ? "✓ Saved" : "Could not save"}
          </p>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-zinc-800" />

      {/* Common line items + CSV import, merged into one section: this is
          the data every future AI-generated estimate draws from, so it
          gets more visual weight than a field label above -- via
          typography and spacing only (no colour block/badge/tint), reusing
          the h2 sub-heading treatment already established in
          profile-form.tsx's "Reviews & payment reminders" section rather
          than inventing a new one. Manual add and CSV import are equal
          peers underneath it (same button treatment, side by side);
          Download Template is demoted to a small secondary link below
          them, since it serves a different, less common case (starting
          from scratch) than the two primary paths (already has a list). */}
      <section className="flex flex-col gap-4 pt-2">
        <div>
          <h2 className="text-base font-semibold text-white">Common line items</h2>
          <p className="text-xs text-zinc-400 mt-1">
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
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm pointer-events-none select-none">$</span>
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
          <p className="text-zinc-400 text-sm">No items yet. Add your common line items and the AI will use them when estimating.</p>
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
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm pointer-events-none select-none">$</span>
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
                <p className="text-zinc-400 text-xs mt-0.5">
                  {item.material_price > 0 ? (
                    <>
                      <span className="text-zinc-500">Labour</span> ${item.unit_price.toFixed(2)}
                      {" · "}
                      <span className="text-zinc-500">Materials</span> ${item.material_price.toFixed(2)}
                    </>
                  ) : (
                    `$${item.unit_price.toFixed(2)}`
                  )}
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

        <div className="flex gap-3">
          {!showAddForm && (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="flex-1 border border-dashed border-amber-500/40 bg-amber-500/5 text-amber-500 hover:border-amber-500 hover:bg-amber-500/10 font-medium text-sm rounded-xl py-3 transition-colors min-h-[44px] flex items-center justify-center gap-2"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Add item
            </button>
          )}
          <button
            type="button"
            onClick={() => csvInputRef.current?.click()}
            className="flex-1 border border-dashed border-amber-500/40 bg-amber-500/5 text-amber-500 hover:border-amber-500 hover:bg-amber-500/10 font-medium text-sm rounded-xl py-3 transition-colors min-h-[44px] flex items-center justify-center gap-2"
          >
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
              <path d="M3 10v3h10v-3M8 2v8m0-8L5 5m3-3l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Import CSV
          </button>
        </div>

        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleCSVFile}
        />

        <button
          type="button"
          onClick={downloadTemplate}
          className="self-start min-h-[44px] flex items-center text-xs text-zinc-400 hover:text-zinc-300 underline underline-offset-2 transition-colors"
        >
          Don&apos;t have a list yet? Download a blank template
        </button>

        {importResult && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${importResult.errors.length > 0 ? "border-amber-800 bg-amber-950 text-amber-300" : "border-green-800 bg-green-950 text-green-300"}`}>
            <p className="font-medium">
              {importResult.imported > 0 && `${importResult.imported} imported`}
              {importResult.imported > 0 && importResult.updated > 0 && ", "}
              {importResult.updated > 0 && `${importResult.updated} updated`}
              {importResult.imported === 0 && importResult.updated === 0 && "No items imported"}
            </p>
            {importResult.errors.length > 0 && (
              <ul className="mt-1.5 text-xs space-y-0.5">
                {importResult.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            )}
            <button
              type="button"
              onClick={() => setImportResult(null)}
              className="mt-2 text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}

        {showMapping && csvHeaders && (
          <div className="rounded-xl border border-amber-800/60 bg-amber-950/20 p-4 flex flex-col gap-3">
            <div>
              <p className="text-white text-sm font-medium">Match your columns</p>
              <p className="text-xs text-zinc-400 mt-1">
                We couldn&apos;t confidently match every required column in this file. Choose which column is which below. Nothing imports until you confirm. Name and Rate/Price are required; Category and Unit are optional.
              </p>
            </div>
            <p className="text-xs text-zinc-500">
              Your file&apos;s columns: {csvHeaders.join(", ")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {MAPPING_FIELDS.map((field) => (
                <div key={field} className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-zinc-400">{MAPPING_FIELD_LABELS[field]}</label>
                  <select
                    className={inputClass}
                    value={mapping[field]}
                    onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                  >
                    <option value="">{field === "name" || field === "rate" ? "-- Select column --" : "(none)"}</option>
                    {csvHeaders.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleConfirmMapping}
                disabled={!mapping.name || !mapping.rate}
                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-semibold text-sm rounded-lg py-2.5 transition-colors min-h-[40px]"
              >
                Continue
              </button>
              <button
                type="button"
                onClick={handleCancelMapping}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white text-sm rounded-lg py-2.5 transition-colors min-h-[40px]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {importRows && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-3">
            <p className="text-white text-sm font-medium">
              Preview: {importRows.length} {importRows.length === 1 ? "item" : "items"}
              {importRows.some((r) => r.error) && (
                <span className="text-red-400 font-normal ml-2">
                  ({importRows.filter((r) => r.error).length} with errors)
                </span>
              )}
              {importRows.some((r) => !r.error && r.priceBlank) && (
                <span className="text-amber-400 font-normal ml-2">
                  ({importRows.filter((r) => !r.error && r.priceBlank).length} with a blank price in the file)
                </span>
              )}
            </p>
            <div className="overflow-x-auto rounded-lg border border-zinc-700">
              <table className="w-full text-xs">
                <thead className="bg-zinc-800">
                  <tr>
                    <th className="px-2.5 py-2 text-left text-zinc-400 font-medium">Name</th>
                    <th className="px-2.5 py-2 text-left text-zinc-400 font-medium">Category</th>
                    <th className="px-2.5 py-2 text-right text-zinc-400 font-medium">Price</th>
                    <th className="px-2.5 py-2 text-left text-zinc-400 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {importRows.map((row, i) => (
                    <tr key={i} className={row.error ? "bg-red-950/30" : row.priceBlank ? "bg-amber-950/20" : ""}>
                      <td className="px-2.5 py-2 border-t border-zinc-700 text-white truncate max-w-[180px]">{row.name || <span className="text-red-400 italic">missing</span>}</td>
                      <td className="px-2.5 py-2 border-t border-zinc-700 text-zinc-400">{row.category}</td>
                      <td className="px-2.5 py-2 border-t border-zinc-700 text-zinc-300 text-right">
                        ${row.price.toFixed(2)}
                        {!row.error && row.priceBlank && (
                          <span className="block text-amber-400 font-normal" title="This row's price cell was empty in the source file">
                            blank in file
                          </span>
                        )}
                      </td>
                      <td className="px-2.5 py-2 border-t border-zinc-700 text-red-400">{row.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={importing || importRows.every((r) => !!r.error)}
                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-semibold text-sm rounded-lg py-2.5 transition-colors min-h-[40px]"
              >
                {importing ? "Importing..." : `Import ${importRows.filter((r) => !r.error).length} items`}
              </button>
              <button
                type="button"
                onClick={() => { setImportRows(null); setImportResult(null); setCsvHeaders(null); setCsvRawRows(null); }}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white text-sm rounded-lg py-2.5 transition-colors min-h-[40px]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
