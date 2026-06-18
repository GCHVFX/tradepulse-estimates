import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase-server';
import { stripe } from '@/lib/stripe';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/new';

  if (code) {
    const response = NextResponse.redirect(`${origin}${next}`);

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll(); },
          setAll(cookies) {
            cookies.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const user = data.user;
      // OAuth users skip /api/auth/signup, so make sure they get a business
      // row and trial subscription on first login. Existing users are left
      // untouched.
      if (user) {
        const provisioned = await ensureBusiness(user.id, user.email ?? undefined);
        if (!provisioned) {
          return NextResponse.redirect(`${origin}/login?error=oauth_setup_failed`);
        }
      }
      return response;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=reset_failed`);
}

// Returns true if the user already has (or now has) a business row + trial.
async function ensureBusiness(userId: string, email?: string): Promise<boolean> {
  const { data: existing } = await supabaseAdmin
    .from('tpe_businesses')
    .select('id')
    .eq('owner_user_id', userId)
    .maybeSingle();

  if (existing) return true;

  let customerId: string | undefined;
  try {
    const customer = await stripe.customers.create({
      ...(email ? { email } : {}),
      metadata: { user_id: userId },
    });
    customerId = customer.id;

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: process.env.STRIPE_PRICE_ID! }],
      trial_period_days: 14,
      payment_settings: { save_default_payment_method: 'on_subscription' },
    });

    const trialEndsAt = subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const { error: dbError } = await supabaseAdmin
      .from('tpe_businesses')
      .upsert(
        {
          owner_user_id: userId,
          name: '',
          slug: userId,
          plan: 'starter',
          subscription_status: 'trial',
          trial_ends_at: trialEndsAt,
          stripe_customer_id: customer.id,
          stripe_subscription_id: subscription.id,
          signup_source: 'google',
        },
        { onConflict: 'owner_user_id' }
      );

    if (dbError) {
      console.error('[auth/callback] tpe_businesses upsert failed:', dbError.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[auth/callback] OAuth provisioning failed:', err instanceof Error ? err.message : err);
    // Clean up the orphaned Stripe customer so a retry starts clean.
    try { if (customerId) await stripe.customers.del(customerId); } catch {}
    return false;
  }
}
