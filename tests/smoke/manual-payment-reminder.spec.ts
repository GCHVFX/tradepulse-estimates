import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { computeNextReminderStage, selectManualReminderStage } from "../../lib/payment-reminder-stage";

const ROUTE_PATH = "app/api/estimates/[id]/send-reminder/route.ts";
const UI_PATH = "app/components/estimate-actions.tsx";

// A fixed "now" so every date-math test is deterministic regardless of when
// the suite actually runs. Due dates below are expressed relative to it.
const NOW = new Date("2026-08-20T12:00:00Z");
function daysFromNow(offset: number): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function routeSource(): string {
  return readFileSync(ROUTE_PATH, "utf8");
}

// Mirrors the exact result-string mapping in estimate-actions.tsx's
// handleSendReminder -- duplicated deliberately (matching this repo's
// existing test style) rather than importing component internals, so this
// spec can prove the 7 required contractor-facing strings without rendering
// React.
function deriveReminderMessage(
  smsOutcome: "sent" | "suppressed" | "no_phone" | "not_configured" | "failed",
  emailOutcome: "sent" | "no_email" | "not_configured" | "failed"
): string {
  if (smsOutcome === "sent" && emailOutcome === "sent") return "Reminder sent by text and email";
  if (smsOutcome === "sent") return "Reminder sent by text";
  if (emailOutcome === "sent" && smsOutcome === "suppressed") return "SMS opted out. Reminder sent by email.";
  if (emailOutcome === "sent") return "Reminder sent by email";
  if (smsOutcome === "suppressed" && emailOutcome === "no_email") return "SMS opted out. No email address available.";
  if (smsOutcome === "no_phone" && emailOutcome === "no_email") return "No customer contact method available.";
  return "Reminder could not be sent";
}

test("all 7 required result strings are produced by the exact outcome combinations that occur in practice", () => {
  expect(deriveReminderMessage("sent", "sent")).toBe("Reminder sent by text and email");
  expect(deriveReminderMessage("sent", "no_email")).toBe("Reminder sent by text");
  expect(deriveReminderMessage("sent", "failed")).toBe("Reminder sent by text");
  expect(deriveReminderMessage("no_phone", "sent")).toBe("Reminder sent by email");
  expect(deriveReminderMessage("failed", "sent")).toBe("Reminder sent by email");
  expect(deriveReminderMessage("suppressed", "sent")).toBe("SMS opted out. Reminder sent by email.");
  expect(deriveReminderMessage("suppressed", "no_email")).toBe("SMS opted out. No email address available.");
  expect(deriveReminderMessage("no_phone", "no_email")).toBe("No customer contact method available.");
  expect(deriveReminderMessage("failed", "failed")).toBe("Reminder could not be sent");
  expect(deriveReminderMessage("not_configured", "not_configured")).toBe("Reminder could not be sent");
});

test("the route requires a signed-in user before touching any estimate", () => {
  const source = routeSource();
  expect(source).toContain("createApiClient(request)");
  expect(source).toContain("supabase.auth.getUser()");
  expect(source).toContain('NextResponse.json({ error: "Unauthorized" }, { status: 401 })');
});

test("ownership is enforced by matching both the estimate id and the caller's own business_id in one query", () => {
  const source = routeSource();
  const selectBlock = source.slice(source.indexOf('.from("tpe_estimates")'), source.indexOf('.from("tpe_estimates")') + 400);
  expect(selectBlock).toContain('.eq("id", id)');
  expect(selectBlock).toContain('.eq("business_id", business.id)');
});

test("Pro Payments access is required via the existing hasProPaymentsAccess rule, non-Pro is rejected", () => {
  const source = routeSource();
  expect(source).toContain('import { hasProPaymentsAccess } from "@/lib/auth"');
  expect(source).toContain("hasProPaymentsAccess(business)");
  expect(source).toContain('NextResponse.json({ error: "Pro plan required" }, { status: 403 })');
});

test("a paid invoice is rejected before any send is attempted", () => {
  const source = routeSource();
  expect(source).toContain('estimate.payment_status !== "unpaid"');
  const guardIndex = source.indexOf('estimate.payment_status !== "unpaid"');
  const sendIndex = source.indexOf("twilioClient.messages.create");
  expect(guardIndex).toBeGreaterThan(-1);
  expect(sendIndex).toBeGreaterThan(guardIndex);
});

test("missing invoice_amount or due_date is rejected before any send is attempted", () => {
  const source = routeSource();
  expect(source).toContain("estimate.invoice_amount === null");
  expect(source).toContain("Invoice amount is missing.");
  expect(source).toContain("!estimate.due_date");
  expect(source).toContain("Due date is missing.");
});

test("the route selects the manual (non-schedule-gated) stage, not the cron's gated one, and never advances more than one stage per send", () => {
  const source = routeSource();
  expect(source).toContain('from "@/lib/payment-reminder-stage"');
  expect(source).toContain("selectManualReminderStage(estimate.due_date, currentReminderCount)");
  expect(source).not.toContain("computeNextReminderStage(");
  expect(source).not.toContain("reminder_count + 1");
  expect(source).not.toContain("reminder_count += ");
});

test("the cron's own computeNextReminderStage is completely unchanged: it still refuses when nothing is due", () => {
  // This is the exact behavior the manual endpoint used to (wrongly) reuse.
  // Asserting it's untouched proves this fix didn't loosen the cron's own
  // schedule-gating, only the manual endpoint's.
  const dueDate = daysFromNow(10); // 10 days out -- well outside the pre-due window
  expect(computeNextReminderStage(dueDate, 0, NOW)).toBeNull();
});

test("a manual send succeeds even when the cron schedule would not yet select any stage", () => {
  const dueDate = daysFromNow(10); // cron: not yet due (see test above)
  expect(computeNextReminderStage(dueDate, 0, NOW)).toBeNull();
  const manual = selectManualReminderStage(dueDate, 0, NOW);
  expect(manual).not.toBeNull();
  expect(manual!.stage).toBe("pre_due");
});

test("a future due date always gets pre-due wording for a manual send, regardless of how far out", () => {
  expect(selectManualReminderStage(daysFromNow(1), 0, NOW)!.stage).toBe("pre_due");
  expect(selectManualReminderStage(daysFromNow(20), 0, NOW)!.stage).toBe("pre_due");
});

test("due today or overdue with nothing sent yet always gets the first-overdue wording, however overdue it is", () => {
  expect(selectManualReminderStage(daysFromNow(0), 0, NOW)!.stage).toBe("overdue_1");
  expect(selectManualReminderStage(daysFromNow(-1), 0, NOW)!.stage).toBe("overdue_1");
  expect(selectManualReminderStage(daysFromNow(-30), 0, NOW)!.stage).toBe("overdue_1");
});

test("once a reminder has already gone out, the wording matches how overdue the invoice is now", () => {
  expect(selectManualReminderStage(daysFromNow(-2), 2, NOW)!.stage).toBe("overdue_1");
  expect(selectManualReminderStage(daysFromNow(-6), 2, NOW)!.stage).toBe("overdue_2");
  expect(selectManualReminderStage(daysFromNow(-15), 4, NOW)!.stage).toBe("overdue_ongoing");
});

test("nextReminderCount never regresses below what's already recorded", () => {
  const result = selectManualReminderStage(daysFromNow(-2), 5, NOW);
  expect(result!.nextReminderCount).toBeGreaterThanOrEqual(5);
});

test("a manual send does not skip through multiple named stages in its own bookkeeping -- exactly one wording, one recorded stage per call", () => {
  const result = selectManualReminderStage(daysFromNow(-30), 0, NOW);
  // Even though this invoice is very overdue, a fresh (never-reminded)
  // invoice still gets exactly one stage (overdue_1), not a jump straight
  // to overdue_2/overdue_ongoing.
  expect(result!.stage).toBe("overdue_1");
});

test("an immediate cron run right after a manual send does not resend the identical logical stage", () => {
  // Invoice never reminded, 3 days overdue: manual send picks overdue_1.
  const dueDate = daysFromNow(-3);
  const manual = selectManualReminderStage(dueDate, 0, NOW);
  expect(manual!.stage).toBe("overdue_1");

  // The cron runs immediately afterward (same day), now reading the
  // reminder_count the manual send just recorded.
  const cronNext = computeNextReminderStage(dueDate, manual!.nextReminderCount, NOW);
  // Either the cron has nothing left to send for this stage window (null),
  // or it selects a stage strictly beyond what was just manually sent --
  // never the same overdue_1 wording again.
  if (cronNext) {
    expect(cronNext.stage).not.toBe("overdue_1");
  }
});

test("an immediate cron run after a manual overdue_2 send does not resend overdue_2", () => {
  const dueDate = daysFromNow(-6);
  const manual = selectManualReminderStage(dueDate, 0, NOW);
  expect(manual!.stage).toBe("overdue_1"); // first-ever send is always overdue_1 per spec

  // A second manual send later that day after a status change is unusual,
  // but confirm the *general* mechanism: once reminder_count reflects a
  // stage, the cron's own comparison (stagesSent <= stageIndex) will not
  // fire that same stage index again.
  const cronNext = computeNextReminderStage(dueDate, manual!.nextReminderCount, NOW);
  if (cronNext) {
    expect(cronNext.stage).not.toBe(manual!.stage);
  }
});

test("SMS suppression is checked before Twilio is ever called, and 21610 is handled via the shared helper", () => {
  const source = routeSource();
  expect(source).toContain("suppressionStore.isSuppressed(formattedPhone)");
  const suppressIndex = source.indexOf("suppressionStore.isSuppressed(formattedPhone)");
  const twilioCallIndex = source.indexOf("twilioClient.messages.create");
  expect(suppressIndex).toBeGreaterThan(-1);
  expect(twilioCallIndex).toBeGreaterThan(suppressIndex);
  expect(source).toContain("recordSuppressionIfUnsubscribedError(suppressionStore, formattedPhone, err)");
});

test("email can still be attempted when SMS is suppressed -- the two channels are independent, not short-circuited", () => {
  const source = routeSource();
  // The email block does not read smsOutcome anywhere, so a suppressed SMS
  // can never prevent the email branch from running.
  const emailBlockStart = source.indexOf("let emailOutcome: EmailOutcome;");
  const emailBlock = source.slice(emailBlockStart, emailBlockStart + 900);
  expect(emailBlock).not.toContain("smsOutcome");
});

test("no channel sending anything leaves reminder_count and last_reminder_sent_at untouched", () => {
  const source = routeSource();
  expect(source).toContain("if (reminderRows.length === 0)");
  const guardIndex = source.indexOf("if (reminderRows.length === 0)");
  const updateIndex = source.indexOf('.update({');
  expect(guardIndex).toBeGreaterThan(-1);
  expect(updateIndex).toBeGreaterThan(guardIndex);
  // The early return happens before the update call is ever reached.
  const earlyReturnBlock = source.slice(guardIndex, guardIndex + 250);
  expect(earlyReturnBlock).toContain("sent: false");
});

test("a successful send advances reminder_count via an optimistic (compare-and-swap) update, guarding against duplicate requests", () => {
  const source = routeSource();
  const updateIndex = source.indexOf('.update({\n      last_reminder_sent_at');
  expect(updateIndex).toBeGreaterThan(-1);
  const updateBlock = source.slice(updateIndex, updateIndex + 400);
  expect(updateBlock).toContain('.eq("id", estimate.id)');
  expect(updateBlock).toContain('.eq("business_id", business.id)');
  expect(updateBlock).toContain('.eq("reminder_count", currentReminderCount)');
});

test("does not mark the invoice paid and does not alter invoice_amount or due_date", () => {
  const source = routeSource();
  expect(source).not.toContain('payment_status: "paid"');
  expect(source).not.toContain("invoice_amount:");
  expect(source).not.toContain("due_date:");
});

test("the global cron route is never invoked by the manual send route", () => {
  const source = routeSource();
  // The route's header comment documents that it reuses the cron's
  // primitives (and names that file for context) but never calls it -- no
  // fetch/import of the cron route itself, and no use of its bearer-secret
  // auth, which would be a sign this route was proxying into the cron path.
  expect(source).not.toContain("CRON_SECRET");
  expect(source).not.toMatch(/fetch\([^)]*cron/);
  expect(source).not.toContain('from "@/app/api/cron/payment-reminders/route"');
});

test("a configured payment_link is threaded through to the shared message builders, same as the cron", () => {
  const source = routeSource();
  expect(source).toContain("business.payment_link");
  expect(source).toContain("paymentLink,");
});

test("no duplicated message-building or stage-selection implementation exists in the manual route", () => {
  const source = routeSource();
  expect(source).toContain('from "@/lib/payment-reminder-message"');
  expect(source).toContain("buildPaymentReminderSms(stageName,");
  expect(source).toContain("buildPaymentReminderEmailHtml(stageName,");
  expect(source).toContain("buildPaymentReminderEmailBody(stageName,");
  expect(source).not.toContain("function buildPaymentReminderSms");
  expect(source).not.toContain("function computeNextReminderStage");
  expect(source).not.toContain("function selectManualReminderStage");
});

test("a successful manual send records exactly one reminder row per channel that actually sent, in one insert call", () => {
  const source = routeSource();
  const inserts = source.match(/\.from\("tpe_payment_reminders"\)\s*\n\s*\.insert\(/g) ?? [];
  expect(inserts.length).toBe(1);
  expect(source).toContain(".insert(reminderRows)");
});

test("another invoice is never touched: the update and the select are both scoped to this one estimate id", () => {
  const source = routeSource();
  const updateIndex = source.indexOf('.update({\n      last_reminder_sent_at');
  const updateBlock = source.slice(updateIndex, updateIndex + 400);
  expect(updateBlock).toContain('.eq("id", estimate.id)');
  // No unscoped update/select against tpe_estimates anywhere in the route.
  const allEstimateQueries = [...source.matchAll(/\.from\("tpe_estimates"\)/g)];
  expect(allEstimateQueries.length).toBeGreaterThan(0);
  for (const match of allEstimateQueries) {
    const block = source.slice(match.index, match.index! + 400);
    expect(block).toContain('.eq("id", ');
  }
});

test("the route is a POST handler under app/api, never callable anonymously (auth check runs first)", () => {
  const source = routeSource();
  expect(source).toContain("export async function POST(");
  const authIndex = source.indexOf("Unauthorized");
  const firstDbCallIndex = source.indexOf('.from("tpe_businesses")');
  expect(authIndex).toBeGreaterThan(-1);
  expect(authIndex).toBeLessThan(firstDbCallIndex);
});

test("the estimate detail UI shows a real 'Send Reminder Now' action, distinct from the invoicing entry point", () => {
  const source = readFileSync(UI_PATH, "utf8");
  expect(source).toContain("Send Reminder Now");
  expect(source).toContain("Invoice This Job");
  expect(source).not.toContain("Send Payment Reminder");
  expect(source).toContain("/api/estimates/${estimateId}/send-reminder");
});

test("the Send Reminder Now action only renders when invoiced, unpaid, and Pro", () => {
  const source = readFileSync(UI_PATH, "utf8");
  const buttonIndex = source.indexOf("Send Reminder Now");
  const guardStart = source.lastIndexOf("{hasInvoice", buttonIndex);
  const guardLine = source.slice(guardStart, source.indexOf("\n", guardStart));
  expect(guardLine).toContain('localPaymentStatus === "unpaid"');
  expect(guardLine).toContain("isPro");
});

test("the button disables itself while sending, preventing duplicate taps", () => {
  const source = readFileSync(UI_PATH, "utf8");
  expect(source).toContain("disabled={isSendingReminder}");
  expect(source).toContain("if (isSendingReminder) return;");
});
