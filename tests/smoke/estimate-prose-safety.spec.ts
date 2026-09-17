import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { sanitizeGeneratedProse, stripTitleHeading } from "../../lib/estimate-prose";

/**
 * Phase 1 slice 4: the prose price-safety filter
 * (specs/contractor-owned-pricing.md section 10).
 *
 * No browser, no network, no database. The filter is a guardrail on
 * MODEL-generated prose only: the prompt already forbids prices, this deletes
 * the ones the model writes anyway, and it never retries and never blocks a
 * save.
 */

const root = path.join(__dirname, "../..");
const code = (file: string) => readFileSync(path.join(root, file), "utf8");

test("a sentence with a dollar figure is deleted and the rest of the paragraph survives", () => {
  const result = sanitizeGeneratedProse(
    [
      "# Water Heater Replacement",
      "",
      "## Job Summary",
      "Replace the failed 50 gallon gas water heater. The unit is $1,450 supplied and installed. Old tank hauled away the same day.",
    ].join("\n")
  );

  expect(result.prose).toContain("Replace the failed 50 gallon gas water heater.");
  expect(result.prose).toContain("Old tank hauled away the same day.");
  expect(result.prose).not.toContain("$1,450");
  expect(result.removedSentences).toBe(1);
  expect(result.removedHeadings).toBe(0);
});

test("CA$, US$, spelled-out dollars and deposits are all leakage", () => {
  const leaks = [
    "The permit is CA$150 on top.",
    "Materials come to US$410 before tax.",
    "Disposal runs about 90 dollars.",
    "A 1 dollar handling charge applies.",
    "A deposit is required before the work starts.",
    "Deposits are non-refundable.",
  ];

  for (const sentence of leaks) {
    const result = sanitizeGeneratedProse(`## Notes\nWork starts Monday. ${sentence}`);
    expect(result.prose, sentence).toContain("Work starts Monday.");
    expect(result.prose, sentence).not.toContain(sentence);
    expect(result.removedSentences, sentence).toBe(1);
  }
});

test("a generic pricing hedge is leakage even with no dollar amount in it", () => {
  // Observed live: the model wrote "pricing may change" into Assumptions.
  // No figure, but it still puts the model between the contractor and their
  // own price, and the contractor is the one who says that if it needs
  // saying.
  const hedges = [
    "Final pricing may change once the wall is opened up.",
    "The price may change if the fitting is seized.",
    "Prices could change depending on access.",
    "Additional charges may apply for after-hours work.",
    "Additional fees apply if a permit is required.",
    "Additional costs may apply for disposal.",
  ];

  for (const sentence of hedges) {
    const result = sanitizeGeneratedProse(`## Assumptions and Exclusions\nAccess is through the crawlspace. ${sentence}`);
    expect(result.prose, sentence).toContain("Access is through the crawlspace.");
    expect(result.prose, sentence).not.toContain(sentence);
    expect(result.removedSentences, sentence).toBe(1);
  }
});

test("the hedge pattern does not eat ordinary prose about scope changing", () => {
  // Narrow on purpose. A sentence about the work changing is the contractor's
  // own scope language and must survive; only the pricing hedge goes.
  const kept = [
    "The scope may change once the wall is opened up.",
    "We will confirm the fitting size on site before ordering.",
    "Access may change if the tenant moves the shelving.",
    "Any change to the work is confirmed with you first.",
  ];

  for (const sentence of kept) {
    const result = sanitizeGeneratedProse(`## Notes\n${sentence}`);
    expect(result.prose, sentence).toContain(sentence);
    expect(result.removedSentences, sentence).toBe(0);
  }
});

test("prose with nothing to remove comes back byte for byte", () => {
  const clean = [
    "# Panel Upgrade",
    "",
    "## Scope of Work",
    "- Pull the electrical permit",
    "- Swap the 100A panel for a 200A panel",
    "- Reconnect and label every circuit",
    "",
    "## Assumptions and Exclusions",
    "The existing service entrance is sound. Drywall patching around the panel is not included.",
    "",
    "## Notes",
    "The power is off for most of the day, so plan for that.",
  ].join("\n");

  const result = sanitizeGeneratedProse(clean);
  expect(result.prose).toBe(clean);
  expect(result.removedSentences).toBe(0);
  expect(result.removedHeadings).toBe(0);
  expect(result.removedSections).toBe(0);
});

test("filtering an all-price section removes the section heading, not just the sentences", () => {
  const result = sanitizeGeneratedProse(
    [
      "# Drain Cleaning",
      "",
      "## Scope of Work",
      "- Clear the blocked main drain",
      "",
      "## Pricing Summary",
      "| Subtotal | $650 |",
      "| Total | $682.50 |",
      "",
      "## Notes",
      "The cleanout is behind the water heater, so allow room to work.",
    ].join("\n")
  );

  expect(result.prose).not.toContain("Pricing Summary");
  expect(result.prose).not.toContain("$650");
  expect(result.prose).not.toContain("$682.50");
  expect(result.removedHeadings).toBe(1);
  expect(result.removedSentences).toBe(2);

  // The sections either side are untouched, and no empty heading is left
  // anywhere in the output.
  expect(result.prose).toContain("## Scope of Work");
  expect(result.prose).toContain("- Clear the blocked main drain");
  expect(result.prose).toContain("## Notes");
  expect(result.prose).toContain("The cleanout is behind the water heater, so allow room to work.");
  expect(result.prose).not.toMatch(/\n#{1,6} [^\n]*\n\s*(#{1,6} |$)/);
});

test("a heading the model left empty on its own is not removed", () => {
  // Nothing was filtered out of it, so nothing about it is the filter's
  // doing. Only a section the filter emptied loses its heading.
  const source = [
    "## Notes",
    "",
    "## Assumptions and Exclusions",
    "The shutoff valve is accessible.",
  ].join("\n");
  const result = sanitizeGeneratedProse(source);

  expect(result.prose).toContain("## Notes");
  expect(result.removedHeadings).toBe(0);
  expect(result.removedSentences).toBe(0);
});

test("a heading that only introduces a subheading survives", () => {
  const result = sanitizeGeneratedProse(
    ["## Assumptions and Exclusions", "### Included", "- Haul away the old unit"].join("\n")
  );

  expect(result.prose).toContain("## Assumptions and Exclusions");
  expect(result.prose).toContain("### Included");
  expect(result.removedHeadings).toBe(0);
});

test("a bullet keeps its marker when only one of its sentences leaks", () => {
  const result = sanitizeGeneratedProse(
    "- Supply and install the new fixture. Fixture cost is $220."
  );

  expect(result.prose).toBe("- Supply and install the new fixture.");
  expect(result.removedSentences).toBe(1);
});

test("a whole bullet goes when it is nothing but a price", () => {
  const result = sanitizeGeneratedProse(
    ["## Scope of Work", "- Replace the shutoff valves", "- Labour: $380.00"].join("\n")
  );

  expect(result.prose).toContain("- Replace the shutoff valves");
  expect(result.prose).not.toContain("380");
  expect(result.removedHeadings).toBe(0);
});

test("contractor-authored prose is never run through the filter", () => {
  // Section 10: contractor-typed figures are traceable to the contractor and
  // are left alone. Only the generation route sanitizes, and it sanitizes the
  // model's own output, once, before the row is written.
  const generate = code("app/api/generate-estimate/route.ts");
  expect(generate).toContain("const sanitized = sanitizeGeneratedProse(fullText);");

  const patchRoute = code("app/api/estimates/route.ts");
  expect(patchRoute).not.toContain("sanitizeGeneratedProse");
  expect(patchRoute).not.toContain("estimate-prose");

  // And no other route sanitizes anything either.
  const pricingRoute = code("app/api/estimates/[id]/pricing/route.ts");
  expect(pricingRoute).not.toContain("sanitizeGeneratedProse");
});

// Commercial and contractual terms ---------------------------------------
//
// Second live run. The photo restraint held, but the model was still
// writing the business's terms for it: "quoted separately", "cost will
// depend on what we find", "The balance is due upon completion", "This
// estimate is valid for 30 days". None of those is the model's to say, and
// TradePulse has no setting holding any of them yet, so there is nothing to
// substitute either. Phase 1 generation is the job summary, the scope, the
// assumptions and exclusions, and job-specific notes. Nothing else.

test("separate-quoting language is leakage", () => {
  const leaks = [
    "The tile work is quoted separately.",
    "Drywall repair is priced separately.",
    "Permit handling is separately quoted.",
    "Disposal is billed separately.",
  ];

  for (const sentence of leaks) {
    const result = sanitizeGeneratedProse(`## Assumptions and Exclusions\nThe shutoff is accessible. ${sentence}`);
    expect(result.prose, sentence).toContain("The shutoff is accessible.");
    expect(result.prose, sentence).not.toContain(sentence);
    expect(result.removedSentences, sentence).toBe(1);
  }
});

test("cost-will-depend language is leakage", () => {
  const leaks = [
    "The cost will depend on what we find behind the wall.",
    "Costs will depend on the condition of the subfloor.",
    "Final cost may depend on access to the crawlspace.",
    "The price would depend on whether the valve is seized.",
  ];

  for (const sentence of leaks) {
    const result = sanitizeGeneratedProse(`## Notes\nAccess is through the crawlspace. ${sentence}`);
    expect(result.prose, sentence).toContain("Access is through the crawlspace.");
    expect(result.prose, sentence).not.toContain(sentence);
    expect(result.removedSentences, sentence).toBe(1);
  }
});

test("the rewrite the prompt asks for instead of a pricing hedge survives", () => {
  // The model is told to write the condition rather than talk about price.
  // If the filter ate this too, the instruction would have nowhere to land.
  const wanted =
    "If additional deterioration is found, we will discuss the added scope with you before proceeding.";
  const result = sanitizeGeneratedProse(`## Assumptions and Exclusions\n${wanted}`);

  expect(result.prose).toContain(wanted);
  expect(result.removedSentences).toBe(0);
});

test("an AI-written Payment Terms section is dropped whole, heading and all", () => {
  const result = sanitizeGeneratedProse(
    [
      "# Under-Sink Repair",
      "",
      "## Scope of Work",
      "- Replace the failed shutoff valve",
      "",
      "## Payment Terms",
      "The balance is due upon completion.",
      "This estimate is valid for 30 days from the date above.",
      "",
      "## Notes",
      "The cabinet base is damp and should be checked once the valve is out.",
    ].join("\n")
  );

  expect(result.prose).not.toContain("Payment Terms");
  expect(result.prose).not.toContain("balance is due");
  expect(result.prose).not.toContain("valid for 30 days");
  expect(result.removedSections).toBe(1);

  expect(result.prose).toContain("## Scope of Work");
  expect(result.prose).toContain("- Replace the failed shutoff valve");
  expect(result.prose).toContain("## Notes");
  expect(result.prose).toContain("The cabinet base is damp and should be checked once the valve is out.");
});

test("an invented validity period or payment date is removed wherever it appears", () => {
  // Not only under a Payment Terms heading: the model moves these around.
  const terms = [
    "This estimate is valid for 30 days from the date above.",
    "This quote is valid for 14 business days.",
    "The balance is due upon completion.",
    "Payment is due within 15 days.",
    "Standard payment terms apply.",
    "The work carries a two year warranty.",
    "Financing is available on request.",
    "A cancellation fee applies inside 48 hours.",
  ];

  for (const sentence of terms) {
    const result = sanitizeGeneratedProse(`## Notes\nThe unit sits in a tight closet. ${sentence}`);
    expect(result.prose, sentence).toContain("The unit sits in a tight closet.");
    expect(result.prose, sentence).not.toContain(sentence);
    expect(result.removedSentences, sentence).toBe(1);
  }
});

test("ordinary non-commercial scope prose still survives all of it", () => {
  // The whole risk of this filter is eating the job. These are the sentences
  // it must never touch: timing, sequencing, access, condition, what has to
  // be confirmed on site.
  const kept = [
    "The work takes most of a day, so plan to be without water.",
    "We will confirm the valve size on site before ordering.",
    "Access is due to be cleared by the tenant before we arrive.",
    "Damage behind the cabinet base is inspected once the valve is out.",
    "The scope may change once the wall is opened up.",
    "Dark staining is present under the sink and should be checked.",
    "The braided supply line is inspected and replaced if damaged.",
    "Old fittings are hauled away on completion.",
    "Work is scheduled within two weeks of approval.",
  ];

  for (const sentence of kept) {
    const result = sanitizeGeneratedProse(`## Scope of Work\n- ${sentence}`);
    expect(result.prose, sentence).toContain(sentence);
    expect(result.removedSentences, sentence).toBe(0);
    expect(result.removedSections, sentence).toBe(0);
  }
});

test("stripTitleHeading removes only the H1, for screens that show the title separately", () => {
  const prose = ["# Water Heater Replacement", "", "## Job Summary", "Swap the tank."].join("\n");

  expect(stripTitleHeading(prose)).toBe(["## Job Summary", "Swap the tank."].join("\n"));
  expect(stripTitleHeading("## Job Summary\nSwap the tank.")).toBe("## Job Summary\nSwap the tank.");
});
