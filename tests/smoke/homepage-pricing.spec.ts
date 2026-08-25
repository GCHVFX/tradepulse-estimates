/**
 * Homepage pricing currency, and the mobile hero's top spacing.
 *
 * Two defects, both found on Production from a single US VPN session:
 *
 *   1. /signup correctly showed US$19/month to a US visitor, while the
 *      homepage pricing cards showed CA$29 and CA$59 to that same session.
 *      The homepage was importing fixed CAD constants and had no country
 *      logic at all.
 *   2. At 375x812 the hero left 95px of empty space below the fixed header.
 *
 * The currency assertions are behavioural where they can be: they call the
 * same shared functions the page calls, so they check the strings the page
 * actually emits rather than just its imports. The wiring assertions exist to
 * stop a second, divergent country rule being introduced later.
 */
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  currencyFromCountry,
  currencyPrefix,
  formatMonthlyPlanPrice,
  planMonthlyPrice,
} from "../../lib/currency";

const PAGE = "app/page.tsx";

/** Source with comments removed, so a comment can neither satisfy nor fail an assertion. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
}

/** What the two pricing cards and the hero bullet will read for a country. */
function homepagePrices(country: string | null) {
  const currency = currencyFromCountry(country);
  return {
    currency,
    starterCard: `${currencyPrefix(currency)}${planMonthlyPrice("starter", currency)}`,
    proCard: `${currencyPrefix(currency)}${planMonthlyPrice("pro", currency)}`,
    heroBullet: `${formatMonthlyPlanPrice("starter", currency)} flat`,
  };
}

// ── Currency ────────────────────────────────────────────────────────────────

test("a US visitor sees US$19 and US$39 on the homepage", () => {
  const { currency, starterCard, proCard, heroBullet } = homepagePrices("US");

  expect(currency).toBe("usd");
  expect(starterCard).toBe("US$19");
  expect(proCard).toBe("US$39");
  expect(heroBullet).toBe("US$19/month flat");
});

test("Canadian, unknown, and non-US visitors see CA$29 and CA$59", () => {
  for (const country of ["CA", "GB", "AU", "XX", "", null]) {
    const { currency, starterCard, proCard, heroBullet } = homepagePrices(country);

    expect(currency, `${country} must resolve to CAD`).toBe("cad");
    expect(starterCard, `${country}`).toBe("CA$29");
    expect(proCard, `${country}`).toBe("CA$59");
    expect(heroBullet, `${country}`).toBe("CA$29/month flat");
  }
});

test("every homepage price carries an explicit CA$ or US$, never a bare $", () => {
  for (const country of ["US", "CA", null]) {
    const p = homepagePrices(country);
    for (const rendered of [p.starterCard, p.proCard, p.heroBullet]) {
      expect(rendered).toMatch(/^(CA|US)\$/);
      expect(rendered).not.toMatch(/(?<![A-Z])\$\d/);
    }
  }
});

test("the homepage resolves currency through the same resolver as /signup", () => {
  const page = code(PAGE);
  const signup = code("app/signup/page.tsx");

  // Same header, same resolver, both server-side.
  for (const source of [page, signup]) {
    expect(source).toContain("x-vercel-ip-country");
    expect(source).toContain("currencyFromCountry");
  }
  expect(page).toContain('currencyFromCountry((await headers()).get("x-vercel-ip-country"))');
});

test("the homepage holds no country rule of its own", () => {
  const page = code(PAGE);

  // currencyFromCountry() is the only place a country becomes a currency.
  // Anything here that inspects the country itself would be a second rule
  // free to drift from the one /signup uses.
  expect(page).not.toMatch(/===\s*["']US["']/);
  expect(page).not.toContain("toUpperCase()");
  expect(page).not.toContain("navigator.language");
  expect(page).not.toContain("Intl.DateTimeFormat");
  expect(page.match(/x-vercel-ip-country/g) ?? []).toHaveLength(1);
});

test("the pricing cards no longer hardcode a currency", () => {
  const page = code(PAGE);

  // The only CA$ left is the static metadata description, which is the search
  // snippet rather than an on-page price and cannot read request headers.
  const hardcoded = page.match(/CA\$/g) ?? [];
  expect(hardcoded.length, "only the metadata description may hardcode CA$").toBe(1);
  expect(page).toContain("description:");
  expect(page).not.toContain("PRO_MONTHLY_PRICE_CAD");

  // Cards build their price from the resolved currency.
  expect(page.match(/currencyPrefix\(currency\)/g) ?? []).toHaveLength(2);
  expect(page).toContain('planMonthlyPrice("starter", currency)');
  expect(page).toContain('planMonthlyPrice("pro", currency)');
});

test("the homepage stays per-request so one visitor's country is never cached for another", () => {
  const page = code(PAGE);

  // Reading a request header opts the route into dynamic rendering, which is
  // what stops a US visitor's prices being served from cache to everyone.
  expect(page).toContain("await headers()");
  expect(page).toContain('from "next/headers"');
  // A build-time cache directive here would defeat that.
  expect(page).not.toMatch(/export const revalidate\s*=/);
  expect(page).not.toMatch(/export const dynamic\s*=\s*["']force-static["']/);
});

// ── Mobile hero spacing ─────────────────────────────────────────────────────

test("the mobile hero starts just below the fixed header, not a screen down", () => {
  const page = code(PAGE);

  const hero = page.match(/<section className="relative overflow-hidden noise ([^"]*)"/);
  expect(hero, "hero section must be findable").toBeTruthy();
  const classes = hero![1];

  // Measured at 375x812 against the local dev server: the fixed nav is 57px
  // tall. pt-32 (128px) left a 95px void below it. pt-20 (80px) brings the
  // first hero content to 47px below the nav, which reads as breathing room
  // rather than a gap. Tailwind spacing is 4px per step.
  const mobilePt = Number(classes.match(/(?:^|\s)pt-(\d+)(?:\s|$)/)![1]) * 4;
  expect(mobilePt, "mobile hero top padding").toBeLessThanOrEqual(80);

  // Desktop is deliberately untouched, and only a separate sm: class keeps it
  // that way. Losing it would drag the desktop hero up with the mobile one.
  expect(classes).toContain("sm:pt-40");
});
