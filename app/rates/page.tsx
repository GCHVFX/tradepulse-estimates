import { redirect } from "next/navigation";
import { createSupabaseServerClient, supabaseAdmin } from "@/lib/supabase-server";
import { Logo } from "@/app/components/logo";
import { BottomNav } from "@/app/components/bottom-nav";
import { PriceBook } from "@/app/components/price-book";

export default async function RatesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("name")
    .eq("user_id", user.id)
    .maybeSingle();

  const businessName = (business as any)?.name ?? "";

  return (
    <div className="min-h-dvh bg-zinc-950 text-white flex flex-col">
      <header className="px-5 pt-10 pb-6 shrink-0">
        <Logo businessName={businessName} />
        <h1 className="text-2xl font-bold mt-5">Rates</h1>
        <p className="text-zinc-500 text-sm mt-1">
          Set your rates and the AI will use them when generating estimates.
        </p>
      </header>

      <main className="flex-1 px-5 pb-28">
        <PriceBook />
      </main>

      <div className="fixed bottom-0 left-0 right-0">
        <BottomNav />
      </div>
    </div>
  );
}
