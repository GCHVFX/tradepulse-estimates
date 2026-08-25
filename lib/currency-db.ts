/**
 * Reads and writes for the two currency columns.
 *
 * These helpers exist so every caller agrees on one fallback rule: an absent
 * or unrecognised value is CAD, never an error and never USD. Both columns are
 * `not null default 'cad'` in the database, so in practice only a genuinely
 * missing row can produce that fallback.
 *
 * Billing currency is deliberately absent from this module and from the
 * schema. Stripe locks it to the Customer on the first subscription and is the
 * only authority for it; a copy here would drift the moment a contractor
 * changed their estimate currency.
 */

import { currencyOrDefault, type Currency } from "./currency";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type AdminClient = SupabaseClient<Database>;

/** The business's estimate currency. */
export async function readBusinessEstimateCurrency(
  supabaseAdmin: AdminClient,
  businessId: string
): Promise<Currency> {
  const { data, error } = await supabaseAdmin
    .from("tpe_businesses")
    .select("estimate_currency")
    .eq("id", businessId)
    .maybeSingle();

  if (error || !data) return "cad";
  return currencyOrDefault(data.estimate_currency);
}

/** Row patch that sets a business's estimate currency. Never touches Stripe. */
export function businessEstimateCurrencyPatch(currency: Currency): { estimate_currency: Currency } {
  return { estimate_currency: currency };
}

/** Row patch that snapshots the currency onto a newly created estimate. */
export function estimateCurrencyPatch(currency: Currency): { currency: Currency } {
  return { currency };
}

/** The estimate's immutable snapshot, by id. */
export async function readEstimateCurrency(
  supabaseAdmin: AdminClient,
  estimateId: string
): Promise<Currency> {
  const { data, error } = await supabaseAdmin
    .from("tpe_estimates")
    .select("currency")
    .eq("id", estimateId)
    .maybeSingle();

  if (error || !data) return "cad";
  return currencyOrDefault(data.currency);
}

/**
 * Snapshots for many estimates in one query, for the reminder cron. Ids with
 * no row resolve to CAD.
 */
export async function readEstimateCurrencies(
  supabaseAdmin: AdminClient,
  estimateIds: readonly string[]
): Promise<Map<string, Currency>> {
  const result = new Map<string, Currency>();
  if (estimateIds.length === 0) return result;

  const { data, error } = await supabaseAdmin
    .from("tpe_estimates")
    .select("id, currency")
    .in("id", estimateIds as string[]);

  if (error || !data) return result;
  for (const row of data) {
    result.set(row.id, currencyOrDefault(row.currency));
  }
  return result;
}

/** Reads the immutable snapshot off an estimate row. */
export function estimateCurrencyOf(row: unknown): Currency {
  if (!row || typeof row !== "object") return "cad";
  return currencyOrDefault((row as { currency?: unknown }).currency);
}
