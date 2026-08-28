/**
 * Regression test for a real compliance risk: app/api/send-sms/route.ts sent
 * every estimate text with a bare `from: TWILIO_FROM_NUMBER`, bypassing the
 * Twilio Messaging Service entirely. The Messaging Service's Advanced
 * Opt-Out management only governs sends made through it, and the number's
 * 10DLC campaign registration is tied to the service, not to an ad-hoc
 * `from` send -- so texts sent this way sat outside both protections.
 *
 * The fix, `lib/twilio-send.ts`'s `resolveTwilioSendAddress()`, is a small
 * pure function the route spreads into its `client.messages.create()` call.
 * These tests assert on the payload the route actually builds by calling
 * that same function directly -- nothing here mocks the Twilio SDK.
 */
import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveTwilioSendAddress } from "../../lib/twilio-send";
import {
  isTwilioUnsubscribedError,
  recordSuppressionIfUnsubscribedError,
  TWILIO_UNSUBSCRIBED_ERROR_CODE,
  type SmsSuppressionStore,
} from "../../lib/sms-suppression";

function createFakeStore(): SmsSuppressionStore & { state: Map<string, boolean> } {
  const state = new Map<string, boolean>();
  return {
    state,
    async isSuppressed(phone) {
      return state.get(phone) === true;
    },
    async suppress({ phone }) {
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

test("with TWILIO_MESSAGING_SERVICE_SID set, the payload contains messagingServiceSid and no from", () => {
  const address = resolveTwilioSendAddress({
    TWILIO_MESSAGING_SERVICE_SID: "MGc054dd546b97c9ea33f4836276468516",
    TWILIO_FROM_NUMBER: "+15005550006",
  });

  expect(address).toEqual({ messagingServiceSid: "MGc054dd546b97c9ea33f4836276468516" });
  expect("from" in address).toBe(false);

  // Simulates the exact payload the route builds for client.messages.create.
  const payload = { body: "hello", to: "+13065550134", ...address };
  expect(payload).toEqual({
    body: "hello",
    to: "+13065550134",
    messagingServiceSid: "MGc054dd546b97c9ea33f4836276468516",
  });
  expect("from" in payload).toBe(false);
});

test("with TWILIO_MESSAGING_SERVICE_SID unset, the payload falls back to from and omits messagingServiceSid", () => {
  const address = resolveTwilioSendAddress({
    TWILIO_FROM_NUMBER: "+15005550006",
  });

  expect(address).toEqual({ from: "+15005550006" });
  expect("messagingServiceSid" in address).toBe(false);

  const payload = { body: "hello", to: "+13065550134", ...address };
  expect(payload).toEqual({ body: "hello", to: "+13065550134", from: "+15005550006" });
  expect("messagingServiceSid" in payload).toBe(false);
});

test("an empty-string TWILIO_MESSAGING_SERVICE_SID is treated as absent, not as a blank SID (blank-checked, not nullish-checked)", () => {
  const address = resolveTwilioSendAddress({
    TWILIO_MESSAGING_SERVICE_SID: "   ",
    TWILIO_FROM_NUMBER: "+15005550006",
  });

  expect(address).toEqual({ from: "+15005550006" });
});

test("Twilio never receives both fields at once, for any input", () => {
  for (const env of [
    { TWILIO_MESSAGING_SERVICE_SID: "MGxxxx", TWILIO_FROM_NUMBER: "+15005550006" },
    { TWILIO_MESSAGING_SERVICE_SID: "", TWILIO_FROM_NUMBER: "+15005550006" },
    { TWILIO_FROM_NUMBER: "+15005550006" },
    {},
  ]) {
    const address = resolveTwilioSendAddress(env);
    const hasSid = "messagingServiceSid" in address;
    const hasFrom = "from" in address;
    expect(hasSid && hasFrom).toBe(false);
  }
});

test("a 21610 (unsubscribed recipient) response from a send-sms send results in a suppression write", async () => {
  const store = createFakeStore();
  expect(await store.isSuppressed("+13065550134")).toBe(false);

  // Simulates send-sms/route.ts's catch block around client.messages.create.
  const twilioError = { code: TWILIO_UNSUBSCRIBED_ERROR_CODE, message: "unsubscribed recipient" };
  const optedOut = await recordSuppressionIfUnsubscribedError(store, "+13065550134", twilioError);

  expect(optedOut).toBe(true);
  expect(await store.isSuppressed("+13065550134")).toBe(true);
});

test("a non-21610 send error does not write a suppression", async () => {
  const store = createFakeStore();
  const networkError = new Error("network blip");

  const optedOut = await recordSuppressionIfUnsubscribedError(store, "+13065550134", networkError);

  expect(optedOut).toBe(false);
  expect(await store.isSuppressed("+13065550134")).toBe(false);
  expect(isTwilioUnsubscribedError(networkError)).toBe(false);
});

test("send-sms builds its Twilio payload from resolveTwilioSendAddress, not a hardcoded from field", () => {
  const source = readFileSync("app/api/send-sms/route.ts", "utf8");
  expect(source).toContain('import { resolveTwilioSendAddress } from "@/lib/twilio-send"');
  expect(source).toContain("...resolveTwilioSendAddress(process.env)");
  expect(source).not.toContain("from: process.env.TWILIO_FROM_NUMBER");
});

// Excluded on purpose: lib/twilio-send.ts is the resolver itself (never
// calls messages.create, so it wouldn't match the scan below anyway), and
// lib/notify-error.ts's `from` is a Resend email address, not a Twilio
// field (it doesn't import "twilio" either, so it wouldn't match -- listed
// explicitly anyway, matching the exact exclusion this task named).
const EXCLUDED_FROM_SCAN = new Set(["lib/twilio-send.ts", "lib/notify-error.ts"]);

/** Recursively lists every .ts/.tsx file under `dir`, repo-relative, forward
 * slashes, skipping node_modules and dotfolders. */
function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name).split("\\").join("/");
    if (entry.isDirectory()) {
      listTsFiles(full, out);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

test("no route in the repo constructs a Twilio send payload with a hardcoded from field outside lib/twilio-send.ts", () => {
  // A "Twilio sender" is any file that both imports the twilio SDK and calls
  // .messages.create( -- the import check is what keeps this from false-
  // positiving on unrelated .messages.create( calls (the Anthropic SDK uses
  // the exact same method name in app/api/analyze-photo/route.ts and
  // app/api/estimates/[id]/analyze-photos/route.ts).
  const candidates = [...listTsFiles("app"), ...listTsFiles("lib")].filter(
    (path) => !EXCLUDED_FROM_SCAN.has(path)
  );
  const twilioSenders = candidates.filter((path) => {
    const source = readFileSync(path, "utf8");
    return /from ["']twilio["']/.test(source) && source.includes("messages.create(");
  });

  // Sanity check on the scan itself: if this ever comes back empty or
  // missing a known sender, every assertion below passes vacuously and this
  // test stops meaning anything. Fail loudly instead.
  expect(twilioSenders.sort()).toEqual(
    [
      "app/api/cron/payment-reminders/route.ts",
      "app/api/estimates/[id]/review-request/route.ts",
      "app/api/estimates/[id]/send-reminder/route.ts",
      "app/api/send-sms/route.ts",
    ].sort()
  );

  for (const path of twilioSenders) {
    const source = readFileSync(path, "utf8");
    expect(source, `${path} must not hardcode a from field on a Twilio send`).not.toMatch(
      /from:\s*process\.env\.TWILIO_FROM_NUMBER/
    );
    expect(source, `${path} must resolve its Twilio send address via resolveTwilioSendAddress`).toContain(
      "...resolveTwilioSendAddress(process.env)"
    );
  }
});
