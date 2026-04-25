import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";

// Service role client, bypasses RLS, server use only
export const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Request-scoped anon client for API routes, persists refreshed session tokens back to the browser
export function createApiClient(request: NextRequest) {
  type CookieEntry = { name: string; value: string; options: Record<string, unknown> };
  const pending: CookieEntry[] = [];

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookies) { pending.push(...(cookies as CookieEntry[])); },
      },
    }
  );

  function applyTo<T extends NextResponse>(res: T): T {
    pending.forEach(({ name, value, options }) =>
      res.cookies.set(name, value, options as Parameters<T["cookies"]["set"]>[2])
    );
    return res;
  }

  return { supabase, applyTo };
}

// SSR-aware anon client for reading the authenticated user in server components
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component, middleware handles session refresh
          }
        },
      },
    }
  );
}
