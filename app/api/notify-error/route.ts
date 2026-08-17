import { NextResponse } from "next/server";

// Internal error notification is deliberately server-only in lib/notify-error.
// Keep this route inert so callers of the former public endpoint cannot create
// Resend spend while stale clients receive a clear non-success response.
export function POST(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
