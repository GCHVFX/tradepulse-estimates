import { headers } from "next/headers";
import { currencyFromCountry } from "@/lib/currency";
import { SignupForm } from "./signup-form";

/**
 * Server wrapper so the billing currency is decided from Vercel's
 * server-provided `x-vercel-ip-country` before anything renders. No browser
 * geolocation, no geo-IP lookup, and the country itself is never persisted:
 * only the resulting currency, and only if the person keeps it.
 *
 * Reading a request header opts this route into dynamic rendering.
 */
export default async function SignupPage() {
  const country = (await headers()).get("x-vercel-ip-country");
  return <SignupForm initialCurrency={currencyFromCountry(country)} />;
}
