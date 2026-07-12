import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

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
    .select("subscription_status, trial_ends_at")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business) {
    // The onboarding page creates the missing business row, so it has to be
    // reachable here. Without this guard, redirecting a no-business user to
    // /onboarding would immediately re-trigger this redirect and loop forever.
    if (pathname === "/onboarding") {
      return response;
    }
    const onboardingUrl = new URL("/onboarding", request.url);
    onboardingUrl.searchParams.set("next", pathname);
    return withSessionCookies(NextResponse.redirect(onboardingUrl), response);
  }

  const isActive = business.subscription_status === "active";
  const isTrialing =
    business.subscription_status === "trial" &&
    business.trial_ends_at &&
    new Date(business.trial_ends_at) > new Date();

  const hasAccess =
    isActive || isTrialing || business.subscription_status === "complimentary";

  if (!hasAccess && pathname !== "/subscribe") {
    return withSessionCookies(NextResponse.redirect(new URL("/subscribe", request.url)), response);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|tradepulse-logo.png|favicon.png).*)"],
};
