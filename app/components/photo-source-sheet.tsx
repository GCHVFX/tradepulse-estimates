"use client";

interface PhotoSourceSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onTakePhoto: () => void;
  onChooseFromLibrary: () => void;
}

export function PhotoSourceSheet({
  isOpen,
  onClose,
  onTakePhoto,
  onChooseFromLibrary,
}: PhotoSourceSheetProps) {
  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
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
          <span className="text-white font-semibold text-base">Add Photos for AI Analysis</span>
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

        <div className="px-5 pb-10 pt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={onTakePhoto}
            className="flex items-center gap-4 w-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 rounded-xl px-4 py-4 min-h-[64px] transition-colors text-left"
          >
            <span className="w-10 h-10 rounded-lg bg-zinc-700 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-zinc-300" aria-hidden="true">
                <path
                  d="M3 8.5a2 2 0 012-2h1.4l1.2-1.8a1.5 1.5 0 011.25-.7h6.3a1.5 1.5 0 011.25.7l1.2 1.8H19a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2V8.5z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium text-sm">Take Photo</p>
              <p className="text-zinc-400 text-xs mt-0.5">Use your camera</p>
            </div>
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-zinc-600 shrink-0" aria-hidden="true">
              <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <button
            type="button"
            onClick={onChooseFromLibrary}
            className="flex items-center gap-4 w-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 rounded-xl px-4 py-4 min-h-[64px] transition-colors text-left"
          >
            <span className="w-10 h-10 rounded-lg bg-zinc-700 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-zinc-300" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="8.5" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M3 16l5-5 4 4 3-3 6 6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium text-sm">Choose from Camera Roll</p>
              <p className="text-zinc-400 text-xs mt-0.5">Pick an existing photo</p>
            </div>
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-zinc-600 shrink-0" aria-hidden="true">
              <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}
