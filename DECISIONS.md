# Decisions

Durable product/architecture decisions worth remembering the reasoning behind, not just the outcome. Most recent first. Entries below were recorded together during an AI Control Centre backfill on 2026-07-23, covering decisions made across the session they document.

## Grouped pricing moves line items to structured storage; markdown keeps the prose

Recorded 2026-07-30. Full analysis in `TRADEPULSE_GROUPED_PRICING_ARCHITECTURE.md`. This resolves the question deferred by the entry below.

**Selected storage model.** Priced line items move to a new structured table (working name `tpe_estimate_items`), holding label, group label, kind (quantity or flat), quantity, unit, unit rate, amount, allowance flag, customer-visible flag, and sort order. Prose stays exactly where it is: job summary, scope of work, assumptions and exclusions, payment terms, and notes remain markdown inside `tpe_estimates.summary`. Only the arithmetic and addressable part moves. Migrating the whole document was rejected as unnecessary complexity, since prose has no integrity problem.

**Authoritative source of truth.** One owner per concern, never two. Structured rows are authoritative for pricing wherever `tpe_estimates.pricing_source = 'structured'`; the markdown line-item table remains authoritative wherever it is `'markdown'`. The flag is one-way, flipped inside the same transaction as the per-estimate backfill, and there is never a window where both are read. For a structured estimate the markdown line-item block is regenerated output only and is never read back. Once immutable approval snapshots exist, the snapshot outranks both for what a given customer was shown. Markdown remains authoritative for prose permanently.

**Compatibility rule for existing estimates.** A previously sent customer estimate must never change because of this work. Existing estimates default to `pricing_source = 'markdown'` and render through today's code path untouched. Backfill is lazy, per estimate, on first edit, and aborts for that estimate if the total would change. Sent estimates are excluded from lazy migration entirely, because their share links are live and the customer may already hold the PDF. Grouped customer view ships off by default for existing estimates and on for new ones.

**Disposition of `tpe_estimate_line_items`: replaced, not reused, and not dropped yet.** Its generated type is missing eight fields this feature needs, including unit, unit rate, group label, customer visibility, and allowance status. Worse, its `labour_price` plus `material_price` split directly contradicts the shipped one-cost-per-row model of `quantity * rate` or flat fee, so reusing it would introduce a second, conflicting pricing concept. It stays in the schema, unwritten, until the replacement is in production; removal is a separate scheduled change. Note that `CLAUDE.md` documented this table's columns incorrectly; the generated types are correct.

**Why extending markdown was rejected.** It is the cheaper option and it is genuinely backward compatible if the group column is appended last, which was verified by executing the real parser. It was rejected on long-term correctness, not on compatibility. Two defects were measured in the current format: a single stray Subtotal row that the prompt forbids but nothing enforces silently doubled a subtotal from $285 to $570, and the parse-then-serialize round trip permanently drops the estimate's H1 title on the first edit. Tax rate and deposit percent are already recovered by regex from previously rendered output. Adding grouping would make one text column, read by three independent parsers, carry a seventh meaning. The two phases queued immediately behind grouped pricing both need what markdown cannot give: approval snapshots need a verifiable total, and invoice conversion needs stable per line identity for deposit and partial invoices. Choosing markdown now would most likely mean doing this migration later anyway, twice, with a live approval feature depending on the format being changed.

## Estimate content stays in markdown for now, and the relational line-item table stays unused until a feature forces the change

Recorded 2026-07-30 from the Phase 0 baseline audit. The audit found that `tpe_estimate_line_items` exists in the schema but no application code reads or writes it, and that scope, line items, assumptions, pricing, and payment terms all live inside the single `tpe_estimates.summary` markdown column, parsed and re-serialized by `lib/estimate-summary.ts`. The columns `scope`, `assumptions`, `payment_terms`, and `notes` are similarly dead.

This is not an accident worth "cleaning up" on its own. Markdown is what the model produces, what the editor edits, and what the share page and PDF render, so a single blob keeps generation, editing, and display in one format with no mapping layer. Migrating to relational rows purely for tidiness would add a translation layer on every read and write and buy nothing today.

The decision is to leave it, and to treat the first feature that genuinely needs per-line structured data as the trigger to revisit. Grouped customer-facing pricing (roadmap Phase 1) is that trigger, because it needs a group label per line item and there is nowhere to put one. That phase must resolve the storage question before implementation, not during it. Approval snapshots (Phase 2) will force the same question again, since an immutable approved version needs a stable representation.

Explicitly not decided here: which way it goes. **Resolved on 2026-07-30 by the entry above, "Grouped pricing moves line items to structured storage; markdown keeps the prose".** This entry stands as the record of why the question was deferred, not as a live open question.

## Starter pricing stays at $39 CAD/month and is not lowered to compete on price

Recorded 2026-07-30 when `TRADEPULSE_ESTIMATES_ROADMAP.md` was filed into the repository. Low-cost estimating apps (SimplyWise and similar) sit well under $39, and matching them permanently would set the product's perceived value at the level of a utility rather than a workflow tool. TradePulse competes on estimate speed, contractor-quality scope writing, customer presentation, and the workflow after sending, none of which get cheaper to run by discounting. A temporary founding-user offer for early acquisition is acceptable, but only when it is clearly labelled as founding pricing with $39 shown as the standard price. Pro stays at $69 CAD/month. Rejected specifically: a permanent Starter price in the $10 to $20 range, extra estimate tiers, per-user pricing before team features exist, and charging separately for core estimate features.

## Roadmap priority is the workflow after sending, not more input features

Recorded 2026-07-30 from `TRADEPULSE_ESTIMATES_ROADMAP.md`. Estimate creation is already strong (voice, photo, saved line items, user labour rates), so more input capability has low marginal value. The gap is everything after the estimate is sent. The prioritized work is grouped customer-facing pricing (show work packages by default while keeping full internal detail), customer approval and signature, estimate-to-invoice conversion, and estimate-state and primary-action cleanup. Explicitly deprioritized: receipt scanning, mileage tracking, generic small-business utilities, and LiDAR or 3D room scanning. Those would turn a focused estimating tool into a bookkeeping suite and none of them address the point where jobs currently stall.

## The roadmap is direction, not authorization to build

Recorded 2026-07-30. `TRADEPULSE_ESTIMATES_ROADMAP.md` describes eight phases, several of which touch schema, the customer-facing share page, and the paid Payments feature. An implementation agent that treats the document as a build queue would ship large speculative changes without user sign-off. Any agent picking up a phase must confirm scope with the user first, inspect the current implementation before assuming a capability is missing, and implement only the phase actually requested. Phase 0 (baseline audit) comes before any implementation phase.

## Support for home inspectors, if built, comes via a business-type template — not a separate product

Decided in a ChatGPT browser-planning session (2026-07-23), imported into AI Control Centre as a historical record. **Planning only — nothing below has been implemented.** Trades and Contractors stays the broad default business type. Inspection Services would be added as a separate business-type template only when there is real, validated user demand, not speculatively. No third business type gets added beyond that without its own validated demand — the plan deliberately avoids supporting many service categories early.

## A business type would change more than labels — terminology, sections, defaults, and pricing model

From the same imported planning session. **Planning only.** Business type should drive estimate terminology, which sections appear, default services/add-ons/exclusions, report terms, and the AI generation instructions themselves — not just a cosmetic label swap. Inspection estimates specifically would use service-package and property-based pricing rather than TradePulse's existing labour-and-material pricing model, since that's how inspection work is actually priced.

## Inspection-flavoured camera wording must not imply the photo feature performs the inspection

From the same imported planning session. **Planning only.** The existing Photo Input feature could help scope and price an inspection job, but its inspection-specific wording (e.g. "Add Property Photos" or "Help Scope This Inspection") must make clear it assists scoping, not that it performs or replaces a professional inspection — avoiding any implication that AI photo analysis can identify defects.

## AI_WORKFLOW.md is the single source of truth for AI Control Centre workflow rules

AGENTS.md and CLAUDE.md's managed instruction blocks summarized the tracking contract inline. As the workflow contract grew (source-of-truth rules, git safety, warning resolution, dashboard verification), embedding all of it directly in both files risked drift between them and bloated files that are read for many other purposes too. Created `AI_WORKFLOW.md` as the one place this contract lives, and pointed both managed blocks at it with a single instruction line instead of duplicating content.

## Dictation is available on all plans, not Pro-gated

Typing with gloved, dirty, or cold hands is a genuine field-usability problem for the target user (contractors on a job site). Field-worker UX research supported treating this as a core usability fix rather than a Pro upsell, unlike Photo Input (AI photo analysis), which stays Pro-gated.

## Job-description input row: twin equal-sized icon buttons, not a hero-mic or a labeled toolbar

Three variants were considered for combining mic + camera on `/new`: an attached toolbar with small labeled icons, a large "hero" mic button with camera demoted to a small link, and two equal-sized icon buttons. Chose the twin-equal-buttons variant specifically because photo input in this app is a full alternative path to writing a job description (the photo gets AI-analyzed into a complete description), not just supporting evidence attached to a voice note — demoting it to a secondary link would undersell a feature that does just as much work as dictation.

## Payments removed from the permanent bottom nav

Payments was Pro-gated and low-frequency (checking on invoices, not the every-job loop of creating estimates), but occupied one of only five bottom-nav slots for every user regardless of plan, and showed a permanently-locked "PRO" badge to Starter users on every screen. Replaced with an "Unpaid Invoices" pill on `/estimates` instead — right where a contractor would naturally look for who owes them money. This also let the "New" button move into the one-handed thumb-reach zone instead of sitting dead-center among five items. Accepted tradeoff: Pro-conversion visibility for Payments is now page-level, not nav-level, on every screen.

## Comparison-to-competitor pricing removed from the landing page entirely

The landing page originally compared TradePulse's price against ServiceTitan and Jobber. Jobber's actual starting price (Core plan) moved to match TradePulse Starter exactly ($39/month), eliminating the original "cheaper than Jobber" claim and making the stale comparison actively counterproductive. Rather than patch it with a new competitor or a different angle, removed the "how we compare" section entirely: a ServiceTitan-only comparison read as cherry-picked (different market segment — enterprise multi-tech platform vs. a solo/small-crew tool), and "Simple, flat pricing" already makes the simplicity case without needing a competitor as a foil.

## Gemini 3.5 Flash chosen for voice transcription

Selected `gemini-3.5-flash` (via `@google/genai`) for the dictation feature after confirming via live research that it was the current, generally-available model with audio-input support at the time — rather than relying on training-data assumptions about older Gemini model names, which had already gone stale.
