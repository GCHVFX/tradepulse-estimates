import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { isSupabaseAuthCookie } from "@/lib/auth-session";
import { hasSubscriptionAccess, SUBSCRIPTION_ACCESS_COLUMNS } from "@/lib/subscription-access";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/reset-password",
  "/auth",
  "/share",
  "/electricians",
  "/plumbers",
  "/trades",
  "/plumbing-cost",
  "/electrical-cost",
  "/plumbing-estimate-template",
  "/demo",
  "/go",
  "/contact",
  "/privacy",
  "/terms",
];

function isPublic(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return true;
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"));
}

// When getUser() refreshes a token it calls setAll() which updates `response`.
// Any subsequent redirect must carry those updated cookies or the browser
// keeps the old (expired) access token and the session appears lost.
function withSessionCookies(redirect: NextResponse, session: NextResponse): NextResponse {
  session.cookies.getAll().forEach((cookie) => {
    const { name, value, ...options } = cookie;
    redirect.cookies.set(name, value, options);
  });
  return redirect;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/logo") ||
    pathname.startsWith("/public") ||
    pathname.includes(".") ||
    isPublic(pathname)
  ) {
    return NextResponse.next();
  }

  const response = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookies) {
          cookies.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return withSessionCookies(NextResponse.redirect(loginUrl), response);
  }

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select(SUBSCRIPTION_ACCESS_COLUMNS)
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business) {
    // An authenticated identity with no business row gets no app access and
    // no business created for it. /onboarding used to be exempted here so it
    // could insert one, which handed out a 14-day trial with no Stripe
    // customer or subscription behind it. It no longer creates anything, so
    // there is nothing to exempt.
    //
    // The session is cleared rather than merely redirected, so a stale cookie
    // cannot keep re-entering protected routes. /signup is public, so the
    // proxy does not run on the destination and this cannot loop.
    const signupUrl = new URL("/signup", request.url);
    signupUrl.searchParams.set("error", "setup_required");
    const redirect = NextResponse.redirect(signupUrl);
    for (const cookie of request.cookies.getAll()) {
      if (isSupabaseAuthCookie(cookie.name)) redirect.cookies.delete(cookie.name);
    }
    return redirect;
  }

  if (!hasSubscriptionAccess(business) && pathname !== "/subscribe") {
    return withSessionCookies(NextResponse.redirect(new URL("/subscribe", request.url)), response);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|tradepulse-logo.png|favicon.png).*)"],
};
