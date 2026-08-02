import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { formatEstimateForDisplay, parseSummary } from "../../lib/estimate-summary";
import { parsedToItems } from "../../lib/estimate-items";
import { draftToItemRow } from "../../lib/estimate-item-migration";
import { validFixtures } from "../fixtures/estimate-summaries";
import {
  buildCustomerPricingView,
  canEditCustomerPricingMode,
  updateCustomerPricingMode,
  type CustomerPricingModeDependencies,
  type EstimatePricingRecord,
  type StructuredPricingItem,
} from "../../lib/estimate-pricing-mode";

const SUMMARY = [
  "# Service Upgrade",
  "",
  "Replace the listed fixtures and complete the electrical permit work.",
  "",
  "## Scope of Work",
  "- Complete the listed work.",
  "",
  "## Line Items",
  "| Item | Qty | Unit | Rate | Cost |",
  "|---|---|---|---|---|",
  "| Plumbing labour | 2 | hrs | $100.00 | $200.00 |",
  "| Copper fittings |  |  |  | $50.00 |",
  "| Electrical permit credit |  |  |  | $-25.00 |",
  "| Site protection |  |  |  | $75.00 |",
  "",
  "## Assumptions and Exclusions",
  "- Existing services are usable.",
  "",
  "## Pricing Summary",
  "| | |",
  "|---|---|",
  "| Subtotal | $300 |",
  "| Tax (GST 5%) | $15 |",
  "| **Total** | **$315** |",
  "| Deposit required (20%) | $63 |",
  "| Balance on completion | $252 |",
  "",
  "## Payment Terms",
  "Payment is due on completion.",
  "",
  "## Notes",
  "Permit timing depends on the authority having jurisdiction.",
].join("\n");

const ITEMS: StructuredPricingItem[] = [
  {
    description: "Plumbing labour",
    quantity: 2,
    unit: "hrs",
    unitPrice: 100,
    lineTotal: 200,
    groupLabel: "Plumbing",
    customerVisible: true,
    displayOrder: 0,
  },
  {
    description: "Copper fittings",
    quantity: 1,
    unit: null,
    unitPrice: 50,
    lineTotal: 50,
    groupLabel: "Plumbing",
    customerVisible: true,
    displayOrder: 1,
  },
  {
    description: "Electrical permit credit",
    quantity: 1,
    unit: null,
    unitPrice: -25,
    lineTotal: -25,
    groupLabel: "Permits and fees",
    customerVisible: true,
    displayOrder: 2,
  },
  {
    description: "Site protection",
    quantity: 1,
    unit: null,
    unitPrice: 75,
    lineTotal: 75,
    groupLabel: null,
    customerVisible: true,
    displayOrder: 3,
  },
];

const DRAFT: EstimatePricingRecord = {
  id: "estimate-1",
  businessId: "business-1",
  pricingSource: "structured",
  customerPricingMode: "detailed",
  status: "draft",
  sentAt: null,
  copiedAt: null,
  completedAt: null,
  paymentStatus: null,
  invoiceAmount: null,
  reviewRequestedAt: null,
  summary: SUMMARY,
};

test("structured detailed pricing stays byte-equivalent to the current customer display", () => {
  const view = buildCustomerPricingView({
    estimate: DRAFT,
    items: ITEMS,
    featureEnabled: true,
  });

  expect(view.ok).toBe(true);
  expect(view.renderedMode).toBe("detailed");
  expect(view.summary).toBe(formatEstimateForDisplay(SUMMARY));
  expect(view.detailedSubtotal).toBe(300);
  expect(view.tax).toBe(15);
  expect(view.total).toBe(315);
  expect(view.deposit).toBe(63);
});

test("every convertible fixture keeps the same detailed customer view from structured rows", () => {
  for (const fixture of validFixtures) {
    const items = parsedToItems(parseSummary(fixture.summary)).map((draft) => {
      const row = draftToItemRow(draft, { assignGroups: true });
      return {
        description: row.description,
        quantity: row.quantity,
        unit: row.unit,
        unitPrice: row.unit_price,
        lineTotal: row.line_total,
        groupLabel: row.group_label,
        customerVisible: row.customer_visible,
        displayOrder: row.display_order,
      } satisfies StructuredPricingItem;
    });
    const view = buildCustomerPricingView({
      estimate: { ...DRAFT, summary: fixture.summary },
      items,
      featureEnabled: true,
    });

    expect(view.ok, fixture.name).toBe(true);
    expect(view.summary, fixture.name).toBe(formatEstimateForDisplay(fixture.summary));
  }
});

test("a quantity row with one unit and a blank unit label keeps its detailed description", () => {
  const summary = [
    "# Service Call",
    "",
    "Complete the listed work.",
    "",
    "## Line Items",
    "| Item | Qty | Unit | Rate | Cost |",
    "|---|---|---|---|---|",
    "| Service allowance | 1 |  | $40.00 | $40.00 |",
    "",
    "## Pricing Summary",
    "| | |",
    "|---|---|",
    "| Subtotal | $40 |",
    "| Tax (GST 5%) | $2 |",
    "| **Total** | **$42** |",
    "| No deposit required | |",
    "| Balance on completion | $42 |",
  ].join("\n");
  const view = buildCustomerPricingView({
    estimate: { ...DRAFT, summary },
    items: [
      {
        description: "Service allowance",
        quantity: 1,
        unit: null,
        unitPrice: 0,
        lineTotal: 0,
        groupLabel: null,
        customerVisible: false,
        displayOrder: 0,
      },
      {
        description: "Service allowance",
        quantity: 1,
        unit: null,
        unitPrice: 40,
        lineTotal: 40,
        groupLabel: null,
        customerVisible: true,
        displayOrder: 1,
      },
    ],
    featureEnabled: true,
  });

  expect(view.ok).toBe(true);
  expect(view.summary).toBe(formatEstimateForDisplay(summary));
  expect(view.summary).toContain("Service allowance (1 @ $40.00)");
  expect(view.summary.match(/Service allowance/g)).toHaveLength(1);
});

test("grouped pricing combines work packages in first-appearance order without item prices", () => {
  const view = buildCustomerPricingView({
    estimate: { ...DRAFT, customerPricingMode: "grouped" },
    items: ITEMS,
    featureEnabled: true,
  });

  expect(view.ok).toBe(true);
  expect(view.renderedMode).toBe("grouped");
  expect(view.groups).toEqual([
    { group: "Plumbing", total: 250, itemCount: 2 },
    { group: "Permits and fees", total: -25, itemCount: 1 },
    { group: "Additional items", total: 75, itemCount: 1 },
  ]);
  expect(view.groupedSubtotal).toBe(300);
  expect(view.summary).toContain("| Work package | Price |");
  expect(view.summary).toContain("| Plumbing | $250 |");
  expect(view.summary).toContain("| Permits and fees | $-25 |");
  expect(view.summary).not.toContain("Plumbing labour");
  expect(view.summary).not.toContain("Copper fittings");
  expect(view.summary).toContain("| **Total** | **$315** |");
  expect(view.summary).toContain("| Deposit required (20%) | $63 |");
  expect(view.summary).toContain("Existing services are usable.");
  expect(view.summary).toContain("Payment is due on completion.");
  expect(view.summary).toContain("Permit timing depends on the authority having jurisdiction.");
});

test("customer-hidden zero rows are excluded without changing totals", () => {
  const hidden: StructuredPricingItem = {
    ...ITEMS[3],
    description: "Internal note row",
    lineTotal: 0,
    unitPrice: 0,
    customerVisible: false,
    displayOrder: 4,
  };
  const view = buildCustomerPricingView({
    estimate: { ...DRAFT, customerPricingMode: "grouped" },
    items: [...ITEMS, hidden],
    featureEnabled: true,
  });

  expect(view.ok).toBe(true);
  expect(view.summary).not.toContain("Internal note row");
  expect(view.groups.reduce((count, group) => count + group.itemCount, 0)).toBe(4);
});

test("a hidden priced row or subtotal mismatch fails closed to detailed markdown", () => {
  const hiddenPriced = ITEMS.map((item, index) =>
    index === 3 ? { ...item, customerVisible: false } : item
  );
  const view = buildCustomerPricingView({
    estimate: { ...DRAFT, customerPricingMode: "grouped" },
    items: hiddenPriced,
    featureEnabled: true,
  });

  expect(view.ok).toBe(false);
  expect(view.error).toBe("STRUCTURED_SUBTOTAL_MISMATCH");
  expect(view.renderedMode).toBe("detailed");
  expect(view.summary).toBe(formatEstimateForDisplay(SUMMARY));
  expect(view.summary).not.toContain("| Work package | Price |");
});

test("markdown estimates always use the old renderer and ignore grouped mode", () => {
  const view = buildCustomerPricingView({
    estimate: {
      ...DRAFT,
      pricingSource: "markdown",
      customerPricingMode: "grouped",
    },
    items: ITEMS,
    featureEnabled: true,
  });

  expect(view.ok).toBe(true);
  expect(view.renderedMode).toBe("detailed");
  expect(view.summary).toBe(formatEstimateForDisplay(SUMMARY));
});

test("sent markdown estimates remain on the old renderer", () => {
  const estimate = {
    ...DRAFT,
    pricingSource: "markdown",
    customerPricingMode: "grouped",
    status: "sent",
    sentAt: "2026-08-01T12:00:00Z",
  };
  const view = buildCustomerPricingView({ estimate, items: [], featureEnabled: true });

  expect(view.ok).toBe(true);
  expect(view.renderedMode).toBe("detailed");
  expect(view.summary).toBe(formatEstimateForDisplay(SUMMARY));
  expect(canEditCustomerPricingMode(estimate, 0, true)).toBe(false);
});

test("contractor, share, and PDF are wired to one server-built customer summary", () => {
  const contractorPage = readFileSync("app/estimates/[id]/page.tsx", "utf8");
  const sharePage = readFileSync("app/share/[id]/page.tsx", "utf8");
  const pdf = readFileSync("lib/generate-pdf.ts", "utf8");

  expect(contractorPage).toContain("loadCustomerPricingView(estimate)");
  expect(contractorPage).toContain("summary={pricing.selected.summary}");
  expect(sharePage).toContain("loadCustomerPricingView(estimate)");
  expect(sharePage).toContain("<EstimateMarkdown content={pricing.selected.summary}");
  expect(sharePage).toContain("summary={pricing.selected.summary}");
  expect(pdf).not.toContain("groupItemsForDisplay");
  expect(pdf).not.toContain("renderGroupedLineItemsBlock");
  expect(pdf).not.toContain("formatEstimateForDisplay");
});

test("missing rows, invalid mode, and a disabled flag fail closed to detailed", () => {
  const noRows = buildCustomerPricingView({ estimate: DRAFT, items: [], featureEnabled: true });
  expect(noRows.ok).toBe(false);
  expect(noRows.error).toBe("STRUCTURED_ROWS_MISSING");

  const invalid = buildCustomerPricingView({
    estimate: { ...DRAFT, customerPricingMode: "unexpected" },
    items: ITEMS,
    featureEnabled: true,
  });
  expect(invalid.ok).toBe(false);
  expect(invalid.error).toBe("INVALID_PRICING_MODE");

  const disabled = buildCustomerPricingView({
    estimate: { ...DRAFT, customerPricingMode: "grouped" },
    items: ITEMS,
    featureEnabled: false,
  });
  expect(disabled.ok).toBe(false);
  expect(disabled.error).toBe("GROUPED_PRICING_DISABLED");
  expect(disabled.renderedMode).toBe("detailed");
});

test("only an unprotected structured draft with rows can show the toggle", () => {
  expect(canEditCustomerPricingMode(DRAFT, ITEMS.length, true)).toBe(true);
  expect(canEditCustomerPricingMode({ ...DRAFT, pricingSource: "markdown" }, 0, true)).toBe(false);
  expect(canEditCustomerPricingMode({ ...DRAFT, status: "sent" }, ITEMS.length, true)).toBe(false);
  expect(canEditCustomerPricingMode({ ...DRAFT, status: "done" }, ITEMS.length, true)).toBe(false);
  expect(canEditCustomerPricingMode({ ...DRAFT, sentAt: "2026-08-01T12:00:00Z" }, ITEMS.length, true)).toBe(false);
  expect(canEditCustomerPricingMode({ ...DRAFT, copiedAt: "2026-08-01T12:00:00Z" }, ITEMS.length, true)).toBe(false);
  expect(canEditCustomerPricingMode({ ...DRAFT, paymentStatus: "unpaid" }, ITEMS.length, true)).toBe(false);
  expect(canEditCustomerPricingMode(DRAFT, 0, true)).toBe(false);
  expect(canEditCustomerPricingMode(DRAFT, ITEMS.length, false)).toBe(false);
});

function dependencies(overrides: Partial<CustomerPricingModeDependencies> = {}) {
  let persistedMode = DRAFT.customerPricingMode;
  const updates: Array<{ estimateId: string; businessId: string; mode: "detailed" | "grouped" }> = [];

  const deps: CustomerPricingModeDependencies = {
    featureEnabled: true,
    findBusinessIdForUser: async () => "business-1",
    findEstimateForBusiness: async () => ({ ...DRAFT, customerPricingMode: persistedMode }),
    loadStructuredItems: async () => ITEMS,
    persistMode: async (update) => {
      updates.push(update);
      persistedMode = update.mode;
      return { updated: true };
    },
    ...overrides,
  };

  return { deps, updates, getPersistedMode: () => persistedMode };
}

test("anonymous and foreign callers cannot change pricing mode", async () => {
  const anonymous = dependencies();
  const anonymousResult = await updateCustomerPricingMode(
    { userId: null, estimateId: "estimate-1", requestedMode: "grouped" },
    anonymous.deps
  );
  expect(anonymousResult.status).toBe(401);
  expect(anonymous.updates).toHaveLength(0);

  const foreign = dependencies({ findEstimateForBusiness: async () => null });
  const foreignResult = await updateCustomerPricingMode(
    { userId: "foreign-user", estimateId: "estimate-1", requestedMode: "grouped" },
    foreign.deps
  );
  expect(foreignResult.status).toBe(404);
  expect(foreign.updates).toHaveLength(0);
});

test("protected, markdown, rowless, invalid, and feature-disabled requests are refused", async () => {
  const cases: Array<{
    name: string;
    requestedMode: unknown;
    overrides: Partial<CustomerPricingModeDependencies>;
  }> = [
    {
      name: "sent",
      requestedMode: "grouped",
      overrides: { findEstimateForBusiness: async () => ({ ...DRAFT, status: "sent" }) },
    },
    {
      name: "done",
      requestedMode: "grouped",
      overrides: { findEstimateForBusiness: async () => ({ ...DRAFT, status: "done" }) },
    },
    {
      name: "markdown",
      requestedMode: "grouped",
      overrides: { findEstimateForBusiness: async () => ({ ...DRAFT, pricingSource: "markdown" }) },
    },
    {
      name: "rowless",
      requestedMode: "grouped",
      overrides: { loadStructuredItems: async () => [] },
    },
    {
      name: "invalid",
      requestedMode: "compact",
      overrides: {},
    },
    {
      name: "feature disabled",
      requestedMode: "grouped",
      overrides: { featureEnabled: false },
    },
  ];

  for (const item of cases) {
    const harness = dependencies(item.overrides);
    const result = await updateCustomerPricingMode(
      { userId: "owner-user", estimateId: "estimate-1", requestedMode: item.requestedMode },
      harness.deps
    );
    expect(result.ok, item.name).toBe(false);
    expect(harness.updates, item.name).toHaveLength(0);
  }
});

test("detailed to grouped and grouped to detailed persist only the mode", async () => {
  const toGrouped = dependencies();
  const groupedResult = await updateCustomerPricingMode(
    { userId: "owner-user", estimateId: "estimate-1", requestedMode: "grouped" },
    toGrouped.deps
  );
  expect(groupedResult).toMatchObject({ ok: true, status: 200, mode: "grouped" });
  expect(toGrouped.updates).toEqual([
    { estimateId: "estimate-1", businessId: "business-1", mode: "grouped" },
  ]);
  expect(toGrouped.getPersistedMode()).toBe("grouped");

  const toDetailed = dependencies({
    findEstimateForBusiness: async () => ({ ...DRAFT, customerPricingMode: "grouped" }),
  });
  const detailedResult = await updateCustomerPricingMode(
    { userId: "owner-user", estimateId: "estimate-1", requestedMode: "detailed" },
    toDetailed.deps
  );
  expect(detailedResult).toMatchObject({ ok: true, status: 200, mode: "detailed" });
  expect(toDetailed.updates[0]).toEqual({
    estimateId: "estimate-1",
    businessId: "business-1",
    mode: "detailed",
  });
});

test("a failed update leaves the prior mode intact and repeating the same mode is safe", async () => {
  const failed = dependencies({ persistMode: async () => ({ updated: false, error: "database failure" }) });
  const failedResult = await updateCustomerPricingMode(
    { userId: "owner-user", estimateId: "estimate-1", requestedMode: "grouped" },
    failed.deps
  );
  expect(failedResult.status).toBe(500);
  expect(failed.getPersistedMode()).toBe("detailed");

  const repeated = dependencies();
  const repeatedResult = await updateCustomerPricingMode(
    { userId: "owner-user", estimateId: "estimate-1", requestedMode: "detailed" },
    repeated.deps
  );
  expect(repeatedResult).toMatchObject({ ok: true, status: 200, mode: "detailed" });
  expect(repeated.updates).toHaveLength(0);
});
