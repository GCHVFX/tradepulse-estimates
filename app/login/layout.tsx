import type { Metadata } from "next";
import { CANONICAL_URL } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Sign In — TradePulse Estimates",
  description: "Sign in to TradePulse and create professional estimates from the job site in seconds.",
  alternates: { canonical: `${CANONICAL_URL}/login` },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
