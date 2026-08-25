/**
 * Identifies the Supabase session cookies so a request can be signed out from
 * middleware or a route handler.
 *
 * A server component cannot do this: createSupabaseServerClient()'s setAll
 * swallows the write when it runs during render, so calling signOut() there
 * looks like it worked and leaves the session intact. Anywhere that must
 * actually end a session has to clear these cookies on a real response.
 *
 * Supabase names them `sb-<project-ref>-auth-token`, optionally chunked with
 * a `.0`, `.1` suffix when the token is too large for one cookie.
 */

const SUPABASE_AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

export function isSupabaseAuthCookie(name: string): boolean {
  return SUPABASE_AUTH_COOKIE.test(name);
}

/** The subset of the given cookie names that carry the Supabase session. */
export function supabaseAuthCookieNames(names: readonly string[]): string[] {
  return names.filter(isSupabaseAuthCookie);
}
