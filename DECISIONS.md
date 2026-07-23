# Decisions

Durable product/architecture decisions worth remembering the reasoning behind, not just the outcome. Most recent first. Entries below were recorded together during an AI Control Centre backfill on 2026-07-23, covering decisions made across the session they document.

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
