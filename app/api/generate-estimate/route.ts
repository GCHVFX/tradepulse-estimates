export const maxDuration = 60;

import { checkRateLimit } from "@/lib/rate-limit";
import { validateContentType } from "@/lib/api-utils";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { convertEstimateToStructuredItems } from "@/lib/estimate-item-migration";
import { notifyInternalError } from "@/lib/notify-error";
import { estimateCurrencyPatch, readBusinessEstimateCurrency } from "@/lib/currency-db";
import { hasSubscriptionAccess, SUBSCRIPTION_ACCESS_COLUMNS } from "@/lib/subscription-access";
import {
  claimEstimateGeneration,
  releaseEstimateGenerationClaim,
  runWithEstimateGenerationClaim,
  startWithEstimateGenerationClaim,
} from "@/lib/estimate-generation-claims";

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
- Estimate labour hours the way an experienced tradesperson actually works, not with a built-in safety margin. Do not round up to a full day, a full shift, or a round number out of caution. A small, contained job, such as capping off one or two pipes, patching a small section of drywall, or swapping a single fixture, is typically 1 to 3 hours of hands-on labour, not more. Reserve larger hour counts for jobs that genuinely involve that much physical work, such as a full room repaint, a panel upgrade, or a multi-fixture rough-in.

Output must follow this exact structure:

1. Job Title (H1 heading)
2. Job Summary (2 to 3 sentences)
3. Estimated Total (after the summary, write the total price as a simple line like "Estimated total: $1,943". This is plain text, not a heading or table.)
4. Scope of Work (bullet list of specific tasks)
5. Line Items (labour and materials, individually priced)
   Line Items MUST be formatted as markdown pipe tables, not bullet points or plain text. Use this exact format:
   | Item | Qty | Unit | Rate | Cost |
   |------|-----|------|------|------|
   | Labour | 3 | hrs | $95.00 | $285.00 |
   | Interior paint | 4 | gal | $62.00 | $248.00 |
   | Permit fee |  |  |  | $150.00 |
   Decide per item which type it is:
   - Quantity-based: anything measured in a natural unit, such as labour hours, paint by the gallon, wire by the foot, tile by the square foot. Fill in Qty, Unit, and Rate, and put quantity x rate in the Cost column.
   - Flat fee: anything priced as one lump sum, such as a permit, trip charge, or disposal fee. Leave Qty, Unit, and Rate empty and put the amount in the Cost column.
   Unit is short free text you choose (hrs, gal, sqft, ft, ea). Cost must always be filled in. Money columns use two decimal places.
   Never use bullet points or plain text for line items. Always use pipe table format.
   Do not include a Subtotal, Tax, Total, Deposit, or Balance row in the Line Items table. These are handled separately in the Pricing Summary section. The last row in the Line Items table must be a labour or material line item. Nothing else.
6. Assumptions and Exclusions (what is included, what is not)
7. Pricing Summary (subtotal, tax, total, deposit, balance)
   Pricing Summary MUST be formatted as markdown pipe tables, not bullet points or plain text. Use this exact format:
   | | |
   |---|---|
   | Subtotal | $XXX |
   | Tax (TAX_LABEL TAX_RATE%) | $XXX |
   | **Total** | **$XXX** |
   | Deposit required | $XXX |
   | Balance on completion | $XXX |
   Never use bullet points or plain text for the pricing summary. Always use pipe table format.
8. Payment Terms (2 to 4 lines)
   Always include: "This estimate is valid for 30 days from the date above."
9. Notes (omit if nothing relevant)`;

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[generate-estimate] ANTHROPIC_API_KEY is not set");
    return new NextResponse("Estimate generation is temporarily unavailable.", { status: 500 });
  }

  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const { allowed } = await checkRateLimit(supabaseAdmin, user.id, "generate-estimate", 10, 60);
  if (!allowed) {
    return applyTo(new NextResponse("Too many requests. Please wait a moment.", { status: 429 }));
  }

  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select(`id, name, prepared_by, ${SUBSCRIPTION_ACCESS_COLUMNS}, labour_rate, markup_percent, deposit_percent, deposit_threshold, tax_label, tax_rate`)
    .eq("owner_user_id", user.id)
    .maybeSingle();

  // A missing business row is denied here with the same 403 it always
  // returned, rather than a 404 -- unchanged from before the consolidation.
  if (!hasSubscriptionAccess(business)) return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));

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

  const { jobDescription, photoAnalysis, customerName, customerPhone, customerEmail, jobAddress } = body as {
    jobDescription?: unknown;
    photoAnalysis?: unknown;
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
  if (typeof photoAnalysis === "string" && photoAnalysis.trim()) {
    if (photoAnalysis.length > 4000) {
      return new Response("Photo analysis too long.", { status: 400 });
    }
    lines.push(`What the job site photos show: ${photoAnalysis.trim()}`);
  }
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
  const taxLabel = business.tax_label ?? 'GST';
  const taxRate = business.tax_rate ?? 5;
  lines.push(`Tax: use "${taxLabel} ${taxRate}%" as the tax label in the Pricing Summary. Calculate tax as ${taxRate}% of the subtotal.`);

  if (business.deposit_percent && business.deposit_threshold) {
    lines.push(`Deposit rule: if the job total exceeds $${business.deposit_threshold}, include a deposit row in the Pricing Summary table showing ${business.deposit_percent}% of the total. Calculate the exact dollar amount. If the total is under $${business.deposit_threshold}, write "No deposit required" in the deposit row.`);
  } else {
    lines.push("Deposit: write 'No deposit required' in the deposit row of the Pricing Summary.");
  }

  const userMessage = lines.join("\n");

  const claimInput = { businessId: business.id, ownerUserId: user.id };
  let claimedStream;
  try {
    claimedStream = await startWithEstimateGenerationClaim({
      claim: () => claimEstimateGeneration(supabaseAdmin, claimInput),
      release: (claimId) => releaseEstimateGenerationClaim(supabaseAdmin, { ...claimInput, claimId }),
      start: () => client.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
  } catch (err) {
    const errStatus = (err as { status?: number }).status;
    if (errStatus === 401) {
      console.error("[generate-estimate] Anthropic API authentication failed. Check ANTHROPIC_API_KEY is valid.");
    } else {
      console.error("[generate-estimate] failed to create stream:", err instanceof Error ? err.message : err);
    }
    if (typeof errStatus === "number") {
      void notifyInternalError({
        error: err instanceof Error ? err.message : "Failed to start estimate generation",
        status: errStatus,
        context: "generate-estimate",
      });
    }
    return applyTo(
      new NextResponse(
        "Something went wrong generating your estimate. Our support team has been notified.",
        { status: 500 }
      )
    );
  }

  if (!claimedStream) {
    return applyTo(
      new NextResponse("Estimate generation is temporarily unavailable. Please try again in a few minutes.", {
        status: 409,
      })
    );
  }

  const { claimId, value: stream } = claimedStream;

  const safeCustomerName = typeof customerName === "string" ? customerName.trim() : "";
  const safeCustomerPhone = typeof customerPhone === "string" ? customerPhone.trim() : "";
  const safeCustomerEmail = typeof customerEmail === "string" ? customerEmail.trim() : "";
  const safeJobAddress = typeof jobAddress === "string" ? jobAddress.trim() : "";
  const safePreparedBy = business?.prepared_by ?? "";

  // Read the snapshot currency once, before the stream opens, so the value
  // written to the row and the value the client renders with are the same
  // read. /new has no estimate row to query, so the response header is how
  // it learns the snapshot instead of guessing from the business setting.
  const estimateCurrency = await readBusinessEstimateCurrency(supabaseAdmin, business.id);

  const readable = new ReadableStream({
    async start(controller) {
      await runWithEstimateGenerationClaim({
        claimId,
        release: (activeClaimId) =>
          releaseEstimateGenerationClaim(supabaseAdmin, { ...claimInput, claimId: activeClaimId }),
        work: async () => {
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
                // Immutable snapshot. Changing the business estimate currency
                // later must never move an estimate that is already saved.
                ...estimateCurrencyPatch(estimateCurrency),
              })
              .select();

            if (error || !data?.[0]?.id) {
              console.error("[generate-estimate] DB insert failed", error?.message ?? "no id returned");
              controller.enqueue(new TextEncoder().encode(`\n__ERROR__:Failed to save estimate. Please try again.`));
              controller.close();
              return;
            }
            const newEstimateId = data[0].id;
            controller.enqueue(new TextEncoder().encode(`\n__ID__:${newEstimateId}`));

            // Structured pricing, for NEWLY GENERATED estimates only.
            //
            // Best effort and strictly non-fatal. The estimate is already saved and
            // the client already has its id, so if anything here refuses or throws,
            // the estimate simply stays markdown-authoritative, exactly as every
            // estimate created before today. No existing estimate is touched.
            //
            // The markdown summary is preserved either way, so detailed rendering
            // (share page, PDF, editor, preview) is byte-for-byte what it was.
            // Grouping is written to the rows only; nothing renders it yet.
            //
            // This runs before controller.close() so it cannot be cut short by the
            // runtime freezing the instance once the response completes. It costs a
            // few database round trips after a generation that already took seconds.
            try {
              const conversion = await convertEstimateToStructuredItems({
                estimateId: newEstimateId,
                userId: user.id,
                dryRun: false,
                assignGroups: true,
              });
              if (!conversion.success) {
                console.info(
                  `[generate-estimate] structured pricing skipped for ${newEstimateId}: ${conversion.refusalReason}`
                );
              }
            } catch (conversionErr) {
              console.error(
                "[generate-estimate] structured pricing failed, estimate remains markdown:",
                conversionErr instanceof Error ? conversionErr.message : conversionErr
              );
            }

            controller.close();
          } catch (err) {
            const errStatus = (err as { status?: number }).status;
            const message = err instanceof Error ? err.message : "Estimate generation failed";

            if (errStatus === 401) {
              console.error("[generate-estimate] Anthropic API authentication failed. Check ANTHROPIC_API_KEY is valid.");
            } else {
              console.error("[generate-estimate] stream error:", message);
            }

            if (typeof errStatus === "number") {
              void notifyInternalError({
                error: message,
                status: errStatus,
                context: "generate-estimate",
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
    },
  });

  return applyTo(new NextResponse(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // The snapshot the row was saved with. A header rather than a body
      // marker so the existing __ID__ / __ERROR__ stream protocol is
      // untouched and an older client simply ignores it.
      "X-Estimate-Currency": estimateCurrency,
    },
  }));
}
