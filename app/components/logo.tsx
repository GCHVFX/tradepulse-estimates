import { RowLockup } from "@/app/components/wordmark";

// Every screen that renders this component has a dark shell (bg-zinc-950),
// so the lockup always uses the on-dark variant. If a light-background
// screen ever needs this component, add a `variant` prop then rather than
// speculatively building one now.
//
// Text size: the reference sheet gives 26px for a normal header icon and
// 19px under a 24px icon, but doesn't cover a 44px icon (this one was
// deliberately enlarged from 32px last round so Mark A's outline doesn't
// mush below 40px -- the text has no such constraint). Scaled 26px
// proportionally to the icon's growth (44/32 = 1.375x) and rounded to 36px.
export function Logo() {
  return <RowLockup variant="dark" iconSize={44} textSize={36} />;
}
