export const maxDuration = 60;

import { checkRateLimit } from "@/lib/rate-limit";
import { validateContentType } from "@/lib/api-utils";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a professional contractor writing a job estimate for a customer. Turn the job description into a complete, professional estimate. Write it the way an experienced contractor would. Clear, specific, and direct. Ready to send with minimal editing.

Rules:
- Write like a contractor, not like software
- Use plain language the homeowner can understand
- Be specific. Vague scope descriptions are not acceptable
- Never ask for more information. No matter how brief the input, always generate a complete estimate.
- Make reasonable assumptions for any missing details and list them in the Assumptions and Exclusions section.
- Never overstate certainty when key details are unknown
- Do not use em dashes
- Do not use: ensure, streamline, leverage, utilize, seamless, comprehensive, facilitate
- Prices must be specific and labelled, never vague
- Use Canadian English spelling throughout. Use 'labour' not 'labor', 'colour' not 'color', 'centre' not 'center'.
- For automotive and vehicle parts, use American English spellings: tire not tyre, muffler not silencer, gas not petrol, truck not lorry.
- Never show markup as a separate line item. Apply markup to material prices directly and list each material at its marked-up price. The customer sees final prices only.
- In the Assumptions and Exclusions section, write each item as a plain bullet point. Do not use bold labels like **Included:**, **Excluded:**, or **Assumptions:**. Just write the assumption or exclusion directly.

Output must follow this exact structure:

1. Job Title (H1 heading)
2. Job Summary (2 to 3 sentences)
3. Total Price (after the summary, write the total price as a simple line like "Total: $1,943". This is plain text, not a heading or table.)
4. Scope of Work (bullet list of specific tasks)
5. Line Items (labour and materials, individually priced)
   Line Items MUST be formatted as markdown pipe tables, not bullet points or plain text. Use this exact format:
   | Item | Cost |
   |------|------|
   | Labour (X hours @ $X/hr) | $XXX |
   | Item description | $XXX |
   Never use bullet points or plain text for line items. Always use pipe table format.
   Do not include a Subtotal, Tax, Total, Deposit, or Balance row in the Line Items table. These are handled separately in the Pricing Summary section. The last row in the Line Items table must be a labour or material line item. Nothing else.
6. Assumptions and Exclusions (what is included, what is not)
7. Pricing Summary (subtotal, tax, total, deposit, balance)
   Pricing Summary MUST be formatted as markdown pipe tables, not bullet points or plain text. Use this exact format:
   | | |
   |---|---|
   | Subtotal | $XXX |
   | Tax (GST 5%) | $XXX |
   | **Total** | **$XXX** |
   | Deposit required | $XXX |
   | Balance on completion | $XXX |
   Never use bullet points or plain text for the pricing summary. Always use pipe table format.
8. Payment Terms (2 to 4 lines)
   Always include: "This estimate is valid for 30 days from the date above."
9. Notes (omit if nothing relevant)`;

export async function POST(request: NextRequest) {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { allowed } = await checkRateLimit(supabaseAdmin, user.id, "generate-estimate", 10, 60);
  if (!allowed) {
    return applyTo(new NextResponse("Too many requests. Please wait a moment.", { status: 429 }));
  }

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("id, name, prepared_by, subscription_status, trial_ends_at, labour_rate, markup_percent, deposit_percent, deposit_threshold")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  const isActive = business?.subscription_status === "active";
  const isTrialing =
    business?.subscription_status === "trial" &&
    business?.trial_ends_at &&
    new Date(business.trial_ends_at) > new Date();
  const hasAccess = isActive || isTrialing || business?.subscription_status === "complimentary";

  if (!hasAccess) return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));

  const contentTypeError = validateContentType(request);
  if (contentTypeError) return applyTo(contentTypeError);

  const { data: priceItemsData } = await supabaseAdmin
    .from("tpe_pricebook_items")
    .select("name, labour_price")
    .eq("business_id", business.id)
    .order("created_at", { ascending: true });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { jobDescription, customerName, customerPhone, customerEmail, jobAddress } = body as {
    jobDescription?: unknown;
    customerName?: unknown;
    customerPhone?: unknown;
    customerEmail?: unknown;
    jobAddress?: unknown;
  };

  if (typeof jobDescription !== "string" || !jobDescription.trim()) {
    return new Response("jobDescription is required", { status: 400 });
  }
  if (jobDescription.length > 2000) {
    return new Response("Job description too long. Please keep it under 2000 characters.", { status: 400 });
  }

  // Pass customer details to Claude for context only, not output in the estimate
  const lines: string[] = [jobDescription.trim()];
  if (business?.name) lines.push(`Business name: ${business.name}`);
  if (typeof customerName === "string" && customerName.trim()) {
    lines.push(`Customer name (for context only, do not include in output): ${customerName.trim()}`);
  }
  if (typeof customerPhone === "string" && customerPhone.trim()) {
    lines.push(`Customer phone (for context only, do not include in output): ${customerPhone.trim()}`);
  }
  if (typeof jobAddress === "string" && jobAddress.trim()) {
    lines.push(`Job address (for context only, do not include in output): ${jobAddress.trim()}`);
  }

  // Inject price book data from tpe_businesses columns
  if (business.labour_rate) {
    lines.push(`Labour rate: $${business.labour_rate}/hr. Use this rate for all labour line items`);
  }
  if (business.markup_percent) {
    lines.push(`Materials markup: ${business.markup_percent}%. Apply this markup on top of all material costs`);
  }
  const priceItems = priceItemsData ?? [];
  if (priceItems.length > 0) {
    lines.push(`Common line items from contractor's price book (use these prices when applicable):`);
    priceItems.forEach((item) => {
      lines.push(`  - ${item.name}: $${item.labour_price}`);
    });
  }
  if (business.deposit_percent && business.deposit_threshold) {
    lines.push(`Deposit rule: if the job total exceeds $${business.deposit_threshold}, include a deposit row in the Pricing Summary table showing ${business.deposit_percent}% of the total. Calculate the exact dollar amount. If the total is under $${business.deposit_threshold}, write "No deposit required" in the deposit row.`);
  } else {
    lines.push("Deposit: write 'No deposit required' in the deposit row of the Pricing Summary.");
  }

  const userMessage = lines.join("\n");

  const baseUrl = request.nextUrl.origin;

  let stream;
  try {
    stream = client.messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    console.error("[generate-estimate] failed to create stream:", err);
    const errStatus = (err as { status?: number }).status;
    if (typeof errStatus === "number") {
      void fetch(`${baseUrl}/api/notify-error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: err instanceof Error ? err.message : "Failed to start estimate generation",
          status: errStatus,
          context: "generate-estimate",
        }),
      });
    }
    return applyTo(
      new NextResponse(
        "Something went wrong generating your estimate. Our support team has been notified.",
        { status: 500 }
      )
    );
  }

  const safeCustomerName = typeof customerName === "string" ? customerName.trim() : "";
  const safeCustomerPhone = typeof customerPhone === "string" ? customerPhone.trim() : "";
  const safeCustomerEmail = typeof customerEmail === "string" ? customerEmail.trim() : "";
  const safeJobAddress = typeof jobAddress === "string" ? jobAddress.trim() : "";
  const safePreparedBy = business?.prepared_by ?? "";

  const readable = new ReadableStream({
    async start(controller) {
      let fullText = "";
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullText += event.delta.text;
            controller.enqueue(new TextEncoder().encode(event.delta.text));
          }
        }

        // Extract job title, find first H1 that isn't the business name
        const businessNameClean = (business?.name ?? "").trim().toLowerCase();
        const titleLine = fullText
          .split("\n")
          .filter((l) => l.startsWith("# "))
          .find((l) => {
            const clean = l.replace(/^#\s*/, "").trim().toLowerCase();
            return clean.length > 0 && clean !== businessNameClean;
          });
        const title = titleLine?.replace(/^#\s*/, "").trim() ?? "Untitled Estimate";

        const { data, error } = await supabaseAdmin
          .from("tpe_estimates")
          .insert({
            title,
            summary: fullText,
            status: "draft",
            source: "ai_generated",
            business_id: business.id,
            customer_name: safeCustomerName,
            customer_phone: safeCustomerPhone,
            customer_email: safeCustomerEmail,
            job_address: safeJobAddress,
            description: safeJobAddress,
            service_type: "estimate",
            location: "",
            urgency: "flexible",
            prepared_by: safePreparedBy,
            deposit_amount: null,
          })
          .select();

        if (error || !data?.[0]?.id) {
          console.error("[generate-estimate] DB insert failed", error?.message ?? "no id returned");
          controller.enqueue(new TextEncoder().encode(`\n__ERROR__:Failed to save estimate. Please try again.`));
          controller.close();
          return;
        }
        controller.enqueue(new TextEncoder().encode(`\n__ID__:${data[0].id}`));

        controller.close();
      } catch (err) {
        console.error("[generate-estimate] stream error:", err);
        const message = err instanceof Error ? err.message : "Estimate generation failed";
        const errStatus = (err as { status?: number }).status;
        if (typeof errStatus === "number") {
          void fetch(`${baseUrl}/api/notify-error`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: message, status: errStatus, context: "generate-estimate" }),
          });
        }
        controller.enqueue(
          new TextEncoder().encode(
            `\n__ERROR__:Something went wrong generating your estimate. Our support team has been notified.`
          )
        );
        controller.close();
      }
    },
  });

  return applyTo(new NextResponse(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  }));
}
