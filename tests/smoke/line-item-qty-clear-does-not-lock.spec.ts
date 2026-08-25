import { test, expect } from "@playwright/test";
import { signUpFreshAccount, cleanupTestAccount } from "./helpers";

/**
 * Regression lock, two related bugs in the same classification logic.
 *
 * Bug 1: clearing a quantity-based line item's quantity field (the natural
 * way to retype it -- select the value, delete it, type a new one) used to
 * permanently reclassify the item as a flat fee mid-edit, because
 * isQuantityItem() in lib/estimate-summary.ts required BOTH quantity AND
 * rate to be non-blank, and the editor's expand/collapse UI is gated on
 * that same function. The instant the quantity field emptied, the whole
 * edit panel -- the very inputs the contractor was typing into -- unmounted
 * itself, with no way back in short of deleting and re-adding the item.
 *
 * Bug 2 (introduced by an early fix for bug 1 that changed the AND to an
 * OR): the AI sometimes fills in Qty and Unit for a material but leaves
 * Rate blank rather than leaving all three columns blank as instructed. An
 * OR-based check treats that row as quantity-based with a zero rate,
 * silently discarding the AI's own stated cost.
 *
 * Both are fixed by isQuantityItem() reading a `quantityBased` flag set
 * once, strictly (both quantity and rate present), at parse time -- never
 * re-derived from the live field values afterward. A user clearing one
 * field mid-edit can't flip it, and an AI row that's genuinely incomplete
 * keeps its own stated cost instead of being recomputed to zero.
 */
const RAW = `# Test Job

Job summary.

Estimated total: $650

## Scope of Work
- Do the work

## Line Items
| Item | Qty | Unit | Rate | Cost |
|------|-----|------|------|------|
| Labour | 10 | hrs | $65.00 | $650.00 |

## Pricing Summary
| | |
|---|---|
| Subtotal | $650 |
| Tax (GST 5%) | $33 |
| **Total** | **$683** |
| No deposit required | |
| Balance on completion | $683 |
`;

test("clearing a quantity field to retype it does not erase the edit UI", async ({ page }) => {
  const account = await signUpFreshAccount(page);

  try {
    await page.route("**/api/generate-estimate", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: `${RAW}\n__ID__:00000000-0000-0000-0000-000000000000`,
      })
    );
    await page.goto("/new");
    await page.locator("textarea").first().fill("Anything");
    await page.getByRole("button", { name: /generate estimate/i }).click();
    await expect(page.getByRole("button", { name: /back to description/i })).toBeVisible({
      timeout: 30000,
    });

    await page.getByRole("button", { name: /edit quantity and rate for labour/i }).click();
    const qtyInput = page.getByLabel("Item quantity");
    await expect(qtyInput).toHaveValue("10");

    // Select the existing value and delete it, the natural way to retype a
    // number -- not a single fill() call, which wouldn't pass through the
    // empty intermediate state that triggered the bug.
    await qtyInput.click();
    await qtyInput.press("Control+a");
    await qtyInput.press("Backspace");

    // The edit panel must still be there while the field is blank.
    await expect(qtyInput).toBeVisible();
    await expect(page.getByLabel("Item unit rate")).toBeVisible();

    await qtyInput.type("6");
    await expect(qtyInput).toHaveValue("6");
    await page.getByRole("button", { name: /^done$/i }).click();

    // Cost recalculated from the new quantity, not frozen at a stale value.
    await expect(page.getByText("CA$390.00")).toBeVisible();
    // Collapsed summary and edit affordance are still there afterward.
    await expect(page.getByText("6 hrs @ $65.00")).toBeVisible();
  } finally {
    await cleanupTestAccount(account.userId);
  }
});

const AMBIGUOUS_RAW = `# Test Job

Job summary.

Estimated total: $702

## Scope of Work
- Do the work

## Line Items
| Item | Qty | Unit | Rate | Cost |
|------|-----|------|------|------|
| Labour | 4.5 | hrs | $65.00 | $292.50 |
| Drywall compound and spackling | 1 | ea |  | $16.00 |
| Permit fee |  |  |  | $150.00 |

## Pricing Summary
| | |
|---|---|
| Subtotal | $458.50 |
| Tax (GST 5%) | $23 |
| **Total** | **$481.50** |
| No deposit required | |
| Balance on completion | $481.50 |
`;

test("an AI row with qty/unit filled but rate blank keeps its stated cost", async ({ page }) => {
  const account = await signUpFreshAccount(page);

  try {
    await page.route("**/api/generate-estimate", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: `${AMBIGUOUS_RAW}\n__ID__:00000000-0000-0000-0000-000000000000`,
      })
    );
    await page.goto("/new");
    await page.locator("textarea").first().fill("Anything");
    await page.getByRole("button", { name: /generate estimate/i }).click();
    await expect(page.getByRole("button", { name: /back to description/i })).toBeVisible({
      timeout: 30000,
    });

    const costInputs = await page.getByLabel("Item cost").all();
    const costs = await Promise.all(costInputs.map((el) => el.inputValue()));
    expect(costs).toContain("$16.00");
    expect(costs).not.toContain("$0.00");

    // Flat, so no expand affordance -- not silently promoted to a quantity item.
    await expect(
      page.getByRole("button", { name: /edit quantity and rate for drywall compound and spackling/i })
    ).toHaveCount(0);

    // The genuine quantity row is unaffected.
    await expect(page.getByText("$292.50")).toBeVisible();
  } finally {
    await cleanupTestAccount(account.userId);
  }
});
