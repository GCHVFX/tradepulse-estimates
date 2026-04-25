"use client";

export default function NewPageError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col items-center justify-center px-5 gap-6">
      <p className="text-zinc-400 text-base text-center">
        Something went wrong loading this page.
      </p>
      <button
        onClick={reset}
        className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-base rounded-xl px-6 py-3 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
