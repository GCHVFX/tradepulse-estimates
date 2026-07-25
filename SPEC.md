# Spec: Estimate flow - photo merge, photo persistence, structured line items

## What this is

Three related fixes to the estimate creation flow. Analyze Photos and Generate Estimate become one action. Photos stop disappearing when you go back to the description screen. Line items with a natural quantity (hours, gallons) get real qty x rate fields so editing the quantity updates the cost, instead of the cost being a separate hand-typed number with no link to the quantity.

## Resolved decisions

- Analyze Photos button is removed. Generate Estimate now runs photo analysis first (if photos exist), then feeds that analysis plus the typed description into the estimate generation call, in one tap.
- Vision analysis on the photos is cached. It only re-runs if the photo set has changed since the last analysis. Regenerating the estimate without touching photos reuses the prior analysis instead of re-calling the vision API.
- Photos, the typed description, and per-photo notes persist through the "back to description then generate again" flow. Only the AI-generated estimate content (job summary, scope of work, line items) gets replaced on regenerate. Nothing clears photos except sending the estimate or explicitly starting a new one.
- Line items are split into two types: quantity-based and flat fee.
  - Quantity-based items (e.g. Labour, Interior paint, Primer) get three fields: quantity, unit, and unit rate. Cost is calculated as quantity x unit rate and displayed read-only. Editing quantity or rate updates the displayed cost live.
  - Flat fee items (e.g. permit, trip charge, disposal fee) keep today's behaviour: one freeform description, one editable cost field, no quantity or rate.
- The AI decides which type each line item is when it generates the estimate. No manual toggle in the UI.
- Unit (hrs, gal, sqft, ft, etc.) is freeform text written by the AI per item, not a fixed dropdown list.
- No migration. Estimates already saved in the old freeform format (single text description, single hand-typed cost, no qty/rate) keep displaying exactly as they do today. The new structure only applies to estimates generated after this ships.

## Explicitly out of scope

- Manual override of AI's quantity-based vs flat-fee classification
- A fixed/constrained list of allowed units
- Migrating or reformatting any existing saved estimates
- Any change to the Scope of Work, Assumptions, or Payment Terms sections

## Open questions

None. All branches from the grill-me pass were resolved.

## Status

Done. Shipped 2026-07-25. Verified with `npx next build` (clean), the Playwright
smoke suite (9 passed, 1 pre-existing unrelated failure in
payments-nav-no-direct-stripe.spec.ts, confirmed failing on the pre-change
baseline too), a browser check of both the new and old line item formats, and a
direct model call confirming the AI splits quantity-based and flat-fee items.
New regression test: tests/smoke/photos-persist-after-generate.spec.ts.
