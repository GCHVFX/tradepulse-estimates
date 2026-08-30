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
