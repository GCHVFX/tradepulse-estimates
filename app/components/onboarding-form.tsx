"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { formatPhoneInput } from "@/lib/format-phone";

interface OnboardingProfile {
  name: string;
  phone: string;
  email: string;
  logo_url: string;
  prepared_by: string;
  google_review_link: string;
}

export function OnboardingForm({
  profile,
  nextPath,
  businessId,
}: {
  profile: OnboardingProfile;
  nextPath?: string | null;
  businessId: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(formatPhoneInput(profile.phone));
  const [email, setEmail] = useState(profile.email);
  const [preparedBy, setPreparedBy] = useState(profile.prepared_by);
  const [googleReviewLink, setGoogleReviewLink] = useState(profile.google_review_link);
  const [logoUrl, setLogoUrl] = useState(profile.logo_url);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const destination = nextPath && nextPath.startsWith("/") ? nextPath : "/estimates";

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
        throw new Error("Please select an image file.");
      }

      const uploadRes = await fetch("/api/upload-logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: base64, type: mimeType }),
      });

      const uploadData = (await uploadRes.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!uploadRes.ok || !uploadData.url) {
        throw new Error(uploadData.error ?? "Upload failed. Try again.");
      }

      setLogoUrl(uploadData.url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed. Try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSave() {
    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone,
          email,
          logo_url: logoUrl,
          prepared_by: preparedBy,
          google_review_link: googleReviewLink,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to save business setup.");
      }

      router.push(destination);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setSaving(false);
    }
  }

  function skipForNow() {
    router.push(destination);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-4">
        <p className="text-sm font-semibold text-white">Your TradePulse business ID</p>
        <p className="mt-2 break-all rounded-lg bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300">
          {businessId}
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Use this later as TP_BUSINESS_ID when connecting a standalone contractor website.
        </p>
      </div>

      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5 shrink-0">
          <label className="text-sm font-medium text-zinc-400">Logo</label>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-24 h-16 rounded-xl bg-zinc-900 border border-zinc-700 hover:border-amber-500 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center overflow-hidden"
            aria-label={logoUrl ? "Change logo" : "Upload logo"}
          >
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt="Company logo"
                width={96}
                height={64}
                className="h-full w-full object-contain"
                unoptimized
              />
            ) : uploading ? (
              <svg className="animate-spin w-5 h-5 text-amber-500" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-zinc-600" aria-hidden="true">
                <path d="M3 17h18M12 3v10m0-10l-3.5 3.5M12 3l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="3" y="13" width="18" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleLogoUpload}
          />
        </div>

        <div className="flex flex-col gap-1.5 flex-1">
          <label className="text-sm font-medium text-zinc-400">Business name</label>
          <input
            type="text"
            className={inputClass}
            placeholder="Smith Plumbing Co."
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            autoComplete="organization"
          />
        </div>
      </div>

      {uploadError && <p className="text-red-400 text-sm">{uploadError}</p>}

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-400">Your name <span className="text-zinc-600">optional</span></label>
        <input
          type="text"
          className={inputClass}
          placeholder="John Smith"
          value={preparedBy}
          onChange={(e) => setPreparedBy(e.target.value)}
          autoComplete="name"
        />
        <p className="text-zinc-500 text-xs">Appears as “Prepared by” on estimates.</p>
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
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-400">Google review link <span className="text-zinc-600">optional</span></label>
        <input
          type="url"
          className={inputClass}
          placeholder="https://search.google.com/local/writereview?..."
          value={googleReviewLink}
          onChange={(e) => setGoogleReviewLink(e.target.value)}
          autoComplete="url"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <p className="text-zinc-500 text-xs">Saved now so review requests are ready if this business moves to Pro later.</p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
        >
          {saving ? "Saving..." : "Save & Continue"}
        </button>
        <button
          type="button"
          onClick={skipForNow}
          disabled={saving}
          className="w-full text-zinc-400 hover:text-zinc-300 text-sm py-3 transition-colors min-h-[44px] disabled:opacity-40"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
