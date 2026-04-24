import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In — TradePulse Estimates",
  description: "Sign in to TradePulse and create professional estimates from the job site in seconds.",
  alternates: { canonical: "https://www.trytradepulse.com/login" },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
