import { expect, test } from "@playwright/test";
import twilio from "twilio";
import {
  createTwilioInboundWebhookHandler,
  classifyOptOut,
  type TwilioInboundDependencies,
} from "../../lib/twilio-inbound-webhook";
import type { SmsSuppressionStore } from "../../lib/sms-suppression";

const AUTH_TOKEN = "unit_test_auth_token_only";
const WEBHOOK_URL = "https://tradepulse-estimates.com/api/webhooks/twilio-inbound";

// In-memory fake standing in for the Supabase-backed store, matching how
// stripe-webhook.spec.ts fakes StripeWebhookStore. No network, no real DB.
function createFakeStore(): SmsSuppressionStore & {
  suppressCalls: number;
  unsuppressCalls: number;
  state: Map<string, boolean>;
} {
  const state = new Map<string, boolean>();
  return {
    state,
    suppressCalls: 0,
    unsuppressCalls: 0,
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
      this.unsuppressCalls++;
      const wasSuppressed = state.get(phone) === true;
      if (wasSuppressed) state.set(phone, false);
      return { newlyUnsuppressed: wasSuppressed };
    },
  };
}

function signedRequest(params: Record<string, string>, authToken = AUTH_TOKEN): Request {
  const body = new URLSearchParams(params).toString();
  const signature = twilio.getExpectedTwilioSignature(authToken, WEBHOOK_URL, params);
  return new Request(WEBHOOK_URL, {
    method: "POST",
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
  });
}

function makeDependencies(store: SmsSuppressionStore): TwilioInboundDependencies {
  return {
    validateSignature: twilio.validateRequest,
    getAuthToken: () => AUTH_TOKEN,
    getWebhookUrls: () => [WEBHOOK_URL],
    store,
  };
}

test("classifyOptOut recognizes OptOutType and falls back to keyword matching", () => {
  expect(classifyOptOut({ OptOutType: "STOP" })).toBe("STOP");
  expect(classifyOptOut({ OptOutType: "START" })).toBe("START");
  expect(classifyOptOut({ OptOutType: "HELP" })).toBe("HELP");
  expect(classifyOptOut({ Body: "stop" })).toBe("STOP");
  expect(classifyOptOut({ Body: "  Unsubscribe  " })).toBe("STOP");
  expect(classifyOptOut({ Body: "Start" })).toBe("START");
  expect(classifyOptOut({ Body: "Thanks for the quote!" })).toBeNull();
  expect(classifyOptOut({})).toBeNull();
});

test("a valid STOP webhook suppresses the recipient", async () => {
  const store = createFakeStore();
  const handler = createTwilioInboundWebhookHandler(makeDependencies(store));

  const response = await handler(
    signedRequest({ From: "+13065550134", OptOutType: "STOP", MessageSid: "SM_stop_1" })
  );

  expect(response.status).toBe(200);
  expect(await store.isSuppressed("+13065550134")).toBe(true);
  expect(store.suppressCalls).toBe(1);
});

test("a duplicate STOP webhook is idempotent and does not duplicate the notification signal", async () => {
  const store = createFakeStore();
  const handler = createTwilioInboundWebhookHandler(makeDependencies(store));

  await handler(signedRequest({ From: "+13065550134", OptOutType: "STOP", MessageSid: "SM_stop_1" }));
  // Twilio redelivering the same webhook (network retry, etc).
  await handler(signedRequest({ From: "+13065550134", OptOutType: "STOP", MessageSid: "SM_stop_1" }));

  expect(await store.isSuppressed("+13065550134")).toBe(true);
  expect(store.suppressCalls).toBe(2);

  // The store itself reports whether each call actually changed state --
  // this is what a future one-time contractor notification would gate on.
  const first = await store.suppress({ phone: "+15005550006", messageSid: null });
  const second = await store.suppress({ phone: "+15005550006", messageSid: null });
  expect(first.newlySuppressed).toBe(true);
  expect(second.newlySuppressed).toBe(false);
});

test("START restores SMS eligibility after a prior STOP", async () => {
  const store = createFakeStore();
  const handler = createTwilioInboundWebhookHandler(makeDependencies(store));

  await handler(signedRequest({ From: "+13065550134", OptOutType: "STOP", MessageSid: "SM_stop_1" }));
  expect(await store.isSuppressed("+13065550134")).toBe(true);

  const response = await handler(
    signedRequest({ From: "+13065550134", OptOutType: "START", MessageSid: "SM_start_1" })
  );

  expect(response.status).toBe(200);
  expect(await store.isSuppressed("+13065550134")).toBe(false);
  expect(store.unsuppressCalls).toBe(1);
});

test("an invalid Twilio signature is rejected before any state change", async () => {
  const store = createFakeStore();
  const handler = createTwilioInboundWebhookHandler(makeDependencies(store));

  const response = await handler(
    new Request(WEBHOOK_URL, {
      method: "POST",
      body: new URLSearchParams({ From: "+13065550134", OptOutType: "STOP" }).toString(),
      headers: { "x-twilio-signature": "not-a-real-signature" },
    })
  );

  expect(response.status).toBe(403);
  expect(await store.isSuppressed("+13065550134")).toBe(false);
  expect(store.suppressCalls).toBe(0);
});

test("a missing signature header is rejected", async () => {
  const store = createFakeStore();
  const handler = createTwilioInboundWebhookHandler(makeDependencies(store));

  const response = await handler(
    new Request(WEBHOOK_URL, {
      method: "POST",
      body: new URLSearchParams({ From: "+13065550134", OptOutType: "STOP" }).toString(),
    })
  );

  expect(response.status).toBe(400);
  expect(store.suppressCalls).toBe(0);
});

test("unrelated inbound text does not alter suppression", async () => {
  const store = createFakeStore();
  const handler = createTwilioInboundWebhookHandler(makeDependencies(store));

  const response = await handler(
    signedRequest({ From: "+13065550134", Body: "Thanks, see you Tuesday!", MessageSid: "SM_normal_1" })
  );

  expect(response.status).toBe(200);
  expect(await store.isSuppressed("+13065550134")).toBe(false);
  expect(store.suppressCalls).toBe(0);
  expect(store.unsuppressCalls).toBe(0);
});

test("STOP for a phone TradePulse has never seen is handled safely", async () => {
  const store = createFakeStore();
  const handler = createTwilioInboundWebhookHandler(makeDependencies(store));

  const response = await handler(
    signedRequest({ From: "+19995550111", OptOutType: "STOP", MessageSid: "SM_unknown_1" })
  );

  expect(response.status).toBe(200);
  expect(await store.isSuppressed("+19995550111")).toBe(true);
});

test("suppressing one phone leaves another phone unaffected", async () => {
  const store = createFakeStore();
  const handler = createTwilioInboundWebhookHandler(makeDependencies(store));

  await handler(signedRequest({ From: "+13065550134", OptOutType: "STOP", MessageSid: "SM_a" }));

  expect(await store.isSuppressed("+13065550134")).toBe(true);
  expect(await store.isSuppressed("+14165550199")).toBe(false);
});

test("HELP is a recognized no-op: it neither suppresses nor unsuppresses", async () => {
  const store = createFakeStore();
  const handler = createTwilioInboundWebhookHandler(makeDependencies(store));

  const response = await handler(
    signedRequest({ From: "+13065550134", OptOutType: "HELP", MessageSid: "SM_help_1" })
  );

  expect(response.status).toBe(200);
  expect(store.suppressCalls).toBe(0);
  expect(store.unsuppressCalls).toBe(0);
});
