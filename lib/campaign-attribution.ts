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
 * Coarse, best-effort click context: never a visitor/session identifier,
 * never a raw IP address (see the migration that added these columns,
 * 20260912190000_add_outreach_click_metadata.sql, for the reasoning). Every
 * field is independently optional -- a click with no geo headers at all is
 * still a valid, fully recordable click.
 */
export interface OutreachClickMetadata {
  country: string | null;
  region: string | null;
  city: string | null;
  userAgent: string | null;
  referrer: string | null;
}

// Vercel's edge geolocation headers are only present on Vercel infrastructure
// (unset in local dev and most other hosts), and x-vercel-ip-city is
// percent-encoded because city names can contain spaces or punctuation. None
// of this may ever throw: a malformed or absent header degrades to null for
// that one field, never to a failed click.
function readHeader(request: NextRequest, name: string): string | null {
  const value = request.headers.get(name);
  return value && value.trim() ? value.trim() : null;
}

function readCity(request: NextRequest): string | null {
  const raw = readHeader(request, "x-vercel-ip-city");
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function readOutreachClickMetadata(request: NextRequest): OutreachClickMetadata {
  return {
    country: readHeader(request, "x-vercel-ip-country"),
    region: readHeader(request, "x-vercel-ip-country-region"),
    city: readCity(request),
    userAgent: readHeader(request, "user-agent"),
    referrer: readHeader(request, "referer"),
  };
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
export type OutreachClickRecorder = (code: string, metadata: OutreachClickMetadata) => Promise<void>;

export const recordOutreachClick: OutreachClickRecorder = async (code, metadata) => {
  try {
    const { error } = await supabaseAdmin.from("tpe_outreach_clicks").insert({
      campaign_code: code,
      country: metadata.country,
      region: metadata.region,
      city: metadata.city,
      user_agent: metadata.userAgent,
      referrer: metadata.referrer,
    });
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

    // Best-effort and independent of the click write succeeding or failing:
    // reading headers never throws, so a metadata read can never be the
    // reason a click goes unrecorded or a redirect is delayed.
    const metadata = readOutreachClickMetadata(request);
    try {
      await recordClick(code, metadata);
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
