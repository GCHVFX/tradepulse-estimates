import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";

/**
 * A phone with a safe-area inset (most current iPhones, many Android
 * browsers) renders BottomNav taller than the ~87px figure
 * app/components/estimate-actions.tsx's fixed action bar and
 * app/estimates/[id]/page.tsx's bottom padding were both hardcoded against --
 * BottomNav's own bottom padding is `env(safe-area-inset-bottom)`-driven
 * (app/components/bottom-nav.tsx). On such a device the old `bottom-[84px]`
 * and flat `108px` under-reserved space, so the sticky Send bar (and its
 * disabled-state warning text) covered the bottom of the pricing editor and
 * summary instead of sitting below it -- found on a real seeded phone pass,
 * not in CI, precisely because Playwright's default Chromium reports
 * `env(safe-area-inset-bottom)` as 0 (tests/smoke/estimate-actions-no-nav-
 * gap.spec.ts's invariant-based gap assertion holds either way, so it never
 * caught this; that test needs a live account and could not be run here).
 *
 * No browser, no live account: BottomNav's own real height is now measured
 * (the same ResizeObserver-and-CSS-variable pattern estimate-actions.tsx
 * already used for its own height) and both consumers read that measurement
 * instead of a guess, so this is a static, unit-safe check that the
 * mechanism is wired correctly, not a pixel-value regression test.
 */

const root = path.join(__dirname, "../..");
const code = (file: string) => readFileSync(path.join(root, file), "utf8");

test("BottomNav measures and publishes its own real height", () => {
  const nav = code("app/components/bottom-nav.tsx");
  expect(nav).toContain("const navRef = useRef<HTMLElement>(null);");
  expect(nav).toContain('document.documentElement.style.setProperty("--tp-bottom-nav-height"');
  expect(nav).toContain("new ResizeObserver(publishHeight)");
  expect(nav).toContain("ref={navRef}");
  // Cleaned up on unmount, the same discipline estimate-actions.tsx already
  // follows for its own published variable.
  expect(nav).toContain('document.documentElement.style.removeProperty("--tp-bottom-nav-height");');
});

test("EstimateActions positions its fixed bar from BottomNav's measured height, not a hardcoded offset", () => {
  const actions = code("app/components/estimate-actions.tsx");
  expect(actions).toContain('style={{ bottom: "calc(var(--tp-bottom-nav-height, 87px) - 3px)" }}');
  // The old hardcoded class is gone from the fixed bar's own className --
  // not just added alongside it -- though the comment above may still name
  // it for historical context, so check the className attribute specifically
  // rather than the whole file.
  const classNameMatch = actions.match(/className="fixed left-0 right-0 px-5 pb-7 pt-4[^"]*"/);
  expect(classNameMatch).not.toBeNull();
  expect(classNameMatch?.[0]).not.toContain("bottom-[84px]");
});

test("the estimate detail page's bottom padding accounts for both bars' real measured heights", () => {
  const page = code("app/estimates/[id]/page.tsx");
  expect(page).toContain("var(--tp-estimate-action-bar-height, 200px)");
  expect(page).toContain("var(--tp-bottom-nav-height, 87px)");
  // The flat, safe-area-blind constant this replaces is gone.
  expect(page).not.toContain("+ 108px");

  // Same net clearance as before on a no-safe-area device: the fallback
  // values alone (200 + 87 - 3 + 24 = 308) reduce to the same shape the old
  // formula had (barHeight + 108, with 87 - 3 + 24 = 108), so nothing
  // regresses for a device this fix doesn't need to change anything for.
  expect(page).toContain(
    'paddingBottom:\n            "calc(var(--tp-estimate-action-bar-height, 200px) + var(--tp-bottom-nav-height, 87px) - 3px + 24px)",'
  );
});

/**
 * Follow-up defect found on the phone after the fixes above: an estimate
 * that loads *directly* into the state the sticky bar is hidden for (a
 * fresh incomplete contractor_pricing draft, the common case) never mounts
 * the bar's <div> even once, so the callback ref that publishes
 * --tp-estimate-action-bar-height is never invoked at all -- not with a
 * real element, not with null. The property stays permanently unset, and
 * page.tsx's 200px placeholder (meant only to bridge the gap before this
 * ref's first paint for a bar that *will* render) applies for the entire
 * session, reserving dead clearance for a bar that was never even
 * attempted. A callback ref only fires on mount/unmount, so nothing about
 * the ref itself can fix this; it needs an effect that runs independent of
 * whether the ref has ever fired.
 */
test("the action-bar height is forced to 0 whenever the sticky bar is hidden, independent of the callback ref ever firing", () => {
  const actions = code("app/components/estimate-actions.tsx");
  expect(actions).toContain(
    "const showStickyActionBar = shouldShowStickyActionBar({ isQuoteRequest, isDone, localStatus, sendBlocked });"
  );
  const guardEffect = actions.match(
    /useEffect\(\(\) => \{\s*if \(!showStickyActionBar\) \{\s*document\.documentElement\.style\.setProperty\("--tp-estimate-action-bar-height", "0px"\);\s*\}\s*\}, \[showStickyActionBar\]\);/
  );
  expect(guardEffect).not.toBeNull();

  // This effect's dependency array is showStickyActionBar itself, not [] --
  // an empty array (the callback ref's own mistake this fix corrects) would
  // only run the check once at mount, missing every later transition.
  expect(guardEffect?.[0]).toContain("[showStickyActionBar]");

  // Both call sites of shouldShowStickyActionBar (the render gate and this
  // effect) read the one computed value, not two separate calls that could
  // drift apart.
  const callCount = actions.split("shouldShowStickyActionBar({ isQuoteRequest, isDone, localStatus, sendBlocked })").length - 1;
  expect(callCount).toBe(1);
  expect(actions).toContain("{showStickyActionBar && (");
});
