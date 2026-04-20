export default function EstimateLoading() {
  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
      <header className="px-5 pt-10 pb-4 shrink-0 flex items-center justify-between">
        <div className="h-5 w-20 bg-zinc-800 rounded-lg animate-pulse" />
        <div className="h-6 w-24 bg-zinc-800 rounded-lg animate-pulse" />
      </header>

      <main className="flex-1 px-5 pt-4 flex flex-col gap-4">
        <div className="h-6 w-48 bg-zinc-800 rounded-lg animate-pulse" />
        <div className="h-4 w-32 bg-zinc-800 rounded animate-pulse" />
        <div className="h-4 w-28 bg-zinc-800 rounded animate-pulse" />
        <div className="mt-4 h-4 w-full bg-zinc-800 rounded animate-pulse" />
        <div className="h-4 w-5/6 bg-zinc-800 rounded animate-pulse" />
        <div className="h-4 w-4/6 bg-zinc-800 rounded animate-pulse" />
        <div className="mt-4 h-5 w-36 bg-zinc-800 rounded animate-pulse" />
        <div className="h-4 w-full bg-zinc-800 rounded animate-pulse" />
        <div className="h-4 w-full bg-zinc-800 rounded animate-pulse" />
        <div className="h-4 w-3/4 bg-zinc-800 rounded animate-pulse" />
      </main>
    </div>
  );
}
