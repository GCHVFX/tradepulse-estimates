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
 */
const PRICE_LEAK = /\$|\d\s*dollars?\b|\bdeposit/i;

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
  if (!PRICE_LEAK.test(line)) return { line, removed: 0 };

  const prefix = line.match(LIST_PREFIX)?.[1] ?? "";
  const body = line.slice(prefix.length);
  const sentences = body.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence) => !PRICE_LEAK.test(sentence));
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
 * Delete leaking sentences, then delete any heading the deletion emptied.
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
  const out: string[] = [];
  for (const section of sections) {
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

  return { prose: collapsed, removedSentences, removedHeadings };
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
