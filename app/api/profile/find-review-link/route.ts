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
    body: JSON.stringify({ textQuery: query, maxResultCount: 5 }),
  });

  if (!res.ok) return [];

  const data = await res.json() as { places?: PlacesApiPlace[] };

  return (data.places ?? []).map((p) => ({
    placeName: p.displayName.text,
    formattedAddress: p.formattedAddress,
    placeId: p.id,
    reviewLink: `https://search.google.com/local/writereview?placeid=${p.id}`,
  }));
}

function rankMatches(matches: PlaceMatch[], enteredName: string): PlaceMatch[] {
  const ln = enteredName.toLowerCase().trim();

  function score(m: PlaceMatch): number {
    const lp = m.placeName.toLowerCase().trim();
    if (lp === ln) return 0;
    if (lp.includes(ln) || ln.includes(lp)) return 1;
    return 2;
  }

  return [...matches].sort((a, b) => score(a) - score(b));
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

  const { businessName, city, extraDetails } = body as {
    businessName?: unknown;
    city?: unknown;
    extraDetails?: unknown;
  };

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
  const extra = typeof extraDetails === "string" ? extraDetails.trim() : "";

  try {
    const firstQuery = extra
      ? `${name} ${extra} ${cityStr} BC Canada`
      : `${name} ${cityStr} BC Canada`;

    const queries = [
      firstQuery,
      `${name} ${cityStr}`,
      name,
      `${name} near ${cityStr}`,
    ];

    const batches = await Promise.all(queries.map((q) => searchPlaces(q, apiKey)));

    const seen = new Set<string>();
    const merged: PlaceMatch[] = [];
    for (const batch of batches) {
      for (const match of batch) {
        if (!seen.has(match.placeId)) {
          seen.add(match.placeId);
          merged.push(match);
        }
      }
    }

    if (!merged.length) {
      return applyTo(NextResponse.json({ error: "No matching business found." }, { status: 404 }));
    }

    const ranked = rankMatches(merged, name);
    const matches = ranked.slice(0, 10);

    const ln = name.toLowerCase().trim();
    const hasStrongMatch = matches.some((m) => {
      const lp = m.placeName.toLowerCase().trim();
      return lp === ln || lp.includes(ln) || ln.includes(lp);
    });

    return applyTo(NextResponse.json({ matches, hasStrongMatch }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return applyTo(NextResponse.json({ error: message }, { status: 500 }));
  }
}
