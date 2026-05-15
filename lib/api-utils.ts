import { NextRequest, NextResponse } from "next/server";

export function validateContentType(
  request: NextRequest,
  expectedType: string = "application/json"
): NextResponse | null {
  const contentType = request.headers.get("content-type");
  if (!contentType?.includes(expectedType)) {
    return NextResponse.json(
      { error: `Content-Type must be ${expectedType}` },
      { status: 400 }
    );
  }
  return null;
}

export function generateRequestId(request: NextRequest): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

export function addRequestIdToResponse(
  response: NextResponse,
  requestId: string
): NextResponse {
  response.headers.set("x-request-id", requestId);
  return response;
}
