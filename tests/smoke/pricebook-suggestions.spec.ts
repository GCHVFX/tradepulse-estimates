import { expect, test } from "@playwright/test";
import {
  suggestPriceBookItems,
  MIN_SUGGESTION_SCORE,
  MAX_SUGGESTIONS,
  type PriceBookSuggestionItem,
} from "../../lib/pricebook-suggestions";

/**
 * Phase 2 slice 1: the pure deterministic price-book suggestion matcher.
 *
 * No browser, no network, no database, no LLM. A suggestion here is inert --
 * it carries no price and is not persisted. These tests only check candidate
 * identity and ranking, never a dollar total (that is a later slice).
 */

const FIXTURE_ITEMS: PriceBookSuggestionItem[] = [
  {
    id: "faucet",
    name: "Kitchen faucet replacement",
    description:
      "Remove existing kitchen faucet, install replacement faucet, reconnect water supplies, and test for leaks",
    category: "Faucets",
  },
  {
    id: "shutoff",
    name: "Quarter-turn shutoff valve replacement",
    description: "Replace one under-sink shutoff valve with a quarter-turn valve and test for leaks",
    category: "Valves",
  },
  {
    id: "supply-line",
    name: "Braided supply line replacement",
    description: "Replace one braided faucet supply line and test connection",
    category: "Supply Lines",
  },
  {
    id: "p-trap",
    name: "Kitchen P-trap replacement",
    description: "Remove and replace accessible kitchen sink P-trap and test drain for leaks",
    category: "Drains",
  },
  {
    id: "drain-clear",
    name: "Drain clearing",
    description: "Clear an accessible blocked kitchen or bathroom drain",
    category: "Drains",
  },
  {
    id: "toilet",
    name: "Toilet replacement labour",
    description: "Remove existing toilet and install replacement toilet",
    category: "Toilets",
  },
];

const JOB_A =
  "Customer has a leaking kitchen faucet. Replace the existing kitchen faucet, replace both corroded " +
  "shutoff valves under the sink, and replace both braided faucet supply lines. The existing sink, " +
  "countertop, and drain stay in place. Test all new connections for leaks and clean up when finished. " +
  "There is no blocked drain and no toilet work required.";

const JOB_B = "Toilet is cracked at the base and leaking. Remove the old toilet and install a new one.";

const JOB_C = "Kitchen sink is backing up and draining slowly. Clear the blocked drain.";

const JOB_D = "Replace the P-trap under the bathroom sink, it is leaking at the joint.";

function idsOf(suggestions: { id: string }[]): string[] {
  return suggestions.map((s) => s.id);
}

// ── 1: exact/strong match ─────────────────────────────────────────────────

test("1: a strong, near-exact job description returns that saved item", () => {
  const result = suggestPriceBookItems(
    "Need to replace the kitchen faucet, it's leaking under the handle",
    FIXTURE_ITEMS
  );
  expect(idsOf(result)).toContain("faucet");
});

// ── 2 & 3: Job A ─────────────────────────────────────────────────────────

test("2: Job A returns the three intended items at the top of the ranking", () => {
  const result = suggestPriceBookItems(JOB_A, FIXTURE_ITEMS);
  const topThree = idsOf(result).slice(0, 3);
  expect(topThree).toEqual(["supply-line", "shutoff", "faucet"]);
});

test("3: Job A's remaining above-threshold items are documented, not forced out", () => {
  // No negation handling in v1 (specs/contractor-owned-pricing.md Phase 2
  // audit): "no toilet work" and "drain stay in place" still leave literal
  // "toilet" and "drain" tokens in the job text, so drain-clearing and
  // toilet-replacement can legitimately clear the floor as low-ranked,
  // inert suggestions. Kitchen P-trap replacement does not, because it has
  // zero literal name-token overlap with Job A ("trap" never appears).
  const result = suggestPriceBookItems(JOB_A, FIXTURE_ITEMS);
  expect(idsOf(result)).toEqual(["supply-line", "shutoff", "faucet", "drain-clear", "toilet"]);
  expect(result.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
  expect(idsOf(result)).not.toContain("p-trap");
});

// ── 4, 5, 6: positive controls ───────────────────────────────────────────

test("4: Job B returns Toilet replacement labour", () => {
  const result = suggestPriceBookItems(JOB_B, FIXTURE_ITEMS);
  expect(idsOf(result)).toContain("toilet");
});

test("5: Job C returns Drain clearing", () => {
  const result = suggestPriceBookItems(JOB_C, FIXTURE_ITEMS);
  expect(idsOf(result)).toContain("drain-clear");
});

test("6: Job D returns Kitchen P-trap replacement or nothing, never Kitchen faucet replacement", () => {
  const result = suggestPriceBookItems(JOB_D, FIXTURE_ITEMS);
  const ids = idsOf(result);
  expect(ids.every((id) => id === "p-trap")).toBe(true);
  expect(ids).not.toContain("faucet");
});

// ── 7: quantity is always exactly 1 ─────────────────────────────────────

test("7: quantity is always exactly 1, even when the job text says 'both' or 'two'", () => {
  const bothResult = suggestPriceBookItems(
    "replace both shutoff valves under the sink, they are corroded",
    FIXTURE_ITEMS
  );
  const twoResult = suggestPriceBookItems(
    "replace two shutoff valves under the sink, they are corroded",
    FIXTURE_ITEMS
  );
  expect(bothResult.length).toBeGreaterThan(0);
  expect(twoResult.length).toBeGreaterThan(0);
  for (const suggestion of [...bothResult, ...twoResult]) {
    expect(suggestion.quantity).toBe(1);
  }
});

// ── 8: generic-only overlap is suppressed ───────────────────────────────

test("8: sharing only generic words (kitchen, replace, install) is not enough alone", () => {
  const result = suggestPriceBookItems("Kitchen work, please replace and install as needed.", FIXTURE_ITEMS);
  expect(result).toEqual([]);
});

// ── 9: description can strengthen a legitimate candidate ───────────────

test("9: description overlap raises the score of a candidate the name already supports", () => {
  const nameOnly = suggestPriceBookItems("kitchen faucet job", FIXTURE_ITEMS).find((s) => s.id === "faucet");
  const nameAndDesc = suggestPriceBookItems(
    "kitchen faucet job, need to reconnect the water supply and check for leaks",
    FIXTURE_ITEMS
  ).find((s) => s.id === "faucet");
  expect(nameOnly).toBeDefined();
  expect(nameAndDesc).toBeDefined();
  expect(nameAndDesc!.score).toBeGreaterThan(nameOnly!.score);
});

// ── 10: category alone cannot cause a suggestion ────────────────────────

test("10: a category-only word match never produces a suggestion", () => {
  const categoryOnlyItem: PriceBookSuggestionItem = {
    id: "unrelated",
    name: "Test Item Alpha",
    description: "unrelated placeholder text with no shared terms",
    category: "Drains",
  };
  const result = suggestPriceBookItems("the drain is draining a little slow today", [categoryOnlyItem]);
  expect(result).toEqual([]);
});

// ── 11 & 12: empty inputs ────────────────────────────────────────────────

test("11: an empty price-book list returns no suggestions", () => {
  expect(suggestPriceBookItems(JOB_A, [])).toEqual([]);
});

test("12: empty or whitespace-only job text returns no suggestions", () => {
  expect(suggestPriceBookItems("", FIXTURE_ITEMS)).toEqual([]);
  expect(suggestPriceBookItems("   ", FIXTURE_ITEMS)).toEqual([]);
});

// ── 13: case/punctuation insensitivity ──────────────────────────────────

test("13: matching is case and punctuation insensitive", () => {
  const plain = suggestPriceBookItems("replace the kitchen faucet, it is leaking", FIXTURE_ITEMS);
  const shouty = suggestPriceBookItems("REPLACE THE KITCHEN FAUCET!!! IT'S LEAKING...", FIXTURE_ITEMS);
  expect(idsOf(shouty)).toEqual(idsOf(plain));
});

// ── 14: no money fields ever appear on the output ───────────────────────

test("14: suggestion output carries no price fields", () => {
  const result = suggestPriceBookItems(JOB_A, FIXTURE_ITEMS);
  expect(result.length).toBeGreaterThan(0);
  for (const suggestion of result) {
    expect(Object.keys(suggestion).sort()).toEqual(["id", "name", "quantity", "score"]);
  }
});

// ── 15: deterministic ordering ───────────────────────────────────────────

test("15: equal-score candidates keep a deterministic, input-order tie-break", () => {
  const tiedItems: PriceBookSuggestionItem[] = [
    { id: "second", name: "Widget replacement", description: null, category: "General" },
    { id: "first", name: "Widget replacement", description: null, category: "General" },
  ];
  const jobText = "need a widget replaced";
  const first = suggestPriceBookItems(jobText, tiedItems);
  const second = suggestPriceBookItems(jobText, tiedItems);
  expect(idsOf(first)).toEqual(["second", "first"]); // stable on original input order, not alphabetical
  expect(idsOf(first)).toEqual(idsOf(second)); // deterministic across runs
});

// ── threshold / count constants are used, not magic numbers ─────────────

test("MIN_SUGGESTION_SCORE and MAX_SUGGESTIONS are the module's only tunables", () => {
  expect(MIN_SUGGESTION_SCORE).toBeGreaterThan(0);
  expect(MAX_SUGGESTIONS).toBe(5);
});
