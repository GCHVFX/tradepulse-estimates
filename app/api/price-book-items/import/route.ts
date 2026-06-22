import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

interface ImportItem {
  name: string;
  description?: string;
  category?: string;
  price?: number;
  material_price?: number;
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
    const matPrice = typeof raw.material_price === "number" ? raw.material_price : 0;
    const description = typeof raw.description === "string" ? raw.description.trim() || null : null;
    const category = typeof raw.category === "string" && raw.category.trim() ? raw.category.trim() : "General";
    const taxable = raw.taxable !== false;
    const active = raw.active !== false;

    const existingId = existingByName.get(name.toLowerCase());
    if (existingId) {
      const { error } = await supabaseAdmin
        .from("tpe_pricebook_items")
        .update({ name, description, category, labour_price: price, material_price: matPrice, taxable, active })
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
        .insert({ business_id: business.id, name, description, category, labour_price: price, material_price: matPrice, taxable, active });
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
