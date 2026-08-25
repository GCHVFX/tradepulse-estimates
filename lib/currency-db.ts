/**
 * The single place that reads or writes the new currency columns.
 *
 * TYPE-GENERATION BLOCKER, deliberate and temporary:
 * `lib/database.types.ts` is generated from the LIVE schema, and
 * `supabase/migrations/20260825000000_add_currency_columns.sql` has not been
 * applied to Production yet. Regenerating types now would produce the old
 * schema, and hand-editing them would fake schema state that does not exist.
 * So the two new columns are accessed through the narrow casts below and
 * nowhere else.
 *
 * After the migration is applied, regenerate `lib/database.types.ts` with the
 * Supabase MCP `generate_typescript_types` tool, then delete the casts here.
 * Everything else in the app already goes through this module, so that is a
 * one-file change.
 */

import { currencyOrDefault, type Currency } from "./currency";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyClient = any;

export const BUSINESS_ESTIMATE_CURRENCY_COLUMN = "estimate_currency";
export const ESTIMATE_CURRENCY_COLUMN = "currency";

/** The business's estimate currency, defaulting to CAD pre-migration. */
export async function readBusinessEstimateCurrency(
  supabaseAdmin: AnyClient,
  businessId: string
): Promise<Currency> {
  const { data, error } = await supabaseAdmin
    .from("tpe_businesses")
    .select(BUSINESS_ESTIMATE_CURRENCY_COLUMN)
    .eq("id", businessId)
    .maybeSingle();

  // Before the migration lands the column does not exist. Falling back to CAD
  // keeps every existing business exactly where it is.
  if (error || !data) return "cad";
  return currencyOrDefault((data as Record<string, unknown>)[BUSINESS_ESTIMATE_CURRENCY_COLUMN]);
}

/** Row patch that sets a business's estimate currency. Never touches Stripe. */
export function businessEstimateCurrencyPatch(currency: Currency): Record<string, string> {
  return { [BUSINESS_ESTIMATE_CURRENCY_COLUMN]: currency };
}

/** Row patch that snapshots the currency onto a newly created estimate. */
export function estimateCurrencyPatch(currency: Currency): Record<string, string> {
  return { [ESTIMATE_CURRENCY_COLUMN]: currency };
}

/** The estimate's immutable snapshot, by id. Defaults to CAD pre-migration. */
export async function readEstimateCurrency(
  supabaseAdmin: AnyClient,
  estimateId: string
): Promise<Currency> {
  const { data, error } = await supabaseAdmin
    .from("tpe_estimates")
    .select(ESTIMATE_CURRENCY_COLUMN)
    .eq("id", estimateId)
    .maybeSingle();

  if (error || !data) return "cad";
  return currencyOrDefault((data as Record<string, unknown>)[ESTIMATE_CURRENCY_COLUMN]);
}

/**
 * Snapshots for many estimates in one query, for the reminder cron. Ids with
 * no row, or any id at all before the migration lands, resolve to CAD.
 */
export async function readEstimateCurrencies(
  supabaseAdmin: AnyClient,
  estimateIds: readonly string[]
): Promise<Map<string, Currency>> {
  const result = new Map<string, Currency>();
  if (estimateIds.length === 0) return result;

  const { data, error } = await supabaseAdmin
    .from("tpe_estimates")
    .select(`id, ${ESTIMATE_CURRENCY_COLUMN}`)
    .in("id", estimateIds as string[]);

  if (error || !data) return result;
  for (const row of data as Record<string, unknown>[]) {
    result.set(String(row.id), currencyOrDefault(row[ESTIMATE_CURRENCY_COLUMN]));
  }
  return result;
}

/** Reads the immutable snapshot off an estimate row. */
export function estimateCurrencyOf(row: unknown): Currency {
  if (!row || typeof row !== "object") return "cad";
  return currencyOrDefault((row as Record<string, unknown>)[ESTIMATE_CURRENCY_COLUMN]);
}
