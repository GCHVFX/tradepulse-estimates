const MAX_EMAIL_LENGTH = 320;
const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_EMAIL_LENGTH ||
    !SIMPLE_EMAIL_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function getRequestIp(request: Request): string {
  const vercelForwarded = request.headers.get("x-vercel-forwarded-for");
  const forwarded = vercelForwarded ?? request.headers.get("x-forwarded-for");
  const candidate = forwarded?.split(",")[0]?.trim();
  return candidate && candidate.length <= 64 ? candidate : "unknown";
}
