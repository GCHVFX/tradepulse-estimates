import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Start Your Free Trial — TradePulse Estimates",
  description: "Try TradePulse free for 14 days. Create and send professional estimates from the job site in seconds. No credit card required.",
  alternates: { canonical: "https://www.trytradepulse.com/signup" },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
