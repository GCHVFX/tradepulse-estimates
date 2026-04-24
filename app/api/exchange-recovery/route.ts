import { NextRequest, NextResponse } from 'next/server';
import { createApiClient } from '@/lib/supabase-server';

export async function POST(request: NextRequest) {
  const { code } = await request.json();

  if (!code) {
    return NextResponse.json({ error: 'No code provided' }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  const { supabase, applyTo } = createApiClient(request);

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return applyTo(response);
}
