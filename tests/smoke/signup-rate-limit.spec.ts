import { test, expect } from "@playwright/test";
import crypto from "crypto";
import { cleanupTestAccount, resetSignupRateLimit } from "./helpers";

// Must match the limit passed to checkRateLimit(...) in app/api/auth/signup/route.ts.
const SIGNUP_LIMIT = 5;

test("rapid repeated signups from the same source are rejected after the threshold", async ({ request }) => {
  test.setTimeout(60000);

  await resetSignupRateLimit();
  const createdUserIds: string[] = [];

  try {
    let sawRejection = false;

    for (let i = 0; i < SIGNUP_LIMIT + 1; i++) {
      const email = `gchansen+audit-ratelimit-${Date.now()}-${crypto.randomBytes(4).toString("hex")}@gmail.com`;
      const password = crypto.randomBytes(12).toString("hex");

      const response = await request.post("/api/auth/signup", {
        data: { email, password },
      });

      if (response.status() === 429) {
        sawRejection = true;
        break;
      }

      expect(response.ok()).toBeTruthy();
      const body = (await response.json()) as { userId?: string };
      if (body.userId) createdUserIds.push(body.userId);
    }

    expect(sawRejection).toBe(true);
  } finally {
    for (const userId of createdUserIds) {
      await cleanupTestAccount(userId);
    }
    await resetSignupRateLimit();
  }
});
