/**
 * Reads Vercel's `x-vercel-ip-country` header to decide whether a visitor is
 * in Canada. Used only for a cosmetic "Proudly Canadian" claim on the
 * pricing section, not for currency or any billing decision (see
 * `currencyFromCountry` in `lib/currency.ts` for that, which intentionally
 * treats an unknown country as CAD).
 *
 * Fails closed: a missing header, an empty value, or anything other than
 * "CA" all return false. Showing a Canada-only claim by default anywhere
 * the visitor's country isn't confirmed would be inaccurate, not just a
 * missed opportunity.
 */
export function isVisitorInCanada(country: string | null | undefined): boolean {
  if (typeof country !== "string") return false;
  return country.trim().toUpperCase() === "CA";
}
