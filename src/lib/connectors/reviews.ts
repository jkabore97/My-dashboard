import { demoReviews } from "../demo";
import { getSetting } from "../server/store/settings";
import { env, errorMessage, fromSource, getJson } from "../source";
import type { PlaceReviews } from "../types";

// Google ratings and reviews through the Places API (New). Needs
// GOOGLE_PLACES_API_KEY plus a place ID per business (Settings). Google returns
// up to 5 reviews per place, newest-relevant first.

export interface PlaceConfig {
  placeId: string;
  business: string;
}

export function parsePlaces(text: string): PlaceConfig[] {
  return text
    .split("\n")
    .map((l) => l.split("|").map((s) => s.trim()))
    .filter(([id]) => !!id)
    .map(([placeId, business]) => ({ placeId, business: business || "Unassigned" }));
}

interface PlaceResponse {
  id: string;
  displayName?: { text: string };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  reviews?: { name: string; rating: number; text?: { text: string }; originalText?: { text: string }; authorAttribution?: { displayName?: string }; publishTime: string; relativePublishTimeDescription?: string }[];
}

export function toPlaceReviews(cfg: PlaceConfig, p: PlaceResponse): PlaceReviews {
  return {
    placeId: cfg.placeId,
    business: cfg.business,
    name: p.displayName?.text ?? cfg.business,
    rating: p.rating ?? null,
    reviewCount: p.userRatingCount ?? 0,
    url: p.googleMapsUri ?? null,
    reviews: (p.reviews ?? [])
      .map((r) => ({ id: r.name, rating: r.rating, text: (r.text?.text ?? r.originalText?.text ?? "").slice(0, 600), author: r.authorAttribution?.displayName ?? "A Google user", publishedAt: r.publishTime, relative: r.relativePublishTimeDescription ?? null }))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
  };
}

export async function getReviews() {
  const key = env("GOOGLE_PLACES_API_KEY");
  let places: PlaceConfig[] = [];
  try {
    places = await getSetting<PlaceConfig[]>("places", []);
  } catch {
    /* database unavailable */
  }
  return fromSource<PlaceReviews[]>(
    "Google reviews",
    !!key && places.length > 0,
    async (fail) => {
      const settled = await Promise.allSettled(
        places.map((p) =>
          getJson<PlaceResponse>(`https://places.googleapis.com/v1/places/${encodeURIComponent(p.placeId)}`, {
            headers: { "X-Goog-Api-Key": key!, "X-Goog-FieldMask": "id,displayName,rating,userRatingCount,googleMapsUri,reviews" },
            next: { revalidate: 3600 },
          }).then((r) => toPlaceReviews(p, r)),
        ),
      );
      settled.forEach((r, i) => r.status === "rejected" && fail(places[i].placeId, `${places[i].business}: ${errorMessage(r.reason)}`));
      const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (ok.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
      return ok;
    },
    demoReviews,
  );
}
