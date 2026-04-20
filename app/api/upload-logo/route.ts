import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll() {},
      },
    }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as { data?: string; type?: string };

  if (!body.data || !body.type) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!body.type.startsWith("image/")) {
    return NextResponse.json({ error: "Please select an image file." }, { status: 400 });
  }

  const base64 = body.data.split(",")[1] ?? body.data;
  const buffer = Buffer.from(base64, "base64");

  if (buffer.byteLength > 2 * 1024 * 1024) {
    return NextResponse.json({ error: "Image must be under 2MB." }, { status: 400 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const path = `${user.id}/logo`;

  const { error: uploadError } = await admin.storage
    .from("logos")
    .upload(path, buffer, {
      upsert: true,
      contentType: body.type,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const { data } = admin.storage.from("logos").getPublicUrl(path);
  const url = `${data.publicUrl}?t=${Date.now()}`;

  return NextResponse.json({ url });
}
