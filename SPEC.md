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
