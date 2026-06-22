# Pricebook CSV Import + Template Matching

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let contractors upload a CSV pricebook and have website quote drafts use matching pricebook prices instead of showing "Needs pricing."

**Architecture:** Client-side CSV parsing with preview/validation, server-side bulk upsert API scoped by business_id, and keyword-overlap matching in the existing `buildDraftSummary` function. No schema changes needed — `tpe_pricebook_items` already has all required columns.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (service role), client-side CSV parsing (no new deps)

## Global Constraints

- No database schema changes
- No new npm dependencies
- All pricebook writes scoped to current `business_id` — one business cannot read or write another's data
- Do not break existing manual estimate creation or Clearwater quote submission
- Access checks: active, trial (future trial_ends_at), or complimentary
- Canadian English in UI copy
- No secrets in code
- Verification: `npx tsc --noEmit` + `npm run build`

---

### Task 1: CSV Parse Utility

**Files:**
- Create: `lib/csv-parse.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] }` — used by Task 3

- [ ] **Step 1: Create `lib/csv-parse.ts`**

```ts
// lib/csv-parse.ts
// Handles: quoted fields, commas inside quotes, escaped quotes (""),
// empty fields, CRLF and LF line endings.

export function parseCSV(text: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const lines = splitCSVLines(text);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i]);
    if (cells.every((c) => c.trim() === "")) continue; // skip blank lines
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (cells[j] ?? "").trim();
    }
    rows.push(row);
  }

  return { headers, rows };
}

function splitCSVLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

function parseCSVLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        cells.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  cells.push(current);
  return cells;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: clean (no output)

- [ ] **Step 3: Commit**

```bash
git add lib/csv-parse.ts
git commit -m "feat: add CSV parsing utility for pricebook import"
```

---

### Task 2: Bulk Import API Route

**Files:**
- Create: `app/api/price-book-items/import/route.ts`

**Interfaces:**
- Consumes: `tpe_pricebook_items` table, `getBusinessWithAccess()` pattern from `app/api/price-book-items/route.ts`
- Produces: `POST /api/price-book-items/import` accepting `{ items: ImportItem[] }`, returning `{ imported: number, updated: number, errors: string[] }`

The route accepts an array of validated items. Upserts by matching `name` within `business_id`. Auth + subscription gating follows the same pattern as the existing `price-book-items/route.ts`.

- [ ] **Step 1: Create the import route**

```ts
// app/api/price-book-items/import/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

interface ImportItem {
  name: string;
  description?: string;
  category?: string;
  price?: number;
  taxable?: boolean;
  active?: boolean;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, subscription_status, trial_ends_at")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!business) return applyTo(NextResponse.json({ error: "Business not found" }, { status: 404 }));

  const isActive = business.subscription_status === "active";
  const isTrialing = business.subscription_status === "trial" && business.trial_ends_at && new Date(business.trial_ends_at) > new Date();
  const hasAccess = isActive || isTrialing || business.subscription_status === "complimentary";
  if (!hasAccess) return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));

  let body: { items?: unknown };
  try {
    body = await request.json();
  } catch {
    return applyTo(NextResponse.json({ error: "Invalid request body" }, { status: 400 }));
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return applyTo(NextResponse.json({ error: "No items provided" }, { status: 400 }));
  }
  if (body.items.length > 500) {
    return applyTo(NextResponse.json({ error: "Maximum 500 items per import" }, { status: 400 }));
  }

  // Fetch existing items for upsert matching
  const { data: existing } = await supabaseAdmin
    .from("tpe_pricebook_items")
    .select("id, name")
    .eq("business_id", business.id);

  const existingByName = new Map<string, string>();
  for (const item of existing ?? []) {
    existingByName.set(item.name.toLowerCase().trim(), item.id);
  }

  let imported = 0;
  let updated = 0;
  const errors: string[] = [];

  for (let i = 0; i < body.items.length; i++) {
    const raw = body.items[i] as ImportItem;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) {
      errors.push(`Row ${i + 1}: name is required`);
      continue;
    }

    const price = typeof raw.price === "number" ? raw.price : 0;
    const row = {
      business_id: business.id,
      name,
      description: typeof raw.description === "string" ? raw.description.trim() || null : null,
      category: typeof raw.category === "string" && raw.category.trim() ? raw.category.trim() : "General",
      labour_price: price,
      material_price: 0,
      taxable: raw.taxable !== false,
      active: raw.active !== false,
    };

    const existingId = existingByName.get(name.toLowerCase());
    if (existingId) {
      const { error } = await supabaseAdmin
        .from("tpe_pricebook_items")
        .update({ ...row, business_id: undefined })
        .eq("id", existingId)
        .eq("business_id", business.id);
      if (error) {
        errors.push(`Row ${i + 1} ("${name}"): ${error.message}`);
      } else {
        updated++;
      }
    } else {
      const { error } = await supabaseAdmin
        .from("tpe_pricebook_items")
        .insert(row);
      if (error) {
        errors.push(`Row ${i + 1} ("${name}"): ${error.message}`);
      } else {
        imported++;
        existingByName.set(name.toLowerCase(), "new");
      }
    }
  }

  return applyTo(NextResponse.json({ imported, updated, errors }));
}
```

Note on the upsert update: `business_id: undefined` is stripped by Supabase — we do not update business_id, only the mutable fields. The `.eq("business_id", business.id)` guard ensures no cross-business writes.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add app/api/price-book-items/import/route.ts
git commit -m "feat: add bulk pricebook import API route"
```

---

### Task 3: Import UI in PriceBook Component

**Files:**
- Modify: `app/components/price-book.tsx`

**Interfaces:**
- Consumes: `parseCSV()` from `lib/csv-parse.ts`, `POST /api/price-book-items/import` from Task 2
- Produces: File picker, CSV preview table, validation display, import confirmation, result counts

Add to the existing `PriceBook` component:
1. "Import CSV" and "Download Template" buttons next to "Add item"
2. A file input that triggers CSV parsing
3. A preview modal/section showing parsed rows with validation
4. Confirm button that POSTs to the import API
5. Result display (imported/updated/errors)

Column mapping from CSV headers to import fields:
- `item_name` or `name` → `name`
- `description` → `description`
- `category` → `category`
- `price` → `price` (numeric)
- `taxable` → `taxable` (true/false, defaults true)
- `active` → `active` (true/false, defaults true)

The CSV template download generates the template client-side as a Blob.

- [ ] **Step 1: Add import state, template download, and file handling to `price-book.tsx`**

Add these state variables and handlers after the existing edit state:

```ts
// Import state
const [importRows, setImportRows] = useState<Array<{
  name: string;
  description: string;
  category: string;
  price: number;
  taxable: boolean;
  active: boolean;
  error: string;
}> | null>(null);
const [importing, setImporting] = useState(false);
const [importResult, setImportResult] = useState<{
  imported: number;
  updated: number;
  errors: string[];
} | null>(null);
const csvInputRef = useRef<HTMLInputElement>(null);
```

Add the template download function and file handler:

```ts
function downloadTemplate() {
  const csv = [
    "name,description,category,price,taxable,active",
    '"Toilet replacement labour","Remove existing toilet and install replacement",Toilets,450,true,true',
    '"Faucet cartridge replacement","Replace faucet cartridge and test for leaks",Faucets,225,true,true',
    '"Drain clearing","Clear blocked drain where accessible",Drains,250,true,true',
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pricebook-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function handleCSVFile(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const { parseCSV } = require("@/lib/csv-parse");
    const { headers, rows } = parseCSV(reader.result as string);
    // Map columns
    const nameCol = headers.includes("item_name") ? "item_name" : "name";
    const parsed = rows.map((row) => {
      const name = (row[nameCol] ?? "").trim();
      const priceStr = (row["price"] ?? "").trim();
      const price = parseFloat(priceStr);
      const taxStr = (row["taxable"] ?? "true").toLowerCase();
      const activeStr = (row["active"] ?? "true").toLowerCase();
      return {
        name,
        description: (row["description"] ?? "").trim(),
        category: (row["category"] ?? "General").trim() || "General",
        price: isNaN(price) ? 0 : price,
        taxable: taxStr !== "false" && taxStr !== "0" && taxStr !== "no",
        active: activeStr !== "false" && activeStr !== "0" && activeStr !== "no",
        error: !name ? "Name is required" : "",
      };
    });
    setImportRows(parsed);
    setImportResult(null);
  };
  reader.readAsText(file);
  if (csvInputRef.current) csvInputRef.current.value = "";
}
```

Note: use dynamic import for `parseCSV` to keep the code clean — `import { parseCSV } from "@/lib/csv-parse"` at top level.

Add the confirm handler:

```ts
async function handleConfirmImport() {
  if (!importRows) return;
  const valid = importRows.filter((r) => !r.error);
  if (valid.length === 0) return;
  setImporting(true);
  try {
    const res = await fetch("/api/price-book-items/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: valid.map((r) => ({
          name: r.name,
          description: r.description || undefined,
          category: r.category,
          price: r.price,
          taxable: r.taxable,
          active: r.active,
        })),
      }),
    });
    const data = await res.json();
    setImportResult(data);
    // Refresh items list
    const listRes = await fetch("/api/price-book");
    const listData = await listRes.json();
    setItems(listData.items);
    setImportRows(null);
  } catch {
    setImportResult({ imported: 0, updated: 0, errors: ["Import failed. Try again."] });
  } finally {
    setImporting(false);
  }
}
```

- [ ] **Step 2: Add import UI elements to the JSX**

After the "Add item" button and before the closing `</div>`, add:
1. Import/template buttons row
2. Hidden file input
3. Preview section (when importRows is set)
4. Result banner (when importResult is set)

The preview shows a table of parsed rows with validation errors highlighted. Confirm/Cancel buttons at the bottom. See Task 3 implementation for exact JSX.

- [ ] **Step 3: Verify it compiles and builds**

Run: `npx tsc --noEmit` then `npm run build`
Expected: both clean

- [ ] **Step 4: Commit**

```bash
git add app/components/price-book.tsx
git commit -m "feat: add CSV import UI to pricebook with preview and validation"
```

---

### Task 4: Pricebook Matching in Draft Generation

**Files:**
- Modify: `lib/quote-templates.ts`
- Modify: `app/components/estimate-actions.tsx`

**Interfaces:**
- Consumes: `GET /api/price-book` (existing, returns `{ items: { id, name, unit_price }[] }`), `QuoteTemplate.lineItems` (string array)
- Produces: Updated `buildDraftSummary()` that accepts optional pricebook items and substitutes matched prices

#### Matching strategy:

For each template line item label (e.g., "Remove existing toilet"), tokenize into lowercase words and compare against each pricebook item's `name`. Score = number of overlapping non-trivial words (skip "and", "or", "the", "a", "of", "for", "as", "to", "in"). Pick the best match above a minimum threshold of 2 overlapping words. If matched, use the pricebook item's name and price. If not, keep template label with `—`.

- [ ] **Step 1: Update `lib/quote-templates.ts`**

Add a `PricebookItem` interface and a matching function. Update `buildDraftSummary` to accept optional pricebook items:

```ts
export interface PricebookItem {
  name: string;
  price: number;
}

const STOP_WORDS = new Set(["and", "or", "the", "a", "of", "for", "as", "to", "in", "on", "is", "if"]);

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function findBestMatch(
  templateLabel: string,
  pricebookItems: PricebookItem[],
): PricebookItem | null {
  const templateTokens = new Set(tokenize(templateLabel));
  let bestItem: PricebookItem | null = null;
  let bestScore = 0;

  for (const item of pricebookItems) {
    const itemTokens = tokenize(item.name);
    const overlap = itemTokens.filter((t) => templateTokens.has(t)).length;
    if (overlap > bestScore && overlap >= 2) {
      bestScore = overlap;
      bestItem = item;
    }
  }

  return bestItem;
}

export function buildDraftSummary(
  template: QuoteTemplate,
  customerDescription: string,
  pricebookItems?: PricebookItem[],  // NEW optional parameter
): string {
  const pb = pricebookItems ?? [];
  const lineItemRows = template.lineItems
    .map((label) => {
      const match = pb.length > 0 ? findBestMatch(label, pb) : null;
      if (match) {
        return `| ${match.name} | $${match.price.toFixed(2)} |`;
      }
      return `| ${label} | — |`;
    })
    .join("\n");

  // ... rest of the function unchanged
}
```

- [ ] **Step 2: Update `app/components/estimate-actions.tsx`**

In `handleCreateEstimate`, fetch pricebook items before building the draft:

```ts
async function handleCreateEstimate() {
  setIsConverting(true);
  setConvertError("");
  try {
    const desc = description ?? "";
    const template = matchTemplate(desc);

    // Fetch pricebook items for price matching
    let pricebookItems: PricebookItem[] = [];
    try {
      const pbRes = await fetch("/api/price-book");
      if (pbRes.ok) {
        const pbData = await pbRes.json();
        pricebookItems = (pbData.items ?? []).map((i: { name: string; unit_price: number }) => ({
          name: i.name,
          price: i.unit_price,
        }));
      }
    } catch {}

    const res = await fetch("/api/estimates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: estimateId,
        title: template.title,
        summary: buildDraftSummary(template, desc, pricebookItems),
        status: "draft",
      }),
    });
    // ... error handling unchanged
  }
}
```

- [ ] **Step 3: Verify it compiles and builds**

Run: `npx tsc --noEmit` then `npm run build`
Expected: both clean

- [ ] **Step 4: Commit**

```bash
git add lib/quote-templates.ts app/components/estimate-actions.tsx
git commit -m "feat: match pricebook items to generated estimate line items"
```
