"use client";

import { useState, useEffect } from "react";

interface BusinessProfile {
  logoUrl: string | null;
  businessName: string;
  businessEmail: string;
  preparedBy: string;
  isLoading: boolean;
}

export function useBusinessProfile(): BusinessProfile {
  const [profile, setProfile] = useState<BusinessProfile>({
    logoUrl: null,
    businessName: "",
    businessEmail: "",
    preparedBy: "",
    isLoading: true,
  });

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d: { profile?: { logo_url?: string; name?: string; email?: string; prepared_by?: string } }) => {
        setProfile({
          logoUrl: d?.profile?.logo_url ?? null,
          businessName: d?.profile?.name ?? "",
          businessEmail: d?.profile?.email ?? "",
          preparedBy: d?.profile?.prepared_by ?? "",
          isLoading: false,
        });
      })
      .catch(() => {
        setProfile(prev => ({ ...prev, isLoading: false }));
      });
  }, []);

  return profile;
}
