import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase-server';
import { provisionNewAccount } from '@/lib/account-provisioning';
import { createAccountProvisioningDependencies } from '@/lib/account-provisioning-server';

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
          // The Google identity is the person's own account, so it is always
          // preserved. Signing out stops a half-provisioned user from staying
          // active, and /signup lets them retry: ensureBusiness provisions
          // again on the next attempt because no business row exists yet.
          try {
            await supabase.auth.signOut();
          } catch (signOutError) {
            console.error(
              '[auth/callback] sign out after failed provisioning failed:',
              signOutError instanceof Error ? signOutError.message : signOutError
            );
          }

          const failure = NextResponse.redirect(`${origin}/signup?error=setup_failed`);
          // signOut clears the session cookies onto `response`; carry them
          // across or the browser keeps the old access token.
          response.cookies.getAll().forEach((cookie) => {
            const { name, value, ...options } = cookie;
            failure.cookies.set(name, value, options);
          });
          return failure;
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
          },
          { onConflict: 'owner_user_id' }
        );

      if (dbError) throw new Error(dbError.message);
    }),
    { userId, email, plan: 'starter', deleteAuthUserOnFailure: false }
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
