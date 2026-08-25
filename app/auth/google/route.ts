import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  createOAuthNonce,
  OAUTH_INTENT_COOKIE,
  OAUTH_INTENT_MAX_AGE_SECONDS,
  OAUTH_NONCE_PARAM,
  parseOAuthIntent,
  serializeOAuthIntentCookie,
} from "@/lib/oauth-intent";

type PendingCookie = { name: string; value: string; options: Record<string, unknown> };

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/")) return "/onboarding";
  if (value.startsWith("//")) return "/onboarding";
  return value;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const next = safeNextPath(searchParams.get("next"));

  // Only /signup may start a provisioning flow. An unrecognised or absent
  // value falls back to "login", which never creates anything.
  const intent = parseOAuthIntent(searchParams.get("intent")) ?? "login";
  const nonce = createOAuthNonce();

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
      // The nonce travels in the URL; the intent itself never does.
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}&${OAUTH_NONCE_PARAM}=${nonce}`,
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

  // HttpOnly so no script or crafted callback URL can choose the intent.
  // Lax survives the provider's top-level GET redirect back to us.
  response.cookies.set(OAUTH_INTENT_COOKIE, serializeOAuthIntentCookie(intent, nonce), {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_INTENT_MAX_AGE_SECONDS,
  });

  return response;
}
