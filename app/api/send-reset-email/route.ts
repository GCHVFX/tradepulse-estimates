import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { Resend } from 'resend';
import { checkRateLimit } from '@/lib/rate-limit';
import { getRequestIp, normalizeEmail } from '@/lib/request-guards';
import { SITE_URL } from '@/lib/site-url';
import { ESTIMATES_EMAIL } from '@/lib/email-addresses';

const resend = new Resend(process.env.RESEND_API_KEY);
const GENERIC_RESPONSE = { ok: true };

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const email =
      typeof body === 'object' && body !== null && 'email' in body
        ? (body as { email?: unknown }).email
        : undefined;
    const normalizedEmail = typeof email === 'string' ? normalizeEmail(email) : null;
    if (!normalizedEmail) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });

    const ipLimit = await checkRateLimit(supabaseAdmin, getRequestIp(request), 'password-reset-ip', 5, 3600);
    const emailLimit = await checkRateLimit(supabaseAdmin, normalizedEmail, 'password-reset-email', 3, 3600);
    if (!ipLimit.allowed || !emailLimit.allowed) return NextResponse.json(GENERIC_RESPONSE);

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: normalizedEmail,
      options: {
        redirectTo: `${SITE_URL}/reset-password`,
      },
    });

    if (error || !data?.properties?.action_link) {
      console.error('[send-reset-email] recovery link generation failed:', error?.message ?? 'no link');
      return NextResponse.json(GENERIC_RESPONSE);
    }

    await resend.emails.send({
      from: ESTIMATES_EMAIL,
      to: normalizedEmail,
      subject: 'Reset your TradePulse password',
      text: `Click the link below to reset your password. This link expires in 1 hour.\n\n${data.properties.action_link}\n\nIf you did not request a password reset, ignore this email.`,
    });

    return NextResponse.json(GENERIC_RESPONSE);
  } catch (err) {
    console.error("[send-reset-email] unhandled error", err instanceof Error ? err.message : err);
    return NextResponse.json(GENERIC_RESPONSE);
  }
}
