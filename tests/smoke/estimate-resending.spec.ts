import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

test("the send action keeps first-send and resend wording", () => {
  const actions = read("app/components/estimate-actions.tsx");
  const sheet = read("app/components/send-estimate-sheet.tsx");
  expect(actions).toContain('localStatus === "sent"');
  expect(actions).toContain("Resend Estimate");
  expect(actions).toContain("Send Estimate");
  expect(sheet).toContain('currentStatus === "sent"');
  expect(sheet).toContain("Resend Estimate");
});

test("email and SMS allow a new claim after a successful prior send", () => {
  for (const relativePath of ["app/api/send-email/route.ts", "app/api/send-sms/route.ts"]) {
    const source = read(relativePath);
    expect(source).toContain("sent_at");
    expect(source).toContain("resend-${estimate.sent_at}");
    expect(source).not.toContain("already sent by");
  }
});

test("send timestamps update only after provider success and recipient guards remain", () => {
  const email = read("app/api/send-email/route.ts");
  const sms = read("app/api/send-sms/route.ts");
  const sheet = read("app/components/send-estimate-sheet.tsx");
  expect(email).toContain("Email address is required");
  expect(email).toContain("Use the customer email saved on this estimate");
  expect(sms).toContain("Phone number is required");
  expect(sms).not.toContain("Use the customer phone saved on this estimate");
  expect(sms).toContain("let formattedPhone = suppliedPhone;");
  expect(sheet).toContain('useState(formatPhoneInput(customerPhone ?? ""))');
  expect(sms).toContain("const phoneUpdate = !estimate.customer_phone ?");

  for (const [source, providerCall] of [[email, "resend.emails.send"], [sms, "messages.create"]] as const) {
    const providerIndex = source.indexOf(providerCall);
    const timestampIndex = source.indexOf("sent_at: new Date().toISOString()", providerIndex);
    expect(providerIndex).toBeGreaterThanOrEqual(0);
    expect(timestampIndex).toBeGreaterThan(providerIndex);
  }
});
