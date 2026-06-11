"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Spinner } from "@/app/components/spinner";

interface InvoiceSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onInvoiced: () => void;
  estimateId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  existingAmount: string;
  businessHasPaymentLink: boolean;
}

function defaultDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayDate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function InvoiceSheet({
  isOpen,
  onClose,
  onInvoiced,
  estimateId,
  customerName,
  customerPhone,
  customerEmail,
  existingAmount,
  businessHasPaymentLink,
}: InvoiceSheetProps) {
  const [amount, setAmount] = useState(existingAmount);
  const [dueDate, setDueDate] = useState(defaultDueDate());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setAmount(existingAmount);
        setDueDate(defaultDueDate());
        setError("");
      }, 300);
      return () => clearTimeout(t);
    }
  }, [isOpen, existingAmount]);

  const parsedAmount = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0;

  async function handleConfirm() {
    if (!amountValid || !dueDate || saving) return;
    setSaving(true);
    setError("");

    try {
      const res = await fetch(`/api/estimates/${estimateId}/invoice`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_amount: parsedAmount, due_date: dueDate }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Server error ${res.status}`);
      }

      onInvoiced();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 ${
          isOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 rounded-t-2xl transition-transform duration-300 ease-out ${
          isOpen ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3">
          <div className="w-10 h-1 rounded-full bg-zinc-700" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3 pb-2 min-h-[52px]">
          <span className="text-white font-semibold text-base">Mark as Invoiced</span>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-white transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="px-5 pb-10 pt-2 flex flex-col gap-4">
          {customerName.trim() && (
            <p className="text-zinc-400 text-sm">
              Payment reminders go to {customerName.trim()} until you mark this invoice paid.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-400">Invoice amount</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 text-base">$</span>
              <input
                type="text"
                inputMode="decimal"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl pl-8 pr-4 py-3.5 text-white placeholder-zinc-600 text-base focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-400">Due date</label>
            <input
              type="date"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3.5 text-white text-base focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]"
              value={dueDate}
              min={todayDate()}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          {!customerPhone.trim() && !customerEmail.trim() && (
            <p className="text-amber-400 text-sm">
              No contact info on this estimate. Add a phone number or email to send payment
              reminders.
            </p>
          )}

          {!businessHasPaymentLink && (
            <div className="bg-amber-950/40 border border-amber-800/50 rounded-xl px-4 py-3 text-amber-300 text-sm">
              Add your payment link in{" "}
              <Link href="/profile" className="underline font-medium hover:text-amber-200 transition-colors">
                Settings
              </Link>{" "}
              so reminders include a pay-now link.
            </div>
          )}

          {error && (
            <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={!amountValid || !dueDate || saving}
            onClick={handleConfirm}
            className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Spinner className="w-5 h-5" />
                Saving...
              </>
            ) : (
              "Start Reminders"
            )}
          </button>
        </div>
      </div>
    </>
  );
}
