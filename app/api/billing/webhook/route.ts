import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-server";
import { stripe } from "@/lib/stripe";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) return NextResponse.json({ error: "No signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Webhook signature verification failed" }, { status: 400 });
  }

  const getCustomerId = (obj: unknown): string | null => {
    if (obj && typeof obj === "object" && "customer" in obj) {
      const c = (obj as { customer: string | Stripe.Customer | Stripe.DeletedCustomer }).customer;
      return typeof c === "string" ? c : c.id;
    }
    return null;
  };

  const customerId = getCustomerId(event.data.object);

  if (customerId) {
    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;

      let status: string;
      const update: Record<string, unknown> = { stripe_subscription_id: sub.id };

      if (sub.status === "trialing") {
        status = "trial";
        update.trial_ends_at = sub.trial_end
          ? new Date(sub.trial_end * 1000).toISOString()
          : null;
      } else if (sub.status === "active") {
        status = "active";
      } else {
        status = sub.status;
      }

      update.subscription_status = status;

      await supabaseAdmin
        .from("tpe_businesses")
        .update(update)
        .eq("stripe_customer_id", customerId);
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      // Only mark canceled if this is still the subscription on record.
      // Guards against old trial subs being deleted after a user has since subscribed.
      await supabaseAdmin
        .from("tpe_businesses")
        .update({ subscription_status: "canceled" })
        .eq("stripe_customer_id", customerId)
        .eq("stripe_subscription_id", sub.id);
    }

    if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object as Stripe.Invoice & { amount_paid?: number };
      const amountPaid = invoice.amount_paid ?? 0;

      if (amountPaid > 0) {
        const { error } = await supabaseAdmin
          .from("tpe_businesses")
          .update({ subscription_status: "active" })
          .eq("stripe_customer_id", customerId);
      }
    }
  }

  return NextResponse.json({ received: true });
}
