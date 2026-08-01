# tpe_estimate_items Schema

Slice 1 of the grouped-pricing plan. Labels: **Confirmed** (verified against the live database), **Recommendation**, **Unknown**.

---

## 1. Purpose

Create the minimum structured storage for priced estimate rows, so a later slice can convert eligible estimates from markdown to structured pricing. **Confirmed: nothing in the application reads or writes any of this yet, and no behaviour changed.**

## 2. Schema decision

**Confirmed.** Per `TRADEPULSE_GROUPED_PRICING_ARCHITECTURE.md` and the recorded decision in `DECISIONS.md`: priced rows move to structured storage, prose stays markdown, `tpe_estimates.pricing_source` names the authoritative representation per estimate, and there are never two live sources at once.

The dead `tpe_estimate_line_items` table is **replaced, not reused**. It is missing eight fields this model needs and its `labour_price` plus `material_price` split contradicts the shipped one-cost-per-row model.

## 3. `tpe_estimate_items` columns

**Confirmed** by introspection after the migration:

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `estimate_id` | uuid | no | none |
| `description` | text | no | none |
| `item_type` | text | no | `'other'` |
| `is_allowance` | boolean | no | `false` |
| `quantity` | numeric | no | `1` |
| `unit` | text | yes | none |
| `unit_price` | numeric | no | `0` |
| `line_total` | numeric | no | `0` |
| `labour_hours` | numeric | yes | none |
| `labour_rate` | numeric | yes | none |
| `markup_percent` | numeric | yes | none |
| `group_label` | text | yes | none |
| `customer_visible` | boolean | no | `true` |
| `display_order` | integer | no | `0` |
| `taxable` | boolean | no | `true` |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |

## 4. Column semantics

- **`description`** is the contractor-facing row label, the equivalent of the `Item` cell today.
- **`quantity` and `unit_price`**: for a quantity row, `line_total` is intended to equal `quantity * unit_price`. For a flat fee, `quantity` stays at its default of 1 and `unit_price` equals `line_total`. **Confirmed** this matches the current one-price-per-row model in `lib/estimate-summary.ts`.
- **`line_total`** is stored, not computed. **Recommendation** and rationale: a future approval snapshot must be verifiable without re-running arithmetic, and the audit showed the current parser already discards a quantity row's stated cost in favour of `quantity * rate`. Storing the resolved amount makes that resolution durable.
- **`unit`** is free text such as `hrs`, `gal`, `sqft`, `ea`. **Confirmed no enum**: the current format lets the model write any unit string, so there is no closed verified set.
- **`group_label`** is free text and nullable. **Confirmed no groups table and no default categories** in this slice, per the architecture document.
- **`customer_visible`** defaults to `true`. **Confirmed this preserves current behaviour**: every line item is shown to the customer today, so a new structured row must default to visible or conversion would silently hide rows.
- **`display_order`** is the ordering contract within one estimate, mirroring the array position of the current markdown rows.
- **`item_type`** is a text column with a narrow check constraint, not a Postgres enum. **Confirmed this matches project conventions**: the schema contains no enum types, and every other constrained-looking column (`status`, `plan`, `payment_status`) is plain text.
- **`is_allowance`** is stored explicitly. **Confirmed it is never inferred from description text.**
- **`labour_hours` and `labour_rate`** are nullable and carry no cross-field constraint. **Confirmed a flat-rate labour row is valid**: it can set `item_type = 'labour'` with both left null.
- **`taxable`** defaults to `true`, matching `tpe_pricebook_items.taxable` and `tpe_estimate_line_items.taxable`. **Confirmed the database performs no tax calculation.** Tax is applied to the whole subtotal in application code and this column is currently unread.

## 5. Monetary and percentage conventions

**Confirmed.** Money and quantities use unconstrained `numeric`, which is exact decimal with arbitrary precision, never binary floating point. This matches every existing money column in the schema (`labour_price`, `material_price`, `invoice_amount`, `labour_rate`, `tax_rate`), none of which declare a precision or scale.

**Confirmed.** Single currency, CAD. No multi-currency support was added.

**Confirmed, percentage convention: whole numbers.** `markup_percent = 20` means 20 percent, not 0.20. This matches `tpe_businesses.markup_percent`, `deposit_percent`, and `tax_rate`, all of which are interpolated directly into prompt text as percentages in `app/api/generate-estimate/route.ts`.

**Confirmed.** `markup_percent` on an item records markup already applied to `unit_price`, for auditability only. The customer never sees markup as a separate line, per the generation prompt.

## 6. Constraints

**Confirmed** present on `tpe_estimate_items`:

| Constraint | Definition |
|---|---|
| `tpe_estimate_items_description_not_blank` | `btrim(description) <> ''` |
| `tpe_estimate_items_item_type_valid` | `item_type in ('labour','material','service','allowance','other')` |
| `tpe_estimate_items_quantity_nonneg` | `quantity >= 0` |
| `tpe_estimate_items_display_order_nonneg` | `display_order >= 0` |
| `tpe_estimate_items_labour_hours_nonneg` | `labour_hours is null or labour_hours >= 0` |
| `tpe_estimate_items_labour_rate_nonneg` | `labour_rate is null or labour_rate >= 0` |
| `tpe_estimate_items_markup_percent_range` | `markup_percent is null or (markup_percent between 0 and 1000)` |

On `tpe_estimates`:

| Constraint | Definition |
|---|---|
| `tpe_estimates_pricing_source_valid` | `pricing_source in ('markdown','structured')` |
| `tpe_estimates_customer_pricing_mode_valid` | `customer_pricing_mode in ('detailed','grouped')` |

**Deliberate omission, and the one judgement call worth flagging.** `unit_price` and `line_total` are **not** sign constrained. The current markdown format permits a negative amount, a credit or discount row, and `lib/estimate-items.ts` treats a negative row total as a non-blocking warning rather than a refusal. Adding `>= 0` here would create a state where `validateConversionTotals()` reports the estimate as safe to migrate but the insert fails. The schema must be able to represent everything the current format can. **Recommendation:** revisit only if a product decision rules out discount rows.

## 7. Indexes

**Confirmed:**

- `tpe_estimate_items_pkey`, unique on `id`.
- `tpe_estimate_items_estimate_id_display_order_idx` on `(estimate_id, display_order)`.

**One composite index, deliberately, not two.** Its leading column serves the foreign-key lookup, so a separate index on `estimate_id` would be redundant, and the pair serves the only read this table will have for a long time: fetch one estimate's items in order. No speculative indexes were added.

**No uniqueness on `(estimate_id, display_order)`.** **Recommendation** with rationale: a unique constraint would make swapping two rows require a temporary value or a deferred constraint, complicating exactly the reordering the grouped-pricing editor will need, for no integrity benefit that matters here.

## 8. Foreign key and delete behaviour

**Confirmed:** `tpe_estimate_items_estimate_id_fkey`, `FOREIGN KEY (estimate_id) REFERENCES tpe_estimates(id) ON DELETE CASCADE`.

**Delete behaviour rationale.** `ON DELETE CASCADE` matches `tpe_estimate_line_items`, the closest sibling. It is also correct on its own terms: an item has no meaning without its estimate, and the alternative would leave orphans. Note the contrast with `tpe_estimate_photos`, which has **no** cascade and is therefore cleaned up manually in `DELETE /api/estimates`. Cascade here means no such manual cleanup will ever be needed.

**Confirmed: no `business_id` column was added.** Ownership stays derivable through `tpe_estimate_items -> tpe_estimates.business_id -> tpe_businesses.owner_user_id`. Duplicating it would create a second copy of ownership that could drift.

## 9. RLS ownership model

**Confirmed, and this contradicts the RLS design the task assumed. Read this section before wiring anything.**

The live model, verified on 2026-07-31 through `pg_policy`, `pg_policies`, `information_schema.role_table_grants`, and `pg_roles`:

- All eight pre-existing `tpe_` tables have `rowsecurity = true`.
- **All eight have zero policies.** Not permissive ones, not restrictive ones. None.
- `anon` and `authenticated` hold full table grants (SELECT, INSERT, UPDATE, DELETE) on every `tpe_` table.
- `service_role` has `rolbypassrls = true`. `authenticated` has `rolbypassrls = false`.

RLS enabled with no policy denies all row access. So the effective model is: **anon and authenticated can reach nothing; the application works entirely through the service-role client and enforces ownership in application code.** That matches the Phase 0 audit finding that every route uses `supabaseAdmin` with an explicit `business_id` filter.

**What was applied to `tpe_estimate_items`: RLS enabled, zero policies.** Identical to all eight siblings.

**Why the four owner-scoped policies were written but NOT applied.** The task asked for policies letting authenticated users select, insert, update, and delete their own items. Applying them would make `tpe_estimate_items` the only table in the entire schema where the `authenticated` role has live row access. Combined with the wide grants already present, that is a new access surface the application does not use and has no code path for. Choosing not to add one changes nothing about who can reach what, which is why it was the safe default to take without further authorization. **Recommendation: decide this explicitly before any application wiring**, and if the app ever moves to the authenticated client, apply these together with equivalent policies on the sibling tables rather than for this table alone.

Reviewed, not applied:

```sql
-- NOT APPLIED. Requires a deliberate decision, see above.
create policy tpe_estimate_items_owner_select on public.tpe_estimate_items
  for select to authenticated using (
    exists (select 1 from public.tpe_estimates e
            join public.tpe_businesses b on b.id = e.business_id
            where e.id = tpe_estimate_items.estimate_id
              and b.owner_user_id = auth.uid())
  );
-- and the same EXISTS predicate as `using` for update and delete,
-- and as `with check` for insert and update.
```

**Confirmed there is no existing shared SQL helper** for ownership, so the `EXISTS` form above would be the first, and would need to be applied consistently rather than duplicated inconsistently.

## 10. `pricing_source`

**Confirmed.** `text not null default 'markdown'` on `tpe_estimates`, constrained to `markdown` or `structured`.

**Confirmed the default stays `markdown` for newly created rows in this slice**, exactly as recommended, so no unwired estimate can become structured by accident. Flipping to `structured` is a one-way move that only a future backfill performs, and only after every invariant passes.

**Confirmed: all 29 existing estimates are `markdown`. Zero are `structured`.**

## 11. `customer_pricing_mode`

**Confirmed.** `text not null default 'detailed'` on `tpe_estimates`, constrained to `detailed` or `grouped`.

**Confirmed the default is `detailed`**, which is the current and only implemented rendering. **Confirmed no UI exposes or sets this value.** **Confirmed no business-wide default was added**, per the task.

**Confirmed: all 29 existing estimates are `detailed`.**

## 12. Existing-estimate preservation

**Confirmed** by comparing a fingerprint captured immediately before the migration against the same query after it:

| Check | Before | After | Result |
|---|---|---|---|
| Estimate row count | 29 | 29 | unchanged |
| `max(updated_at)` | `2026-07-30 15:35:03.258894+00` | same | unchanged |
| Content fingerprint (md5 over summary, status, sent_at) | `152dab94ef40910e348e7867c08e4439` | same | **byte-identical** |
| Status split | 25 draft, 2 sent, 2 done | same | unchanged |
| `pricing_source = 'markdown'` | n/a | 29 of 29 | correct |
| `customer_pricing_mode = 'detailed'` | n/a | 29 of 29 | correct |
| `tpe_estimate_items` rows | n/a | 0 | no backfill |

The content fingerprint covers every summary, status, and sent timestamp. Its being unchanged is direct evidence that no estimate content, total, status, or customer link was altered.

**Confirmed why `updated_at` was untouched:** on Postgres 11 and later, `ADD COLUMN` with a constant default is a metadata-only change with no table rewrite, and this schema has no triggers at all, so nothing could have fired.

## 13. Dead-table disposition

**Confirmed `tpe_estimate_line_items` was not touched.** Not dropped, renamed, migrated, written to, repurposed, or altered. It still holds 0 rows and still has RLS enabled with no policies.

It remains **deprecated and unused**, pending a separate cleanup decision. Dropping it is irreversible and it is harmless where it sits, so removal should be its own change once `tpe_estimate_items` is in real use.

## 14. Application wiring status

**Confirmed by repository search: nothing is wired.**

- Zero references to `tpe_estimate_items` in `app/`, `lib/`, `tests/`, `scripts/`, or `proxy.ts`, outside `lib/database.types.ts`.
- Zero references to `pricing_source` or `customer_pricing_mode` anywhere outside `lib/database.types.ts`.
- No estimate creation route sets `pricing_source`. No UI sets `customer_pricing_mode`.
- No backfill exists. The only occurrence of the word is a comment in `lib/estimate-items.ts` describing what a future backfill should call.

## 15. Verification performed

**Confirmed, all passed:**

- Migration applied through the Supabase MCP `apply_migration` tool, which records it in `supabase_migrations.schema_migrations`. SQL also stored at `supabase/migrations/20260731000000_create_tpe_estimate_items.sql`.
- Schema introspection: table exists, all 18 columns present with the exact types and defaults above, 7 check constraints, 1 foreign key with `ON DELETE CASCADE`, 2 indexes.
- **Constraint enforcement proved by execution**, inside a transaction deliberately aborted with `RAISE EXCEPTION` so nothing persisted. All ten cases behaved correctly: blank description rejected, invalid `item_type` rejected, negative quantity rejected, markup above 1000 rejected, negative `display_order` rejected, bad foreign key rejected, a valid row accepted, a negative monetary amount accepted, invalid `pricing_source` rejected, invalid `customer_pricing_mode` rejected. Verified afterwards that `tpe_estimate_items` still holds 0 rows.
- Existing-row preservation, per the table in section 12.
- **RLS runtime verification with the real anon key** (read-only, no writes persisted): `SELECT` on `tpe_estimate_items` returned HTTP 200 with an empty array, identical to `tpe_estimates` and `tpe_businesses`; `INSERT` was rejected with HTTP 401 and Postgres code `42501`, "new row violates row-level security policy". Anonymous access is denied and the public share page gains no direct table access.
- `lib/database.types.ts` regenerated from the live schema, not hand-written. Diff is 81 insertions and 5 deletions: the whole `tpe_estimate_items` block plus the two new columns in the `tpe_estimates` Row, Insert, and Update shapes. The deletions are a PostgREST version bump (13.0.4 to 14.5) and a cosmetic reformat of the `increment_rate_limit` Args, both genuine regenerator output.
- `npx tsc --noEmit` clean. `npx next build` compiled, 52 static pages. Conversion suite 249 assertions, 0 failures.

## 16. Unverified items

- **Unknown: authenticated-role runtime behaviour.** Testing it needs a signed-in user JWT, which would require creating a real account, a production write this task forbade. It is **provable by construction** rather than by execution: `authenticated` has `rolbypassrls = false` and there are zero policies, so it gets the same deny-all as `anon`. Not the same as having run it.
- **Not applicable rather than unverified: the eight owner and cross-business RLS cases** the task listed (owner can select or insert or update or delete, another business cannot, and so on). Under the deny-all model, no authenticated user can perform any of those operations, so there is no owner-versus-other-business distinction to test. Those cases become testable only if the four policies in section 9 are ever applied, and **RLS runtime verification must happen in a safe environment before that**.
- **Unknown: whether the wide `anon` and `authenticated` table grants are intentional.** They are pre-existing on all eight tables and were not changed. They are currently inert because RLS denies everything, but they mean any future permissive policy immediately becomes live. Worth a separate review.
- **Unknown: rollback rehearsal.** The migration is reversible with `drop table tpe_estimate_items` and two `drop column` statements, but that was not rehearsed against a copy.

## 17. Exact next slice

**The lazy per-estimate conversion service.** For eligible unsent markdown estimates only, using `parsedToItems()` and `validateConversionTotals()` from `lib/estimate-items.ts`, inside a single database transaction that inserts the structured rows and flips `pricing_source` to `structured` only after every invariant passes, aborting the whole transaction otherwise.

It must refuse multi-option estimates, which the production audit found and the conversion layer already rejects, and it must never touch a sent or customer-visible estimate. No customer rendering and no editor changes in that slice.

Before it wires anything to the authenticated client, resolve the RLS question in section 9.
