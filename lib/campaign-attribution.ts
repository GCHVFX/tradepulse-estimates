import { NextRequest, NextResponse } from "next/server";
import { canonicalUrl } from "@/lib/site-url";
import { supabaseAdmin } from "@/lib/supabase-server";

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

/**
 * Writes one raw click event for a recognised campaign code, so TradePulse
 * can measure the top of its own outreach funnel (click, independent of
 * whether the visitor ever signs up). Uses the service-role client: this
 * fires from the public /r/[code] route, which has no user session and no
 * RLS-visible identity, the same posture as every other tpe_ write from a
 * public route in this codebase.
 *
 * Never throws. A failed click write must never stop the redirect, so any
 * error -- Supabase returning one, or the call itself throwing -- is caught
 * and logged here rather than propagated. The caller in
 * createCampaignRedirectHandler also wraps this in its own try/catch, so
 * the "never blocks the redirect" property holds even for an injected
 * recorder that does not behave this well.
 */
export type OutreachClickRecorder = (code: string) => Promise<void>;

export const recordOutreachClick: OutreachClickRecorder = async (code) => {
  try {
    const { error } = await supabaseAdmin.from("tpe_outreach_clicks").insert({ campaign_code: code });
    if (error) {
      console.error("Failed to record outreach click:", { code, message: error.message });
    }
  } catch (error) {
    console.error("Failed to record outreach click:", { code, error });
  }
};

/**
 * Creates the small public redirect handler and keeps it directly testable.
 *
 * `recordClick` defaults to the real service-role write and is injectable so
 * tests can prove the click and the redirect are decoupled: a recorder that
 * rejects, or one that captures every call it received, exercises this
 * without needing a live Supabase connection.
 */
export function createCampaignRedirectHandler(recordClick: OutreachClickRecorder = recordOutreachClick) {
  return async function GET(
    request: NextRequest,
    context: CampaignRouteContext
  ): Promise<NextResponse> {
    const response = NextResponse.redirect(canonicalUrl("/"));
    const code = campaignCode((await context.params).code);
    if (!code) return response;

    try {
      await recordClick(code);
    } catch (error) {
      console.error("Failed to record outreach click:", { code, error });
    }

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
