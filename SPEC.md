# Spec: Wordmark lockup rollout

## What this is
Add the "TradePulse Estimates" text lockup next to the icon mark
wherever the icon-only swap from the previous round left it bare, and
build (but don't place) a stacked variant for future use.

## Resolved decisions
- "Estimates" renders in the muted grey token, not italic. The
  reference file's CSS sets font-style: normal explicitly, colour is
  what differentiates it from "TradePulse".
- App nav (dark, existing 44px icon) gets the wordmark text added
  beside it, using the on-dark colour spec: "TradePulse" in bone
  (#F7F2E9), "Estimates" in #9A8F79.
- The three demo widgets (EstimateDemo.tsx, EstimateDemoElectrical.tsx,
  EstimateDemoTrades.tsx) get the same on-dark wordmark text added next
  to their existing icon.
- The marketing site's public header is a separate, likely untouched
  location (last round only touched app components and the demo
  widgets). Claude Code confirms its current state and applies the
  light lockup spec if it still shows the old mark.
- A stacked (icon-above-text) lockup component gets built and exported,
  but is not placed on any page in this pass.
- Estimate/PDF output is not touched. It stays fully white-label,
  contractor's own branding only, no TradePulse credit anywhere on it.

## Explicitly out of scope
- Any TradePulse branding on generated estimates or PDFs
- Placing the stacked lockup anywhere
- General re-theme beyond the wordmark rollout
- New sizes or colour values beyond what the reference sheet specifies

## Open questions
None.

## Status
Done. Shipped 2026-08-29. App nav (Logo()) and all three demo widgets
(EstimateDemo.tsx, EstimateDemoElectrical.tsx, EstimateDemoTrades.tsx) now
render icon + "TradePulse Estimates" via a shared `RowLockup` component
(new `app/components/wordmark.tsx`), Instrument Serif, on-dark colours
(#F7F2E9 / #9A8F79), 36px text next to the 44px icon (26px scaled
proportionally to the icon's 32->44px growth from last round, since the
reference sheet doesn't cover a 44px icon directly -- see the comment in
logo.tsx). Marketing site's public header (app/page.tsx nav, and the
raster lockup shared by /trades, /electricians, /plumbers, /contact,
/share/[id]) was checked and already shows icon + wordmark text (from the
prior round's raster compositing) -- not icon-only and not the old mark,
so task 3's trigger condition didn't apply; left untouched. Flagging one
thing for a separate decision: that raster wordmark still uses its
original sans-serif typography/colours, not this spec's Instrument Serif
treatment, since it's baked into a flat PNG rather than live text --
redoing it as a new composite was judged to be a bigger, separate piece of
work than "add the wordmark where it's bare," which is what this spec
scoped. `StackedLockup` built and exported from the same file, not
imported anywhere. Verified `npx tsc --noEmit` and `npx next build` both
clean; confirmed zero changes under estimate generation, preview, or
PDF/document export (lib/generate-pdf.ts, company-estimate-header.tsx,
download-pdf-button.tsx, estimate-markdown.tsx, app/api/generate-estimate
all untouched -- that output remains fully white-label). Live-checked
both the app nav and the demo widget lockup in the browser.

### Correction (2026-08-29 02:07 PT): task 3 was wrong

The "already shows icon+wordmark, not applicable" call above was wrong.
The marketing nav/header (home page plus /trades, /electricians,
/plumbers, /contact, /share/[id]) was in fact still rendering the legacy
raster lockup verbatim: bold sans-serif "TradePulse" stacked over bold
orange "Estimates", next to a small icon -- not any of the four lockups
this spec defines. What I'd checked for was "icon-only vs has some
wordmark," which the raster technically passed (it does have text), but
that's not the same question as "does it match this spec's lockup," which
it didn't. Replaced with `RowLockup variant="light"` (live component,
`LogoMarkLight` + `WordmarkText`, Instrument Serif, muted-grey
"Estimates", not bold, not orange) at all six locations. Icon sized 44px,
matching the dark app nav's precedent rather than the reference sheet's
literal 26-28px suggestion, since that would put Mark A back under the
40px floor round 1 established (confirmed with Greg before implementing).
Text 36px, same 26px-scaled-to-44px-icon reasoning as the dark nav. Verified
`tsc --noEmit` and `next build` clean, and live-checked the home page and
`/trades` in the browser -- both show the Instrument Serif lockup, not the
raster asset. `app/page.tsx`'s small footer credit (`h-7`, ~24px icon) was
left on the original raster, same as round 2's decision to skip it as
"a footer credit nobody zooms into." `public/tradepulse-logo.png` is still
used there; `public/tradepulse-logo-compact.png` is now unreferenced by
any code (nothing deleted, flagging for Greg same as the other
now-orphaned assets from earlier rounds).

### Second correction (2026-08-29 02:30 PT): the footer skip was wrong too

The "nobody zooms into it" assumption above was wrong, confirmed by
direct screenshot -- the footer was still showing the legacy raster mark
just like the marketing nav had been. Confirmed via grep (not assumed)
that `app/page.tsx`'s footer `<img src="/tradepulse-logo.png">` was the
same flagged asset. Measured the footer's actual available width in the
browser rather than guessing: it's a flexible `justify-between` row, not
a hard-clipped box, tightest at the `sm:` 640px breakpoint where the
nav-links row leaves only ~189px for the logo credit -- far less than the
nav's 44/36 or the demo widgets' 44/28, neither of which would fit here.
Kept `iconSize=44` (the Mark A legibility floor), tried `textSize=19`
first (matched the reference sheet's own small/dense anchor, but measured
at 190.85px against the ~189px budget -- zero margin, rejected), settled
on `textSize=16` (measured at 169.6px, 43.2px of real margin). Verified
at 640px, 375px, and 1280px; screenshotted at 640px and 375px confirming
"TradePulse Estimates" reads completely and the footer's other two rows
(quick links, legal links) are unchanged. `tsc --noEmit` and `next build`
both clean. `public/tradepulse-logo.png` is no longer referenced by any
component in the codebase as of this fix. Full measurement tables in
`HANDOFF.md`.

### Third correction (2026-08-29 02:37 PT): 44/16 fit but looked wrong, and Mark C didn't exist as a component

The `44/16` sizing above fit its width budget but was disproportionate --
a 44px icon next to 16px text, confirmed by screenshot. The real problem
wasn't sizing, it was variant: round 1's own acceptance criteria
("nothing under 40px uses Mark A, filled Mark C only") had never actually
been built as a component, so every sub-40px context up to this point
either used a raster Mark C image or forced Mark A's 44px floor somewhere
too narrow for it.

Added `LogoMarkC` to `app/components/logo-mark.tsx` (filled amber tile,
dark pulse stroke, same size-dependent stroke-width curve as the raster
favicon variants). `RowLockup` and `StackedLockup` in `wordmark.tsx` now
both switch to it automatically via a shared `pickMark(variant, size)`
whenever `iconSize < 40`, regardless of `variant` -- centralized once so
this can't be silently skipped again the next time something needs to
render small.

Footer re-sized `44/16` -> `iconSize=20, textSize=19` (near 1:1, matching
the reference sheet's own small/dense pairing). Re-measured: lockup width
dropped from 169.6px to 167.0px, margin grew from 43.2px to 45.7px against
the same 560px/347.25px budget. `tsc --noEmit` and `next build` both
clean. Confirmed via fresh screenshot (640px and mobile) that the icon and
text now read as one balanced mark. Nav (44/36, 6 locations) and the three
demo widgets (44/28) confirmed unchanged and still resolving to Mark A,
since both stay >=40px. Full measurement table in `HANDOFF.md`.

### FINAL DECISION (2026-08-29 02:46 PT): Mark A at every size, sitewide -- the Mark C swap above is reversed

Greg rejected the Mark C swap in the correction directly above. **This
supersedes round 1's "nothing under 40px uses Mark A, filled Mark C
only" acceptance criterion.** Mark A now has a documented, implemented
small-size treatment (from the brand reference's own "sizes" row, exact
values, not interpolated) and is used at every size, every surface,
sitewide, including the footer. This is the final decision on the footer
mark -- do not relitigate it again.

`LogoMarkLight`/`LogoMarkOnDark` gained internal size-graduated
treatment: 40px+ unchanged (stroke 2.2, both gridlines); 24-39px thickens
to stroke 2.6, gridlines still present; under 24px thickens to stroke 3
and drops both gridlines entirely. `pickMark()` in `wordmark.tsx` no
longer branches on size -- it's just variant-to-component again, since
the components handle their own graduation now. `LogoMarkC` stays as a
component, unreferenced by the lockups, for an eventual real
favicon/app-icon build (its original purpose).

Footer kept the same `iconSize=20, textSize=19` props, now resolving to
`LogoMarkLight`'s under-24px treatment. Predicted the lockup width would
land close to the superseded Mark C measurement (167.0px) since both
icons share the same 32-unit viewBox -- confirmed by direct measurement,
not assumed: identical 167.0px, identical 45.7px margin. Stroke-width (3)
and gridline count (0) also confirmed by reading the rendered SVG's
attributes directly, matching the reference spec exactly. `tsc --noEmit`
and `next build` both clean. Fresh screenshots at 640px and mobile
(375px) confirm the icon reads clearly with no mushing and matches the
same mark design as the nav and demo widgets. Nav (44px) and a demo
widget (44px) both re-measured afterward and confirmed still at
stroke-width 2.2 with both gridlines present -- unaffected. Full
measurement table in `HANDOFF.md`.
