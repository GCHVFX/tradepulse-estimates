import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { TrialBanner } from "@/app/components/trial-banner";
import { Analytics } from "@vercel/analytics/next";
import { PostHogProvider } from "@/app/components/posthog-provider";
import { PostHogPageView } from "@/app/components/posthog-pageview";
import { Suspense } from "react";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "TradePulse Estimates",
  description: "Create and send professional estimates in seconds.",
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PostHogProvider>
          <Suspense fallback={null}>
            <PostHogPageView />
          </Suspense>
          <TrialBanner />
          {children}
          <Analytics />
        </PostHogProvider>
      </body>
    </html>
  );
}
