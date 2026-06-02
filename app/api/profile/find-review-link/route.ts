import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-server";
import { validateContentType } from "@/lib/api-utils";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { supabase, applyTo } = createApiClient(request);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyTo(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));

  const contentTypeError = validateContentType(request);
  if (contentTypeError) return applyTo(contentTypeError);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return applyTo(NextResponse.json({ error: "Invalid request body" }, { status: 400 }));
  }

  const { businessName, city } = body as { businessName?: unknown; city?: unknown };

  if (typeof businessName !== "string" || !businessName.trim()) {
    return applyTo(NextResponse.json({ error: "Business name is required" }, { status: 400 }));
  }
  if (typeof city !== "string" || !city.trim()) {
    return applyTo(NextResponse.json({ error: "City is required" }, { status: 400 }));
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return applyTo(NextResponse.json({ error: "Google Places API is not configured" }, { status: 503 }));
  }

  const query = `${businessName.trim()} ${city.trim()}`;
  const placesUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id,name,formatted_address&key=${apiKey}`;

  try {
    const res = await fetch(placesUrl);
    if (!res.ok) {
      return applyTo(NextResponse.json({ error: "Places API request failed" }, { status: 502 }));
    }

    const data = await res.json() as {
      status: string;
      candidates?: Array<{
        place_id: string;
        name: string;
        formatted_address: string;
      }>;
    };

    if (data.status !== "OK" || !data.candidates?.length) {
      return applyTo(NextResponse.json({ error: "No matching business found." }, { status: 404 }));
    }

    const place = data.candidates[0];
    const reviewLink = `https://search.google.com/local/writereview?placeid=${place.place_id}`;

    return applyTo(NextResponse.json({
      placeName: place.name,
      formattedAddress: place.formatted_address,
      placeId: place.place_id,
      reviewLink,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return applyTo(NextResponse.json({ error: message }, { status: 500 }));
  }
}
