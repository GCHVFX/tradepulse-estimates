import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({}, { status: 200 });
    }

    const { error, status, context } = body as {
      error?: unknown;
      status?: unknown;
      context?: unknown;
    };

    const errorStr = typeof error === "string" ? error : String(error ?? "unknown error");
    const statusNum = typeof status === "number" ? status : 0;
    const contextStr = typeof context === "string" ? context : "unknown";

    if (!process.env.RESEND_API_KEY) {
      console.error("[notify-error] RESEND_API_KEY not set");
      return NextResponse.json({}, { status: 200 });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const { error: resendError } = await resend.emails.send({
      from: "estimates@trytradepulse.com",
      to: "support@trytradepulse.com",
      subject: `[TradePulse Alert] ${contextStr} failed with ${statusNum}`,
      text: [
        `Context: ${contextStr}`,
        `Status: ${statusNum}`,
        `Error: ${errorStr}`,
        `Timestamp: ${new Date().toISOString()}`,
      ].join("\n"),
    });

    if (resendError) {
      console.error("[notify-error] Resend failed:", resendError);
    }
  } catch (err) {
    console.error("[notify-error] unexpected error:", err);
  }

  return NextResponse.json({}, { status: 200 });
}
