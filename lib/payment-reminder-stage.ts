import type { PaymentReminderStage } from "@/lib/payment-reminder-message";

// Offsets are days relative to the due date. A stage is eligible once
// today >= due_date + offsetDays. reminder_count tracks how many stages
// have been sent, so each stage fires at most once per invoice.
export const REMINDER_STAGES: ReadonlyArray<{ name: PaymentReminderStage; offsetDays: number }> = [
  { name: "pre_due", offsetDays: -2 },
  { name: "overdue_1", offsetDays: 1 },
  { name: "overdue_2", offsetDays: 5 },
];

// After the named stages, keep reminding weekly until paid. The first
// ongoing reminder fires at due_date + ONGOING_START_DAYS, then every
// ONGOING_INTERVAL_DAYS after that.
export const REMINDER_ONGOING_START_DAYS = 14;
export const REMINDER_ONGOING_INTERVAL_DAYS = 7;

export interface NextReminderStage {
  stage: PaymentReminderStage;
  nextReminderCount: number;
  daysFromDue: number;
}

/**
 * The same eligibility algorithm the daily payment-reminders cron uses,
 * extracted so a manual "Send reminder now" trigger computes the identical
 * answer for the identical invoice state -- never a different stage, never
 * an artificial jump ahead. Returns null when no stage is currently due
 * (e.g. the due date is still more than 2 days away).
 */
export function computeNextReminderStage(
  dueDateIso: string,
  reminderCount: number,
  now: Date = new Date()
): NextReminderStage | null {
  const [year, month, day] = dueDateIso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;

  const dueUtc = Date.UTC(year, month - 1, day);
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysFromDue = Math.floor((todayUtc - dueUtc) / msPerDay);

  const stagesSent = reminderCount ?? 0;

  if (stagesSent < REMINDER_STAGES.length) {
    let stageIndex = -1;
    for (let i = 0; i < REMINDER_STAGES.length; i++) {
      if (daysFromDue >= REMINDER_STAGES[i].offsetDays) stageIndex = i;
    }
    if (stageIndex >= 0 && stagesSent <= stageIndex) {
      return { stage: REMINDER_STAGES[stageIndex].name, nextReminderCount: stageIndex + 1, daysFromDue };
    }
    return null;
  }

  const weeklySent = stagesSent - REMINDER_STAGES.length;
  if (daysFromDue >= REMINDER_ONGOING_START_DAYS + REMINDER_ONGOING_INTERVAL_DAYS * weeklySent) {
    return { stage: "overdue_ongoing", nextReminderCount: stagesSent + 1, daysFromDue };
  }
  return null;
}

export interface ManualReminderStage {
  stage: PaymentReminderStage;
  nextReminderCount: number;
  daysFromDue: number;
}

/**
 * Chooses the reminder wording for an on-demand "Send Reminder Now" manual
 * send. Unlike computeNextReminderStage() (used only by the cron), this
 * never refuses because the automatic schedule wouldn't yet pick a stage --
 * a manual send always sends something, using whichever existing wording
 * actually matches the invoice's current relationship to its due date:
 *
 *  - due date in the future -> pre_due, regardless of how far out (the cron
 *    only offers pre_due inside its 2-day pre-due window; a manual send is
 *    not bound by that window)
 *  - due today or overdue, nothing sent yet -> overdue_1 (first overdue),
 *    regardless of how overdue it already is
 *  - due today or overdue, something already sent -> whichever of
 *    overdue_1 / overdue_2 / overdue_ongoing best matches how overdue the
 *    invoice is now, using the same day thresholds the cron uses
 *
 * nextReminderCount is set to the same value the cron's own indexing would
 * assign for having reached that stage (stage index + 1, or the ongoing
 * weekly count) and never regresses below what's already recorded. That
 * means a cron run immediately afterward sees this stage as already
 * covered and will not resend the identical wording -- this mirrors, not
 * duplicates, the indexing computeNextReminderStage() already uses.
 */
export function selectManualReminderStage(
  dueDateIso: string,
  reminderCount: number,
  now: Date = new Date()
): ManualReminderStage | null {
  const [year, month, day] = dueDateIso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;

  const dueUtc = Date.UTC(year, month - 1, day);
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysFromDue = Math.floor((todayUtc - dueUtc) / msPerDay);

  const stagesSent = reminderCount ?? 0;

  if (daysFromDue < 0) {
    return { stage: "pre_due", nextReminderCount: Math.max(stagesSent, 1), daysFromDue };
  }

  if (stagesSent === 0) {
    // First reminder ever for this invoice: always the gentle first-overdue
    // wording, regardless of how overdue it already is. nextReminderCount
    // matches what the cron would assign for reaching overdue_1 (index 1).
    return { stage: "overdue_1", nextReminderCount: 2, daysFromDue };
  }

  if (daysFromDue >= REMINDER_ONGOING_START_DAYS) {
    return { stage: "overdue_ongoing", nextReminderCount: stagesSent + 1, daysFromDue };
  }

  // A reminder has already gone out for this invoice: pick whichever named
  // overdue wording actually matches how overdue it is now.
  let stageIndex = 1; // overdue_1
  for (let i = 1; i < REMINDER_STAGES.length; i++) {
    if (daysFromDue >= REMINDER_STAGES[i].offsetDays) stageIndex = i;
  }
  return {
    stage: REMINDER_STAGES[stageIndex].name,
    nextReminderCount: Math.max(stagesSent, stageIndex + 1),
    daysFromDue,
  };
}

/** UTC-safe due-date formatting shared by the cron and the manual route, so
 * "August 12, 2026" always means the same calendar day regardless of the
 * server's local timezone. */
export function formatDueDateText(dueDateIso: string): string {
  const [year, month, day] = dueDateIso.slice(0, 10).split("-").map(Number);
  const dueUtc = Date.UTC(year, month - 1, day);
  return new Date(dueUtc).toLocaleDateString("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
