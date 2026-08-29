import { LogoMarkLight, LogoMarkOnDark } from "@/app/components/logo-mark";

export type WordmarkVariant = "light" | "dark";

const WORDMARK_COLORS: Record<WordmarkVariant, { ink: string; muted: string }> = {
  light: { ink: "#211D18", muted: "#6B6152" },
  dark: { ink: "#F7F2E9", muted: "#9A8F79" },
};

function pickMark(variant: WordmarkVariant) {
  return variant === "dark" ? LogoMarkOnDark : LogoMarkLight;
}

/**
 * "TradePulse Estimates" text only, no icon. Instrument Serif, line-height
 * 1. "Estimates" differs from "TradePulse" by colour only -- font-style
 * stays normal for both, never italic.
 */
export function WordmarkText({
  variant,
  size = 26,
}: {
  variant: WordmarkVariant;
  size?: number;
}) {
  const { ink, muted } = WORDMARK_COLORS[variant];
  return (
    <span
      style={{
        fontFamily: "var(--font-instrument-serif), Georgia, serif",
        fontSize: size,
        lineHeight: 1,
        fontStyle: "normal",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: ink }}>TradePulse </span>
      <span style={{ color: muted }}>Estimates</span>
    </span>
  );
}

/**
 * Icon beside the wordmark, row layout, 11px gap, vertically centered --
 * the standard header/nav lockup. Used by the app nav (Logo()), the
 * marketing demo widgets, and the marketing site's public header/footer.
 * Mark A (Light/OnDark) is used at every size, sitewide -- LogoMarkLight/
 * LogoMarkOnDark apply their own size-graduated stroke-width/gridline
 * treatment internally (see logo-mark.tsx), so this component doesn't
 * need to know or care what size it's rendering at.
 */
export function RowLockup({
  variant,
  iconSize = 44,
  textSize = 26,
}: {
  variant: WordmarkVariant;
  iconSize?: number;
  textSize?: number;
}) {
  const Mark = pickMark(variant);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
      <Mark size={iconSize} />
      <WordmarkText variant={variant} size={textSize} />
    </div>
  );
}

/**
 * Icon above the wordmark, column layout, 6px gap, left-aligned. Built per
 * spec for future placement (auth screens, empty states, splash) -- not
 * imported or rendered anywhere yet.
 */
export function StackedLockup({
  variant,
  iconSize = 44,
}: {
  variant: WordmarkVariant;
  iconSize?: number;
}) {
  const Mark = pickMark(variant);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
      <Mark size={iconSize} />
      <WordmarkText variant={variant} size={26} />
    </div>
  );
}
