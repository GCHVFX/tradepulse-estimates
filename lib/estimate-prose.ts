/**
 * Generated-prose handling for contractor-owned pricing
 * (specs/contractor-owned-pricing.md sections 9 and 10).
 *
 * The model writes the words. It must never author a number that changes the
 * selling price. The prompt already asks for prose only; this module is the
 * guardrail for when it writes a price anyway.
 *
 * It is deliberately narrow. It is not a markdown parser, it does not
 * understand tables, and it never rewrites a line it has no reason to touch.
 * Only MODEL-generated prose goes through it. Contractor-typed prose is
 * traceable to the contractor and is never filtered.
 */

/**
 * What counts as price or deposit leakage in a single sentence:
 *
 * - any currency sign, which covers `$`, `CA$` and `US$`
 * - a digit followed by "dollar" or "dollars"
 * - the word "deposit" in any form, because the deposit is calculated from
 *   the contractor's snapshots and the model has no way to know it
 * - a generic pricing hedge such as "pricing may change", "quoted
 *   separately" or "cost will depend", which carries no figure but still
 *   puts the model between the contractor and their own price
 */
const PRICE_LEAK =
  /\$|\d\s*dollars?\b|\bdeposit|\bpric(?:e|es|ing)\s+(?:may|can|could|might)\s+chang|\badditional\s+(?:charges|fees|costs)\s+(?:may\s+)?appl|\b(?:quoted|priced|billed)\s+separately\b|\bseparately\s+(?:quoted|priced|billed)\b|\b(?:cost|costs|price|prices|pricing)\s+(?:will|would|may|might|can|could)\s+depend/i;

/**
 * Commercial and contractual terms the model has no standing to invent.
 *
 * A payment due date, an estimate validity period, a warranty, financing or
 * a cancellation policy is a commitment the business makes, and TradePulse
 * has no setting holding any of them yet. Until one exists and can be
 * supplied deterministically, the model writing one is the model making a
 * promise on the contractor's behalf. "Due to" is deliberately not matched:
 * it is ordinary scope language, not a payment date.
 */
const COMMERCIAL_TERM =
  /\bvalid for \d+ (?:calendar |business |working )?days?\b|\bthis (?:estimate|quote) is valid\b|\b(?:balance|payment|invoice)s?\s+(?:is|are|will be|becomes?)\s+due\b|\bdue\s+(?:up)?on\s+completion\b|\bdue\s+within\s+\d+\s+days?\b|\bbalance\s+(?:due\s+)?(?:up)?on\s+completion\b|\bpayment\s+(?:terms|plan|schedule)\b|\bprogress\s+payments?\b|\bwarrant(?:y|ies)\b|\bfinancing\b|\bcancellation\s+(?:fee|policy|charge|terms?)\b/i;

/** Everything the model is not allowed to leave in a saved estimate. */
function leaks(text: string): boolean {
  return PRICE_LEAK.test(text) || COMMERCIAL_TERM.test(text);
}

/**
 * Sections the model is not asked for and must not supply. Phase 1
 * generation is a job summary, a scope of work, assumptions and exclusions,
 * and job-specific notes. A Payment Terms section is dropped whole, content
 * and heading together, rather than sentence by sentence: an invented
 * default is worse than no section at all, and there is no contractor
 * setting to fill it from yet.
 */
const FORBIDDEN_SECTION = /^\s*#{1,6}\s*\**\s*payment\s+terms\b/i;

/** `#` through `######`, allowing the three leading spaces markdown permits. */
const HEADING_LINE = /^ {0,3}#{1,6}\s/;

/** A bullet or numbered list marker, kept with whatever survives the line. */
const LIST_PREFIX = /^(\s*(?:[-*+]|\d+[.)])\s+)/;

export interface SanitizedProse {
  prose: string;
  /** Sentences deleted. Diagnostics only: it never blocks or retries. */
  removedSentences: number;
  /** Headings deleted because the filter emptied their section. */
  removedHeadings: number;
  /** Whole sections dropped because the model must not write them at all. */
  removedSections: number;
}

/**
 * One line, treated as a run of sentences. A line with no leak is returned
 * byte-for-byte, so ordinary prose is never reflowed. A line whose sentences
 * are all removed returns null and the whole line goes.
 *
 * A table row or a bullet with no terminal punctuation is a single sentence,
 * which is what makes a leaked pricing table disappear row by row.
 */
function filterLine(line: string): { line: string | null; removed: number } {
  if (!leaks(line)) return { line, removed: 0 };

  const prefix = line.match(LIST_PREFIX)?.[1] ?? "";
  const body = line.slice(prefix.length);
  const sentences = body.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence) => !leaks(sentence));
  const removed = sentences.length - kept.length;

  if (kept.length === 0) return { line: null, removed };
  return { line: prefix + kept.join(" "), removed };
}

interface ProseSection {
  /** null for the run of lines before the first heading. */
  heading: string | null;
  lines: string[];
  contentBefore: number;
  contentAfter: number;
}

/**
 * Drop the sections the model must not write at all, delete leaking
 * sentences from the rest, then delete any heading the deletion emptied.
 *
 * A heading is removed only when it had content and now has none, so a
 * heading that was already empty, or one that only introduces a subheading,
 * is left exactly as the model wrote it. Never block, never retry, never
 * report this as an error: the contractor now has a real place to put the
 * number the model was trying to invent.
 */
export function sanitizeGeneratedProse(prose: string): SanitizedProse {
  const sections: ProseSection[] = [{ heading: null, lines: [], contentBefore: 0, contentAfter: 0 }];
  let removedSentences = 0;

  for (const line of prose.split("\n")) {
    if (HEADING_LINE.test(line)) {
      sections.push({ heading: line, lines: [], contentBefore: 0, contentAfter: 0 });
      continue;
    }

    const section = sections[sections.length - 1];
    if (!line.trim()) {
      section.lines.push(line);
      continue;
    }

    section.contentBefore += 1;
    const result = filterLine(line);
    removedSentences += result.removed;
    if (result.line === null) continue;

    section.lines.push(result.line);
    section.contentAfter += 1;
  }

  let removedHeadings = 0;
  let removedSections = 0;
  const out: string[] = [];
  for (const section of sections) {
    // A forbidden section goes whole, however much survived the sentence
    // filter, because the problem is the section existing at all.
    if (section.heading !== null && FORBIDDEN_SECTION.test(section.heading)) {
      removedSections += 1;
      continue;
    }

    const emptiedByFilter =
      section.heading !== null && section.contentBefore > 0 && section.contentAfter === 0;
    if (emptiedByFilter) {
      removedHeadings += 1;
      continue;
    }
    if (section.heading !== null) out.push(section.heading);
    out.push(...section.lines);
  }

  // Removing lines leaves runs of blank lines behind. Collapse them so the
  // saved prose reads as though the removed sentences were never written.
  const collapsed = out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");

  return { prose: collapsed, removedSentences, removedHeadings, removedSections };
}

/**
 * The prose body without its H1 job title. Every surface that shows the title
 * separately renders this, so the title is not printed twice. The title stays
 * in the stored summary; this is display only.
 */
export function stripTitleHeading(prose: string): string {
  return prose
    .split("\n")
    .filter((line) => !/^ {0,3}#\s/.test(line))
    .join("\n")
    .replace(/^\s+/, "");
}
