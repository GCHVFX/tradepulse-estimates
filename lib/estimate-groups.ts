// Work-package grouping for structured estimate items.
//
// Two separate concerns live here:
//
//   1. assignGroupLabel(), a keyword classifier used ONLY when a brand-new
//      estimate is generated. It never runs against an existing estimate.
//   2. The grouped renderer, which is INTERNAL ONLY and gated behind
//      isGroupedPricingEnabled(). No customer sees its output yet.
//
// Pure functions. No React, no network, no database, no side effects.
//
// A deliberate note on inference. lib/estimate-item-migration.ts refuses to
// guess item_type, allowances, or labour fields from description text, and that
// stays true. Grouping is different in kind: a group label is a presentational
// bucket that changes no price and no arithmetic, it is only ever applied to
// estimates being created right now, and an unrecognised row is left ungrouped
// rather than forced into a wrong bucket. Nothing here alters a total.

import type { EstimateItemDraft } from "./estimate-items";
import { formatDollars } from "./estimate-summary";

// ── Feature flag ──────────────────────────────────────────────────────────────

/**
 * Grouped customer pricing is not shipped. This gate exists so the renderer can
 * be built and tested without any path to a customer. Server-side only: it
 * reads a plain env var and is never bundled into a client component.
 */
export function isGroupedPricingEnabled(): boolean {
  return process.env.ESTIMATE_GROUPED_PRICING_INTERNAL === "true";
}

// ── Classifier ────────────────────────────────────────────────────────────────

/**
 * Ordered rules, first match wins. Order matters: "demolition" is checked
 * before "plumbing" so "demo the old plumbing" reads as demolition, which is
 * the work actually being done.
 *
 * Every pattern is anchored on whole words to avoid the substring traps that
 * bit the reserved-label regex earlier in this project ("total station rental"
 * matching "total"). For example `\btile\b` will not fire on "ventilated".
 */
// Each pattern ends `)s?\b` so a plural reads the same as a singular. Without
// it "Pot lights" fell through to ungrouped, because the word boundary after
// "light" fails against the trailing "s".
const GROUP_RULES: Array<{ group: string; pattern: RegExp }> = [
  { group: "Demolition and disposal", pattern: /\b(demolition|demolish|demo|tear[- ]?out|tearout|rip[- ]?out|removal|remove|haul(ing)?[- ]?away|disposal|dispose|dump(ster)?|debris|bin)s?\b/i },
  { group: "Permits and fees",        pattern: /\b(permit|inspection fee|application fee|licen[cs]e fee|trip charge|service call|mobilization|mobilisation)s?\b/i },
  { group: "Concrete and masonry",    pattern: /\b(concrete|footing|slab|rebar|masonry|mortar|brick|block work|paver|aggregate|asphalt|gravel base)s?\b/i },
  { group: "Framing and structure",   pattern: /\b(framing|frame|joist|stud|rafter|beam|header|collar tie|lumber|truss|sheathing|blocking)s?\b/i },
  { group: "Roofing and exterior",    pattern: /\b(roof(ing)?|shingle|flashing|soffit|fascia|gutter|downspout|siding|underlayment)s?\b/i },
  { group: "Plumbing",                pattern: /\b(plumb(ing|er)?|pipe|piping|pex|copper line|drain|waste line|vent stack|water heater|tank|faucet|tap|valve|shut[- ]?off|toilet|tub|shower|sink|vanity top|supply line|p[- ]?trap|fixture rough)s?\b/i },
  { group: "Electrical",              pattern: /\b(electric(al|ian)?|wir(e|ing)|circuit|breaker|panel|outlet|receptacle|switch|conduit|light(ing| fixture)?|pot ?light|gfci|service entrance|junction box)e?s?\b/i },
  { group: "HVAC and ventilation",    pattern: /\b(hvac|furnace|duct(work)?|vent(ilation|ing)?|exhaust fan|air handler|heat pump|thermostat|baseboard heater|register)s?\b/i },
  { group: "Insulation and drywall",  pattern: /\b(insulation|batt|vapour barrier|vapor barrier|poly|drywall|gypsum|cement board|backer board|tape and mud|mudding|taping|compound)s?\b/i },
  { group: "Flooring",                pattern: /\b(floor(ing)?|subfloor|underlay|tile|tiling|grout|thinset|vinyl plank|laminate|hardwood|carpet|lino(leum)?)s?\b/i },
  { group: "Cabinets and countertops",pattern: /\b(cabinet|vanity|countertop|counter top|quartz|granite|laminate top|shelving|millwork)s?\b/i },
  { group: "Trim and carpentry",      pattern: /\b(trim|baseboard|casing|moulding|molding|crown|door (slab|jamb|hardware)?|threshold|weatherstrip|handrail|railing|stair)s?\b/i },
  { group: "Painting and finishing",  pattern: /\b(paint(ing)?|primer|prime|stain|varnish|lacquer|caulk(ing)?|sealer|seal(ing)?|spackle|spackling|sand(ing|paper)?)s?\b/i },
  { group: "Landscaping and fencing", pattern: /\b(fence|fencing|post|gate|landscap(e|ing)|sod|topsoil|mulch|excavat(e|ion)|grading|pond liner|irrigation)s?\b/i },
  { group: "Cleanup",                 pattern: /\b(clean[- ]?up|cleaning|final clean|site clean|tidy|sweep)s?\b/i },
];

/**
 * Best-effort work package for one line item description.
 *
 * Returns null when nothing matches. That is deliberate: an ungrouped row is
 * honest, a wrongly grouped row is not. The renderer collects nulls under a
 * clearly named bucket rather than hiding them.
 */
export function assignGroupLabel(description: string): string | null {
  const text = (description ?? "").trim();
  if (!text) return null;
  for (const rule of GROUP_RULES) {
    if (rule.pattern.test(text)) return rule.group;
  }
  return null;
}

/** The closed set this classifier can produce, for tests and future UI. */
export const KNOWN_GROUP_LABELS: readonly string[] = GROUP_RULES.map((r) => r.group);

// ── Grouped rendering (internal only) ────────────────────────────────────────

export interface GroupedPriceLine {
  group: string;
  total: number;
  itemCount: number;
}

const UNGROUPED_BUCKET = "Additional items";

/**
 * Collapse items into work packages, preserving first-appearance order so the
 * grouped view follows the same narrative order as the detailed one.
 *
 * The sum of the returned totals equals the sum of the item totals exactly.
 * Nothing is rounded here; rounding happens only at display.
 */
export function groupItemsForDisplay(
  items: Array<Pick<EstimateItemDraft, "total" | "groupLabel">>
): GroupedPriceLine[] {
  const order: string[] = [];
  const totals = new Map<string, { total: number; itemCount: number }>();

  for (const item of items) {
    const key = item.groupLabel ?? UNGROUPED_BUCKET;
    const existing = totals.get(key);
    if (existing) {
      existing.total += item.total;
      existing.itemCount += 1;
    } else {
      totals.set(key, { total: item.total, itemCount: 1 });
      order.push(key);
    }
  }

  return order.map((group) => ({
    group,
    total: totals.get(group)!.total,
    itemCount: totals.get(group)!.itemCount,
  }));
}

/**
 * Grouped pricing as a markdown pipe table, matching how every other priced
 * section in this app is rendered so it flows through the existing markdown
 * pipeline unchanged.
 *
 * INTERNAL ONLY. Nothing customer-facing calls this.
 */
export function renderGroupedLineItemsBlock(
  items: Array<Pick<EstimateItemDraft, "total" | "groupLabel">>
): string {
  const groups = groupItemsForDisplay(items);
  const table = [
    "| Work package | Price |",
    "|------|------|",
    ...groups.map((g) => `| ${g.group} | ${formatDollars(g.total)} |`),
  ].join("\n");
  return `## Line Items\n${table}`;
}

/**
 * Leader-dot plain text, for internal inspection and log-free debugging:
 *
 *   Demolition and disposal ........ $650
 *   Plumbing ....................... $1,450
 *
 * INTERNAL ONLY.
 */
export function renderGroupedPlainText(
  items: Array<Pick<EstimateItemDraft, "total" | "groupLabel">>,
  width = 46
): string {
  const groups = groupItemsForDisplay(items);
  return groups
    .map((g) => {
      const price = formatDollars(g.total);
      const dots = Math.max(1, width - g.group.length - price.length);
      return `${g.group} ${".".repeat(dots)} ${price}`;
    })
    .join("\n");
}

/** Sum of grouped totals. Must equal the detailed subtotal exactly. */
export function groupedSubtotal(
  items: Array<Pick<EstimateItemDraft, "total" | "groupLabel">>
): number {
  return groupItemsForDisplay(items).reduce((sum, g) => sum + g.total, 0);
}
