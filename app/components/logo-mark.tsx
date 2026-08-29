// The TradePulse mark on its own, no wordmark. See wordmark.tsx for the
// icon+text lockups built on top of these.

// Mark A's small-size treatment, per the brand reference's own "sizes"
// row: 40px+ is the default (2.2 stroke, both gridlines). 24-39px
// thickens the stroke to 2.6, gridlines still present. Under 24px
// thickens further to 3 AND drops both gridlines entirely -- at that
// size they read as noise, not detail.
type MarkATreatment = { strokeWidth: number; showGridlines: boolean };

function markATreatment(size: number): MarkATreatment {
  if (size < 24) return { strokeWidth: 3, showGridlines: false };
  if (size < 40) return { strokeWidth: 2.6, showGridlines: true };
  return { strokeWidth: 2.2, showGridlines: true };
}

export function LogoMarkOnDark({ size = 44 }: { size?: number }) {
  const { strokeWidth, showGridlines } = markATreatment(size);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect x="5.5" y="2.5" width="21" height="27" fill="none" stroke="#F7F2E9" strokeWidth={strokeWidth} />
      {showGridlines && (
        <>
          <line x1="9.5" y1="9" x2="18.5" y2="9" stroke="#6B6152" strokeWidth="2" />
          <line x1="9.5" y1="13" x2="22.5" y2="13" stroke="#6B6152" strokeWidth="2" />
        </>
      )}
      <path
        d="M9 21.5 H12 L13.6 17 L16.2 26 L18 20.5 L19 21.5 H23"
        fill="none"
        stroke="#F59E0B"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LogoMarkLight({ size = 44 }: { size?: number }) {
  const { strokeWidth, showGridlines } = markATreatment(size);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect x="5.5" y="2.5" width="21" height="27" fill="#FFFCF6" stroke="#211D18" strokeWidth={strokeWidth} />
      {showGridlines && (
        <>
          <line x1="9.5" y1="9" x2="18.5" y2="9" stroke="#C8BCA4" strokeWidth="2" />
          <line x1="9.5" y1="13" x2="22.5" y2="13" stroke="#C8BCA4" strokeWidth="2" />
        </>
      )}
      <path
        d="M9 21.5 H12 L13.6 17 L16.2 26 L18 20.5 L19 21.5 H23"
        fill="none"
        stroke="#F59E0B"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Stroke thickens as the render shrinks so the mark stays legible at
// favicon-scale sizes: 2.8 at 40px and up, 3.2 at 24px, 4.0 at 16px and
// below, linearly interpolated between those anchors (viewBox units, not
// device pixels).
function markCStrokeWidth(size: number): number {
  if (size <= 16) return 4.0;
  if (size <= 24) return 4.0 - ((size - 16) / (24 - 16)) * (4.0 - 3.2);
  if (size <= 40) return 3.2 - ((size - 24) / (40 - 24)) * (3.2 - 2.8);
  return 2.8;
}

/**
 * Mark C: filled tile, same on any surface (the fill IS the background).
 * Not used by RowLockup/StackedLockup as of the small-size Mark A
 * treatment above -- Greg's call, Mark A is used at every size sitewide
 * now. Kept here, unreferenced by the lockups, for an eventual real
 * favicon/app-icon build, which is what it was actually designed for.
 */
export function LogoMarkC({ size = 32 }: { size?: number }) {
  const strokeWidth = markCStrokeWidth(size);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect width="32" height="32" fill="#F59E0B" />
      <path
        d="M3.5 17 H9 L11.4 9.5 L15.6 25 L18.6 14.5 L20.2 17 H28.5"
        fill="none"
        stroke="#211D18"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
