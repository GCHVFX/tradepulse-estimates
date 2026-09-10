import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpFreshAccount, cleanupTestAccount } from "./helpers";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const JOB_DESCRIPTION =
  "Replace 50-gallon gas water heater. New unit, expansion tank, about 3 hours labour.";

// EditableEstimateBody renders line-item and scope descriptions as
// textarea/input values, which Element.innerText never includes (it only
// reflects rendered text nodes). Read both so the spelling check actually
// sees the editable line item text a contractor sees on screen.
async function readEstimateText(page: import("@playwright/test").Page): Promise<string> {
  const bodyText = await page.locator("main").first().innerText();
  const fieldValues = await page
    .locator("main textarea, main input")
    .evaluateAll((els) => els.map((el) => (el as HTMLInputElement | HTMLTextAreaElement).value).join("\n"));
  return `${bodyText}\n${fieldValues}`;
}

test("generating an estimate renders a pricing summary", async ({ page }) => {
  const account = await signUpFreshAccount(page);

  try {
    await page.locator("textarea").fill(JOB_DESCRIPTION);
    await page.getByRole("button", { name: /generate estimate/i }).click();

    await expect(page.getByText(/pricing summary/i)).toBeVisible({ timeout: 30000 });
  } finally {
    await cleanupTestAccount(account.userId);
  }
});

/**
 * Spelling locale contract.
 *
 * The AI system prompt used to hard-code "Use Canadian English spelling"
 * regardless of the business's own estimate currency, so a US ('usd')
 * business still got 'labour' in its own generated estimates. The prompt is
 * now built per request from the same estimate_currency value that already
 * decides CA$ vs US$ (lib/currency.ts's spellingInstructionForCurrency),
 * never a second geolocation source and never a post-generation find/replace.
 */
test("a Canadian (default) business gets Canadian spelling in generated content", async ({ page }) => {
  const account = await signUpFreshAccount(page);

  try {
    await page.locator("textarea").fill(JOB_DESCRIPTION);
    await page.getByRole("button", { name: /generate estimate/i }).click();
    // Wait for generation to fully finish, not just for the heading to
    // stream in -- "Send Estimate" only enables once the stream (and the
    // server's claim release) has completed, so the summary text below is
    // guaranteed complete rather than a mid-stream snapshot.
    await expect(page.getByRole("button", { name: /^send estimate$/i })).toBeEnabled({
      timeout: 45000,
    });

    const bodyText = await readEstimateText(page);
    expect(bodyText, "expected 'labour' somewhere in a Canadian estimate").toMatch(/\blabour\b/i);
    expect(bodyText, "must not also contain the American spelling").not.toMatch(/\blabor\b/i);
  } finally {
    await cleanupTestAccount(account.userId);
  }
});

test("a US business gets American spelling in generated content", async ({ page }) => {
  const account = await signUpFreshAccount(page);

  try {
    const admin = adminClient();
    const { data: business } = await admin
      .from("tpe_businesses")
      .select("id")
      .eq("owner_user_id", account.userId)
      .maybeSingle();
    if (!business) throw new Error("No business row for test account");
    await admin.from("tpe_businesses").update({ estimate_currency: "usd" }).eq("id", business.id);

    // No reload needed: /api/generate-estimate reads estimate_currency fresh
    // from the database on every request, not from client-cached state.
    await page.locator("textarea").fill(JOB_DESCRIPTION);
    await page.getByRole("button", { name: /generate estimate/i }).click();
    // Wait for generation to fully finish, not just for the heading to
    // stream in -- "Send Estimate" only enables once the stream (and the
    // server's claim release) has completed, so the summary text below is
    // guaranteed complete rather than a mid-stream snapshot.
    await expect(page.getByRole("button", { name: /^send estimate$/i })).toBeEnabled({
      timeout: 45000,
    });

    const bodyText = await readEstimateText(page);
    expect(bodyText, "expected 'labor' somewhere in a US estimate").toMatch(/\blabor\b/i);
    expect(bodyText, "must not also contain the Canadian spelling").not.toMatch(/\blabour\b/i);
    expect(bodyText, "currency must still render as US$, unchanged by this task").toMatch(/US\$/);
  } finally {
    await cleanupTestAccount(account.userId);
  }
});
