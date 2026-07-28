"use client";

import { useState, useEffect } from "react";

interface BusinessProfile {
  logoUrl: string | null;
  businessName: string;
  businessEmail: string;
  preparedBy: string;
  isPro: boolean;
  googleReviewLink: string | null;
  // Remaining AI photo estimates this calendar month for a Starter business.
  // null for Pro (unlimited) and while still loading.
  aiPhotoEstimatesRemaining: number | null;
  isLoading: boolean;
}

export function useBusinessProfile(): BusinessProfile {
  const [profile, setProfile] = useState<BusinessProfile>({
    logoUrl: null,
    businessName: "",
    businessEmail: "",
    preparedBy: "",
    isPro: false,
    googleReviewLink: null,
    aiPhotoEstimatesRemaining: null,
    isLoading: true,
  });

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d: { profile?: { logo_url?: string; name?: string; email?: string; prepared_by?: string; plan?: string; google_review_link?: string | null; ai_photo_estimates_remaining?: number | null } }) => {
        setProfile({
          logoUrl: d?.profile?.logo_url ?? null,
          businessName: d?.profile?.name ?? "",
          businessEmail: d?.profile?.email ?? "",
          preparedBy: d?.profile?.prepared_by ?? "",
          isPro: d?.profile?.plan === "pro",
          googleReviewLink: d?.profile?.google_review_link ?? null,
          aiPhotoEstimatesRemaining: d?.profile?.ai_photo_estimates_remaining ?? null,
          isLoading: false,
        });
      })
      .catch(() => {
        setProfile(prev => ({ ...prev, isLoading: false }));
      });
  }, []);

  return profile;
}
