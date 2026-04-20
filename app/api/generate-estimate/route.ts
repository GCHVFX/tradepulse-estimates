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
- Never show markup as a separate line item. Apply markup to material prices directly and list each material at its marked-up price. The customer sees final prices only.

Output must follow this exact structure:

1. Job Title (H1 heading)
2. Job Summary (2 to 3 sentences)
3. Scope of Work (bullet list of specific tasks)
4. Line Items (labour and materials, individually priced)
   Line Items MUST be formatted as markdown pipe tables, not bullet points or plain text. Use this exact format:
   | Item | Cost |
   |------|------|
   | Labour (X hours @ $X/hr) | $XXX |
   | Item description | $XXX |
   Never use bullet points or plain text for line items. Always use pipe table format.
5. Assumptions and Exclusions (what is included, what is not)
6. Pricing Summary (subtotal, tax, total, deposit, balance)
   Pricing Summary MUST be formatted as markdown pipe tables, not bullet points or plain text. Use this exact format:
   | | |
   |---|---|
   | Subtotal | $XXX |
   | Tax (GST 5%) | $XXX |
   | **Total** | **$XXX** |
   | Deposit required | $XXX |
   | Balance on completion | $XXX |
   Never use bullet points or plain text for the pricing summary. Always use pipe table format.
7. Payment Terms (2 to 4 lines)
   Always include: "This estimate is valid for 30 days from the date above."
8. Notes (omit if nothing relevant)`;

export async function POST(request: NextRequest) {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select("name, prepared_by")
    .eq("user_id", user.id)
    .maybeSingle();

  const [priceBookResult, priceItemsResult] = await Promise.all([
    supabaseAdmin
      .from("tpe_price_book")
      .select("labour_rate, markup_percent, deposit_percent, deposit_threshold")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabaseAdmin
      .from("tpe_price_book_items")
      .select("name, unit_price")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
  ]);

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

  // Inject price book data
  const priceBook = priceBookResult.data;
  if (priceBook?.labour_rate) {
    lines.push(`Labour rate: $${priceBook.labour_rate}/hr. Use this rate for all labour line items`);
  }
  if (priceBook?.markup_percent) {
    lines.push(`Materials markup: ${priceBook.markup_percent}%. Apply this markup on top of all material costs`);
  }
  const priceItems = priceItemsResult.data ?? [];
  if (priceItems.length > 0) {
    lines.push(`Common line items from contractor's price book (use these prices when applicable):`);
    priceItems.forEach((item) => {
      lines.push(`  - ${item.name}: $${item.unit_price}`);
    });
  }
  if (priceBook?.deposit_percent && priceBook?.deposit_threshold) {
    lines.push(`Deposit rule: if the job total exceeds $${priceBook.deposit_threshold}, include a deposit row in the Pricing Summary table showing ${priceBook.deposit_percent}% of the total. Calculate the exact dollar amount. If the total is under $${priceBook.deposit_threshold}, write "No deposit required" in the deposit row.`);
  } else {
    lines.push("Deposit: write 'No deposit required' in the deposit row of the Pricing Summary.");
  }

  const userMessage = lines.join("\n");

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
    return applyTo(
      new NextResponse(
        err instanceof Error ? err.message : "Failed to start estimate generation",
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
            business_id: user.id,
            customer_name: safeCustomerName,
            customer_phone: safeCustomerPhone,
            customer_email: safeCustomerEmail,
            customer_address: safeJobAddress,
            prepared_by: safePreparedBy,
            deposit_amount: null,
          })
          .select();

        console.log("[supabase] response:", { data, error });

        if (data?.[0]?.id) {
          controller.enqueue(new TextEncoder().encode(`\n__ID__:${data[0].id}`));
        }

        controller.close();
      } catch (err) {
        console.error("[generate-estimate] stream error:", err);
        const message =
          err instanceof Error ? err.message : "Estimate generation failed";
        controller.enqueue(new TextEncoder().encode(`\n__ERROR__:${message}`));
        controller.close();
      }
    },
  });

  return applyTo(new NextResponse(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  }));
}
