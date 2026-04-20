"use client";

import { useState, useEffect } from "react";
import { formatPhoneInput } from "@/lib/format-phone";
import { generateEstimatePDF } from "@/lib/generate-pdf";

type Panel = "menu" | "sms" | "email";
type SMSStatus = "idle" | "sending" | "sent" | "error";
type EmailStatus = "idle" | "sending" | "sent" | "error";

interface SendEstimateSheetProps {
  isOpen: boolean;
  onClose: () => void;
  estimateId?: string;
  customerPhone?: string;
  customerEmail?: string;
  title?: string;
  summary?: string;
  businessName?: string;
  logoUrl?: string | null;
}

export function SendEstimateSheet({
  isOpen,
  onClose,
  estimateId,
  customerPhone,
  customerEmail,
  title,
  summary,
  businessName,
  logoUrl,
}: SendEstimateSheetProps) {
  const [panel, setPanel] = useState<Panel>("menu");
  const [phone, setPhone] = useState(formatPhoneInput(customerPhone ?? ""));
  const [email, setEmail] = useState(customerEmail ?? "");

  useEffect(() => {
    setEmail(customerEmail ?? "");
  }, [customerEmail]);

  useEffect(() => {
    setPhone(formatPhoneInput(customerPhone ?? ""));
  }, [customerPhone]);
  const [copied, setCopied] = useState(false);
  const [smsStatus, setSmsStatus] = useState<SMSStatus>("idle");
  const [smsError, setSmsError] = useState("");
  const [emailStatus, setEmailStatus] = useState<EmailStatus>("idle");
  const [emailError, setEmailError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setPanel("menu");
        setSmsStatus("idle");
        setSmsError("");
        setEmailStatus("idle");
        setEmailError("");
      }, 300);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  const shareUrl =
    estimateId && typeof window !== "undefined"
      ? window.location.origin + "/share/" + estimateId
      : "";

  async function handleCopyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // Clipboard API unavailable, fall back to legacy method
      const el = document.createElement("textarea");
      el.value = shareUrl;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.focus();
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSendSMS() {
    if (!phone.trim() || !estimateId) return;
    setSmsStatus("sending");
    setSmsError("");

    try {
      const res = await fetch("/api/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone.trim(), estimateId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? `Server error ${res.status}`
        );
      }

      setSmsStatus("sent");
    } catch (err) {
      setSmsError(
        err instanceof Error ? err.message : "Something went wrong. Try again."
      );
      setSmsStatus("error");
    }
  }

  async function handleSendEmail() {
    if (!email.trim() || !estimateId) return;
    setEmailStatus("sending");
    setEmailError("");

    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: email.trim(), estimateId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? `Server error ${res.status}`
        );
      }

      setEmailStatus("sent");
    } catch (err) {
      setEmailError(
        err instanceof Error ? err.message : "Something went wrong. Try again."
      );
      setEmailStatus("error");
    }
  }

  const panelTitle =
    panel === "sms"
      ? "Send via SMS"
      : panel === "email"
      ? "Send via Email"
      : "Send Estimate";

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
          {panel !== "menu" ? (
            <button
              type="button"
              onClick={() => {
                setPanel("menu");
                setSmsStatus("idle");
                setSmsError("");
                setEmailStatus("idle");
                setEmailError("");
              }}
              className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors min-h-[44px] text-sm"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
                <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </button>
          ) : (
            <span className="text-white font-semibold text-base">{panelTitle}</span>
          )}

          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Menu panel */}
        {panel === "menu" && (
          <div className="px-5 pb-10 pt-2 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setPanel("sms")}
              className="flex items-center gap-4 w-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 rounded-xl px-4 py-4 min-h-[64px] transition-colors text-left"
            >
              <span className="w-10 h-10 rounded-lg bg-zinc-700 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-zinc-300" aria-hidden="true">
                  <path d="M3 4h14a1 1 0 011 1v8a1 1 0 01-1 1H5l-3 2V5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium text-sm">Send via SMS</p>
                <p className="text-zinc-500 text-xs mt-0.5">Text a link to the estimate</p>
              </div>
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-zinc-600 shrink-0" aria-hidden="true">
                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => setPanel("email")}
              className="flex items-center gap-4 w-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 rounded-xl px-4 py-4 min-h-[64px] transition-colors text-left"
            >
              <span className="w-10 h-10 rounded-lg bg-zinc-700 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-zinc-300" aria-hidden="true">
                  <rect x="2" y="5" width="16" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M2 7l8 5 8-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium text-sm">Send via Email</p>
                <p className="text-zinc-500 text-xs mt-0.5">Email a link to the estimate</p>
              </div>
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-zinc-600 shrink-0" aria-hidden="true">
                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <button
              type="button"
              onClick={handleCopyLink}
              className="flex items-center gap-4 w-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 rounded-xl px-4 py-4 min-h-[64px] transition-colors text-left"
            >
              <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors ${copied ? "bg-green-900" : "bg-zinc-700"}`}>
                {copied ? (
                  <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-green-400" aria-hidden="true">
                    <path d="M4 10l4 4 8-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-zinc-300" aria-hidden="true">
                    <path d="M8 4H5a1 1 0 00-1 1v11a1 1 0 001 1h10a1 1 0 001-1v-3M8 4h7a1 1 0 011 1v3M8 4v4h8V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M11 11h4m-2-2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                )}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`font-medium text-sm ${copied ? "text-green-400" : "text-white"}`}>
                  {copied ? "Copied!" : "Copy Link"}
                </p>
                <p className="text-zinc-500 text-xs mt-0.5">Share a link to this estimate</p>
              </div>
            </button>

          </div>
        )}

        {/* SMS panel */}
        {panel === "sms" && (
          <div className="px-5 pb-10 pt-3 flex flex-col gap-4">
            {smsStatus !== "sent" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-zinc-400">Phone number</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3.5 text-white placeholder-zinc-600 text-base focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]"
                    placeholder="000-000-0000"
                    value={phone}
                    onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                    autoComplete="tel"
                  />
                </div>

                {smsStatus === "error" && smsError && (
                  <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-red-300 text-sm">
                    {smsError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={phone.replace(/\D/g, "").length < 10 || smsStatus === "sending"}
                  onClick={handleSendSMS}
                  className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center gap-2"
                >
                  {smsStatus === "sending" ? (
                    <>
                      <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Sending...
                    </>
                  ) : (
                    "Send via SMS"
                  )}
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="w-14 h-14 rounded-full bg-green-900 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-green-400" aria-hidden="true">
                    <path d="M5 12l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-white font-semibold text-base">Estimate sent</p>
                  <p className="text-zinc-500 text-sm mt-1">Link sent to {phone}</p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-2 w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        )}

        {/* Email panel */}
        {panel === "email" && (
          <div className="px-5 pb-10 pt-3 flex flex-col gap-4">
            {emailStatus !== "sent" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-zinc-400">Email address</label>
                  <input
                    type="email"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3.5 text-white placeholder-zinc-600 text-base focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]"
                    placeholder="customer@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>

                {emailStatus === "error" && emailError && (
                  <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-red-300 text-sm">
                    {emailError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={!email.trim() || emailStatus === "sending"}
                  onClick={handleSendEmail}
                  className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center gap-2"
                >
                  {emailStatus === "sending" ? (
                    <>
                      <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Sending...
                    </>
                  ) : (
                    "Send via Email"
                  )}
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="w-14 h-14 rounded-full bg-green-900 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-green-400" aria-hidden="true">
                    <path d="M5 12l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-white font-semibold text-base">Estimate sent</p>
                  <p className="text-zinc-500 text-sm mt-1">Email sent to {email}</p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-2 w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
