// Column-matching for the price-book CSV import ("Rates" page). Turns a
// customer's raw CSV header row into a best-effort mapping to the two
// required fields (Name, Rate/Price) plus two optional ones (Category,
// Unit), or reports that a required field couldn't be confidently matched
// so the UI can fall back to a manual mapping screen instead of silently
// importing a real price as $0.00.
//
// This was a real production bug: a file with headers "Unit" and
// "Rate (CAD)" imported 21 items with correct names and categories but
// every price at $0.00, because the parenthetical currency suffix wasn't
// stripped before comparison and the exact-match-only column resolution
// had no fallback other than silently defaulting the price to 0.
//
// Deliberately separate from price-book.tsx's own older, narrower alias
// lists for description/labour_price/material_price/taxable/active/
// keywords -- those columns were never part of this bug and keep their
// existing behavior, just reusing normalizeHeader()'s bugfix below.

export type MatchableField = "name" | "rate" | "category" | "unit";

/**
 * Per-field synonym lists, most specific/canonical term first -- matters
 * because resolution below checks a field's own synonyms in this order
 * across every header before moving to a looser synonym, so a real "Name"
 * column is never shadowed by a "Description" column that merely comes
 * first in the file.
 */
export const FIELD_SYNONYMS: Record<MatchableField, string[]> = {
  name: ["name", "item name", "item", "service name", "service", "product", "item description", "task", "description"],
  rate: ["rate", "price", "unit price", "cost", "amount", "total"],
  category: ["category", "type", "group", "section"],
  unit: ["unit", "unit of measure", "uom", "measure"],
};

const REQUIRED_FIELDS: MatchableField[] = ["name", "rate"];

/**
 * Case-insensitive, whitespace-collapsed, trailing-parenthetical-stripped
 * normalization -- "Rate (CAD)" and "Price ($)" both resolve the same as
 * "Rate" / "Price" alone. The parenthetical strip runs BEFORE collapsing
 * everything else: stripping non-alphanumerics first would otherwise fold
 * "(CAD)" straight into the token as a trailing "_cad" and silently
 * prevent the match -- this was the exact cause of the bug above.
 */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/(\s*\([^)]*\))+\s*$/g, "") // trailing "(...)" group(s), e.g. "(CAD)", "($)"
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export interface ColumnMatchResult {
  /** field -> the actual raw header (original casing) that matched it. */
  columns: Partial<Record<MatchableField, string>>;
  /** Headers whose normalized form matched more than one field's synonym
   * list -- excluded from every field rather than guessed, per spec. */
  ambiguousHeaders: string[];
  /** True only when every required field (name, rate) resolved. */
  isComplete: boolean;
}

/** Every field this matcher can resolve. */
export const MATCHABLE_FIELDS = Object.keys(FIELD_SYNONYMS) as MatchableField[];

export function matchColumns(headers: string[]): ColumnMatchResult {
  const normalizedSynonymSets = Object.fromEntries(
    MATCHABLE_FIELDS.map((field) => [field, new Set(FIELD_SYNONYMS[field].map(normalizeHeader))])
  ) as Record<MatchableField, Set<string>>;

  const ambiguousHeaders: string[] = [];
  // Normalized header text -> original header, for headers that matched
  // exactly one field. A header matching zero fields is simply absent
  // here (falls through as unrecognized), never an error.
  const eligible = new Map<string, string>();

  for (const raw of headers) {
    const norm = normalizeHeader(raw);
    if (!norm) continue;
    const matchingFields = MATCHABLE_FIELDS.filter((field) => normalizedSynonymSets[field].has(norm));
    if (matchingFields.length === 0) continue;
    if (matchingFields.length > 1) {
      ambiguousHeaders.push(raw);
      continue;
    }
    eligible.set(norm, raw);
  }

  const columns: Partial<Record<MatchableField, string>> = {};
  for (const field of MATCHABLE_FIELDS) {
    for (const synonym of FIELD_SYNONYMS[field]) {
      const raw = eligible.get(normalizeHeader(synonym));
      if (raw) {
        columns[field] = raw;
        break;
      }
    }
  }

  const isComplete = REQUIRED_FIELDS.every((field) => !!columns[field]);
  return { columns, ambiguousHeaders, isComplete };
}
