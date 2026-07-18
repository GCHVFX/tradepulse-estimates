"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EditableEstimateBody } from "@/app/components/editable-estimate-body";
import { CompanyEstimateHeader } from "@/app/components/company-estimate-header";
import { EstimateMarkdown } from "@/app/components/estimate-markdown";
import { formatPhoneInput } from "@/lib/format-phone";
import { Logo } from "@/app/components/logo";
import { BottomNav } from "@/app/components/bottom-nav";
import { SendEstimateSheet } from "@/app/components/send-estimate-sheet";
import { PhotoSourceSheet } from "@/app/components/photo-source-sheet";
import { CustomerDetailsBlock } from "@/app/components/customer-details-block";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { useBusinessProfile } from "@/lib/hooks/use-business-profile";
import { Spinner } from "@/app/components/spinner";
import { usePostHog } from "posthog-js/react";

const inputClass =
  "w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3.5 text-white placeholder-zinc-600 text-base focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]";

const PREFILLS: Record<string, string> = {
  "water-heater": "Replace 50-gallon water heater, Bradford White natural gas unit, new expansion tank, about 3 hours labour.",
  "panel-upgrade": "Upgrade 100A panel to 200A, pull permit, new Square D 200A panel, reconnect all circuits, about 6 hours labour.",
  "drain-cleaning": "Clear blocked main drain, camera inspection, hydro jet if needed.",
  "leak-repair": "Locate and repair pipe leak under kitchen sink, replace shutoff valves, check surrounding connections.",
};

const EXAMPLE_CHIPS = [
  { label: "Water Heater Replacement", text: "Replace 50-gallon gas water heater. New unit, expansion tank, about 3 hours labour." },
  { label: "Electrical Panel Upgrade", text: "Upgrade 100A panel to 200A. Pull permit, new Square D panel, reconnect all circuits, about 6 hours." },
] as const;

const PHOTO_PRO_GATE_MESSAGE = "Photo estimates are a Pro feature. Upgrade to Pro to use your camera.";

const jobPlaceholders = [
  "Replace hot water tank in basement",
  "Install 200 amp electrical panel",
  "Fix leaking pipe under kitchen sink",
  "Install exhaust fan in upstairs bathroom",
  "Repair roof leak over garage",
];

// Reject oversized files before the browser tries to decode them at native
// resolution -- that decode happens before any downscaling and can freeze or
// crash the tab on a very large source image
const MAX_PHOTO_FILE_BYTES = 20 * 1024 * 1024;

// Downscale to keep camera photos under the API image size limit
async function resizePhotoToJpeg(file: File): Promise<{ dataUrl: string; base64: string }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that photo. Try a JPEG or PNG."));
      el.src = objectUrl;
    });
    const maxEdge = 1568;
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process the photo on this device.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { dataUrl, base64: dataUrl.split(",")[1] };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

interface PhotoEntry {
  id: string;
  base64: string;
  preview: string;
  note: string;
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M3 8.5a2 2 0 012-2h1.4l1.2-1.8a1.5 1.5 0 011.25-.7h6.3a1.5 1.5 0 011.25.7l1.2 1.8H19a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2V8.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Longest a dictation can run before it auto-stops and transcribes
const MAX_RECORDING_SECONDS = 120;

function pickAudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not process the recording."));
    reader.readAsDataURL(blob);
  });
}

function formatRecordingTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

interface EstimateViewProps {
  generating: boolean;
  estimateStarted: boolean;
  estimate: string;
  error: string;
  saved: boolean;
  savedEstimateId: string | null;
  needsProfileSetup: boolean;
  logoUrl: string | null;
  businessName: string;
  businessEmail: string;
  preparedBy: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  jobAddress: string;
  jobTitle: string;
  showSendSheet: boolean;
  setShowSendSheet: (v: boolean) => void;
  onBack: () => void;
  onNewEstimate: () => void;
}

interface FormViewProps {
  jobDescription: string;
  setJobDescription: (v: string) => void;
  customerName: string;
  setCustomerName: (v: string) => void;
  customerPhone: string;
  setCustomerPhone: (v: string) => void;
  customerEmail: string;
  setCustomerEmail: (v: string) => void;
  jobAddress: string;
  setJobAddress: (v: string) => void;
  customerDetailsSaved: boolean;
  setCustomerDetailsSaved: (v: boolean) => void;
  saved: boolean;
  jobPlaceholders: string[];
  placeholderIndex: number;
  isFirstTime: boolean;
  needsProfileSetup: boolean;
  isPro: boolean;
  error: string;
  onGenerate: (photos: PhotoEntry[]) => void;
  onViewEstimate: () => void;
}

function EstimateView({
  generating,
  estimateStarted,
  estimate,
  error,
  saved,
  savedEstimateId,
  needsProfileSetup,
  logoUrl,
  businessName,
  businessEmail,
  preparedBy,
  customerName,
  customerPhone,
  customerEmail,
  jobAddress,
  jobTitle,
  showSendSheet,
  setShowSendSheet,
  onBack,
  onNewEstimate,
}: EstimateViewProps) {
  const estimateScrollRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!generating) return;

    const frame = requestAnimationFrame(() => {
      const el = estimateScrollRef.current;
      if (el && el.scrollHeight > el.clientHeight) {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      } else {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [estimate, generating]);

  // When generation finishes, jump back to the top so the contractor sees the
  // start of the estimate, not the middle of a wall of text.
  useEffect(() => {
    if (generating || !estimate || error) return;

    const frame = requestAnimationFrame(() => {
      const el = estimateScrollRef.current;
      if (el) {
        el.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [generating, estimate, error]);

  return (
    <div className="h-dvh bg-zinc-950 text-white flex flex-col">
      <header className="px-5 pt-10 pb-4 shrink-0" />

      <main ref={estimateScrollRef} className="flex-1 min-h-0 px-5 pb-52 overflow-y-auto">
        {error && (
          <div className="mt-4 bg-red-950 border border-red-800 rounded-xl px-4 py-3.5 text-red-300 text-sm">
            {error}
          </div>
        )}

        {estimate && saved && !generating && !error && needsProfileSetup && (
          <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-4">
            <p className="text-sm font-semibold text-amber-400">Make this look more professional</p>
            <p className="mt-1 text-sm text-zinc-300">
              Add your company details so your next estimate includes your name, logo, and contact info.
            </p>
            <Link
              href={savedEstimateId ? `/profile?next=/estimates/${savedEstimateId}` : "/profile"}
              className="mt-3 flex w-full items-center justify-center rounded-xl bg-amber-500 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400"
            >
              Add Company Details
            </Link>
          </div>
        )}

        {estimate && (
          <div className="mt-2 pb-2">
            <div className="bg-white rounded-2xl p-5 mt-2">
              <CompanyEstimateHeader logoUrl={logoUrl} businessName={businessName} />
              <span className="mt-3 inline-flex rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-500">
                Estimate
              </span>
              {jobTitle && (
                <h1 className="mt-1 text-3xl font-bold tracking-tight leading-tight text-zinc-900 break-words">
                  {jobTitle}
                </h1>
              )}
              <CustomerDetailsBlock
                estimateId={savedEstimateId}
                initialName={customerName}
                initialPhone={customerPhone}
                initialEmail={customerEmail}
                initialAddress={jobAddress}
                preparedBy={preparedBy}
                companyName={businessName || undefined}
                businessEmail={businessEmail || undefined}
                dateStr={new Date().toISOString()}
              />
              {savedEstimateId ? (
                <EditableEstimateBody
                  key={savedEstimateId ?? "default"}
                  summary={estimate}
                  estimateId={savedEstimateId}
                />
              ) : (
                <EstimateMarkdown
                  content={estimate
                    .split("\n")
                    .filter((l) => !l.startsWith("# "))
                    .join("\n")}
                />
              )}
              {saved && !generating && !error && (
                <p className="mt-4 text-xs text-zinc-400 flex items-center gap-1.5">
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    className="w-3.5 h-3.5 text-green-500 shrink-0"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 8l3.5 3.5L13 4.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Estimate saved
                </p>
              )}
            </div>
          </div>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0">
        <div className="px-5 pb-6 pt-4 bg-zinc-950 border-t border-zinc-800 flex flex-col gap-3">
          {generating && !estimateStarted && (
            <div className="flex items-center justify-center gap-2 text-zinc-400 text-sm">
              <Spinner className="w-4 h-4 text-amber-500" />
              <span>Writing estimate...</span>
            </div>
          )}
          {!generating && (
            <button
              type="button"
              onClick={onBack}
              className="w-full flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
                <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back to Description
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSendSheet(true)}
            disabled={generating || !saved}
            className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
          >
            Send Estimate
          </button>
        </div>
        <BottomNav onNewClick={onNewEstimate} />
      </div>

      <SendEstimateSheet
        isOpen={showSendSheet}
        onClose={() => setShowSendSheet(false)}
        estimateId={savedEstimateId ?? undefined}
        customerPhone={customerPhone}
        customerEmail={customerEmail}
        title={jobTitle || undefined}
        summary={estimate || undefined}
        businessName={businessName || undefined}
        logoUrl={logoUrl}
      />

    </div>
  );
}

function FormView({
  jobDescription,
  setJobDescription,
  customerName,
  setCustomerName,
  customerPhone,
  setCustomerPhone,
  customerEmail,
  setCustomerEmail,
  jobAddress,
  setJobAddress,
  customerDetailsSaved,
  setCustomerDetailsSaved,
  saved,
  jobPlaceholders: placeholders,
  placeholderIndex,
  isFirstTime,
  needsProfileSetup,
  isPro,
  error,
  onGenerate,
  onViewEstimate,
}: FormViewProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [photoAnalysing, setPhotoAnalysing] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [analysed, setAnalysed] = useState(false);
  const [showPhotoSourceSheet, setShowPhotoSourceSheet] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [dictationError, setDictationError] = useState("");

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
    };
  }, []);

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
    recordTimerRef.current = null;
    autoStopTimerRef.current = null;
    setRecording(false);
  }

  async function handleRecordingStopped(mimeType: string) {
    setTranscribing(true);
    try {
      const blob = new Blob(audioChunksRef.current, { type: mimeType });
      audioChunksRef.current = [];
      const audioBase64 = await blobToBase64(blob);
      const res = await fetch("/api/transcribe-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64, mimeType: mimeType.split(";")[0] }),
      });
      const data = (await res.json().catch(() => null)) as
        | { transcription?: string; error?: string }
        | null;
      if (!res.ok || !data?.transcription) {
        throw new Error(data?.error || "Could not transcribe that recording. Try again.");
      }
      const trimmed = jobDescription.trim();
      setJobDescription(trimmed ? `${trimmed} ${data.transcription}` : data.transcription);
    } catch (err) {
      setDictationError(
        err instanceof Error ? err.message : "Could not transcribe that recording. Try again."
      );
    } finally {
      setTranscribing(false);
    }
  }

  async function startRecording() {
    setDictationError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setDictationError("This browser doesn't support microphone recording. Try updating it or use a different browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        void handleRecordingStopped(recorder.mimeType || mimeType || "audio/webm");
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
      autoStopTimerRef.current = setTimeout(stopRecording, MAX_RECORDING_SECONDS * 1000);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setDictationError(
          "Microphone access is blocked for this site. Tap the icon next to the address bar, allow microphone access, then tap the mic again. No need to reload."
        );
      } else if (name === "NotFoundError") {
        setDictationError("No microphone found on this device.");
      } else if (name === "NotReadableError") {
        setDictationError("Your microphone is being used by another app. Close it and try again.");
      } else {
        setDictationError("Could not access the microphone. Try again.");
      }
    }
  }

  const posthog = usePostHog();
  useEffect(() => {
    if (isFirstTime) {
      const supabase = createSupabaseBrowserClient();
      supabase.auth.getUser().then(({ data }) => {
        if (data.user) {
          posthog.identify(data.user.id, { email: data.user.email });
        }
      });
    }
  }, [isFirstTime, posthog]);

  async function handlePhotoAdded(file: File) {
    if (photos.length >= 5) return;
    setPhotoError("");
    if (file.size > MAX_PHOTO_FILE_BYTES) {
      setPhotoError("That photo is too large. Try a smaller one.");
      return;
    }
    try {
      const { dataUrl, base64 } = await resizePhotoToJpeg(file);
      setAnalysed(false);
      setPhotos((prev) =>
        prev.length >= 5
          ? prev
          : [...prev, { id: crypto.randomUUID(), base64, preview: dataUrl, note: "" }]
      );
    } catch (err) {
      setPhotoError(
        err instanceof Error ? err.message : "Could not read that photo. Try again."
      );
    }
  }

  async function handleAnalysePhotos() {
    setPhotoAnalysing(true);
    setPhotoError("");
    try {
      const res = await fetch("/api/analyze-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photos: photos.map((p) => ({ base64: p.base64, mediaType: "image/jpeg", note: p.note })),
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { description?: string; error?: string }
        | null;
      if (!res.ok || !data?.description) {
        throw new Error(data?.error || "Could not analyse the photos. Try again.");
      }
      setJobDescription(data.description);
      setAnalysed(true);
    } catch (err) {
      setPhotoError(
        err instanceof Error ? err.message : "Could not analyse the photos. Try again."
      );
    } finally {
      setPhotoAnalysing(false);
    }
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
      <header className="px-5 pt-10 pb-6 shrink-0">
        <Logo />
        {isFirstTime && (
          <p className="text-zinc-400 text-sm mt-3">Try it with any job description, or tap a preset below.</p>
        )}
      </header>

      <main className="flex-1 px-5 pb-52 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          {(!isFirstTime || recording || transcribing) && (
            <p className={`text-xs ${recording ? "text-red-400" : "text-zinc-300"}`}>
              {recording
                ? `Recording... ${formatRecordingTime(recordSeconds)} · tap mic to stop`
                : transcribing
                ? "Transcribing..."
                : "Describe the job."}
            </p>
          )}
          <div className="relative pb-6">
            <textarea
              ref={textareaRef}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3.5 text-white placeholder-zinc-400 text-base leading-relaxed resize-none focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-40"
              placeholder={placeholders[placeholderIndex]}
              rows={6}
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              autoFocus
            />
            <div className="absolute right-2.5 bottom-0 flex gap-2">
              <button
                type="button"
                disabled={transcribing}
                onClick={recording ? stopRecording : startRecording}
                aria-label={recording ? "Stop recording" : "Dictate job description"}
                className={`w-11 h-11 rounded-full flex items-center justify-center shadow-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                  recording ? "bg-red-500 text-white animate-pulse" : "bg-amber-500 text-zinc-950 hover:bg-amber-400"
                }`}
              >
                {transcribing ? <Spinner className="w-4 h-4" /> : <MicIcon className="w-5 h-5" />}
              </button>
              <button
                type="button"
                disabled={photoAnalysing || photos.length >= 5}
                onClick={() => (isPro ? setShowPhotoSourceSheet(true) : setPhotoError(PHOTO_PRO_GATE_MESSAGE))}
                aria-label="Add photos for AI analysis"
                className="relative w-11 h-11 rounded-full flex items-center justify-center bg-amber-500 text-zinc-950 hover:bg-amber-400 shadow-lg disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                <CameraIcon className="w-5 h-5" />
                {!isPro && (
                  <span className="absolute -top-1 -right-1 text-[8px] font-bold leading-none text-amber-500 bg-zinc-950 border border-amber-500/50 rounded px-1 py-0.5">
                    PRO
                  </span>
                )}
              </button>
            </div>
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handlePhotoAdded(file);
            }}
          />
          <input
            ref={libraryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handlePhotoAdded(file);
            }}
          />
          {dictationError && <p className="text-red-400 text-sm">{dictationError}</p>}
          {photos.length > 0 && (
            <p className="text-xs text-zinc-400 pt-1">Photos ({photos.length}/5)</p>
          )}
          {photos.length > 0 && (
            <div className="flex flex-col gap-3">
              {photos.map((photo) => (
                <div key={photo.id} className="flex items-start gap-3">
                  <div className="relative shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.preview}
                      alt="Job site photo"
                      className="h-20 w-20 rounded-xl border border-zinc-700 object-cover"
                    />
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => {
                        setAnalysed(false);
                        setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
                      }}
                      className="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-zinc-600 bg-zinc-800 text-zinc-300 hover:text-white transition-colors"
                    >
                      <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3" aria-hidden="true">
                        <path
                          d="M2.5 2.5l7 7M9.5 2.5l-7 7"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                  <input
                    type="text"
                    maxLength={200}
                    placeholder="Add a note..."
                    value={photo.note}
                    onChange={(e) =>
                      setPhotos((prev) =>
                        prev.map((p) =>
                          p.id === photo.id ? { ...p, note: e.target.value } : p
                        )
                      )
                    }
                    className="flex-1 min-w-0 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[44px]"
                  />
                </div>
              ))}
            </div>
          )}
          {photos.length > 0 && (
            <button
              type="button"
              disabled={photoAnalysing}
              onClick={() => void handleAnalysePhotos()}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-60 disabled:cursor-not-allowed transition-colors min-h-[44px]"
            >
              {photoAnalysing ? (
                <>
                  <Spinner className="w-4 h-4 text-amber-500" />
                  <span>Analysing photos...</span>
                </>
              ) : (
                <span>Analyse Photos</span>
              )}
            </button>
          )}
          {analysed && photos.length > 0 && (
            <p className="text-sm text-green-400 text-center">
              {photos.length === 1 ? "Photo analysed." : `All ${photos.length} photos analysed.`}
            </p>
          )}
          {photoError && (
            <p className="text-red-400 text-sm">
              {photoError === PHOTO_PRO_GATE_MESSAGE ? (
                <>
                  Photo estimates are a Pro feature.{" "}
                  <Link href="/subscribe" className="underline hover:text-red-300">
                    Upgrade to Pro
                  </Link>{" "}
                  to use your camera.
                </>
              ) : (
                photoError
              )}
            </p>
          )}
          {isFirstTime && (
            <div className="flex flex-col gap-1.5 mt-1">
              <p className="text-xs text-zinc-300">Try:</p>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_CHIPS.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => {
                      setJobDescription(chip.text);
                      requestAnimationFrame(() => {
                        const el = textareaRef.current;
                        if (el) {
                          el.focus();
                          el.setSelectionRange(chip.text.length, chip.text.length);
                        }
                      });
                    }}
                    className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}

        <button
          type="button"
          disabled={!jobDescription.trim()}
          onClick={() => onGenerate(photos)}
          className="w-full bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold text-base rounded-xl py-4 transition-colors min-h-[56px]"
        >
          {saved ? "Regenerate Estimate" : "Generate Estimate"}
        </button>

        {needsProfileSetup && (
          <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white">Complete your profile</p>
              <p className="text-xs text-zinc-400 mt-0.5">Add your business details so your estimates look professional.</p>
            </div>
            <Link
              href="/profile"
              className="shrink-0 text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors min-h-[44px] flex items-center"
            >
              Open Profile
            </Link>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-zinc-800" />
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">Customer details</p>
          <div className="h-px flex-1 bg-zinc-800" />
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-400">Customer name</label>
            <input
              type="text"
              className={inputClass}
              placeholder="David Miller"
              value={customerName}
              onChange={(e) => {
                setCustomerName(e.target.value);
                setCustomerDetailsSaved(false);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-400">Phone</label>
            <input
              type="tel"
              className={inputClass}
              placeholder="000-000-0000"
              value={customerPhone}
              onChange={(e) => {
                setCustomerPhone(formatPhoneInput(e.target.value));
                setCustomerDetailsSaved(false);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-400">Email <span className="font-normal text-zinc-500 text-xs">(Optional)</span></label>
            <input
              type="email"
              className={inputClass}
              placeholder="customer@example.com"
              value={customerEmail}
              onChange={(e) => {
                setCustomerEmail(e.target.value);
                setCustomerDetailsSaved(false);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-400">Job address <span className="font-normal text-zinc-500 text-xs">(Optional)</span></label>
            <input
              type="text"
              className={inputClass}
              placeholder="123 Main St, Suburb"
              value={jobAddress}
              onChange={(e) => {
                setJobAddress(e.target.value);
                setCustomerDetailsSaved(false);
              }}
            />
          </div>

          {saved && (
            <button
              type="button"
              onClick={() => {
                setCustomerDetailsSaved(true);
                setTimeout(() => setCustomerDetailsSaved(false), 3000);
              }}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-sm rounded-xl py-3 transition-colors min-h-[44px] flex items-center justify-center gap-2"
            >
              {customerDetailsSaved ? (
                <>
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    className="w-4 h-4 text-green-400"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 8l3.5 3.5L13 4.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="text-green-400">Details saved</span>
                </>
              ) : (
                "Save Details"
              )}
            </button>
          )}
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0">
        {saved && (
          <div className="px-5 pt-4 pb-6 bg-zinc-950 border-t border-zinc-800">
            <button
              type="button"
              onClick={onViewEstimate}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-base rounded-xl py-4 transition-colors min-h-[56px]"
            >
              Back to Estimate
            </button>
          </div>
        )}
        <BottomNav />
      </div>

      <PhotoSourceSheet
        isOpen={showPhotoSourceSheet}
        onClose={() => setShowPhotoSourceSheet(false)}
        onTakePhoto={() => {
          setShowPhotoSourceSheet(false);
          photoInputRef.current?.click();
        }}
        onChooseFromLibrary={() => {
          setShowPhotoSourceSheet(false);
          libraryInputRef.current?.click();
        }}
      />
    </div>
  );
}

function NewPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [jobDescription, setJobDescription] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [jobAddress, setJobAddress] = useState("");

  const [view, setView] = useState<"form" | "estimate">("form");
  const [generating, setGenerating] = useState(false);
  const [estimate, setEstimate] = useState("");
  const [estimateStarted, setEstimateStarted] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [savedEstimateId, setSavedEstimateId] = useState<string | null>(null);
  const [showSendSheet, setShowSendSheet] = useState(false);
  const [customerDetailsSaved, setCustomerDetailsSaved] = useState(false);
  const { logoUrl, businessName, businessEmail, preparedBy, isPro, isLoading: profileLoading } = useBusinessProfile();
  const [jobTitle, setJobTitle] = useState("");
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % jobPlaceholders.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const key = searchParams.get("prefill");
    if (key && PREFILLS[key]) {
      setJobDescription(PREFILLS[key]);
    }
  }, [searchParams]);

  useEffect(() => {
    fetch("/api/estimates")
      .then((r) => r.json())
      .then((d: { estimates?: unknown[] }) => {
        if (Array.isArray(d?.estimates) && d.estimates.length === 0) {
          setIsFirstTime(true);
        }
      })
      .catch(() => {});
  }, []);

  const needsProfileSetup = !profileLoading && !logoUrl && !businessName && !preparedBy && !businessEmail;

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function handleGenerate(photos: PhotoEntry[]) {
    setView("estimate");
    setGenerating(true);
    setEstimate("");
    setError("");
    setSaved(false);
    setSavedEstimateId(null);
    setJobTitle("");

    try {
      const res = await fetch("/api/generate-estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobDescription,
          customerName: customerName || undefined,
          customerPhone: customerPhone || undefined,
          customerEmail: customerEmail || undefined,
          jobAddress: jobAddress || undefined,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || `Server error ${res.status}`);
      }

      if (!res.body) {
        throw new Error("No response body returned from server");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let createdEstimateId: string | null = null;

      while (true) {
        let readResult;
        try {
          readResult = await reader.read();
        } catch (streamErr) {
          throw new Error(
            streamErr instanceof Error
              ? streamErr.message
              : "Estimate generation stream failed"
          );
        }

        const { done, value } = readResult;
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const errorMarkerIndex = buffer.indexOf("\n__ERROR__:");
        if (errorMarkerIndex !== -1) {
          const errorMessage = buffer
            .slice(errorMarkerIndex + "\n__ERROR__:".length)
            .trim();
          buffer = buffer.slice(0, errorMarkerIndex);
          setEstimate(buffer);
          throw new Error(errorMessage || "Estimate generation failed");
        }

        const idMarkerIndex = buffer.indexOf("\n__ID__:");
        if (idMarkerIndex !== -1) {
          const id = buffer.slice(idMarkerIndex + "\n__ID__:".length).trim();
          createdEstimateId = id;
          setSavedEstimateId(id);
          buffer = buffer.slice(0, idMarkerIndex);
        }

        const h1Line = buffer.split("\n").find((l) => l.startsWith("# "));
        if (h1Line) setJobTitle(h1Line.replace(/^# /, ""));
        setEstimateStarted(true);
        setEstimate(buffer);
      }

      // Save any job photos onto the estimate (Pro only). They stay hidden
      // until the contractor turns them on from the estimate view.
      if (isPro && createdEstimateId && photos.length > 0) {
        try {
          await fetch(`/api/estimates/${createdEstimateId}/photos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              photos: photos.map((p) => ({ base64: p.base64, note: p.note })),
            }),
          });
        } catch {
          // Photos are optional; never block the estimate on a failed upload.
        }
      }

      setSaved(true);
      setIsFirstTime(false);
    } catch (err) {
      setSaved(false);
      setView("form");
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Check your connection and try again."
      );
    } finally {
      setGenerating(false);
      setEstimateStarted(false);
    }
  }

  function handleBack() {
    setView("form");
  }

  function handleNewEstimate() {
    setView("form");
    setJobDescription("");
    setCustomerName("");
    setCustomerPhone("");
    setCustomerEmail("");
    setJobAddress("");
    setEstimate("");
    setError("");
    setSaved(false);
    setSavedEstimateId(null);
    setJobTitle("");
    setCustomerDetailsSaved(false);
  }

  if (view === "estimate") {
    return (
      <EstimateView
        generating={generating}
        estimateStarted={estimateStarted}
        estimate={estimate}
        error={error}
        saved={saved}
        savedEstimateId={savedEstimateId}
        needsProfileSetup={needsProfileSetup}
        logoUrl={logoUrl}
        businessName={businessName}
        businessEmail={businessEmail}
        preparedBy={preparedBy}
        customerName={customerName}
        customerPhone={customerPhone}
        customerEmail={customerEmail}
        jobAddress={jobAddress}
        jobTitle={jobTitle}
        showSendSheet={showSendSheet}
        setShowSendSheet={setShowSendSheet}
        onBack={handleBack}
        onNewEstimate={handleNewEstimate}
      />
    );
  }

  return (
    <FormView
      jobDescription={jobDescription}
      setJobDescription={setJobDescription}
      customerName={customerName}
      setCustomerName={setCustomerName}
      customerPhone={customerPhone}
      setCustomerPhone={setCustomerPhone}
      customerEmail={customerEmail}
      setCustomerEmail={setCustomerEmail}
      jobAddress={jobAddress}
      setJobAddress={setJobAddress}
      customerDetailsSaved={customerDetailsSaved}
      setCustomerDetailsSaved={setCustomerDetailsSaved}
      saved={saved}
      jobPlaceholders={jobPlaceholders}
      placeholderIndex={placeholderIndex}
      isFirstTime={isFirstTime}
      needsProfileSetup={needsProfileSetup}
      isPro={isPro}
      error={error}
      onGenerate={handleGenerate}
      onViewEstimate={() => setView("estimate")}
    />
  );
}

export default function Home() {
  return (
    <Suspense>
      <NewPageInner />
    </Suspense>
  );
}
