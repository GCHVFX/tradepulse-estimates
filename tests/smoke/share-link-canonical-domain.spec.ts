import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { CANONICAL_URL, CANONICAL_DOMAIN } from "../../lib/site-url";

/**
 * The share link is the highest-stakes surface in the domain migration. Every
 * estimate ever sent to a customer is a bare URL in a text message or an
 * email, with no navigation around it, so the invariant is asserted the same
 * way a customer meets it: go straight to the share route on the canonical
 * domain by URL and check the estimate is on the page.
 *
 * Nothing here locates a nav element, a link, or a button to get there. A nav
 * element can move or be renamed without the invariant breaking, and it can
 * also keep working while the invariant is broken. Only the URL matters.
 *
 * Seeds its own estimate rather than reusing a real one, so the assertions can
 * name exact content. The business row is deliberately ownerless: no Auth
 * user, no Stripe customer, and no subscription is created, and teardown is a
 * plain delete rather than the account-deletion RPC, which cannot act on an
 * ownerless business.
 */

const TITLE = "Domain migration share check";
const CUSTOMER = "Share Route Verification";
const LINE_ITEM = "Replace main shutoff valve";

const SUMMARY = [
  "# " + TITLE,
  "",
  "## Job Summary",
  "",
  "Replace the failed main shutoff valve under the kitchen sink.",
  "",
  "## Line Items",
  "",
  "| Item | Cost |",
  "|---|---|",
  `| ${LINE_ITEM} | CA$420.00 |`,
  "",
  "## Pricing Summary",
  "",
  "| Item | Amount |",
  "|---|---|",
  "| Total | CA$420.00 |",
].join("\n");

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

test("the canonical host is the apex, with no www", () => {
  expect(CANONICAL_URL).toMatch(/^https:\/\//);
  expect(CANONICAL_DOMAIN.startsWith("www."), `${CANONICAL_DOMAIN} must not be a www host`).toBe(
    false
  );
  expect(CANONICAL_URL.endsWith("/"), "no trailing slash, paths are appended directly").toBe(false);
});

test("an estimate share URL on the canonical domain renders the estimate", async ({ page }) => {
  test.setTimeout(120000);
  const admin = adminClient();

  const { data: business, error: businessError } = await admin
    .from("tpe_businesses")
    .insert({ name: "Share Route Test Co", owner_user_id: null, plan: "starter" })
    .select("id")
    .maybeSingle();
  if (businessError || !business) {
    throw new Error(`Could not seed business: ${businessError?.message ?? "no row"}`);
  }

  let estimateId: string | null = null;

  try {
    const { data: estimate, error: estimateError } = await admin
      .from("tpe_estimates")
      .insert({
        business_id: business.id,
        title: TITLE,
        summary: SUMMARY,
        status: "sent",
        customer_name: CUSTOMER,
      })
      .select("id")
      .maybeSingle();
    if (estimateError || !estimate) {
      throw new Error(`Could not seed estimate: ${estimateError?.message ?? "no row"}`);
    }
    estimateId = estimate.id;

    // Absolute URL on the canonical host. Not baseURL-relative, so this fails
    // if the canonical host stops serving the share route even while some
    // alias still does.
    const shareUrl = `${CANONICAL_URL}/share/${estimateId}`;
    const response = await page.goto(shareUrl);

    expect(response?.status(), `${shareUrl} must serve the estimate directly`).toBe(200);
    expect(
      response?.request().redirectedFrom(),
      "the canonical host must serve 200, never redirect"
    ).toBeNull();
    expect(new URL(page.url()).host).toBe(CANONICAL_DOMAIN);

    // The estimate itself, not the page chrome around it.
    await expect(page.getByRole("heading", { name: TITLE }).first()).toBeVisible();
    await expect(page.getByText(`Prepared for: ${CUSTOMER}`)).toBeVisible();
    await expect(page.getByText(LINE_ITEM)).toBeVisible();
    await expect(page.getByText("CA$420.00").first()).toBeVisible();
    await expect(page.getByText("All amounts in CAD")).toBeVisible();
    await expect(page.getByText("Estimate not found.")).toHaveCount(0);
  } finally {
    if (estimateId) await admin.from("tpe_estimates").delete().eq("id", estimateId);
    await admin.from("tpe_businesses").delete().eq("id", business.id);
  }
});
