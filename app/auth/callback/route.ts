import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase-server';
import { provisionNewAccount } from '@/lib/account-provisioning';
import { createAccountProvisioningDependencies } from '@/lib/account-provisioning-server';
import {
  OAUTH_INTENT_COOKIE,
  OAUTH_NONCE_PARAM,
  resolveOAuthIntent,
  resolveOAuthSignupCurrency,
} from '@/lib/oauth-intent';
import { DEFAULT_CURRENCY, type Currency } from '@/lib/currency';
import { businessEstimateCurrencyPatch } from '@/lib/currency-db';

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

    // Sign out and leave for /signup, carrying the cleared session cookies
    // across so the browser cannot keep the old access token.
    const abandon = async (errorCode: string): Promise<NextResponse> => {
      try {
        await supabase.auth.signOut();
      } catch (signOutError) {
        console.error(
          '[auth/callback] sign out failed:',
          signOutError instanceof Error ? signOutError.message : signOutError
        );
      }

      const failure = NextResponse.redirect(`${origin}/signup?error=${errorCode}`);
      response.cookies.getAll().forEach((cookie) => {
        const { name, value, ...options } = cookie;
        failure.cookies.set(name, value, options);
      });
      failure.cookies.delete(OAUTH_INTENT_COOKIE);
      return failure;
    };

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const user = data.user;

      if (user) {
        // The intent is never read from the callback URL. It comes from the
        // HttpOnly cookie written when the flow started, and is only trusted
        // when its nonce matches the one that came back with the redirect.
        const intent = resolveOAuthIntent(
          request.cookies.get(OAUTH_INTENT_COOKIE)?.value,
          searchParams.get(OAUTH_NONCE_PARAM)
        );

        if (!intent) {
          return abandon('signin_expired');
        }

        const hasBusiness = await businessExists(user.id);

        if (hasBusiness) {
          // Both intents behave identically here: sign in, provision nothing.
          return response;
        }

        if (intent === 'login') {
          // Signing in never creates a business, a Stripe customer, a
          // subscription, or a trial. They have to go through signup.
          return abandon('setup_required');
        }

        // Only a resolved signup intent can carry a currency; login gets null.
        const signupCurrency =
          resolveOAuthSignupCurrency(
            request.cookies.get(OAUTH_INTENT_COOKIE)?.value,
            searchParams.get(OAUTH_NONCE_PARAM)
          ) ?? DEFAULT_CURRENCY;

        const provisioned = await ensureBusiness(user.id, user.email ?? undefined, signupCurrency);
        if (!provisioned) {
          // The Google identity is the person's own account, so it is always
          // preserved. Signing out stops a half-provisioned user from staying
          // active, and /signup lets them retry: ensureBusiness provisions
          // again on the next attempt because no business row exists yet.
          return abandon('setup_failed');
        }
      }

      response.cookies.delete(OAUTH_INTENT_COOKIE);
      return response;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=reset_failed`);
}

async function businessExists(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('tpe_businesses')
    .select('id')
    .eq('owner_user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[auth/callback] business lookup failed:', error.message);
    return false;
  }

  return Boolean(data);
}

// Returns true if the user already has (or now has) a business row + trial.
async function ensureBusiness(userId: string, email?: string, currency: Currency = DEFAULT_CURRENCY): Promise<boolean> {
  const { data: existing } = await supabaseAdmin
    .from('tpe_businesses')
    .select('id')
    .eq('owner_user_id', userId)
    .maybeSingle();

  if (existing) return true;

  // Same sequence and same compensation as email/password signup, except the
  // Auth identity is preserved: it is the person's own Google account, and
  // deleting it would destroy a real identity rather than a half-made one.
  const provisioned = await provisionNewAccount(
    createAccountProvisioningDependencies(async (record) => {
      const { error: dbError } = await supabaseAdmin
        .from('tpe_businesses')
        .upsert(
          {
            owner_user_id: userId,
            name: '',
            slug: userId,
            plan: 'starter',
            subscription_status: record.subscriptionStatus,
            trial_ends_at: record.trialEndsAt,
            stripe_customer_id: record.customerId,
            stripe_subscription_id: record.subscriptionId,
            signup_source: 'google',
            email: email ?? '',
            ...businessEstimateCurrencyPatch(currency),
          },
          { onConflict: 'owner_user_id' }
        );

      if (dbError) throw new Error(dbError.message);
    }),
    { userId, email, plan: 'starter', currency, deleteAuthUserOnFailure: false }
  );

  if (!provisioned.ok) {
    console.error(
      `[auth/callback] OAuth provisioning failed at ${provisioned.stage}:`,
      provisioned.error instanceof Error ? provisioned.error.message : provisioned.error
    );
    return false;
  }

  return true;
}
