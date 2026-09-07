import { NextRequest, NextResponse } from "next/server";
import { canonicalUrl } from "@/lib/site-url";

export const ATTRIBUTION_COOKIE_NAME = "tp_campaign";
export const ATTRIBUTION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const OUTREACH_CAMPAIGNS = {
  CA2609A: "Canada Bulk Outreach - September 2026",
} as const;

interface CampaignRouteContext {
  params: Promise<{ code: string }>;
}

export function campaignCode(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  if (Object.prototype.hasOwnProperty.call(OUTREACH_CAMPAIGNS, value)) {
    return value;
  }
  return null;
}

export function resolveRequestCampaignCode(request: NextRequest): string | null {
  return campaignCode(request.cookies.get(ATTRIBUTION_COOKIE_NAME)?.value);
}

/** Adds campaign attribution without changing an unattributed business record. */
export function withBusinessCampaignAttribution<T extends object>(
  business: T,
  code: string | null
): T & Partial<{ outreach_campaign_code: string }> {
  return code ? { ...business, outreach_campaign_code: code } : business;
}

/** Creates the small public redirect handler and keeps it directly testable. */
export function createCampaignRedirectHandler() {
  return async function GET(
    request: NextRequest,
    context: CampaignRouteContext
  ): Promise<NextResponse> {
    const response = NextResponse.redirect(canonicalUrl("/"));
    const code = campaignCode((await context.params).code);
    if (!code) return response;

    response.cookies.set(ATTRIBUTION_COOKIE_NAME, code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: ATTRIBUTION_MAX_AGE_SECONDS,
    });

    return response;
  };
}
