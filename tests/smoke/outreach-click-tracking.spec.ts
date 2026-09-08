import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { NextRequest } from "next/server";
import {
  ATTRIBUTION_COOKIE_NAME,
  createCampaignRedirectHandler,
  recordOutreachClick,
} from "../../lib/campaign-attribution";

const MIGRATION_PATH = "supabase/migrations/20260908000000_create_tpe_outreach_clicks.sql";

function requestFor(code: string): NextRequest {
  return new NextRequest(`https://tradepulse-estimates.com/r/${code}`);
}

test("visiting /r/CA2609A records exactly one click with campaign code CA2609A", async () => {
  const recorded: string[] = [];
  const handler = createCampaignRedirectHandler(async (code) => {
    recorded.push(code);
  });

  await handler(requestFor("CA2609A"), { params: Promise.resolve({ code: "CA2609A" }) });

  expect(recorded).toEqual(["CA2609A"]);
});

test("the redirect destination and cookie are unchanged by adding click logging", async () => {
  const response = await createCampaignRedirectHandler(async () => {})(
    requestFor("CA2609A"),
    { params: Promise.resolve({ code: "CA2609A" }) }
  );

  expect(response.headers.get("location")).toBe("https://tradepulse-estimates.com/");
  expect(response.cookies.get(ATTRIBUTION_COOKIE_NAME)).toMatchObject({
    value: "CA2609A",
    httpOnly: true,
    sameSite: "lax",
  });
});

test("repeated visits record repeated click rows, not a deduplicated count", async () => {
  const recorded: string[] = [];
  const handler = createCampaignRedirectHandler(async (code) => {
    recorded.push(code);
  });

  for (let i = 0; i < 3; i += 1) {
    await handler(requestFor("CA2609A"), { params: Promise.resolve({ code: "CA2609A" }) });
  }

  // tpe_outreach_clicks represents raw click events, so three visits must
  // produce three recorded calls -- nothing here may collapse repeats.
  expect(recorded).toEqual(["CA2609A", "CA2609A", "CA2609A"]);
});

test("a throwing click recorder does not prevent the redirect or the cookie", async () => {
  const response = await createCampaignRedirectHandler(async () => {
    throw new Error("synthetic click-write failure");
  })(requestFor("CA2609A"), { params: Promise.resolve({ code: "CA2609A" }) });

  expect(response.headers.get("location")).toBe("https://tradepulse-estimates.com/");
  expect(response.cookies.get(ATTRIBUTION_COOKIE_NAME)?.value).toBe("CA2609A");
});

test("a rejecting click recorder also does not prevent the redirect or the cookie", async () => {
  const response = await createCampaignRedirectHandler(() =>
    Promise.reject(new Error("synthetic rejection"))
  )(requestFor("CA2609A"), { params: Promise.resolve({ code: "CA2609A" }) });

  expect(response.headers.get("location")).toBe("https://tradepulse-estimates.com/");
  expect(response.cookies.get(ATTRIBUTION_COOKIE_NAME)?.value).toBe("CA2609A");
});

test("the real recordOutreachClick never throws, even when the write itself fails", async () => {
  // playwright.unit.config.ts points NEXT_PUBLIC_SUPABASE_URL and
  // SUPABASE_SERVICE_ROLE_KEY at an address nothing is listening on, so this
  // exercises a genuine write failure (connection refused), not a mock
  // standing in for one -- the same property the two tests above prove at
  // the handler level, proved here for the production recorder itself.
  await expect(recordOutreachClick("CA2609A")).resolves.toBeUndefined();
});

test("invalid campaign codes record no click, consistent with the existing no-cookie behaviour", async () => {
  const recorded: string[] = [];
  const response = await createCampaignRedirectHandler(async (code) => {
    recorded.push(code);
  })(requestFor("UNKNOWN"), { params: Promise.resolve({ code: "UNKNOWN" }) });

  // Reuses campaignCode()'s existing allowlist rather than a second
  // definition: an unrecognised code already skips the cookie, and must
  // skip the click write for the same reason -- it isn't a real campaign.
  expect(recorded).toEqual([]);
  expect(response.cookies.get(ATTRIBUTION_COOKIE_NAME)).toBeUndefined();
});

test("no route or module other than campaign-attribution.ts writes to tpe_outreach_clicks", () => {
  const offenders: string[] = [];

  function scan(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        scan(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      // The one intended writer, and the generated schema types (which
      // legitimately describe every table, written to only by the sanctioned
      // `generate_typescript_types` regeneration, never by hand).
      if (path === "lib/campaign-attribution.ts" || path === "lib/database.types.ts") continue;
      if (readFileSync(path, "utf8").includes("tpe_outreach_clicks")) offenders.push(path);
    }
  }

  scan("app");
  scan("lib");

  expect(offenders).toEqual([]);
});

test("the migration is additive: one new table, RLS enabled, no policies, no foreign key", () => {
  const migration = readFileSync(MIGRATION_PATH, "utf8");

  expect(migration).toMatch(/create table if not exists public\.tpe_outreach_clicks/);
  expect(migration).toMatch(/id\s+uuid primary key default gen_random_uuid\(\)/);
  expect(migration).toMatch(/campaign_code\s+text not null/);
  expect(migration).toMatch(/clicked_at\s+timestamptz not null default now\(\)/);
  expect(migration).toMatch(/alter table public\.tpe_outreach_clicks enable row level security/);
  expect(migration).not.toMatch(/create policy/i);
  expect(migration).not.toMatch(/references/i);
  // No change to the existing signup-attribution table or column.
  expect(migration).not.toContain("alter table public.tpe_businesses");
});

test("the migration indexes clicks for querying by campaign and date", () => {
  const migration = readFileSync(MIGRATION_PATH, "utf8");

  expect(migration).toMatch(
    /create index if not exists tpe_outreach_clicks_campaign_clicked_at_idx\s+on public\.tpe_outreach_clicks \(campaign_code, clicked_at\)/
  );
});

test("no IP address, email, name, or other unnecessary personal data column was added", () => {
  const migration = readFileSync(MIGRATION_PATH, "utf8");

  // Scoped to the table's actual column list, not the file's prose: the
  // migration's own comments explain in plain English that these fields are
  // deliberately absent, and checking the whole file for the word "email"
  // would trip on that explanation rather than on an actual column.
  const start = migration.indexOf("create table if not exists public.tpe_outreach_clicks (");
  const end = migration.indexOf(");", start);
  expect(start, "the table definition must be findable").toBeGreaterThan(-1);
  const columns = migration.slice(start, end);

  for (const forbidden of ["ip_address", "ip_addr", "user_agent", "email", "referrer", "name"]) {
    expect(
      columns,
      `the column list must not declare a "${forbidden}" field`
    ).not.toMatch(new RegExp(`^\\s*${forbidden}\\b`, "mi"));
  }
});

test("the redirect route file itself is unchanged in shape: still one delegating export", () => {
  const source = readFileSync("app/r/[code]/route.ts", "utf8");

  expect(source.trim().split("\n").length).toBeLessThanOrEqual(3);
  expect(source).toContain("export const GET = createCampaignRedirectHandler();");
});
