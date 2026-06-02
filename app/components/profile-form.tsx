"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import QRCode from "qrcode";
import { formatPhoneInput } from "@/lib/format-phone";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

interface Profile {
  name: string;
  phone: string;
  email: string;
  logo_url: string;
  prepared_by: string;
  google_review_link: string;
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
  const [googleReviewLink, setGoogleReviewLink] = useState(profile.google_review_link);
  const [logoUrl, setLogoUrl] = useState(profile.logo_url);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [showReviewLinkHelp, setShowReviewLinkHelp] = useState(false);
  const [showFindLinkSheet, setShowFindLinkSheet] = useState(false);
  const [findBusinessName, setFindBusinessName] = useState("");
  const [findCity, setFindCity] = useState("");
  const [findLoading, setFindLoading] = useState(false);
  const [findError, setFindError] = useState("");
  const [findResults, setFindResults] = useState<Array<{
    placeName: string;
    formattedAddress: string;
    placeId: string;
    reviewLink: string;
  }> | null>(null);
  const [findStreetOrPhone, setFindStreetOrPhone] = useState("");
  const [findWeakMatch, setFindWeakMatch] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  const referralUrl = `https://trytradepulse.com/signup?ref=${userId}`;

  const inputClass =
    "w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3.5 text-white placeholder-zinc-600 text-base focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]";

  useEffect(() => {
    if (!modalOpen || !qrCanvasRef.current) return;
    QRCode.toCanvas(qrCanvasRef.current, referralUrl, {
      width: 200,
      color: { dark: "#f59e0b", light: "#09090b" },
    }).catch(console.error);
  }, [modalOpen]);

  async function handleCopy() {
    await navigator.clipboard.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "TradePulse", url: referralUrl });
      } catch {
        // user cancelled or not supported — fall through to copy
        await handleCopy();
      }
    } else {
      await handleCopy();
    }
  }

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
        body: JSON.stringify({ name, phone, email, logo_url: url, prepared_by: preparedBy, google_review_link: googleReviewLink }),
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
        body: JSON.stringify({ name, phone, email, logo_url: "", prepared_by: preparedBy, google_review_link: googleReviewLink }),
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
        body: JSON.stringify({ name, phone, email, logo_url: logoUrl, prepared_by: preparedBy, google_review_link: googleReviewLink }),
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

  async function handleFindBusiness() {
    setFindLoading(true);
    setFindError("");
    setFindResults(null);
    setFindWeakMatch(false);
    try {
      const res = await fetch("/api/profile/find-review-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName: findBusinessName, city: findCity, streetOrPhone: findStreetOrPhone }),
      });
      const data = await res.json() as {
        error?: string;
        matches?: Array<{
          placeName: string;
          formattedAddress: string;
          placeId: string;
          reviewLink: string;
        }>;
        hasStrongMatch?: boolean;
      };
      if (!res.ok) {
        setFindError(data.error ?? `Error ${res.status}`);
        return;
      }
      setFindResults(data.matches ?? []);
      setFindWeakMatch(!(data.hasStrongMatch ?? true));
    } catch {
      setFindError("Something went wrong. Try again.");
    } finally {
      setFindLoading(false);
    }
  }

  return (
    <>
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

        {/* Google Review Link */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-400">Google Review Link</label>
          <input
            type="url"
            className={inputClass}
            placeholder="https://g.page/r/..."
            value={googleReviewLink}
            onChange={(e) => setGoogleReviewLink(e.target.value)}
            autoComplete="url"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          {googleReviewLink && googleReviewLink.includes("google.com/search") && (
            <p className="text-amber-400 text-xs">This looks like a Google search URL, not a direct review link.</p>
          )}
          {googleReviewLink &&
            !googleReviewLink.includes("google.com/search") &&
            (googleReviewLink.includes("google.com/maps") ||
              googleReviewLink.includes("maps.app.goo.gl") ||
              googleReviewLink.includes("g.co/kgs")) && (
            <p className="text-amber-400 text-xs">This looks like a Google Business Profile link. Use Find My Review Link to create the review link.</p>
          )}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setFindBusinessName(name);
                setFindCity("");
                setFindError("");
                setFindResults(null);
                setFindStreetOrPhone("");
                setFindWeakMatch(false);
                setShowFindLinkSheet(true);
              }}
              className="text-xs text-amber-400 hover:text-amber-300 transition-colors min-h-[32px] font-medium"
            >
              Find My Review Link
            </button>
            <button
              type="button"
              onClick={() => setShowReviewLinkHelp(!showReviewLinkHelp)}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors min-h-[32px]"
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                className={`w-3.5 h-3.5 transition-transform ${showReviewLinkHelp ? "rotate-90" : ""}`}
                aria-hidden="true"
              >
                <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              How do I find it?
            </button>
          </div>
          {showReviewLinkHelp && (
            <div className="flex flex-col gap-2">
              <ol className="ml-1 flex flex-col gap-1 text-xs text-zinc-500 list-decimal list-inside">
                <li>Go to Google and search your business name.</li>
                <li>Make sure you are logged into the Google account that manages the business.</li>
                <li>In the Business Profile panel, look for &ldquo;Ask for reviews&rdquo; or &ldquo;Share review form&rdquo;.</li>
                <li>Copy the review link.</li>
                <li>Paste it here.</li>
              </ol>
              <p className="text-zinc-600 text-xs ml-1">If you don&apos;t see this option, open Google Business Profile Manager and select your business.</p>
            </div>
          )}
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

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="w-full flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3.5 transition-colors hover:border-zinc-700 hover:bg-zinc-800"
        >
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true">
              <circle cx="15" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="15" cy="16" r="2" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="5" cy="10" r="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M7 9l6-3.5M7 11l6 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <p className="text-sm font-medium text-white">Share TradePulse</p>
          </div>
          <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-zinc-600 shrink-0 ml-3" aria-hidden="true">
            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

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

      <>
        <div
          className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 ${showFindLinkSheet ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
          onClick={() => setShowFindLinkSheet(false)}
          aria-hidden="true"
        />
        <div
          className={`fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 rounded-t-2xl transition-transform duration-300 ease-out ${showFindLinkSheet ? "translate-y-0" : "translate-y-full"}`}
          role="dialog"
          aria-modal="true"
        >
          <div className="flex justify-center pt-3">
            <div className="w-10 h-1 rounded-full bg-zinc-700" />
          </div>
          <div className="flex items-center justify-between px-5 pt-3 pb-2 min-h-[52px]">
            <span className="text-white font-semibold text-base">Find My Review Link</span>
            <button
              type="button"
              onClick={() => setShowFindLinkSheet(false)}
              className="text-zinc-500 hover:text-white transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Close"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="px-5 pb-10 pt-2 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-400">Business name</label>
              <input
                type="text"
                className={inputClass}
                placeholder="Smith Plumbing Co."
                value={findBusinessName}
                onChange={(e) => setFindBusinessName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-400">City</label>
              <input
                type="text"
                className={inputClass}
                placeholder="Vancouver"
                value={findCity}
                onChange={(e) => setFindCity(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-400">Street address or phone number <span className="text-zinc-600 font-normal">(optional)</span></label>
              <input
                type="text"
                className={inputClass}
                placeholder="Optional, helps find the right business"
                value={findStreetOrPhone}
                onChange={(e) => setFindStreetOrPhone(e.target.value)}
              />
            </div>
            {findError && (
              <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-red-300 text-sm">
                {findError}
              </div>
            )}
            {findWeakMatch && findResults && findResults.length > 0 && (
              <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-400 text-sm">
                We couldn&apos;t find an exact name match. Choose the correct business below, or try adding your street address.
              </div>
            )}
            {findResults && findResults.length > 0 && (
              <div className="flex flex-col gap-3">
                {findResults.map((match) => (
                  <div key={match.placeId} className="bg-zinc-800 rounded-xl px-4 py-3.5 flex flex-col gap-2">
                    <p className="text-white text-sm font-medium">{match.placeName}</p>
                    <p className="text-zinc-500 text-xs">{match.formattedAddress}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setGoogleReviewLink(match.reviewLink);
                        setShowFindLinkSheet(false);
                      }}
                      className="mt-1 w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-sm rounded-xl py-3 transition-colors min-h-[44px]"
                    >
                      Use This Business
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              disabled={findLoading || !findBusinessName.trim() || !findCity.trim()}
              onClick={handleFindBusiness}
              className="w-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center gap-2"
            >
              {findLoading && (
                <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {findLoading ? "Searching..." : "Find Business"}
            </button>
          </div>
        </div>
      </>

      <>
          <div
            className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 ease-out ${modalOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            onClick={() => setModalOpen(false)}
            aria-hidden="true"
          />
          <div
            className={`fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 rounded-t-2xl p-6 transition-transform duration-300 ease-out ${modalOpen ? 'translate-y-0' : 'translate-y-full'}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-modal-heading"
          >
            <div className="flex items-center justify-between mb-1">
              <h2 id="share-modal-heading" className="text-lg font-bold text-white">Invite a contractor</h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-zinc-500 hover:text-white transition-colors p-1 -mr-1 min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Close"
              >
                <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <p className="text-zinc-400 text-sm mb-5">Share this link and they&apos;ll get a free 14-day trial.</p>

            <div className="flex gap-2 mb-6">
              <input
                type="text"
                readOnly
                value={referralUrl}
                className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-zinc-300 text-sm focus:outline-none select-all"
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white text-sm font-medium rounded-xl px-4 py-2.5 transition-colors min-h-[44px]"
              >
                {copied ? "Copied!" : "Copy link"}
              </button>
            </div>

            <div className="flex justify-center mb-6">
              <canvas ref={qrCanvasRef} className="rounded-xl" />
            </div>

            <button
              type="button"
              onClick={handleShare}
              className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px] flex items-center justify-center gap-2"
            >
              <svg viewBox="0 0 20 20" fill="none" className="w-5 h-5" aria-hidden="true">
                <circle cx="15" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="15" cy="16" r="2" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="5" cy="10" r="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7 9l6-3.5M7 11l6 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Share
            </button>
          </div>
      </>
    </>
  );
}
