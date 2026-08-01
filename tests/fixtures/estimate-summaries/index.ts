/**
 * Synthetic estimate-summary corpus for the grouped-pricing conversion layer
 * (lib/estimate-items.ts).
 *
 * ALL FIXTURES ARE SYNTHETIC. No production data was read to build this set, no
 * database was contacted, and there is no real customer personal information
 * here. Names, addresses, and phone numbers are invented.
 *
 * IMPORTANT SCOPE NOTE: this corpus does NOT claim to represent the real
 * production format distribution. It covers the shapes the format is known to
 * permit, which is not the same thing as covering the shapes that actually
 * exist in stored estimates. A read-only production format audit is still
 * outstanding before any backfill.
 *
 * Adding a real-data corpus later must not require rewriting the tests. Load
 * additional fixtures through `EstimateFixture` and concatenate them into
 * `allFixtures`; the test suite enumerates whatever is exported here rather
 * than naming fixtures individually.
 */

export interface EstimateFixture {
  /** Stable slug, used in test names. */
  name: string;
  /** What shape of the format this fixture exercises. */
  describes: string;
  /** Raw stored `summary` markdown, exactly as it would sit in the database. */
  summary: string;
  /**
   * `valid` fixtures must round trip with every total preserved.
   * `negative` fixtures must fail explicitly, never silently succeed.
   */
  kind: "valid" | "negative";
  /** For negative fixtures: the malformed-row reason or abort this must produce. */
  expectFailureContaining?: string;
  /**
   * For negative fixtures: whether the finding must block migration.
   * Defaults to true. Set false for cases the current format genuinely permits
   * but that are still worth surfacing, such as a negative amount.
   */
  expectBlocking?: boolean;
  /** Optional expectations, asserted when present. */
  expect?: {
    itemCount?: number;
    subtotal?: number;
    tax?: number;
    grandTotal?: number;
    /** True when this fixture should serialize to the legacy two-column table. */
    legacyTwoColumn?: boolean;
  };
}

// ── Helpers to keep fixtures readable ─────────────────────────────────────────

function doc(parts: {
  title?: string;
  preamble?: string;
  scope?: string[];
  lineItems: string;
  assumptions?: string[];
  pricing?: string;
  paymentTerms?: string;
  notes?: string;
  extraSections?: string;
}): string {
  const out: string[] = [];
  if (parts.title) out.push(`# ${parts.title}\n`);
  if (parts.preamble) out.push(`${parts.preamble}\n`);
  if (parts.scope) out.push(`## Scope of Work\n${parts.scope.map((s) => `- ${s}`).join("\n")}\n`);
  out.push(`## Line Items\n${parts.lineItems}\n`);
  if (parts.assumptions)
    out.push(
      `## Assumptions and Exclusions\n${parts.assumptions.map((s) => `- ${s}`).join("\n")}\n`
    );
  if (parts.pricing) out.push(`## Pricing Summary\n${parts.pricing}\n`);
  if (parts.extraSections) out.push(`${parts.extraSections}\n`);
  if (parts.paymentTerms) out.push(`## Payment Terms\n${parts.paymentTerms}\n`);
  if (parts.notes) out.push(`## Notes\n${parts.notes}\n`);
  return out.join("\n").trim();
}

/** Standard pricing block. Tax label and rate are recovered from this text. */
function pricing(opts: { taxLabel?: string; taxRate?: number; depositPercent?: number }): string {
  const label = opts.taxLabel ?? "GST";
  const rate = opts.taxRate ?? 5;
  const depositRow =
    opts.depositPercent && opts.depositPercent > 0
      ? `| Deposit required (${opts.depositPercent}%) | $0 |`
      : "| No deposit required | |";
  return [
    "| | |",
    "|---|---|",
    "| Subtotal | $0 |",
    `| Tax (${label} ${rate}%) | $0 |`,
    "| **Total** | **$0** |",
    depositRow,
    "| Balance on completion | $0 |",
  ].join("\n");
}

const QTY_HEADER = ["| Item | Qty | Unit | Rate | Cost |", "|------|-----|------|------|------|"];
const FLAT_HEADER = ["| Item | Cost |", "|------|------|"];

function qtyTable(rows: string[]): string {
  return [...QTY_HEADER, ...rows].join("\n");
}
function flatTable(rows: string[]): string {
  return [...FLAT_HEADER, ...rows].join("\n");
}

// ── Valid fixtures ────────────────────────────────────────────────────────────

const valid: EstimateFixture[] = [
  {
    name: "01-simple-two-line",
    describes: "Simple two-line estimate",
    kind: "valid",
    expect: { itemCount: 2 },
    summary: doc({
      title: "Kitchen Tap Replacement",
      preamble: "Replace the leaking kitchen tap.\n\nEstimated total: $0",
      scope: ["Remove old tap", "Install customer-supplied tap"],
      lineItems: qtyTable([
        "| Labour | 2 | hrs | $95.00 | $190.00 |",
        "| Supply fittings | 1 | ea | $34.00 | $34.00 |",
      ]),
      pricing: pricing({}),
      paymentTerms: "This estimate is valid for 30 days from the date above.",
    }),
  },
  {
    name: "02-labour-only",
    describes: "Labour-only estimate",
    kind: "valid",
    expect: { itemCount: 1 },
    summary: doc({
      title: "Diagnostic Visit",
      lineItems: qtyTable(["| Diagnostic labour | 1.5 | hrs | $110.00 | $165.00 |"]),
      pricing: pricing({}),
    }),
  },
  {
    name: "03-materials-only",
    describes: "Materials-only estimate, all flat fees",
    kind: "valid",
    expect: { itemCount: 3, legacyTwoColumn: true },
    summary: doc({
      title: "Materials Supply",
      // Every row is a flat fee, so the serializer collapses to two columns.
      lineItems: qtyTable([
        "| Copper pipe bundle |  |  |  | $240.00 |",
        "| Solder and flux |  |  |  | $38.00 |",
        "| Pipe insulation |  |  |  | $52.00 |",
      ]),
      pricing: pricing({}),
    }),
  },
  {
    name: "04-mixed-labour-and-materials",
    describes: "Mixed labour and materials",
    kind: "valid",
    expect: { itemCount: 4 },
    summary: doc({
      title: "Bathroom Fan Install",
      scope: ["Cut opening", "Run duct to soffit", "Wire to existing switch"],
      lineItems: qtyTable([
        "| Labour | 4 | hrs | $95.00 | $380.00 |",
        "| Exhaust fan | 1 | ea | $189.00 | $189.00 |",
        "| Rigid duct | 8 | ft | $6.50 | $52.00 |",
        "| Permit fee |  |  |  | $150.00 |",
      ]),
      assumptions: ["Attic is accessible", "Existing wiring is to code"],
      pricing: pricing({}),
    }),
  },
  {
    name: "05-decimal-quantities",
    describes: "Decimal quantities",
    kind: "valid",
    expect: { itemCount: 3 },
    summary: doc({
      title: "Drywall Patch",
      lineItems: qtyTable([
        "| Labour | 2.5 | hrs | $88.00 | $220.00 |",
        "| Compound | 0.5 | pail | $46.00 | $23.00 |",
        "| Tape | 1.25 | roll | $12.00 | $15.00 |",
      ]),
      pricing: pricing({}),
    }),
  },
  {
    name: "06-currency-with-commas",
    describes: "Currency values containing commas",
    kind: "valid",
    expect: { itemCount: 3 },
    summary: doc({
      title: "Panel Upgrade",
      lineItems: qtyTable([
        "| Labour | 16 | hrs | $115.00 | $1,840.00 |",
        "| 200A panel | 1 | ea | $1,250.00 | $1,250.00 |",
        "| Inspection fee |  |  |  | $1,100.00 |",
      ]),
      pricing: pricing({}),
    }),
  },
  {
    name: "07-markup-already-in-prices",
    describes: "Markup already reflected in line prices, never shown separately",
    kind: "valid",
    expect: { itemCount: 3 },
    summary: doc({
      title: "Faucet Swap",
      preamble: "Material prices below already include markup.",
      lineItems: qtyTable([
        "| Labour | 3 | hrs | $95.00 | $285.00 |",
        "| Faucet, marked up | 1 | ea | $253.00 | $253.00 |",
        "| Supply lines, marked up | 2 | ea | $19.80 | $39.60 |",
      ]),
      pricing: pricing({}),
    }),
  },
  {
    name: "08-tax-gst-5",
    describes: "Tax present at 5 percent",
    kind: "valid",
    expect: { itemCount: 1, subtotal: 500, tax: 25, grandTotal: 525 },
    summary: doc({
      title: "Taxed Job",
      lineItems: qtyTable(["| Labour | 5 | hrs | $100.00 | $500.00 |"]),
      pricing: pricing({ taxLabel: "GST", taxRate: 5 }),
    }),
  },
  {
    name: "09-no-tax",
    describes: "Zero tax rate",
    kind: "valid",
    expect: { itemCount: 1, subtotal: 500, tax: 0, grandTotal: 500 },
    summary: doc({
      title: "Untaxed Job",
      lineItems: qtyTable(["| Labour | 5 | hrs | $100.00 | $500.00 |"]),
      pricing: pricing({ taxLabel: "GST", taxRate: 0 }),
    }),
  },
  {
    name: "10-deposit-percentage",
    describes: "Deposit expressed as a percentage",
    kind: "valid",
    expect: { itemCount: 2 },
    summary: doc({
      title: "Deposit Job",
      lineItems: qtyTable([
        "| Labour | 20 | hrs | $95.00 | $1,900.00 |",
        "| Fixtures |  |  |  | $860.00 |",
      ]),
      pricing: pricing({ depositPercent: 30 }),
    }),
  },
  {
    // Fixture 11 in the brief was "deposit fixed amount, only if currently
    // supported". It is NOT supported: parseSummary only recovers a deposit
    // PERCENT, via /Deposit.*?\((\d+)%\)/. A fixed dollar deposit with no
    // percent parses as depositPercent 0. This fixture pins that behaviour so
    // the limitation is recorded rather than assumed.
    name: "11-deposit-fixed-amount-not-supported",
    describes: "Fixed-amount deposit, which the current format does not model (parses as 0 percent)",
    kind: "valid",
    expect: { itemCount: 1 },
    summary: doc({
      title: "Fixed Deposit Job",
      lineItems: qtyTable(["| Labour | 10 | hrs | $95.00 | $950.00 |"]),
      pricing: [
        "| | |",
        "|---|---|",
        "| Subtotal | $950 |",
        "| Tax (GST 5%) | $48 |",
        "| **Total** | **$998** |",
        "| Deposit required | $400 |",
        "| Balance on completion | $598 |",
      ].join("\n"),
    }),
  },
  {
    name: "12-assumptions",
    describes: "Assumptions section present",
    kind: "valid",
    expect: { itemCount: 1 },
    summary: doc({
      title: "With Assumptions",
      lineItems: qtyTable(["| Labour | 4 | hrs | $95.00 | $380.00 |"]),
      assumptions: [
        "Existing shutoff valves are working",
        "Water can be shut off during the work",
      ],
      pricing: pricing({}),
    }),
  },
  {
    name: "13-exclusions",
    describes: "Exclusions written into the same section",
    kind: "valid",
    expect: { itemCount: 1 },
    summary: doc({
      title: "With Exclusions",
      lineItems: qtyTable(["| Labour | 4 | hrs | $95.00 | $380.00 |"]),
      assumptions: [
        "Drywall repair is not included",
        "Painting is not included",
        "Permit costs are not included unless listed above",
      ],
      pricing: pricing({}),
    }),
  },
  {
    name: "14-payment-terms",
    describes: "Payment terms section",
    kind: "valid",
    expect: { itemCount: 1 },
    summary: doc({
      title: "With Terms",
      lineItems: qtyTable(["| Labour | 4 | hrs | $95.00 | $380.00 |"]),
      pricing: pricing({}),
      paymentTerms:
        "Payment due on completion.\nWe accept e-transfer or cheque.\nThis estimate is valid for 30 days from the date above.",
    }),
  },
  {
    name: "15-notes",
    describes: "Notes section",
    kind: "valid",
    expect: { itemCount: 1 },
    summary: doc({
      title: "With Notes",
      lineItems: qtyTable(["| Labour | 4 | hrs | $95.00 | $380.00 |"]),
      pricing: pricing({}),
      notes: "Customer asked us to call before arriving.",
    }),
  },
  {
    name: "16-missing-optional-sections",
    describes: "Only line items and pricing, everything optional omitted",
    kind: "valid",
    expect: { itemCount: 1 },
    summary: ["## Line Items", ...QTY_HEADER, "| Labour | 4 | hrs | $95.00 | $380.00 |", "", "## Pricing Summary", pricing({})].join("\n"),
  },
  {
    name: "17-multiline-prose-outside-table",
    describes: "Multiline prose in the preamble and in sections around the table",
    kind: "valid",
    expect: { itemCount: 2 },
    summary: doc({
      title: "Prose Heavy",
      preamble:
        "This job covers the upstairs bathroom only.\nThe downstairs bathroom was quoted separately.\n\nEstimated total: $0",
      scope: ["Remove old vanity", "Install new vanity"],
      lineItems: qtyTable([
        "| Labour | 6 | hrs | $95.00 | $570.00 |",
        "| Vanity | 1 | ea | $640.00 | $640.00 |",
      ]),
      pricing: pricing({}),
      extraSections: "## Warranty\nOne year on labour.\nManufacturer warranty on parts.",
      notes: "Access through the side door.\nDog on site.",
    }),
  },
  {
    name: "18-similar-descriptions",
    describes: "Similar but distinct line-item descriptions",
    kind: "valid",
    expect: { itemCount: 4 },
    summary: doc({
      title: "Similar Descriptions",
      lineItems: qtyTable([
        "| Labour, rough-in | 6 | hrs | $95.00 | $570.00 |",
        "| Labour, finish | 4 | hrs | $95.00 | $380.00 |",
        "| Labour rough in | 1 | hrs | $95.00 | $95.00 |",
        "| Labour (finish) | 1 | hrs | $95.00 | $95.00 |",
      ]),
      pricing: pricing({}),
    }),
  },
  {
    name: "19-duplicate-descriptions",
    describes: "Exactly duplicated line-item descriptions",
    kind: "valid",
    expect: { itemCount: 3 },
    summary: doc({
      title: "Duplicate Descriptions",
      lineItems: qtyTable([
        "| Service call | 1 | ea | $120.00 | $120.00 |",
        "| Service call | 1 | ea | $120.00 | $120.00 |",
        "| Service call |  |  |  | $120.00 |",
      ]),
      pricing: pricing({}),
    }),
  },
  {
    name: "20-zero-value-line-item",
    describes: "Zero-value line item, which the current format permits",
    kind: "valid",
    expect: { itemCount: 3 },
    summary: doc({
      title: "Zero Value Row",
      lineItems: qtyTable([
        "| Labour | 4 | hrs | $95.00 | $380.00 |",
        "| Warranty callback, no charge | 1 | ea | $0.00 | $0.00 |",
        "| Disposal, waived |  |  |  | $0.00 |",
      ]),
      pricing: pricing({}),
    }),
  },
  {
    name: "21-rounding-sensitive",
    describes: "Rounding-sensitive values that land on a half cent and a half dollar",
    kind: "valid",
    // Subtotal 333.325; tax at 5 percent is 16.66625, Math.round gives 17.
    expect: { itemCount: 3 },
    summary: doc({
      title: "Rounding Sensitive",
      lineItems: qtyTable([
        "| Labour | 3.5 | hrs | $95.05 | $332.68 |",
        "| Fitting | 0.5 | ea | $0.05 | $0.03 |",
        "| Odd charge |  |  |  | $0.615 |",
      ]),
      pricing: pricing({ taxRate: 5 }),
    }),
  },
  {
    name: "22-large-realistic-estimate",
    describes: "Realistic larger estimate with more than 20 line items",
    kind: "valid",
    expect: { itemCount: 24 },
    summary: doc({
      title: "Full Bathroom Renovation",
      preamble:
        "Complete renovation of the main bathroom. Demolition, rough-in, finishing, and cleanup.\n\nEstimated total: $0",
      scope: [
        "Demolish existing bathroom to studs",
        "Rough-in new plumbing and electrical",
        "Install new tub, toilet, and vanity",
        "Tile floor and tub surround",
        "Paint and install trim",
      ],
      lineItems: qtyTable([
        "| Labour, demolition | 12 | hrs | $95.00 | $1,140.00 |",
        "| Disposal bin |  |  |  | $420.00 |",
        "| Labour, plumbing rough-in | 14 | hrs | $115.00 | $1,610.00 |",
        "| PEX and fittings | 1 | lot | $340.00 | $340.00 |",
        "| Labour, electrical rough-in | 8 | hrs | $115.00 | $920.00 |",
        "| Wire and boxes | 1 | lot | $210.00 | $210.00 |",
        "| Exhaust fan | 1 | ea | $189.00 | $189.00 |",
        "| Labour, framing | 6 | hrs | $95.00 | $570.00 |",
        "| Lumber | 1 | lot | $265.00 | $265.00 |",
        "| Cement board | 8 | sheet | $28.00 | $224.00 |",
        "| Waterproofing membrane | 60 | sqft | $3.40 | $204.00 |",
        "| Labour, tile setting | 20 | hrs | $105.00 | $2,100.00 |",
        "| Floor tile | 55 | sqft | $8.20 | $451.00 |",
        "| Wall tile | 90 | sqft | $9.60 | $864.00 |",
        "| Thinset and grout | 1 | lot | $185.00 | $185.00 |",
        "| Tub | 1 | ea | $780.00 | $780.00 |",
        "| Toilet | 1 | ea | $410.00 | $410.00 |",
        "| Vanity and top | 1 | ea | $1,150.00 | $1,150.00 |",
        "| Tub and shower valve | 1 | ea | $365.00 | $365.00 |",
        "| Labour, finish plumbing | 8 | hrs | $115.00 | $920.00 |",
        "| Labour, painting | 8 | hrs | $85.00 | $680.00 |",
        "| Paint and supplies | 1 | lot | $175.00 | $175.00 |",
        "| Trim and door | 1 | lot | $290.00 | $290.00 |",
        "| Permit fee |  |  |  | $260.00 |",
      ]),
      assumptions: [
        "Existing subfloor is sound and does not need replacing",
        "No asbestos or mould is present",
        "Customer selects all finishes before work begins",
        "Structural changes are not included",
      ],
      pricing: pricing({ depositPercent: 25 }),
      paymentTerms:
        "25 percent deposit due before work begins.\nBalance due on completion.\nThis estimate is valid for 30 days from the date above.",
      notes: "Work is scheduled in two phases, roughly three weeks total.",
    }),
  },
  {
    name: "23-legacy-two-column",
    describes: "Legacy two-column estimate saved before the structured table shipped",
    kind: "valid",
    expect: { itemCount: 3, legacyTwoColumn: true },
    summary: doc({
      title: "Legacy Format",
      lineItems: flatTable([
        "| Labour | $420.00 |",
        "| Materials | $265.00 |",
        "| Disposal | $80.00 |",
      ]),
      pricing: pricing({}),
    }),
  },
  {
    name: "24-no-title-h1",
    describes: "Already-edited estimate, H1 title absent because the serializer dropped it",
    kind: "valid",
    expect: { itemCount: 2 },
    summary: [
      "Replace the leaking kitchen tap.",
      "",
      "Estimated total: $224",
      "",
      "## Line Items",
      ...QTY_HEADER,
      "| Labour | 2 | hrs | $95.00 | $190.00 |",
      "| Fittings | 1 | ea | $34.00 | $34.00 |",
      "",
      "## Pricing Summary",
      pricing({}),
    ].join("\n"),
  },
];

// ── Negative fixtures ─────────────────────────────────────────────────────────
//
// Each must fail explicitly. None may silently produce a valid migration.

const negative: EstimateFixture[] = [
  {
    name: "n01-stray-subtotal-row",
    describes: "Stray Subtotal row inside the line-item table (the known parser defect)",
    kind: "negative",
    expectFailureContaining: "reserved-total-row",
    summary: doc({
      title: "Stray Subtotal",
      lineItems: qtyTable([
        "| Labour | 3 | hrs | $95.00 | $285.00 |",
        "| Subtotal |  |  |  | $285.00 |",
      ]),
      pricing: pricing({}),
    }),
  },
  {
    name: "n02-duplicate-subtotal-rows",
    describes: "Two totals rows inside the line-item table",
    kind: "negative",
    expectFailureContaining: "reserved-total-row",
    summary: doc({
      title: "Duplicate Totals Rows",
      lineItems: qtyTable([
        "| Labour | 3 | hrs | $95.00 | $285.00 |",
        "| Subtotal |  |  |  | $285.00 |",
        "| Total |  |  |  | $299.00 |",
      ]),
      pricing: pricing({}),
    }),
  },
  {
    name: "n03-tax-row-in-line-items",
    describes: "Tax row leaked into the line-item table",
    kind: "negative",
    expectFailureContaining: "reserved-total-row",
    summary: doc({
      title: "Tax Row Leak",
      lineItems: qtyTable([
        "| Labour | 3 | hrs | $95.00 | $285.00 |",
        "| Tax (GST 5%) |  |  |  | $14.00 |",
      ]),
      pricing: pricing({}),
    }),
  },
  {
    name: "n04-deposit-row-in-line-items",
    describes: "Deposit row leaked into the line-item table",
    kind: "negative",
    expectFailureContaining: "reserved-total-row",
    summary: doc({
      title: "Deposit Row Leak",
      lineItems: qtyTable([
        "| Labour | 3 | hrs | $95.00 | $285.00 |",
        "| Deposit required (30%) |  |  |  | $90.00 |",
      ]),
      pricing: pricing({}),
    }),
  },
  {
    name: "n05-row-with-no-description",
    describes: "Priced row with an empty description",
    kind: "negative",
    expectFailureContaining: "empty-description",
    summary: doc({
      title: "No Description",
      lineItems: qtyTable([
        "| Labour | 3 | hrs | $95.00 | $285.00 |",
        "|  |  |  |  | $120.00 |",
      ]),
      pricing: pricing({}),
    }),
  },
  {
    name: "n06-row-with-no-numeric-value",
    describes: "Row whose amount cell holds prose instead of money",
    kind: "negative",
    expectFailureContaining: "unparseable-amount",
    summary: doc({
      title: "No Numeric Value",
      lineItems: qtyTable([
        "| Labour | 3 | hrs | $95.00 | $285.00 |",
        "| Disposal |  |  |  | TBD |",
      ]),
      pricing: pricing({}),
    }),
  },
  {
    name: "n07-invalid-currency",
    describes: "Amount cell with an unreadable currency string",
    kind: "negative",
    expectFailureContaining: "unparseable-amount",
    summary: doc({
      title: "Invalid Currency",
      lineItems: qtyTable([
        "| Labour | 3 | hrs | $95.00 | $285.00 |",
        "| Parts |  |  |  | approx. $40-$60 |",
      ]),
      pricing: pricing({}),
    }),
  },
  {
    name: "n08-group-column-first",
    describes: "Group column placed first, which the current parser misreads catastrophically",
    kind: "negative",
    // The current parser reads the HEADER row as a data row here, because its
    // header guard only skips rows whose first cell starts with "item". The
    // conversion layer catches it as an unreadable quantity, since the header
    // cell "Qty" lands in the quantity column. That is the correct detection:
    // it refuses the estimate rather than silently producing a $0 subtotal.
    expectFailureContaining: "unparseable-quantity",
    summary: doc({
      title: "Group Column First",
      lineItems: [
        "| Group | Item | Qty | Unit | Rate | Cost |",
        "|-------|------|-----|------|------|------|",
        "| Demolition | Labour | 3 | hrs | $95.00 | $285.00 |",
        "| Fixtures | Permit |  |  |  | $150.00 |",
      ].join("\n"),
      pricing: pricing({}),
    }),
  },
  {
    name: "n09-missing-header-row",
    describes: "Table with no header row at all",
    kind: "negative",
    // Caught on the junk quantity and unit-cost cells of the second row.
    expectFailureContaining: "unparseable-quantity",
    summary: doc({
      title: "No Header",
      lineItems: ["| Labour | 3 | hrs | $95.00 | $285.00 |", "| Parts | x | y | z | w |"].join("\n"),
      pricing: pricing({}),
    }),
  },
  {
    name: "n10-empty-estimate",
    describes: "Estimate with no priced line items",
    kind: "negative",
    expectFailureContaining: "no priced line items",
    summary: doc({
      title: "Empty",
      lineItems: qtyTable([]),
      pricing: pricing({}),
    }),
  },
  {
    name: "n11-missing-line-items-section",
    describes: "Estimate with no Line Items section at all",
    kind: "negative",
    expectFailureContaining: "no priced line items",
    summary: [
      "# No Line Items",
      "",
      "Some prose.",
      "",
      "## Pricing Summary",
      pricing({}),
    ].join("\n"),
  },
  {
    name: "n12-pipe-in-description",
    describes: "Description containing a pipe character, which would break the table",
    kind: "negative",
    expectFailureContaining: "unparseable-amount",
    summary: doc({
      title: "Pipe In Description",
      lineItems: qtyTable(["| Labour | 3 | hrs | $95.00 | $285.00 |", "| Supply | install |  |  |  | $60.00 |"]),
      pricing: pricing({}),
    }),
  },
  {
    name: "n13-negative-amount",
    describes: "Negative amount, which parses today but is flagged as suspicious",
    kind: "negative",
    expectFailureContaining: "negative-amount",
    // Deliberately non-blocking. Negative amounts parse and total correctly
    // under the current rules, so refusing them would be this slice inventing a
    // product rule. Surfaced as a finding, migration still permitted.
    expectBlocking: false,
    summary: doc({
      title: "Negative Amount",
      lineItems: qtyTable([
        "| Labour | 3 | hrs | $95.00 | $285.00 |",
        "| Goodwill credit |  |  |  | -$50.00 |",
      ]),
      pricing: pricing({}),
    }),
  },
];

// Sanitised representatives of the real production corpus, generated by
// scripts/audit-estimate-summary-formats.ts. Kept in a separate module so the
// synthetic corpus above is never overwritten by a regeneration.
//
// The import is at the bottom deliberately: production-sanitised.ts imports the
// EstimateFixture TYPE from this file, and a type-only import is erased at
// runtime, so there is no runtime cycle.
import { productionFixtures } from "./production-sanitised";

export const syntheticValidFixtures: EstimateFixture[] = valid;
export const syntheticNegativeFixtures: EstimateFixture[] = negative;

export const productionValidFixtures: EstimateFixture[] = productionFixtures.filter(
  (f) => f.kind === "valid"
);
export const productionNegativeFixtures: EstimateFixture[] = productionFixtures.filter(
  (f) => f.kind === "negative"
);

/**
 * Synthetic plus sanitised production. The conversion suite enumerates these,
 * so adding a future corpus export needs no test changes.
 */
export const validFixtures: EstimateFixture[] = [...valid, ...productionValidFixtures];
export const negativeFixtures: EstimateFixture[] = [...negative, ...productionNegativeFixtures];
export const allFixtures: EstimateFixture[] = [...validFixtures, ...negativeFixtures];

export { productionFixtures };
