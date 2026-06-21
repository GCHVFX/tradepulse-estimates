import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

type PendingCookie = { name: string; value: string; options: Record<string, unknown> };

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/")) return "/onboarding";
  if (value.startsWith("//")) return "/onboarding";
  return value;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const next = safeNextPath(searchParams.get("next"));
  const pendingCookies: PendingCookie[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookies) {
          pendingCookies.push(...(cookies as PendingCookie[]));
        },
      },
    }
  );

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) {
    return NextResponse.redirect(`${origin}/login?error=google_signin_failed`);
  }

  const response = NextResponse.redirect(data.url);
  pendingCookies.forEach(({ name, value, options }) => {
    response.cookies.set(
      name,
      value,
      options as Parameters<typeof response.cookies.set>[2]
    );
  });

  return response;
}
