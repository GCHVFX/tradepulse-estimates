import { Resend } from 'resend';
import { NextRequest, NextResponse } from 'next/server';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-webhook-secret');
  if (secret !== process.env.SUPABASE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const email = body?.record?.email ?? 'unknown';
  const createdAt = body?.record?.created_at ?? '';

  await resend.emails.send({
    from: 'estimates@trytradepulse.com',
    to: process.env.NOTIFY_EMAIL!,
    subject: 'New TradePulse signup',
    text: `New signup\n\nEmail: ${email}\nTime: ${createdAt}\n\nView in Supabase:\nhttps://supabase.com/dashboard/project/hmkkuyznyumhajjqbxpu/auth/users`,
  });

  return NextResponse.json({ ok: true });
}
