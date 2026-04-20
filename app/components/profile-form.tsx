"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { formatPhoneInput } from "@/lib/format-phone";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

interface Profile {
  name: string;
  phone: string;
  email: string;
  logo_url: string;
  prepared_by: string;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function ProfileForm({
  profile,
  userId,
  nextPath,
  subscriptionStatus,
  trialEndsAt,
}: {
  profile: Profile;
  userId: string;
  nextPath?: string | null;
  subscriptionStatus?: string;
  trialEndsAt?: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(formatPhoneInput(profile.phone));
  const [email, setEmail] = useState(profile.email);
  const [preparedBy, setPreparedBy] = useState(profile.prepared_by);
  const [logoUrl, setLogoUrl] = useState(profile.logo_url);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const inputClass =
    "w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3.5 text-white placeholder-zinc-600 text-base focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]";

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setUploadError("Image must be under 2MB.");
      return;
    }

    setUploading(true);
    setUploadError("");

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Could not read file."));
        reader.readAsDataURL(file);
      });

      const mimeType = base64.split(";")[0].replace("data:", "") || file.type;

      if (!mimeType.startsWith("image/")) {
        setUploadError("Please select an image file.");
        setUploading(false);
        return;
      }

      const uploadRes = await fetch("/api/upload-logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: base64, type: mimeType }),
      });

      if (!uploadRes.ok) {
        const data = await uploadRes.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Upload failed. Try again.");
      }

      const { url } = await uploadRes.json();

      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, email, logo_url: url, prepared_by: preparedBy }),
      });

      if (!res.ok) throw new Error("Failed to save logo.");

      setLogoUrl(url);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Upload failed. Try again."
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDeleteLogo() {
    setDeleting(true);
    setUploadError("");

    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.storage.from("logos").remove([`${userId}/logo`]);

      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, email, logo_url: "", prepared_by: preparedBy }),
      });

      if (!res.ok) throw new Error("Failed to remove logo.");

      setLogoUrl("");
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Could not remove logo. Try again."
      );
    } finally {
      setDeleting(false);
    }
  }

  async function handleSave() {
    setStatus("saving");
    setErrorMsg("");

    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, email, logo_url: logoUrl, prepared_by: preparedBy }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? `Server error ${res.status}`
        );
      }

      setStatus("saved");
      if (nextPath) {
        router.push(nextPath);
        router.refresh();
      } else {
        setTimeout(() => setStatus("idle"), 3000);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Something went wrong. Try again."
      );
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-4">

      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center gap-1.5 shrink-0">
          <label className="text-sm font-medium text-zinc-400 self-start">Company logo</label>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || deleting}
            className="w-32 h-20 rounded-xl bg-zinc-900 border border-zinc-700 hover:border-amber-500 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center overflow-hidden relative group"
            aria-label={logoUrl ? "Change logo" : "Upload logo"}
          >
            {logoUrl ? (
              <>
                <Image
                  src={logoUrl}
                  alt="Company logo"
                  width={128}
                  height={80}
                  className="w-full h-full object-contain"
                  unoptimized
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5 text-white" aria-hidden="true">
                    <path d="M3 17h14M10 3v10m0-10l-3 3m3-3l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </>
            ) : uploading ? (
              <svg className="animate-spin w-5 h-5 text-amber-500" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-zinc-600 group-hover:text-amber-500 transition-colors" aria-hidden="true">
                <path d="M3 17h18M12 3v10m0-10l-3.5 3.5M12 3l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="3" y="13" width="18" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            )}
          </button>
          {logoUrl && (
            <button
              type="button"
              onClick={handleDeleteLogo}
              disabled={deleting || uploading}
              className="text-xs text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-h-[24px]"
            >
              {deleting ? "Removing..." : "Remove"}
            </button>
          )}
          {!logoUrl && (
            <p className="text-zinc-500 text-xs text-center leading-tight">PNG or JPG<br />max 2MB</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5 flex-1">
          <label className="text-sm font-medium text-zinc-400">Company name</label>
          <input
            type="text"
            className={inputClass}
            placeholder="Smith Plumbing Co."
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="organization"
          />
          <p className="text-zinc-500 text-xs">If your logo includes your company name, you can leave this blank.</p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleLogoUpload}
      />

      {uploadError && (
        <p className="text-red-400 text-sm">{uploadError}</p>
      )}

      {/* Prepared by */}
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
        <p className="text-zinc-500 text-xs">Appears as "Prepared by" on estimates.</p>
      </div>

      {/* Phone */}
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

      {/* Email */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-400">Business email</label>
        <input
          type="email"
          className={inputClass}
          placeholder="hello@smithplumbing.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      {status === "error" && errorMsg && (
        <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-red-300 text-sm">
          {errorMsg}
        </div>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={status === "saving"}
        className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center gap-2"
      >
        {status === "saving" ? (
          <>
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Saving...
          </>
        ) : status === "saved" ? (
          <>
            <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
              <path d="M4 10l4.5 4.5L16 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Saved
          </>
        ) : (
          "Save Profile"
        )}
      </button>

      <a
        href="/rates"
        className="w-full flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3.5 transition-colors hover:border-zinc-700 hover:bg-zinc-800"
      >
        <div>
          <p className="text-sm font-medium text-white">Set your labour rate and markup</p>
          <p className="text-xs text-zinc-500 mt-0.5">Estimates use your actual numbers when rates are set.</p>
        </div>
        <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-zinc-600 shrink-0 ml-3" aria-hidden="true">
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>

      <p className="text-center text-zinc-500 text-sm">
        Need help?{" "}
        <a href="mailto:support@trytradepulse.com" className="hover:text-zinc-400 transition-colors">
          support@trytradepulse.com
        </a>
      </p>

      <button
        type="button"
        onClick={async () => {
          const supabase = createSupabaseBrowserClient();
          await supabase.auth.signOut();
          router.push("/login");
          router.refresh();
        }}
        className="w-full bg-transparent text-zinc-500 hover:text-zinc-300 text-sm py-3 transition-colors min-h-[44px]"
      >
        Sign out
      </button>

      {subscriptionStatus === "trial" && trialEndsAt && (() => {
        const daysLeft = Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
        const urgent = daysLeft <= 3;
        const message = daysLeft === 0
          ? "Your free trial ends today."
          : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in your free trial.`;
        return urgent ? (
          <p className="text-xs text-amber-500 text-center">
            {message}{" "}
            <a href="/subscribe" className="font-semibold underline hover:text-amber-400 transition-colors">
              Subscribe now
            </a>
          </p>
        ) : (
          <p className="text-xs text-zinc-500 text-center">{message}</p>
        );
      })()}

      <form action="/api/billing/portal" method="POST">
        <button
          type="submit"
          className="w-full text-zinc-600 hover:text-zinc-400 text-xs py-2 transition-colors"
        >
          Manage billing
        </button>
      </form>
    </div>
  );
}
