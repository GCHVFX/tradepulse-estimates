# Whole-codebase / live-infrastructure audit

Use this mode when there's no PR diff to review — the ask is "check my app for vulnerabilities," "is this secure," "audit my Supabase project," or similar — or when the user explicitly wants the whole app checked, not just recent changes. This checks the app *as it stands today*, including its live database and storage configuration, not just a diff.

This mode exists because these five patterns are what actually break AI-assisted apps in practice. A study scanning 380,000+ public Lovable/Replit/Base44/Netlify apps found roughly 40% exposing sensitive data, and a separate Veracode study found 45% of AI-generated code carries at least one OWASP Top 10 vulnerability — concentrated in five specific, boring, repeatable mistakes rather than exotic bugs. Check for exactly these five, in order, and don't stop at the first `git grep` match — verify whether a match is actually reachable/exploitable before calling it a finding.

## 1. Secrets in the client bundle

**The pattern:** the AI hardcodes an API key or reads a server secret inside a component that ships to the browser. Anyone who opens devtools has it.

**How to check:**
- Find every client component: `grep -rn '"use client"' <app dir>` (Next.js) or equivalent for the framework in use.
- Search those files, and anything imported into them, for secret-shaped strings and known key prefixes: `sk-ant-`, `sk_live`, `sk_test`, Stripe/Twilio/AWS-style key patterns, `AIza...` (Google), etc.
- Cross-reference every `process.env.*` (or equivalent) read against which file it's in. In Next.js specifically: only `NEXT_PUBLIC_*`-prefixed vars are safe to reference client-side by design — anything else referenced inside a `"use client"` file or a browser-bound module is a leak. A server component or API route reading a non-public var is fine; that code never ships to the browser.
- Check what the actual browser-side database/API client is initialized with (e.g. does the Supabase browser client use the anon key, or did something paste the service-role key in by mistake?).

**What's a real finding vs. not:** a server secret referenced inside client-rendered code, or inside a file that's imported by one, is a real finding regardless of whether it's "just" a `console.log` or an actual API call — once it's in the client bundle it's readable. A server secret referenced only inside API routes / server components is not a finding.

## 2. Missing or misconfigured Row-Level Security (Supabase)

**The pattern:** the AI creates tables without RLS, or enables RLS but writes no policies (or writes a policy so broad it doesn't actually restrict anything) — the table (or a storage bucket) ends up readable/writable by anyone holding the public anon key.

**How to check**, using the Supabase MCP tools:
1. `list_projects` to get the project ref if you don't already have it, then `list_tables` on the `public` schema — note `rls_enabled` for every table.
2. `get_advisors` with `type: "security"` — this catches the common cases (`rls_enabled_no_policy`, `public_bucket_allows_listing`, leaked-password-protection disabled, outdated Postgres) but **does not catch everything**. Treat it as a starting list, not the whole check.
3. **Don't stop at "RLS enabled, no policy" and call it a finding.** In Postgres, RLS enabled with zero policies is default-deny — it blocks all access for `anon`/`authenticated` roles, which is the *safe* state, not the vulnerable one. Before flagging it, check whether the app ever actually queries that table directly from the browser:
   `grep -rn "createBrowserClient\|createClientComponentClient" <app dir>` to find the anon-key client, then check whether any client component calls `.from("<table>")` on it. If every read/write for that table goes through a server route using a service-role/admin client (which bypasses RLS after doing its own authorization check), the missing policy is a non-issue in practice, not a live vulnerability — say so plainly rather than reporting it as HIGH severity.
4. **Check Storage policies separately from table RLS — this is the part the advisor tool is most likely to miss.** Query the actual policies directly, since a misleadingly-named policy can pass a casual glance:
   ```sql
   select policyname, cmd, roles, permissive, qual, with_check
   from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
   order by policyname;
   ```
   Look specifically for PERMISSIVE policies whose `qual`/`with_check` checks only `auth.role() = 'authenticated'` (or similar) with **no bucket_id restriction and no ownership check** (no `owner_id = auth.uid()` or folder-based scoping) — a policy literally named "Allow users to view their own files" can still grant every signed-up user access to every other user's files if the ownership check was never actually written into the condition. This is a real, easily-missed pattern: the policy *name* implies scoping the *condition* doesn't enforce.
5. Cross-check bucket `public` status and ownership: `select id, name, public, created_at from storage.buckets order by created_at;`. A bucket that predates the current app or isn't referenced anywhere in the codebase (`grep` for the bucket name) may belong to a different, unrelated project sharing the same Supabase org — note it, but don't treat it as this app's vulnerability to fix.

**What's a real finding:** a table or bucket where an unauthenticated or any-authenticated-user request can read/write another tenant's data, verified either by the policy condition itself or by confirming the app's own client-side code actually exercises that unprotected path.

## 3. Auth vs. authorization (IDOR / broken object-level access control)

**The pattern:** login works, but an endpoint like `/api/users/:id` or `/api/estimates/:id` returns or modifies whatever the id points to, without checking that the *logged-in* user actually owns it. Logged in ≠ allowed.

**How to check:** find every API route that takes an id from the URL, path param, or request body, and read what it does with it:
- `grep -rn "params.*id\|searchParams.get(.id.)\|body\.id" <api dir>`
- For each match, confirm the query that reads/writes the resource is scoped by something derived from the *authenticated session* (e.g. `.eq("business_id", business.id)` where `business.id` came from looking up the authenticated user, not from the request) — not just filtered by the id the client sent.
- Route handlers that only check `if (!user) return 401` and then query by the client-supplied id alone, with no ownership/tenant filter, are the vulnerability. A route that does `.eq("id", id).eq("owner_id", user.id)` (or the equivalent join through a parent resource) is fine.

**What's a real finding:** confirmed by reading the actual query, not just noticing an id parameter exists — plenty of ids in a well-built app are properly scoped, and flagging every `:id` route as IDOR without checking the query is noise.

## 4. Debug and admin routes left open

**The pattern:** the AI adds a `/debug`, `/admin`, `/test`, or similar route while building, and nobody removes it or gates it before shipping.

**How to check:**
- `find <api dir> -type d -iname "*debug*" -o -iname "*admin*" -o -iname "*test*"` and a full route listing (`find <api dir> -type d | sort`) — eyeball every route name for anything that looks like it was meant for the developer, not the user.
- For any that exist, check what they expose and whether they're gated behind real auth (not just "requires *a* login" — check if they require an *admin* role specifically, if the app has one).

**What's a real finding:** a route reachable by any request (or any logged-in user, if it should be admin-only) that exposes internal state, lets someone bypass normal flows, or wasn't intended to ship.

## 5. CORS wildcard

**The pattern:** someone hit a CORS error during development, asked the AI to fix it, and it did — by setting `Access-Control-Allow-Origin: *` (or reflecting the request's `Origin` header verbatim), often paired with `Access-Control-Allow-Credentials: true`, which lets any website make authenticated requests on a logged-in user's behalf.

**How to check:**
- `grep -rn "Access-Control-Allow-Origin" <repo>` across API routes and any central config (Next.js `next.config.*` `headers()`, an Express/Fastify CORS middleware config, etc.).
- Flag a literal `*`, or an `Origin` header being reflected back without an explicit allow-list check.

**What's a real finding:** a wildcard or reflected-origin CORS policy on any route that also relies on cookies/session auth (not needed for public data endpoints with no auth). No CORS headers set at all is fine — same-origin requests don't need them.

## Fixing findings

Report findings first, with the same file/line/severity/exploit-scenario/recommendation shape used in `pr-diff-review.md`, before changing anything. Some of these fixes are genuinely reversible (a code change, a CORS header) and some aren't (a database migration touching live storage/RLS policies on a production project with real user data) — treat the second kind the way any other risky, hard-to-reverse action is treated: explain exactly what the fix does and why it's safe for the app's actual usage pattern (check what legitimate flows currently rely on the policy before changing it, the same way you checked whether it was exploitable), then wait for explicit confirmation before applying it. Use `apply_migration` (not raw `execute_sql`) for the actual DDL once confirmed, and verify the change afterward by reading the policies back rather than assuming the migration did what you intended.
