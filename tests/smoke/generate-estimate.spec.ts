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

// The old markdown editor rendered scope and line-item text as
// textarea/input values, which Element.innerText never includes. A generated
// estimate is read-only prose now, but reading both keeps this helper correct
// if a field is ever reintroduced to this screen.
async function readEstimateText(page: import("@playwright/test").Page): Promise<string> {
  const bodyText = await page.locator("main").first().innerText();
  const fieldValues = await page
    .locator("main textarea, main input")
    .evaluateAll((els) => els.map((el) => (el as HTMLInputElement | HTMLTextAreaElement).value).join("\n"));
  return `${bodyText}\n${fieldValues}`;
}

/**
 * Phase 1 acceptance test: pricing-ai-authors-no-numbers
 * (specs/contractor-owned-pricing.md). This used to assert the opposite --
 * that generation rendered a Pricing Summary -- because the model wrote the
 * prices. It does not any more: the AI writes the job, the contractor owns
 * the price, and a freshly generated estimate carries no figures at all until
 * the contractor enters them in the pricing editor on the saved record.
 *
 * This is the one test in the suite that deliberately makes a real
 * generation call.
 */
test("a generated estimate contains no currency figures before contractor input", async ({ page }) => {
  const account = await signUpFreshAccount(page);

  try {
    await page.locator("textarea").fill(JOB_DESCRIPTION);
    await page.getByRole("button", { name: /generate estimate/i }).click();

    // Add Pricing appears only once the estimate row is saved and the server
    // has handed back the sanitized prose, so what is on screen from here is
    // the saved record rather than the raw stream.
    await expect(page.getByRole("button", { name: /^add pricing$/i }).first()).toBeVisible({ timeout: 45000 });

    const bodyText = await page.locator("main").first().innerText();
    expect(bodyText, "no currency figure may appear in generated prose").not.toMatch(/[$]/);
    expect(bodyText, "no deposit may appear in generated prose").not.toMatch(/deposit/i);
    expect(bodyText, "no pricing summary is generated any more").not.toMatch(/pricing summary/i);
    expect(bodyText, "no estimated total is generated any more").not.toMatch(/estimated total/i);
    expect(bodyText, "the model does not write the contractor's business terms").not.toMatch(
      /payment terms|valid for \d+ days|quoted separately|cost will depend/i
    );
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
    // stream in -- Add Pricing only appears once the estimate row is saved
    // and the server has returned the sanitized prose, so the text below is
    // the saved record rather than a mid-stream snapshot.
    await expect(page.getByRole("button", { name: /^add pricing$/i }).first()).toBeVisible({
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
    // stream in -- Add Pricing only appears once the estimate row is saved
    // and the server has returned the sanitized prose, so the text below is
    // the saved record rather than a mid-stream snapshot.
    await expect(page.getByRole("button", { name: /^add pricing$/i }).first()).toBeVisible({
      timeout: 45000,
    });

    const bodyText = await readEstimateText(page);
    expect(bodyText, "expected 'labor' somewhere in a US estimate").toMatch(/\blabor\b/i);
    expect(bodyText, "must not also contain the Canadian spelling").not.toMatch(/\blabour\b/i);
    // No currency assertion: Phase 1 slice 4 removed every figure from
    // generated prose, so this screen renders no money in either currency.
    // The estimate's own currency snapshot is covered in currency.spec.ts.
  } finally {
    await cleanupTestAccount(account.userId);
  }
});
