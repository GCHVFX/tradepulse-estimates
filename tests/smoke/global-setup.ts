import { resetSignupRateLimit } from "./helpers";

// Runs once before any test in the suite. Every test shares one source IP
// (this machine/CI runner) against /api/auth/signup's IP-keyed rate limit,
// so a prior run (or a partially-used budget left over from one) could
// otherwise eat into the margin the signup-based tests need. This is a
// floor for the whole suite, not a substitute for signup-rate-limit.spec.ts's
// own before/after reset, which that test still needs to isolate itself from
// whatever runs before and after it.
export default async function globalSetup(): Promise<void> {
  await resetSignupRateLimit();
}
