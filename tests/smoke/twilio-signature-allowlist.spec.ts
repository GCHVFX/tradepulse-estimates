/**
 * Regression test for a real production risk: the Twilio inbound webhook
 * validated its signature against a single URL rebuilt from SITE_URL.
 * SITE_URL is env-driven (NEXT_PUBLIC_APP_URL, then the Vercel deployment
 * URL, then localhost, then the canonical host) and does not have to agree
 * with whatever host the Twilio Console webhook is actually configured to
 * POST to. The moment they disagreed, every inbound STOP/START/HELP failed
 * signature validation with a clean 403 -- nothing surfaces in logs or
 * Sentry, so the failure is silent from the operator's side too.
 *
 * The fix makes validation host-tolerant: it tries the signature against
 * every host in lib/site-url.ts's TWILIO_SIGNATURE_HOSTS (a fixed,
 * code-owned allow-list), succeeding if any one matches. These tests use
 * the real `TWILIO_SIGNATURE_HOSTS` constant and the real `twilio` SDK
 * (`validateRequest` / `getExpectedTwilioSignature`) throughout -- nothing
 * here is mocked, so a passing test proves the actual production allow-list
 * and the actual production handler logic, not a stand-in for either.
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import twilio from "twilio";
import { createTwilioInboundWebhookHandler, type TwilioInboundDependencies } from "../../lib/twilio-inbound-webhook";
import { TWILIO_SIGNATURE_HOSTS } from "../../lib/site-url";
import type { SmsSuppressionStore } from "../../lib/sms-suppression";

const AUTH_TOKEN = "unit_test_auth_token_only";
const WEBHOOK_PATH = "/api/webhooks/twilio-inbound";

function webhookUrlForHost(host: string): string {
  return `https://${host}${WEBHOOK_PATH}`;
}

function createFakeStore(): SmsSuppressionStore & { suppressCalls: number } {
  const state = new Map<string, boolean>();
  return {
    suppressCalls: 0,
    async isSuppressed(phone) {
      return state.get(phone) === true;
    },
    async suppress({ phone }) {
      this.suppressCalls++;
      const wasSuppressed = state.get(phone) === true;
      state.set(phone, true);
      return { newlySuppressed: !wasSuppressed };
    },
    async unsuppress({ phone }) {
      const wasSuppressed = state.get(phone) === true;
      if (wasSuppressed) state.set(phone, false);
      return { newlyUnsuppressed: wasSuppressed };
    },
  };
}

// Mirrors exactly how app/api/webhooks/twilio-inbound/route.ts wires
// getWebhookUrls from the real allow-list -- the thing under test.
function makeDependencies(store: SmsSuppressionStore): TwilioInboundDependencies {
  return {
    validateSignature: twilio.validateRequest,
    getAuthToken: () => AUTH_TOKEN,
    getWebhookUrls: () => TWILIO_SIGNATURE_HOSTS.map(webhookUrlForHost),
    store,
  };
}

function signedRequestForHost(host: string, params: Record<string, string>): Request {
  const url = webhookUrlForHost(host);
  const body = new URLSearchParams(params).toString();
  const signature = twilio.getExpectedTwilioSignature(AUTH_TOKEN, url, params);
  return new Request(url, {
    method: "POST",
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
  });
}

test("the allow-list contains every alias domain plus the project's vercel.app host, nothing else", () => {
  expect(TWILIO_SIGNATURE_HOSTS).toEqual([
    "tradepulse-estimates.com",
    "www.tradepulse-estimates.com",
    "tradepulseestimates.com",
    "www.tradepulseestimates.com",
    "trytradepulse.com",
    "www.trytradepulse.com",
    "tradepulse-estimates.vercel.app",
  ]);
});

test("a signature computed for an alias host (not the primary canonical one) validates successfully", async () => {
  const store = createFakeStore();
  const handler = createTwilioInboundWebhookHandler(makeDependencies(store));

  // www.tradepulseestimates.com is a real allow-listed alias, but not the
  // primary apex host most other tests exercise -- proves tolerance across
  // the list, not just a hardcoded first entry.
  const response = await handler(
    signedRequestForHost("www.tradepulseestimates.com", {
      From: "+13065550134",
      OptOutType: "STOP",
      MessageSid: "SM_alias_host_1",
    })
  );

  expect(response.status).toBe(200);
  expect(await store.isSuppressed("+13065550134")).toBe(true);
  expect(store.suppressCalls).toBe(1);
});

test("the project's vercel.app host also validates successfully", async () => {
  const store = createFakeStore();
  const handler = createTwilioInboundWebhookHandler(makeDependencies(store));

  const response = await handler(
    signedRequestForHost("tradepulse-estimates.vercel.app", {
      From: "+13065550134",
      OptOutType: "STOP",
      MessageSid: "SM_vercel_host_1",
    })
  );

  expect(response.status).toBe(200);
  expect(await store.isSuppressed("+13065550134")).toBe(true);
});

test("a signature computed for a host NOT on the allow-list is rejected", async () => {
  const store = createFakeStore();
  const handler = createTwilioInboundWebhookHandler(makeDependencies(store));

  // A real, correctly-computed Twilio signature -- just for a host that
  // isn't in TWILIO_SIGNATURE_HOSTS. A branch preview URL is a realistic
  // example: it is a genuine *.vercel.app URL, but not the one stable
  // project host on the allow-list.
  const response = await handler(
    signedRequestForHost("tradepulse-estimates-git-some-branch.vercel.app", {
      From: "+13065550134",
      OptOutType: "STOP",
      MessageSid: "SM_untrusted_host_1",
    })
  );

  expect(response.status).toBe(403);
  expect(await store.isSuppressed("+13065550134")).toBe(false);
  expect(store.suppressCalls).toBe(0);
});

test("an attacker-supplied host cannot be smuggled in: no allow-listed host means rejection regardless of what the request claims", async () => {
  const store = createFakeStore();
  const handler = createTwilioInboundWebhookHandler(makeDependencies(store));

  const response = await handler(
    signedRequestForHost("evil.example.com", {
      From: "+13065550134",
      OptOutType: "STOP",
      MessageSid: "SM_attacker_1",
    })
  );

  expect(response.status).toBe(403);
  expect(store.suppressCalls).toBe(0);
});

test("the route never reconstructs the webhook host from a client-supplied header", () => {
  const routeSource = readFileSync("app/api/webhooks/twilio-inbound/route.ts", "utf8");
  const libSource = readFileSync("lib/twilio-inbound-webhook.ts", "utf8");
  for (const source of [routeSource, libSource]) {
    expect(source.toLowerCase()).not.toContain("x-forwarded-host");
    expect(source).not.toContain("request.headers.get(\"host\")");
    expect(source).not.toContain("request.url");
  }
});

/** Source with comments removed, matching share-link-canonical-host.spec.ts. */
function codeOnly(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
}

test("the route derives its candidate hosts from the single TWILIO_SIGNATURE_HOSTS export, not scattered literals", () => {
  const source = codeOnly("app/api/webhooks/twilio-inbound/route.ts");
  expect(source).toContain('import { TWILIO_SIGNATURE_HOSTS } from "@/lib/site-url"');
  expect(source).toContain("TWILIO_SIGNATURE_HOSTS.map(");
  // Code, not comments: SITE_URL (the old, non-host-tolerant single-URL
  // value) must not appear as an actual import or reference any more.
  expect(source).not.toContain("SITE_URL");
});
