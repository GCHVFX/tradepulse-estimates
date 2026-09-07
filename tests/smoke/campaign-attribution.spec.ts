import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import {
  ATTRIBUTION_COOKIE_NAME,
  ATTRIBUTION_MAX_AGE_SECONDS,
  OUTREACH_CAMPAIGNS,
  createCampaignRedirectHandler,
  resolveRequestCampaignCode,
  withBusinessCampaignAttribution,
} from "../../lib/campaign-attribution";

test("CA2609A sets a 30-day cookie and redirects to the canonical homepage", async () => {
  const response = await createCampaignRedirectHandler()(
    new NextRequest("https://tradepulse-estimates.com/r/CA2609A"),
    { params: Promise.resolve({ code: "CA2609A" }) }
  );

  expect(OUTREACH_CAMPAIGNS.CA2609A).toBe("Canada Bulk Outreach - September 2026");
  expect(response.headers.get("location")).toBe("https://tradepulse-estimates.com/");
  expect(response.cookies.get(ATTRIBUTION_COOKIE_NAME)).toMatchObject({
    value: "CA2609A",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: ATTRIBUTION_MAX_AGE_SECONDS,
  });
  expect(ATTRIBUTION_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60);
});

test("unknown campaign codes redirect without attribution", async () => {
  const response = await createCampaignRedirectHandler()(
    new NextRequest("https://tradepulse-estimates.com/r/UNKNOWN"),
    { params: Promise.resolve({ code: "UNKNOWN" }) }
  );

  expect(response.headers.get("location")).toBe("https://tradepulse-estimates.com/");
  expect(response.cookies.get(ATTRIBUTION_COOKIE_NAME)).toBeUndefined();
});

test("signup persists an allowed campaign code and leaves normal signups unchanged", () => {
  const attributedRequest = new NextRequest("https://tradepulse-estimates.com/signup", {
    headers: { cookie: `${ATTRIBUTION_COOKIE_NAME}=CA2609A` },
  });
  const normalRequest = new NextRequest("https://tradepulse-estimates.com/signup");
  const business = { owner_user_id: "user-1", subscription_status: "trialing" };

  expect(
    withBusinessCampaignAttribution(business, resolveRequestCampaignCode(attributedRequest))
  ).toEqual({ ...business, outreach_campaign_code: "CA2609A" });
  expect(
    withBusinessCampaignAttribution(business, resolveRequestCampaignCode(normalRequest))
  ).toEqual(business);
});

test("both account creation paths persist the server-resolved campaign code", () => {
  for (const path of ["app/api/auth/signup/route.ts", "app/auth/callback/route.ts"]) {
    const source = readFileSync(path, "utf8");
    expect(source).toContain("resolveRequestCampaignCode");
    expect(source).toContain("withBusinessCampaignAttribution");
  }
});

test("the migration adds only the nullable business campaign field", () => {
  const migration = readFileSync(
    "supabase/migrations/20260907000000_add_outreach_campaign_code.sql",
    "utf8"
  );

  expect(migration).toContain("add column if not exists outreach_campaign_code text null");
  expect(migration).not.toMatch(/create table|foreign key|campaign_click|row level security/i);
});
