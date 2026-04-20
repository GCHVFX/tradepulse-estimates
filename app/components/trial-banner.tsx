"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ProfileData {
  subscription_status?: string;
  trial_ends_at?: string | null;
}

export function TrialBanner() {
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const profile: ProfileData | null = data?.profile ?? null;
        if (!profile || profile.subscription_status !== "trial" || !profile.trial_ends_at) return;

        const msLeft = new Date(profile.trial_ends_at).getTime() - Date.now();
        const days = Math.floor(msLeft / (1000 * 60 * 60 * 24));

        if (days <= 7) {
          setDaysLeft(Math.max(days, 0));
        }
      })
      .catch(() => {});
  }, []);

  if (daysLeft === null) return null;

  return (
    <div
      style={{ backgroundColor: "#f59e0b", padding: "10px" }}
      className="w-full text-center text-sm font-medium text-zinc-900"
    >
      {daysLeft === 0 ? "Your free trial ends today." : `Your free trial ends in ${daysLeft} days.`}
      {" "}
      <Link href="/subscribe" className="underline underline-offset-2 hover:opacity-75 transition-opacity">
        Add payment details
      </Link>
    </div>
  );
}
