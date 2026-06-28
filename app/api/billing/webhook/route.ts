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

  const toBusinessSubscriptionStatus = (status: Stripe.Subscription.Status): string => {
    if (status === "trialing") return "trial";
    if (status === "canceled") return "cancelled";
    return status;
  };

  const customerId = getCustomerId(event.data.object);

  if (customerId) {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscription =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      const plan = session.metadata?.plan;
      const previousSubscriptionId = session.metadata?.previous_subscription_id;
      const update: Record<string, unknown> = {};

      if (subscription) update.stripe_subscription_id = subscription;
      if (plan === "starter" || plan === "pro") update.plan = plan;

      if (Object.keys(update).length > 0) {
        await supabaseAdmin
          .from("tpe_businesses")
          .update(update)
          .eq("stripe_customer_id", customerId);
      }

      if (previousSubscriptionId && previousSubscriptionId !== subscription) {
        try {
          const previous = await stripe.subscriptions.retrieve(previousSubscriptionId);
          if (previous.status === "trialing") {
            await stripe.subscriptions.cancel(previousSubscriptionId);
          }
        } catch (err) {
          console.error("[webhook] failed to cancel previous trial:", err instanceof Error ? err.message : err);
        }
      }
    }

    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;
      const { data: currentBusiness, error: currentBusinessError } = await supabaseAdmin
        .from("tpe_businesses")
        .select("stripe_subscription_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();

      if (currentBusinessError) {
        console.error("[webhook] failed to look up current subscription:", currentBusinessError.message);
        return NextResponse.json({ received: true });
      }

      if (currentBusiness?.stripe_subscription_id && currentBusiness.stripe_subscription_id !== sub.id) {
        console.warn("[webhook] ignored stale subscription event", {
          eventType: event.type,
          eventSubscriptionId: sub.id,
          currentSubscriptionId: currentBusiness.stripe_subscription_id,
        });
        return NextResponse.json({ received: true });
      }

      const update: Record<string, unknown> = { stripe_subscription_id: sub.id };
      const status = toBusinessSubscriptionStatus(sub.status);

      if (sub.status === "trialing") {
        update.trial_ends_at = sub.trial_end
          ? new Date(sub.trial_end * 1000).toISOString()
          : null;
      }

      update.subscription_status = status;

      // Detect plan from price ID — set STRIPE_PRO_PRICE_ID env var when Pro is launched
      const priceId = sub.items?.data?.[0]?.price?.id;
      if (priceId && process.env.STRIPE_PRO_PRICE_ID) {
        update.plan = priceId === process.env.STRIPE_PRO_PRICE_ID ? "pro" : "starter";
      }

      await supabaseAdmin
        .from("tpe_businesses")
        .update(update)
        .eq("stripe_customer_id", customerId);
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      // Stripe uses "canceled"; the app stores "cancelled".
      // Only mark cancelled if this is still the subscription on record.
      // Guards against old trial subs being deleted after a user has since subscribed.
      await supabaseAdmin
        .from("tpe_businesses")
        .update({ subscription_status: "cancelled" })
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
        if (error) {
          console.error("[webhook] failed to activate subscription:", error.message);
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}
