# Spec: Hero photo and kraft palette redesign

## What this is
A slight redesign of the marketing site's light chrome (nav, footer) and hero
section, moving off the current navy-gradient hero and pale-cream nav/footer
toward a warmer, photo-grounded look. No structural rebuild, no changes to
the live interactive demo, no changes below the hero.

## Resolved decisions

### Palette
- Nav and footer background moves from the current pale cream to a warmer
  kraft tone: surface #F3E8D0, hairline/border #C9B384, muted text on light
  #5C4A2E. Any other light-background section between hero and footer should
  get the same warm treatment for consistency, using #EADCC0 as the deeper
  page-background token where a surface/page contrast is needed (mirrors how
  the current bone/surface pair already works, just warmed).
- Dark tokens (#26211B ink, #F7F2E9 text, #9A8F79 muted, the four tool
  accents: orange #F59E0B, blue #2563EB, green #16A34A, purple #6D28D9) are
  unchanged.
- The charcoal/safety-orange alternative direction was considered and
  rejected. Kraft only.

### Hero background
- Replace the navy gradient and dot texture with the photo at
  `public/trades-van.jpg` (already compressed, JPEG, ~200KB, same 1254x1254
  dimensions as the original PNG). Confirm the file is present before
  wiring it in; if it's still `trades-van.png`, flag it rather than
  guessing which one is current.
- Apply a dark scrim over the photo so hero text and the demo widget stay
  legible: a left-to-right gradient, darker over the text side, lighter
  over the photo detail on the right. Starting point:
  `linear-gradient(100deg, rgba(38,33,27,0.62) 15%, rgba(38,33,27,0.22) 70%)`
  layered over the image. Treat these as a starting point, not final —
  check legibility on an actual phone screen in daylight and adjust.
- Position the photo so the subject (the person, not just the van) is not
  hidden directly behind the demo widget. Starting point:
  `background-position: 18% 22%`. This was reasoned from the photo's
  composition, not measured against the real rendered layout — check it
  against the actual demo widget's real position and adjust.

### Hero typography
- Headline switches from the current DM Sans bold to Instrument Serif,
  regular weight, roughly 56px desktop (scale down responsively). Do not
  force a bold weight — Instrument Serif does not ship a true bold, and
  synthetic bold on a display serif looks wrong. Size and line-height carry
  the visual weight instead.
- Headline copy is unchanged: "Send a professional estimate" in the base
  text colour, "before you leave the job" in the orange accent, exactly as
  it reads today.
- Subhead, both CTA buttons, the micro-copy line, nav links, and footer
  links all stay in DM Sans. Only the H1 changes typeface.
- A sturdier alternative (Fraunces, Source Serif 4, Zilla Slab) was
  compared against Instrument Serif and rejected. Instrument Serif stays,
  matching the existing wordmark.

### Badge / eyebrow text
- Remove the pill-shaped badge entirely: no border, no pill background, no
  dot, no position above the headline.
- Keep the words "Built for contractors and home service businesses" as
  plain, unstyled small text, relocated lower in the hero block (after the
  "14-day free trial. No credit card required." line), not in the eyebrow
  position.

### CTAs
- Both hero buttons stay exactly as they are: "Try free for 14 days"
  (primary, filled) and "Sign in" (secondary, outline). No copy change, no
  removal, no restyle beyond whatever falls out of the palette swap.

### Live demo widget
- Do not touch it. Not the corners, not the internal field styling, not its
  position in the right column above the fold. It's a real, working
  component — every "phone corners" and "rounded card" discussion earlier
  in this process was about a hand-built visual approximation used for
  chat-based mockups, not an instruction to change the real component.
  Leave it as a fixed piece and build the rest of the hero around it.

### Rollback
- Build this on a feature branch, not directly on main. Push it and let
  Vercel's automatic preview deployment provide a live URL to review before
  anything touches production. Only merge to main (which auto-deploys) once
  it's confirmed to be working. If it's not working, the branch is simply
  not merged — no separate revert mechanism needed given main is never
  touched until sign-off.

## Explicitly out of scope
- The live demo widget's internal styling, including the line-item text
  colour that was flagged earlier this session as inconsistent with the
  palette. That's a real, separate issue but is not part of this spec —
  raise it on its own if you want it fixed.
- Anything below the hero (the "what we build" section, pricing, "how it
  works") — not covered here due to lack of visibility into current markup.
- General re-theme beyond what's listed above.

## Clarification resolved before implementation (2026-08-29)

The two bullets above are in direct conflict: the Palette decision says
"any other light-background section between hero and footer should get the
same warm treatment for consistency," while Explicitly-out-of-scope
excludes "anything below the hero," giving "lack of visibility into current
markup" as the reason. That reason did not apply during implementation (the
markup was in hand: 10 mid-page sections alternating `bg-white` /
`bg-slate-50`).

Asked rather than guessed. **Resolution: warm the mid-page sections too**,
limited strictly to background and border tokens — `bg-white` -> #F3E8D0
(surface), `bg-slate-50` -> #EADCC0 (deeper page), slate borders -> #C9B384.
No layout, copy, or structural changes to any mid-page section. The
out-of-scope bullet is read as excluding *structural* work on those
sections, not the token swap. Without this, the page would have rendered
kraft chrome above and below a stark white middle.

## Open questions
None.

## Status
Implemented 2026-08-29 on branch `redesign/hero-photo-kraft`. Not merged to
main. Awaiting review of the Vercel preview deployment.

Verified: `npx tsc --noEmit` exit 0, `npx next build` exit 0. Screenshots
taken at 375px and 1440px. Demo widget proven unmodified by hash comparison
and an empty `git diff main` on all three EstimateDemo files.

**Contrast was measured, not eyeballed** — the real photo pixels were sampled
into a canvas, composited under the scrim at each text element's actual
position, and scored against WCAG. The spec's starting scrim values failed
twice: the orange headline came out at 2.38:1 on desktop (needs 3.0) and the
"built for contractors" line at 4.42:1 on mobile (needs 4.5). Both looked
fine in a screenshot. The scrim was retuned to hold ~0.74 across the text
column then fall off fast where the demo widget sits; all six hero text
elements now pass at both breakpoints (worst case 4.10:1 orange headline,
5.46:1 built-for line).

Deviations from the spec's starting points, all for measured legibility:
- Desktop scrim `linear-gradient(100deg, 0.80 0%, 0.74 48%, 0.26 82%)`
  rather than `0.62 15% / 0.22 70%`.
- A separate, stronger, near-vertical scrim below 768px, because the layout
  stacks to one column there and the text spans the full width of the photo.
  The spec's single left-to-right scrim only makes sense once the layout
  splits in two.
- `background-position: 32% 18%` rather than `18% 22%`, checked against the
  demo widget's real rendered position (visible phone shell starts at 58.7%
  of hero width; the subject sits clear to its left).

Also changed, not in the spec's list but required by the palette swap:
`.gradient-border` had `background: white` hardcoded in the page's CSS block
and would have stayed white on kraft. Its border gradient was also navy;
both were warmed. `text-slate-500` (18 occurrences) was swapped to #5C4A2E
because slate-500 on #F3E8D0 measures 3.91:1 and fails AA for small text,
where #5C4A2E gives 6.97:1.

Left alone deliberately: `.dot-grid` CSS is retained because the dark Final
CTA section still uses it (only the hero's usage was removed); the navy
Final CTA band itself is unchanged per "dark tokens unchanged"; the primary
CTA keeps its existing `#0D1B2E` label colour per "buttons stay exactly as
they are".

## Addendum: four fixes found on review (2026-08-29 22:04 PT)

Same branch, still not merged. This should have been written before touching
any code, per the instruction that started this session -- it wasn't; the
session went straight to investigation and implementation instead, and this
addendum was written after the fact once that was noticed. Flagging the
process miss plainly rather than quietly backfilling it.

### 1. Mobile nav was broken

Checked before assuming new: `git show main:app/page.tsx` at the same nav
block shows "How it works" and "Pricing" already carried `hidden sm:block`
on `main`, before this branch existed -- that part predates the redesign.
The overlap ("Sign in" wrapping onto two lines, stamped over the wordmark)
was not present in the same form on `main` because `main`'s nav is
structurally identical (no code changed there this session before now) --
measurement showed the real cause either way: the wordmark lockup alone
(`iconSize=44 textSize=36`) measures 313px, and the mobile nav only has
327px of content width after padding. Adding "Sign in" (28px, wrapping) and
"Start Free" (66px) on top of that pushed Start Free's button to `x=377` --
past the 375px viewport, off-screen, not just visually crowded.

No existing hamburger/mobile-nav pattern exists anywhere else in the
codebase (checked). Built one: new `app/components/marketing-nav.tsx`, a
client component (needed for the open/close state -- `app/page.tsx` stays a
server component and passes down only plain serializable values, never the
Supabase user object). Below `sm:`, "How it works" / "Pricing" / "Sign in"
collapse into a hamburger-toggled panel; the primary CTA (Start Free / Go to
App / Subscribe) stays visible in the bar at every width, per the brief.

The wordmark itself still needed to shrink on mobile -- collapsing the other
links doesn't help if the CTA and hamburger button alone can't fit beside a
313px-wide lockup in a 327px-wide bar. Rather than touch `wordmark.tsx`
(shared by six other places at carefully-tuned sizes), added a scoped
`!important` override (`.nav-lockup span { font-size: 19px }`, then measured
and dropped to 17px) inside `page.tsx`'s own style block, since
`WordmarkText` sets font-size inline and only an equal-or-higher-specificity
rule can override it. Measured, not guessed: at 17px the lockup is 177px
wide, leaving a 7px gap to the CTA and 20px clearance to the viewport edge
at 375px -- confirmed via `getBoundingClientRect()`, not assumed from the
font-size change alone. Desktop (`sm:` and up) is untouched: the media query
is `max-width: 639px`, and a screenshot at 1440px shows the nav unchanged.

### 2. Mobile hero photo showed background, not the subject

The `32% 18%` position tuned in the prior session was reasoned against the
desktop crop (a wide, landscape-shaped hero box) and never checked against
mobile's box, which is tall and narrow -- at `cover` sizing those two shapes
select completely different slices of the same square source image. Moved
the position into its own `@media (max-width: 767px)` rule (previously it
was only set once, unscoped, and simply overridden again inside the
768px-and-up query) and iterated against real screenshots: `56% 30%` first
(brought the face into view but tight against the CTA buttons), then
`58% 20%` (worse -- more zoomed, more overlap), settled on `56% 28%`,
checked visually each time rather than computed once and trusted. Re-ran the
contrast audit from the prior session after the position changed, since
different photo pixels now sit under the same text: all hero text elements
still pass (one apparent failure, the "Start Free"/"Try free for 14 days"
button text at 1.01:1, was the audit script incorrectly checking that
button's navy-on-solid-orange text against the photo behind it instead of
its own opaque background -- not a real regression, confirmed by checking
that pairing in isolation).

### 3. Eyebrow labels removed sitewide

Grepped for the shared class rather than editing seven instances by hand:
`text-xs font-semibold uppercase tracking-widest mb-3` matched 9 times
before -- the 7 named ("How it works", "See it for your trade", "After
it's generated", "Why it works", "After the estimate", "Pricing", "FAQ")
plus 2 unrelated matches (the "Starter" / "Pro" plan-name labels on the
pricing cards, which share the class but aren't section eyebrows and
weren't in the brief's list). Removed exactly the 7 named `<p>` elements.
After: the shared class matches 2 (confirmed via `grep -c`, both the two
pricing labels, neither of the 7 requested strings appears anywhere in the
file). Headings now stand alone; no replacement copy added; heading styling
untouched.

### 4. "How it works" three-step section de-carded

Removed `card-lift gradient-border relative rounded-2xl` from each step
(those classes are still used, and still needed, by the unrelated Benefits
section further down -- confirmed via grep before assuming the CSS could
go), the large `text-3xl md:text-4xl` orange "01"/"02"/"03" numeral, and the
decorative connecting line + arrow-in-circle between cards (which existed
to visually link the numeral bubbles -- with the bubbles gone, keeping the
connector would have pointed at nothing). Replaced with a `divide-y
md:divide-y-0 md:divide-x` grid using the kraft `#C9B384` hairline token:
stacked with horizontal rules on mobile, a row with vertical rules on
desktop. Each step keeps a small `text-sm` numeral (`#B45309`, the "accent
on light" token) inline with its `<h3>` heading -- a label, not a graphic.
Copy for all three steps is byte-for-byte the same `STEPS` constant,
untouched.

### Verification actually run (2026-08-29 22:04 PT)

- `npx tsc --noEmit` -- exit 0.
- `npx next build` -- exit 0, all routes built.
- Screenshots at 375px for both mobile fixes (nav collapsed, nav menu open,
  hero subject visible) and at 375px + 1440px for the eyebrow removal and
  the de-carded steps section.
- Eyebrow grep count reported as evidence: 9 matches before, 2 after (both
  confirmed to be the unrelated Starter/Pro labels, 0 of the 7 named
  strings remaining anywhere in the file).
- Demo widget re-proven unmodified: hashes of all three `EstimateDemo*.tsx`
  files identical to the untouched baseline, `git diff main` on those paths
  still empty.
- Re-ran the hero contrast audit after the mobile position change; all
  elements pass (one script false-positive investigated and explained
  above, not a real failure).

`public/trades-van.png` (flagged last session as safe to delete) is gone
from the working tree as of this session -- not deleted by this work,
presumably handled separately.

## Addendum: Final CTA band still on the old navy, not the ink token (2026-08-29 22:40 PT)

Checked, not assumed. Computed-style readback (`getComputedStyle(section)`
on the live page, not a class-name guess) on the "Quote faster. / Win more
jobs." section:

```
backgroundImage: "linear-gradient(135deg, rgb(13, 27, 46) 0%, rgb(26, 46, 71) 100%)"
```

`rgb(13,27,46)` is `#0D1B2E`, `rgb(26,46,71)` is `#1A2E47`. Neither is
`#26211B`. This is not a close variant or a rounding difference -- `#0D1B2E`
is a cool navy blue (hue ~210), `#26211B` is a warm near-black (hue ~40).
It's the old brand's navy, used before this redesign existed, and it was
never migrated to the ink token. It read cooler in earlier screenshots than
the hero for a real reason, not a display artifact.

One correction to the premise this check started from: the demo widget
does **not** use `#26211B` -- it's `#09090b`, a separate near-black that's
part of the demo widget's own untouched design system, unrelated to the
kraft/ink token set. Only the hero scrim actually resolves to `#26211B`
(confirmed earlier this session: `rgba(38,33,27,...)` at various alphas).
Worth being precise about since the two dark values look similar in a
screenshot but aren't the same number.

### The fix

`background: "linear-gradient(135deg, #0D1B2E 0%, #1a2e47 100%)"` ->
`background: "#26211B"`. Went solid rather than keeping a two-stop
gradient, since the token system has no established "lighter ink" partner
color to gradient toward, and inventing one would reintroduce exactly the
kind of stray hex this whole redesign has been removing. Confirmed via
computed-style readback after the change: `rgb(38, 33, 27)` -- exactly
`#26211B`.

### Contrast re-verified, not just the background swapped and assumed fine

Computed exact WCAG contrast (not estimated) for every text element in the
section, against both the old gradient's two stops and the new solid
value:

| Element | Old (worst of 2 stops) | New (#26211B) | Needs |
|---|---|---|---|
| "Quote faster. / Win more jobs." (white, large) | 13.76 | 15.96 | 3.0 |
| "Win more jobs." (orange span, large) | 6.41 | 7.43 | 3.0 |
| Subhead (60% white, 20px) | 5.96 | 6.59 | 4.5 |
| "Already have an account?" (50% white, 16px) | 4.62 | 5.02 | 4.5 |
| "14-day free trial..." (30% white, 14px) | **2.60 FAIL** | **2.70 FAIL** | 4.5 |

Every element that passed before still passes, with a slightly larger
margin. One element -- the 14-day trial line at 30% white opacity --
**already failed contrast before this change** (2.60:1 against the old
navy) and still fails after (2.70:1). Not a regression introduced by this
fix; not fixed either, since it's a pre-existing issue outside what was
asked here. Flagging it rather than quietly leaving it undocumented: that
line's opacity would need raising (or the token darkened further) to pass,
and that's a separate call for Greg to make.

Screenshotted the full page before and after at a tall viewport (this
Browser pane's scrolled-capture bug, noted in earlier sessions, still
applies, so both shots were taken at scroll position 0 with the viewport
sized to fit the section on-screen). The band visibly shifts from a
cool navy-blue to a warm near-black matching the hero and footer tone.

### Verification actually run (2026-08-29 22:40 PT)

- `npx tsc --noEmit` -- exit 0.
- `npx next build` -- exit 0.
- Computed-style readback before and after, both confirming exact rgb
  values (not inferred from the source edit).
- Exact contrast ratios computed for all 5 text elements in the section,
  before and after -- table above.
- Full-page screenshots before and after.
- Demo widget re-hashed identical to the untouched baseline; `git diff
  main` on all three `EstimateDemo*.tsx` files still empty.

## Addendum: Starter pricing card, six-card redundancy, FAQ accordion (2026-08-30 20:29 PT)

Same branch, still not merged.

### 1. Starter card was another unmigrated pre-redesign token

Read via computed-style, not guessed: `borderColor: rgb(226, 232, 240)`
(`#E2E8F0`, Tailwind slate-200) and the button's `backgroundColor:
rgb(100, 116, 139)` (`#64748B`, Tailwind slate-500) -- source confirmed
the same: `style={{ borderColor: "#E2E8F0" }}` on the card,
`style={{ background: "#64748B" }}` on the button. Same root cause as the
Final CTA band two sessions ago: a section nothing had explicitly scoped
in, still on the old generic Tailwind grays.

One correction to the brief before fixing it: the nav's "Start Free" is
**not** orange -- it's `#0D1B2E` (navy), same as `Go to App`/`Subscribe`
everywhere else in the nav/footer. The actual orange used by every other
primary in-page CTA (hero, Final CTA band) is `#f59e0b`. Used that.

Border -> `#C9B384` (the kraft border token, confirmed used elsewhere).
Button -> `background: "#f59e0b", color: "#0D1B2E"`, matching the hero
CTA's exact colour pairing (white text on `#f59e0b` fails contrast, which
is presumably why the hero CTA already pairs it with navy text -- followed
that precedent rather than guessing a new pairing).

Read back after the change: border `rgb(201, 179, 132)` (exact
`#C9B384`), button background `rgb(245, 158, 11)` (exact `#f59e0b`),
button text `rgb(13, 27, 46)` (exact `#0D1B2E`). Pro card's own border
re-read afterward and confirmed unchanged: still `rgb(13, 27, 46)`
(`#0D1B2E` -- itself an unmigrated old-navy value, same as the Starter
border was, but explicitly out of scope here since the brief said leave
Pro alone; flagging it rather than fixing it unasked).

Screenshotted before (grey border barely visible against the kraft
background, button reading as disabled) and after (kraft border, orange
button matching the hero) at desktop width, and confirmed the fixed
version again at 375px.

Other pre-existing generic-gray tokens noticed in the same card in
passing and **not touched** (not in the brief's scope): the "STARTER"
label (`#94A3B8`), the price (`text-slate-900`), the trial caption
(`text-slate-400`), and the feature list (`text-slate-600`). Same
category of issue as the border/button, likely worth a future pass, not
fixed here.

### 2. Six-card feature grid removed, redundancy confirmed by reading the copy

Read both `WORKFLOW_STEPS` (the four-card "Review, edit, send, done"
section) and `BENEFITS` (the six-card "Less time quoting. More jobs won."
section) source arrays directly before removing anything. Confirmed:
`WORKFLOW_STEPS`'s "What the customer sees" ("A clean estimate page with
your logo, the scope of work, and the price. No login needed.") overlaps
directly with `BENEFITS`'s "Send how you want" ("Customers can view the
estimate on any device... No app download required on their end.") and
"Professional output" ("Scope of work, line items, payment terms, and
your logo... Looks like it came from a proper business.") -- the same
"no login, view anywhere, looks professional" claims stated twice.

Removed the entire section (heading, subhead, six-card grid) along with
the now-fully-orphaned `BENEFITS` constant and the `.card-lift`/
`.gradient-border` CSS rules that only that section used (confirmed via
grep before removing -- both classes had zero other usages left in the
file). Nothing moved, nothing restyled, nothing added elsewhere.

### 3. FAQ converted to an accordion

New `app/components/faq-accordion.tsx` (client component -- needs
open/close state). `page.tsx` now holds the FAQ copy as a `FAQ_ITEMS`
constant (copy and order byte-for-byte the same as the six inline
objects it replaced) and passes it to `<FaqAccordion items={FAQ_ITEMS} />`.
Same kraft/hairline box treatment as before (`bg-[#F3E8D0] border
border-[#C9B384]`), just wrapped in a `<button>` with a chevron that
rotates on open, and the answer paragraph only rendered when that index
is the open one.

Verified behaviourally, not just visually: `aria-expanded` read directly
off all six buttons confirmed all `false` on load, `true` on exactly one
after clicking it, and clicking a second question flipped the first back
to `false` while opening the second -- one open at a time, not an
accumulating list. Screenshotted the open state at both 375px and
desktop width.

### Verification actually run (2026-08-30 20:29 PT)

- `npx tsc --noEmit` -- exit 0.
- `npx next build` -- exit 0, all routes built.
- Starter card: computed-style readback before and after (values above).
- Six-card removal: confirmed by reading both sections' actual copy
  first, not removed on request alone; confirmed no other usage of
  `BENEFITS`/`card-lift`/`gradient-border` remained before deleting them.
- FAQ accordion: `aria-expanded` state read directly via JS after each
  click (not inferred from a screenshot) -- closed by default, one open
  at a time, confirmed with three sequential clicks.
- Screenshots at 375px and desktop width for all three changes.
- Demo widget re-hashed identical to the untouched baseline; `git diff
  main` on all three `EstimateDemo*.tsx` files still empty.
- `TradeExamples.tsx` (the trade tabs) confirmed untouched via `git diff
  main` -- empty, as it has been every session it's been named out of
  scope.

## Final pre-merge sweep: sitewide stray-token audit (2026-08-30 22:15 PT)

**Status:** implemented on branch `redesign/hero-photo-kraft`, pushed, not
merged. Requested and treated as the last change before merge -- a full
sitewide audit for leftover Tailwind default slate/gray/zinc/neutral/stone
classes and hex values, not another one-off fix, covering routes this
branch's prior sessions never touched (`/trades`, `/electricians`,
`/plumbers`, `/contact`, `/share/[id]`, `/plumbing-cost`) plus their direct
siblings (`/electrical-cost`, `/plumbing-estimate-template`).

### Scope note: fourteen prior sessions claimed, four commits found

The task brief stated "this branch has fourteen prior sessions on it."
`git log main..HEAD` on this branch shows four commits: `9088b86`, `8aa100d`,
`c45af7a`, `578e653`. Recording this discrepancy rather than repeating an
unverified number -- sessions and commits aren't the same thing (a session
can end without committing), so this isn't proof the "fourteen" figure is
wrong, only that it isn't corroborated by branch history. Flagging for Greg
to confirm if it matters.

### Every match found, classified, and migrated

**`app/trades/page.tsx`, `app/electricians/page.tsx`, `app/plumbers/page.tsx`**
(6-7 edits each): sign-in link colours, subhead/description text, CTA
caption, "How it works" eyebrow, trust line, mobile CTA bar border, footer
domain link and legal footer -- all `text-slate-500`, `hover:text-slate-700`,
`border-slate-100`, `border-zinc-800`, `text-zinc-600`, `hover:text-zinc-400`.
Genuine misses in already-migrated pages (these three routes carry the same
kraft nav/footer chrome as the home page but were never swept for stray
tokens in a prior session). Migrated to `text-[#5C4A2E]` /
`hover:text-[#26211B]` / `border-[#C9B384]` per the established
base-muted/hover-brighter convention. Verified zero remaining via grep.

**`app/plumbing-cost/page.tsx`, `app/electrical-cost/page.tsx`** (12 edits
each, structurally identical siblings): headings, stat-box backgrounds,
dividers migrated from `text-slate-900/500/400/600/700`, `border-slate-200`,
`bg-slate-50`, `divide-slate-100` to the kraft set. The dark "Are you a
plumber/electrician?" CTA card (its own `#26211B` background, not
`#0D1B2E`) had its text and caption migrated from slate classes to the
on-dark pair (`#F7F2E9` / `#9A8F79`). Genuine miss -- same kraft treatment as
the rest of the site, just never swept. Verified zero remaining via grep.
Screenshotted at 375px and desktop; dark CTA card confirmed correct
on-dark contrast.

**`app/plumbing-estimate-template/page.tsx`**: root stays `bg-[#0D1B2E]`
(out of scope, untouched). Its `markdownComponents` renderers (`p`, `ol`,
`li`, `th`, `td`), the back-link, the CTA card copy, and the footer were
migrated from slate classes to the on-dark pair, since text inside a dark
section needs the on-dark tokens, not the light kraft muted-ink (`#5C4A2E`)
which would read as illegibly dim there. One self-caught mistake mid-fix:
the footer links were first written base-bright/hover-dim
(`#F7F2E9` base, `hover:opacity-80`), backwards from this branch's
established base-muted/hover-brighter convention -- caught and corrected
before it went out for review. Verified zero remaining via grep; confirmed
via screenshot at both breakpoints, including the pricing table and
footer.

**`app/contact/page.tsx`**: 7 edits across three zones. Root/header light
chrome: `bg-[#F3E8D0] text-[#26211B]`. Dark hero section
(its own `bg-[#0D1B2E]`, out of scope, untouched): `text-slate-200/300/400`
migrated to on-dark tokens (`#F7F2E9` for prominent copy, `#9A8F79` for
secondary). Light content section: topic cards migrated to
`border-[#C9B384]`, `hover:bg-[#EADCC0] active:bg-[#EADCC0]` (no distinct
hover-border token exists, so the `hover:border-slate-300` it had was
dropped rather than invented). Genuine miss -- this route predates the
kraft redesign entirely. Verified zero remaining via grep; screenshotted
mobile, full mobile scroll, and desktop.

**`app/share/[id]/page.tsx`**: 5 edits, entirely light context.
`bg-slate-50` (not-found state and page root) to `bg-[#F3E8D0]`; card
border and letterhead divider to `border-[#C9B384]`; `text-zinc-500`
(prepared-by line) to `#5C4A2E`; `text-zinc-900` (title) to `#26211B`;
photo thumbnail border and footer "Powered by" text corrected. Genuine
miss. Screenshotted the not-found state at mobile; no live estimate ID was
available in this environment to screenshot the main render path, so that
path was verified by reading the source and the shared-component fixes
below rather than by screenshot.

**`app/page.tsx` (home page)**: the previously-flagged `#94A3B8` "Starter"
label was already fixed in an earlier session. This pass found and fixed
18 further unmigrated instances: `text-slate-700` (pain-point strip) and
`bg-slate-300` (divider dot) targeted individually; `text-slate-900` (12
heading occurrences), `text-slate-400`, `text-slate-600`, and
`text-slate-800` (Pro card feature title, distinct from the `#0D1B2E` used
elsewhere on the same Pro card for border/label/button, which stays
untouched) applied via `replace_all` after confirming via grep that no
conflicting `hover:` variant of the same literal string existed in the
file. Genuine miss -- headings were tacitly exempted in every prior round.
Verified zero remaining via grep; confirmed `#0D1B2E` still present 9 times
(correctly untouched); re-screenshotted the full mobile scroll after the
fix, including the pricing cards and FAQ accordion.

**`app/components/faq-accordion.tsx`**: one miss from the FAQ-accordion
conversion two sessions ago -- `text-slate-900` on the question heading,
missed because the accordion's own file header comment already claimed
"the kraft/hairline box treatment... is the same as the plain list this
replaced" without that being fully true. Fixed to `text-[#26211B]`.

**`app/components/CopyEmailButton.tsx`**: found only by searching the
whole codebase rather than just the routes named in the brief -- this
component renders exclusively on `/contact` (confirmed via grep for its
only usage) but was never touched when that page was migrated. Entirely
unmigrated: `border-slate-300`, `bg-white`, `text-slate-800`,
`hover:bg-slate-50`, `text-slate-500`. Migrated to `border-[#C9B384]`,
`text-[#26211B]`, `hover:bg-[#EADCC0]`, `text-[#5C4A2E]`.

**`app/components/company-estimate-header.tsx`**: `text-zinc-800` on the
business-name line. Shared between the authenticated app shell and
`/share/[id]`, but always rendered on a literal white card in every one of
its three usages (not on the app shell's dark background) -- CLAUDE.md
itself calls it "the header on the white estimate card." Migrated to
`text-[#26211B]`, correct in all three contexts since the card itself is
white regardless of what surrounds it.

**`app/components/estimate-markdown.tsx`**: the single source-of-truth
estimate-content renderer (`EstimateMarkdown`, per CLAUDE.md) was entirely
unmigrated -- every one of its markdown-element renderers (`h1`, `h2`,
`h3`, `p`, the "Estimated total" callout, `li`, `strong`, `table`,
`thead`, `th`, `td`, `hr`, `blockquote`) used `text-zinc-900/700/600/400`,
`border-zinc-200/300`, and `bg-zinc-100`. This is the largest genuine miss
found this session: it renders the bulk of every estimate's visible
content on the public `/share/[id]` white card, one of the six routes the
brief named explicitly. Migrated following this branch's established
zinc-tier mapping (400/500/600/700 to muted-ink `#5C4A2E`, 800/900 to ink
`#26211B`, all borders/hairlines to `#C9B384`, the table-header background
to the deeper kraft surface `#EADCC0`). Colour values only -- no structural
change to the renderer.

**`app/components/download-pdf-button.tsx`**: `bg-zinc-800
hover:bg-zinc-700` on the only button this component renders, used
exclusively on `/share/[id]` (confirmed via grep -- not shared with the
authenticated app shell at all, so this isn't a case of "correctly left
alone because it's app-shell theming"). Migrated to `bg-[#26211B]
hover:opacity-90`, matching the established solid-dark-button convention
used elsewhere on this branch (base colour + `hover:opacity-90`, not a
second shade).

### Confirmed not a regression (untouched, correctly out of scope)

Grep across `app/**/*.tsx` for the full slate/gray/zinc/neutral/stone class
families and their literal default hex values turned up matches only in:
the authenticated app shell (`bottom-nav.tsx`, `customer-details-block.tsx`,
`deposit-block.tsx`, and every route under the dark `bg-zinc-950` theme --
`estimates`, `new`, `profile`, `rates`, `payments`, `onboarding`, `login`,
`signup`, `subscribe`, `privacy`, `terms`, `demo` -- a separate, intentional
theme never named in any round of this branch); the three protected demo
widgets (`EstimateDemo.tsx`, `EstimateDemoElectrical.tsx`,
`EstimateDemoTrades.tsx`, all literal near-black/gray hex inside their own
self-contained phone-mockup styling); `TradeExamples.tsx` (`#F1F5F9`,
`#475569` -- the trade-example tabs, untouched, confirmed again); and
`profile-form.tsx` (`#09090b`, matching the app shell's own dark theme).
None of these are regressions or misses -- all are either the deliberately
separate authenticated-app theme or explicitly protected files.

### `#0D1B2E` (old navy) -- every location, reported, none touched

Per the brief, reporting every place this appears without changing it (a
separate design decision, not part of this cleanup):

- `app/components/marketing-nav.tsx:33,37` -- nav CTA button background.
- `app/page.tsx:287,481,488,559` -- amber-button navy text pairing (badge,
  hero CTA, Pro badge); `:492` -- Pro card "Pro" eyebrow label; `:486` --
  Pro card border; `:521,588,596` -- Pro/Subscribe button backgrounds.
- `app/trades/page.tsx`, `app/electricians/page.tsx`, `app/plumbers/page.tsx`
  (2 h1/h2 headings, 1 amber-button text pairing, 1 CTA button each) --
  present on all three trade landing pages, not just Pro/Subscribe as the
  brief described.
- `app/plumbing-cost/page.tsx:245`, `app/electrical-cost/page.tsx:242`,
  `app/plumbing-estimate-template/page.tsx:102,144` -- amber-button text
  pairing plus (template page only) the page's own root background.
- `app/contact/page.tsx:93,101,125,176,189,207` -- Sign-in button (x2),
  dark hero section background, amber-button text pairing, "Email support"
  label, mailto link.
- `app/components/TradeExamples.tsx:95` -- active-tab background (part of
  the explicitly protected tabs component).
- `app/opengraph-image.tsx:15` -- OG image background.

This footprint is considerably wider than "nav CTA, Pro pricing card,
Subscribe button" -- it's also the standard navy-text-on-amber-button
pairing used on every CTA button sitewide, and two full page/section
backgrounds. None of it was touched.

### Verification actually run (2026-08-30 22:15 PT)

- `npx tsc --noEmit` -- exit 0.
- `npx next build` -- exit 0, all routes built including the four newly
  touched shared components.
- Screenshots at 375px and desktop for every section where a fix landed
  this pass: `/trades`, `/electricians`, `/plumbers` (mobile, prior
  session already covered desktop for these three), `/contact` (mobile,
  full mobile scroll, desktop), `/share/[id]` not-found state (mobile),
  `/plumbing-cost` (mobile, desktop), `/electrical-cost` (mobile including
  the dark CTA card, desktop), `/plumbing-estimate-template` (full-page
  mobile and desktop via a tall viewport, working around a known
  Browser-pane bug where a screenshot taken after scrolling to a ref can
  render solid black), home page (full mobile scroll re-confirmed after
  the 18-instance batch fix).
- WCAG contrast re-checked (manual luminance/contrast calculation, not
  eyeballed) for every text/background pairing touched this session: ink
  `#26211B` and muted-ink `#5C4A2E` against white, `#F3E8D0`, and `#EADCC0`
  all pass AA (6.26:1 to 15.96:1); on-dark `#F7F2E9`/`#9A8F79` against
  `#26211B` and `#0D1B2E` both pass AA (5.00:1 to 14.31:1); white on the
  new `#26211B` Download PDF button passes AA (15.96:1).
- Demo widget re-hashed against baseline: `git diff main` on
  `EstimateDemo.tsx`, `EstimateDemoElectrical.tsx`, `EstimateDemoTrades.tsx`
  still empty. `TradeExamples.tsx` also confirmed empty via the same diff.
