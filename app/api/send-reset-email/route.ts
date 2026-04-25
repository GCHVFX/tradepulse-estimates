import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: 'https://www.trytradepulse.com/reset-password',
      },
    });

    if (error || !data?.properties?.action_link) {
      return NextResponse.json({ error: 'Could not generate reset link' }, { status: 500 });
    }

    await resend.emails.send({
      from: 'estimates@trytradepulse.com',
      to: email,
      subject: 'Reset your TradePulse password',
      text: `Click the link below to reset your password. This link expires in 1 hour.\n\n${data.properties.action_link}\n\nIf you did not request a password reset, ignore this email.`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[send-reset-email] unhandled error", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
