"use client";

import { useState } from "react";
import { formatPhoneInput } from "@/lib/format-phone";

interface CustomerDetailsBlockProps {
  estimateId: string | null;
  initialName: string;
  initialPhone: string;
  initialEmail: string;
  initialAddress: string;
  preparedBy: string;
  dateStr: string;
  companyName?: string;
  businessEmail?: string;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function CustomerDetailsBlock({
  estimateId,
  initialName,
  initialPhone,
  initialEmail,
  initialAddress,
  preparedBy,
  dateStr,
  companyName,
  businessEmail,
}: CustomerDetailsBlockProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(formatPhoneInput(initialPhone));
  const [email, setEmail] = useState(initialEmail);
  const [address, setAddress] = useState(initialAddress);
  const [status, setStatus] = useState<SaveStatus>("idle");

  const formattedDate = new Intl.DateTimeFormat("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateStr));

  async function handleSave() {
    if (!estimateId) return;
    setStatus("saving");

    try {
      const res = await fetch("/api/estimates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: estimateId,
          customer_name: name,
          customer_phone: phone,
          customer_email: email,
          customer_address: address,
        }),
      });

      if (!res.ok) throw new Error("Failed to save");

      setStatus("saved");
      setEditing(false);
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    }
  }

  function handleCancel() {
    setName(initialName);
    setPhone(formatPhoneInput(initialPhone));
    setEmail(initialEmail);
    setAddress(initialAddress);
    setEditing(false);
    setStatus("idle");
  }

  const inputClass =
    "w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  if (editing) {
    return (
      <div className="mb-4 p-3 rounded-xl bg-zinc-900 border border-zinc-800 flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <input
            type="text"
            className={inputClass}
            placeholder="Customer name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="tel"
            className={inputClass}
            placeholder="000-000-0000"
            value={phone}
            onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
          />
          <input
            type="email"
            className={inputClass}
            placeholder="customer@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="text"
            className={inputClass}
            placeholder="Job address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>

        {status === "error" && (
          <p className="text-red-400 text-xs">Failed to save. Try again.</p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={status === "saving"}
            className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-semibold text-sm rounded-lg py-2 transition-colors min-h-[36px]"
          >
            {status === "saving" ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white text-sm rounded-lg py-2 transition-colors min-h-[36px]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-start justify-between gap-2">
      <div className="text-zinc-500 text-xs leading-relaxed">
        {name && <span className="block">Prepared for: {name}</span>}
        {phone && <span className="block">Phone: {phone}</span>}
        {email && <span className="block">Email: {email}</span>}
        {address && <span className="block">Address: {address}</span>}
        {preparedBy && <span className="block">Prepared by: {preparedBy}</span>}
        {businessEmail && (
          <a href={`mailto:${businessEmail}`} className="block text-sm text-amber-500 hover:text-amber-400 transition-colors">{businessEmail}</a>
        )}
        <span className="block">Date: {formattedDate}</span>
        {status === "saved" && (
          <span className="text-green-500 block mt-0.5">Details saved.</span>
        )}
      </div>

      {estimateId && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-zinc-600 hover:text-zinc-400 transition-colors shrink-0 mt-0.5 min-h-[32px] min-w-[32px] flex items-center justify-center"
          aria-label="Edit customer details"
        >
          <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5" aria-hidden="true">
            <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
