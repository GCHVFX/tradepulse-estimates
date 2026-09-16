export const maxDuration = 60;

import { checkRateLimit } from "@/lib/rate-limit";
import { validateContentType } from "@/lib/api-utils";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { createApiClient, supabaseAdmin } from "@/lib/supabase-server";
import { notifyInternalError } from "@/lib/notify-error";
import { readBusinessEstimateCurrency } from "@/lib/currency-db";
import { spellingInstructionForCurrency, type Currency } from "@/lib/currency";
import { businessTax } from "@/lib/estimate-tax";
import { isDelivered } from "@/lib/estimate-delivery";
import { sanitizeGeneratedProse } from "@/lib/estimate-prose";
import {
  buildGenerationUserMessage,
  newGeneratedEstimateInsert,
  regeneratedEstimateUpdate,
} from "@/lib/generated-estimate";
import { hasSubscriptionAccess, SUBSCRIPTION_ACCESS_COLUMNS } from "@/lib/subscription-access";
import {
  claimEstimateGeneration,
  releaseEstimateGenerationClaim,
  runWithEstimateGenerationClaim,
  startWithEstimateGenerationClaim,
} from "@/lib/estimate-generation-claims";

const client = new Anthropic();

/**
 * The model writes the job. The contractor owns the price. TradePulse owns
 * the maths (specs/contractor-owned-pricing.md section 9).
 *
 * Nothing in this prompt, and nothing in the user message built by
 * buildGenerationUserMessage, gives the model a labour rate, a markup, a
 * price book price, a tax rate, a deposit rule or any contractor-entered
 * amount. It has no basis on which to invent a selling price, it is told not
 * to write one, and lib/estimate-prose.ts deletes any it writes anyway.
 */
function buildSystemPrompt(currency: Currency): string {
  return `You are a professional contractor writing a job estimate for a customer. Turn the job description into a clear, specific description of the work. Write it the way an experienced contractor would. The contractor adds the pricing separately, so you write the words only.

Rules:
- Write like a contractor, not like software
- Use plain language the homeowner can understand
- Be specific. Vague scope descriptions are not acceptable
- Never ask for more information. No matter how brief the input, always write a complete description of the work.
- Make reasonable assumptions for any missing details and list them in the Assumptions and Exclusions section.
- Never overstate certainty when key details are unknown
- Write what the information actually establishes, and keep an observation separate from the action it calls for
- Never state an uncertain diagnosis as fact. Write "dark staining, possible moisture-related deterioration" rather than "mould", unless the job description clearly establishes the condition
- Never call for replacement or remediation of something just because it is visible or mentioned. Write inspect, verify, or replace if damaged
- Never assume an adjacent component has failed without evidence for it in the job description
- Do not use em dashes
- Do not use: ensure, streamline, leverage, utilize, seamless, comprehensive, facilitate
- Never write currency amounts, prices, rates, or percentages of cost. Refer to the Pricing section instead.
- Never write a line items table, a pricing summary, an estimated total, a labour or material amount, a labour rate, an hour count, or anything priced by the unit.
- Never mention a deposit, a payment percentage, or any split of the price. Payment Terms describe timing and conditions in words only.
- Never write generic pricing language such as "pricing may change", "price may change", "additional charges may apply", "quoted separately", "priced separately" or "cost will depend", even with no dollar amount in the sentence. The contractor owns the price and says that themselves. Write the condition instead: what is unknown, and what has to be confirmed. For example, "If additional deterioration is found, we will discuss the added scope with you before proceeding."
- Never invent a commercial or contractual term. No payment due date, no payment timing, no estimate validity period, no financing, no cancellation policy, no warranty, no deposit, no guarantee of any kind. Those are the contractor's own business terms and are added outside this text.
- ${spellingInstructionForCurrency(currency)}
- For automotive and vehicle parts, use American English spellings: tire not tyre, muffler not silencer, gas not petrol, truck not lorry.
- In the Assumptions and Exclusions section, write each item as a plain bullet point. Do not use bold labels like **Included:**, **Excluded:**, or **Assumptions:**. Just write the assumption or exclusion directly.

Output must follow this exact structure, and must not contain any other section:

1. Job Title (H1 heading)
2. Job Summary (2 to 3 sentences)
3. Scope of Work (bullet list of specific tasks, plain language)
4. Assumptions and Exclusions (what is included, what is not)
5. Notes (job-specific and useful, omit if nothing relevant)

Do not write a Payment Terms section. Do not write any section about money, timing of payment, or business terms.`;
}

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

  // No labour_rate, no markup_percent, no price book read. A value this route
  // never loads cannot reach the model by accident. deposit_percent,
  // deposit_threshold, tax_label and tax_rate are loaded only for the
  // estimate's own snapshots and are never put in the prompt.
  const { data: business } = await supabaseAdmin
    .from("tpe_businesses")
    .select(`id, name, prepared_by, ${SUBSCRIPTION_ACCESS_COLUMNS}, deposit_percent, deposit_threshold, tax_label, tax_rate`)
    .eq("owner_user_id", user.id)
    .maybeSingle();

  // A missing business row is denied here with the same 403 it always
  // returned, rather than a 404 -- unchanged from before the consolidation.
  if (!hasSubscriptionAccess(business)) return applyTo(NextResponse.json({ error: "Subscription required" }, { status: 403 }));

  const contentTypeError = validateContentType(request);
  if (contentTypeError) return applyTo(contentTypeError);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { jobDescription, photoAnalysis, customerName, customerPhone, customerEmail, jobAddress, estimateId } = body as {
    jobDescription?: unknown;
    photoAnalysis?: unknown;
    customerName?: unknown;
    customerPhone?: unknown;
    customerEmail?: unknown;
    jobAddress?: unknown;
    estimateId?: unknown;
  };

  if (typeof jobDescription !== "string" || !jobDescription.trim()) {
    return new Response("jobDescription is required", { status: 400 });
  }
  if (jobDescription.length > 2000) {
    return new Response("Job description too long. Please keep it under 2000 characters.", { status: 400 });
  }
  if (typeof photoAnalysis === "string" && photoAnalysis.length > 4000) {
    return new Response("Photo analysis too long.", { status: 400 });
  }

  // Regenerate replaces the wording on an estimate that already exists. Its
  // pricing rows, tax and deposit snapshots, customer details and photos are
  // never touched, so regenerating cannot move a price.
  const regenerateId = typeof estimateId === "string" && estimateId.trim() ? estimateId.trim() : null;
  if (regenerateId) {
    const { data: existing } = await supabaseAdmin
      .from("tpe_estimates")
      .select("id, status, sent_at, copied_at, pricing_source")
      .eq("id", regenerateId)
      .eq("business_id", business.id)
      .maybeSingle();

    if (!existing) {
      return applyTo(NextResponse.json({ error: "Estimate not found or access denied" }, { status: 404 }));
    }
    if (existing.pricing_source !== "contractor_pricing") {
      return applyTo(
        NextResponse.json(
          { error: "This estimate uses the previous pricing system and is read-only" },
          { status: 409 }
        )
      );
    }
    if (isDelivered(existing)) {
      return applyTo(
        NextResponse.json(
          { error: "This estimate has already gone to the customer and cannot be changed" },
          { status: 409 }
        )
      );
    }
  }

  const userMessage = buildGenerationUserMessage({
    jobDescription,
    photoAnalysis: typeof photoAnalysis === "string" ? photoAnalysis : undefined,
    businessName: business.name ?? undefined,
    customerName: typeof customerName === "string" ? customerName : undefined,
    customerPhone: typeof customerPhone === "string" ? customerPhone : undefined,
    jobAddress: typeof jobAddress === "string" ? jobAddress : undefined,
  });

  // The tax this estimate is snapshotted with. It is never sent to the model.
  const tax = businessTax(business);

  // Read the snapshot currency once, before the stream opens, so the value
  // written to the row and the spelling convention the AI is told to write in
  // come from the same read.
  const estimateCurrency = await readBusinessEstimateCurrency(supabaseAdmin, business.id);

  const claimInput = { businessId: business.id, ownerUserId: user.id };
  let claimedStream;
  try {
    claimedStream = await startWithEstimateGenerationClaim({
      claim: () => claimEstimateGeneration(supabaseAdmin, claimInput),
      release: (claimId) => releaseEstimateGenerationClaim(supabaseAdmin, { ...claimInput, claimId }),
      start: () => client.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8192,
        system: buildSystemPrompt(estimateCurrency),
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

            // The price-safety guardrail. A sentence carrying a price, a
            // deposit or a business term the model has no standing to invent
            // is deleted; a heading the deletion emptied goes with it; and a
            // Payment Terms section goes whole. It never retries and never
            // blocks the save. From here on this sanitized text is the
            // estimate, and the raw buffer the client watched arrive is not.
            const sanitized = sanitizeGeneratedProse(fullText);
            if (
              sanitized.removedSentences > 0 ||
              sanitized.removedHeadings > 0 ||
              sanitized.removedSections > 0
            ) {
              console.info(
                `[generate-estimate] prose safety removed ${sanitized.removedSentences} sentence(s), ${sanitized.removedHeadings} heading(s) and ${sanitized.removedSections} section(s)`
              );
            }
            const summary = sanitized.prose;

            // Extract job title, find first H1 that isn't the business name
            const businessNameClean = (business?.name ?? "").trim().toLowerCase();
            const titleLine = summary
              .split("\n")
              .filter((l) => l.startsWith("# "))
              .find((l) => {
                const clean = l.replace(/^#\s*/, "").trim().toLowerCase();
                return clean.length > 0 && clean !== businessNameClean;
              });
            const title = titleLine?.replace(/^#\s*/, "").trim() ?? "Untitled Estimate";

            let savedEstimateId: string;
            if (regenerateId) {
              // Title and summary, nothing else. The ownership and delivery
              // checks ran before the stream opened and are repeated in this
              // filter, so a send that landed mid-generation cannot have its
              // wording overwritten underneath it.
              const { data, error } = await supabaseAdmin
                .from("tpe_estimates")
                .update(regeneratedEstimateUpdate(title, summary))
                .eq("id", regenerateId)
                .eq("business_id", business.id)
                .eq("pricing_source", "contractor_pricing")
                .is("sent_at", null)
                .is("copied_at", null)
                .in("status", ["draft", "needs_review"])
                .select("id");

              if (error || !data?.[0]?.id) {
                console.error("[generate-estimate] regenerate failed", error?.message ?? "no row updated");
                controller.enqueue(
                  new TextEncoder().encode(
                    `\n__ERROR__:Could not replace the wording on this estimate. Please try again.`
                  )
                );
                controller.close();
                return;
              }
              savedEstimateId = data[0].id;
            } else {
              const { data, error } = await supabaseAdmin
                .from("tpe_estimates")
                .insert(
                  newGeneratedEstimateInsert({
                    title,
                    summary,
                    business,
                    tax,
                    currency: estimateCurrency,
                    customerName: safeCustomerName,
                    customerPhone: safeCustomerPhone,
                    customerEmail: safeCustomerEmail,
                    jobAddress: safeJobAddress,
                  })
                )
                .select();

              if (error || !data?.[0]?.id) {
                console.error("[generate-estimate] DB insert failed", error?.message ?? "no id returned");
                controller.enqueue(new TextEncoder().encode(`\n__ERROR__:Failed to save estimate. Please try again.`));
                controller.close();
                return;
              }
              savedEstimateId = data[0].id;
            }

            controller.enqueue(new TextEncoder().encode(`\n__ID__:${savedEstimateId}`));

            // The saved record, handed straight back so the client can stop
            // showing the raw stream buffer it collected. Without this the
            // sentences the filter just removed stay on the contractor's
            // screen and get written back on the next save. Emitted last, so
            // everything after the marker is the prose.
            controller.enqueue(new TextEncoder().encode(`\n__SAVED__:${summary}`));

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
    },
  }));
}
