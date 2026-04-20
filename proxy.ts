import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/reset-password",
  "/share",
  "/onboarding",
  "/api/billing/webhook",
  "/electricians",
  "/plumbers",
  "/plumbing-cost",
  "/electrical-cost",
];

function isPublic(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return true;
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(path + "/"));
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
    return NextResponse.redirect(loginUrl);
  }

  const { data: business } = await supabase
    .from("tpe_businesses")
    .select("subscription_status, trial_ends_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!business) {
    if (pathname !== "/subscribe") {
      return NextResponse.redirect(new URL("/subscribe", request.url));
    }
    return response;
  }

  const isActive = business.subscription_status === "active";
  const isTrialing =
    business.subscription_status === "trial" &&
    business.trial_ends_at &&
    new Date(business.trial_ends_at) > new Date();

  const hasAccess =
    isActive || isTrialing || business.subscription_status === "complimentary";

  if (!hasAccess && pathname !== "/subscribe") {
    return NextResponse.redirect(new URL("/subscribe", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|tradepulse-logo.png|favicon.png).*)"],
};
