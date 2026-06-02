import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-server";
import { validateContentType } from "@/lib/api-utils";

interface PlaceMatch {
  placeName: string;
  formattedAddress: string;
  placeId: string;
  reviewLink: string;
}

interface PlacesApiPlace {
  id: string;
  displayName: { text: string; languageCode: string };
  formattedAddress: string;
}

async function searchPlaces(query: string, apiKey: string): Promise<PlaceMatch[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 3 }),
  });

  if (!res.ok) return [];

  const data = await res.json() as { places?: PlacesApiPlace[] };
  console.log("[find-review-link] query:", query, "| response:", JSON.stringify(data));

  return (data.places ?? []).map((p) => ({
    placeName: p.displayName.text,
    formattedAddress: p.formattedAddress,
    placeId: p.id,
    reviewLink: `https://search.google.com/local/writereview?placeid=${p.id}`,
  }));
}

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

  const name = businessName.trim();
  const cityStr = city.trim();

  try {
    let matches = await searchPlaces(`${name} ${cityStr} BC Canada`, apiKey);
    if (!matches.length) matches = await searchPlaces(name, apiKey);
    if (!matches.length) matches = await searchPlaces(`${name} ${cityStr}`, apiKey);

    if (!matches.length) {
      return applyTo(NextResponse.json({ error: "No matching business found." }, { status: 404 }));
    }

    return applyTo(NextResponse.json({ matches }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return applyTo(NextResponse.json({ error: message }, { status: 500 }));
  }
}
