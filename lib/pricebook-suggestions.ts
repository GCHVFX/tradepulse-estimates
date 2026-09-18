/**
 * Phase 2 slice 1: a pure, deterministic price-book suggestion matcher.
 *
 * MONEY SAFETY. This module identifies candidate saved-item IDs only. It never
 * sees `labour_price`, `material_price`, markup, tax or deposit -- its input
 * type is structurally incapable of carrying a dollar field. It never persists
 * anything and never touches a total. A suggestion is inert: `score` is a
 * ranking signal, not a price, and `quantity` is always the neutral default of
 * 1, never inferred from the job text. Nothing here contributes to a dollar
 * total until a later slice requires the contractor to deliberately accept a
 * suggestion, which is the only thing allowed to turn it into a real
 * `tpe_estimate_items` row.
 *
 * No negation handling. "no toilet work" or "drain stays in place" can still
 * surface "Toilet replacement labour" or "Drain clearing" as a low-ranked
 * suggestion -- deliberately out of scope for v1 (specs/contractor-owned-pricing.md
 * Phase 2 audit). A false positive here costs the contractor one glance at an
 * inert suggestion; a false negative costs them re-finding and re-typing a
 * saved item. This module is tuned toward recall, not precision.
 */

/** Matching-safe metadata only. No price field can appear on this type. */
export interface PriceBookSuggestionItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
}

/** Inert suggestion metadata. No price field can appear on this type either. */
export interface PriceBookSuggestion {
  id: string;
  name: string;
  score: number;
  quantity: 1;
}

/**
 * The smallest score a single distinctive, non-generic name-token match
 * produces (see NAME_TOKEN_WEIGHT below). Below this, a candidate is either
 * pure description/category noise or shares only generic words -- suppressed.
 */
export const MIN_SUGGESTION_SCORE = 3;

/** Never return more than this many candidates, however many score above the floor. */
export const MAX_SUGGESTIONS = 5;

// Per-matching-token weights. A name-token match is the primary signal; a
// description-token match only ever strengthens an already-plausible
// candidate (capped at DESC_MATCH_CAP, below); a category match is the
// weakest signal and is deliberately capped under MIN_SUGGESTION_SCORE so it
// can never produce a suggestion by itself (rule: "category overlap may
// contribute slightly but may not produce a match by itself").
const NAME_TOKEN_WEIGHT = 3;
const DESC_TOKEN_WEIGHT = 1;
const DESC_MATCH_CAP = MIN_SUGGESTION_SCORE; // description alone can reach the floor, never clear it
const CATEGORY_WEIGHT = 1;
const NAME_PHRASE_BONUS = 4; // a contiguous two-word phrase from the item name found in the job text

/**
 * Generic words that appear across many different saved items and therefore
 * carry no distinguishing signal on their own -- articles, prepositions,
 * pronouns, quantifiers, and the generic verbs/location words this task's own
 * example names ("kitchen", "replace", "install"). Keeping this list short and
 * clearly generic is the point: it is not a per-fixture word list, it is the
 * same handful of words that would be noise for any saved item.
 */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "to", "of", "for", "with", "is", "are", "it", "its",
  "this", "that", "on", "in", "at", "under", "no", "not", "there", "both", "all",
  "when", "one", "two", "some", "any",
  "install", "installation", "installed",
  "remove", "removal", "removed",
  "replace", "replacement", "replacing",
  "test", "tested", "testing",
  "existing", "new", "required", "finished", "up",
  "customer", "has", "have",
  "connection", "connections",
  "kitchen", "bathroom", "sink",
]);

/** Lowercase, strip punctuation to spaces, collapse whitespace. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A very small, deterministic singular/plural rule -- not a stemmer. Handles
 * exactly the two shapes this domain's plurals take ("-ies" -> "-y",
 * ordinary "-s" -> ""), and nothing else (no tense, no stemming library).
 */
function singularize(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Normalized, singularized tokens in original order. Single-letter noise (e.g. from "P-trap") is dropped. */
function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter(Boolean)
    .map(singularize)
    .filter((token) => token.length > 1);
}

/** Tokens with stop words removed, order preserved. Used for phrase (bigram) detection. */
function meaningfulTokens(text: string): string[] {
  return tokenize(text).filter((token) => !STOP_WORDS.has(token));
}

function bigrams(tokens: readonly string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) result.push(`${tokens[i]} ${tokens[i + 1]}`);
  return result;
}

/** Score one item against the job's tokens. Pure, no side effects. */
function scoreItem(
  item: PriceBookSuggestionItem,
  jobTokenSet: ReadonlySet<string>,
  jobPhraseText: string
): number {
  const nameTokens = meaningfulTokens(item.name);
  const descTokens = meaningfulTokens(item.description ?? "");
  const categoryTokens = meaningfulTokens(item.category);

  const matched = new Set<string>();
  let score = 0;

  for (const token of new Set(nameTokens)) {
    if (jobTokenSet.has(token)) {
      score += NAME_TOKEN_WEIGHT;
      matched.add(token);
    }
  }

  let descMatchScore = 0;
  for (const token of new Set(descTokens)) {
    if (matched.has(token)) continue;
    if (jobTokenSet.has(token)) {
      descMatchScore += DESC_TOKEN_WEIGHT;
      matched.add(token);
    }
  }
  score += Math.min(descMatchScore, DESC_MATCH_CAP);

  for (const token of new Set(categoryTokens)) {
    if (matched.has(token)) continue;
    if (jobTokenSet.has(token)) {
      score += CATEGORY_WEIGHT;
      matched.add(token);
      break; // one flat bonus for the category, not one per category word
    }
  }

  for (const phrase of new Set(bigrams(nameTokens))) {
    if (jobPhraseText.includes(phrase)) score += NAME_PHRASE_BONUS;
  }

  return score;
}

/**
 * Rank a business's saved price-book items against a contractor's job text.
 * Pure and synchronous: no database, no network, no randomness. Returns at
 * most MAX_SUGGESTIONS items scoring at or above MIN_SUGGESTION_SCORE, highest
 * score first, ties broken by original input order (deterministic, not
 * alphabetical -- avoids implying any meaning in tie order beyond "first as
 * given").
 */
export function suggestPriceBookItems(
  jobText: string,
  items: readonly PriceBookSuggestionItem[]
): PriceBookSuggestion[] {
  const jobTokens = meaningfulTokens(jobText);
  if (jobTokens.length === 0 || items.length === 0) return [];

  const jobTokenSet = new Set(jobTokens);
  const jobPhraseText = ` ${jobTokens.join(" ")} `;

  return items
    .map((item, index) => ({
      item,
      index,
      score: scoreItem(item, jobTokenSet, jobPhraseText),
    }))
    .filter(({ score }) => score >= MIN_SUGGESTION_SCORE)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ item, score }) => ({
      id: item.id,
      name: item.name,
      score,
      quantity: 1,
    }));
}
