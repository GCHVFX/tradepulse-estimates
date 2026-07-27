---
name: security-audit
description: Find high-confidence security vulnerabilities, either in a code diff (PR/branch review) or across a whole app and its live infrastructure (Supabase RLS and storage policies, IDOR, exposed secrets, open debug routes, CORS). Use this whenever the user asks to check for vulnerabilities, run a security audit, review a PR/branch/diff for security issues, check if the app is secure, audit Supabase RLS or storage policies, or references known AI-app vulnerability classes (secrets in the client bundle, missing row-level security, IDOR/broken object-level authorization, debug or admin routes left open, CORS wildcards) — including when they paste in an article or post about "vibe coding" security problems and ask you to check their own app against it. Also trigger on "is my app secure", "check for exposed secrets", "audit my database policies", or "did we leave any debug routes in".
---

# Security audit

Two different jobs share this skill because they're both "find real, exploitable security problems" — but they look at different things and need different instructions. Pick the right one before you start; don't blend them.

## Which mode?

**PR / diff review** — there's an actual code change to look at: uncommitted work, a branch ahead of main, a specific PR. The question is "did this change introduce a vulnerability." Read `references/pr-diff-review.md`.

**Whole-codebase / live-infra audit** — there's no diff to review (main is clean, or the user isn't asking about recent changes), or the user explicitly wants the whole app and its live database/storage checked, not just recent edits. The question is "is this app, as it exists right now, vulnerable." Read `references/live-audit.md`.

If it's ambiguous — e.g. the user says "review this for security issues" with a clean working tree — ask which one they mean rather than guessing; a diff review with nothing to diff and a live audit are not interchangeable, and running the wrong one wastes their time.

## Why these are separate

The PR-diff mode is deliberately narrow: it only flags issues the diff *introduced*, ignores anything pre-existing, and leans hard on suppressing false positives because it's meant to run on every change without becoming noise. The live-audit mode is the opposite shape: it's a fixed checklist of five specific patterns (secrets in the client bundle, missing/misconfigured Supabase RLS including storage policies, auth-vs-authorization/IDOR, open debug/admin routes, CORS wildcards) run against the app and its live infrastructure as they stand today, informed by what actually breaks AI-generated apps in practice — not a general vulnerability hunt. Don't let one mode's instructions bleed into the other: a live audit shouldn't get bogged down in the PR-diff mode's exhaustive OWASP category list, and a diff review shouldn't go check Supabase policies that the diff never touched.

## Reporting findings

Both modes report before fixing. If the user asks you to fix something afterward:
- Straightforward code fixes (a CORS header, moving a secret server-side) — just make them, the same as any other requested code change.
- Anything touching live infrastructure with real user data (a database migration, a storage policy change) — explain exactly what the fix does and why it's safe given how the app actually uses that resource (this usually means checking what legitimate flows currently rely on the thing you're about to change), then get explicit confirmation before applying it. See the "Fixing findings" section at the end of `references/live-audit.md` for the specific pattern.
