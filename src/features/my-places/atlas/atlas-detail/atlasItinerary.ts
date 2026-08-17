import type { AtlasTransportMode } from '@/services/atlas/atlasPlaceMetadata';
import type { SavedPlace } from '@/services/place/placeService';

/**
 * What an Atlas stop can render. `category` and `city` are resolved from the
 * matching My Places row — `atlas_places` stores neither, so a stop that was
 * added straight from search (no `place_id`) carries null for both and its
 * category chip is simply omitted.
 */
export type AtlasDisplayPlace =
  Pick<SavedPlace, 'id' | 'name' | 'subtitle' | 'latitude' | 'longitude' | 'photo_url'> & {
    category: string | null;
    city: string | null;
  };

export type ItineraryItem = {
  place: AtlasDisplayPlace;
  rowId: string;
  note: string | null;
  day: number | null;
  time: string | null;
  transport: AtlasTransportMode | null;
};

/** One tab's worth of the itinerary — the stops sharing a `timeline_day`. */
export type DayGroup = {
  /** null when the stops carry no day at all. */
  day: number | null;
  label: string;
  /** The city most of the day's stops sit in, when any of them say. */
  city: string | null;
  items: ItineraryItem[];
  distanceKm: number;
};

const EARTH_RADIUS_KM = 6371;

function haversineKm(a: AtlasDisplayPlace, b: AtlasDisplayPlace): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (b.latitude - a.latitude) * radians;
  const longitudeDelta = (b.longitude - a.longitude) * radians;
  const h = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Straight-line length of the path through a day's stops, in order. Deliberately
 * not the driving distance: the routing service is only called when the user
 * asks for a route, and a day card has to have a number before then.
 */
export function pathDistanceKm(items: ItineraryItem[]): number {
  return items.slice(1).reduce(
    (total, item, index) => total + haversineKm(items[index].place, item.place),
    0,
  );
}

function dominantCity(items: ItineraryItem[]): string | null {
  const counts = new Map<string, number>();
  items.forEach(({ place }) => {
    const city = place.city?.trim();
    if (city) counts.set(city, (counts.get(city) ?? 0) + 1);
  });
  let best: string | null = null;
  let bestCount = 0;
  counts.forEach((count, city) => {
    if (count > bestCount) { best = city; bestCount = count; }
  });
  return best;
}

/**
 * Splits the itinerary into its day tabs — numbered days in order, undated stops
 * last. A trip whose stops carry no day at all comes back as a single group with
 * `day: null`, which callers render as the whole itinerary rather than as a day.
 */
export function groupItemsByDay(items: ItineraryItem[]): DayGroup[] {
  const byDay = new Map<number | null, ItineraryItem[]>();
  items.forEach((item) => {
    const bucket = byDay.get(item.day ?? null);
    if (bucket) bucket.push(item);
    else byDay.set(item.day ?? null, [item]);
  });

  const groups: DayGroup[] = [...byDay.keys()]
    .filter((day): day is number => day !== null)
    .sort((a, b) => a - b)
    .map((day) => {
      const dayItems = byDay.get(day)!;
      return { day, label: `Day ${day}`, city: dominantCity(dayItems), items: dayItems, distanceKm: pathDistanceKm(dayItems) };
    });

  const undated = byDay.get(null);
  if (undated) {
    groups.push({
      day: null,
      // Only reads as "unplanned" next to real days; on its own it *is* the trip.
      label: groups.length ? 'Unplanned' : 'Itinerary',
      city: dominantCity(undated),
      items: undated,
      distanceKm: pathDistanceKm(undated),
    });
  }
  return groups;
}

/** The Atlas's cover — the first stop that has a photo. */
export function atlasCoverUri(items: ItineraryItem[]): string | null {
  return items.find((item) => item.place.photo_url)?.place.photo_url ?? null;
}

function placeCount(count: number): string {
  return `${count} ${count === 1 ? 'place' : 'places'}`;
}

/** "5 days · 8 places", dropping the day count when nothing is scheduled. */
export function tripSummary(groups: DayGroup[], count: number): string {
  const dayCount = groups.filter((group) => group.day !== null).length;
  const places = placeCount(count);
  return dayCount ? `${dayCount} ${dayCount === 1 ? 'day' : 'days'} · ${places}` : places;
}

/**
 * "Osaka · 56km · 4 places" — one line, in the order My Places uses for its own
 * location header. Parts the Atlas has no value for are dropped rather than
 * rendered empty, so a day with no city still reads as a sentence.
 */
export function dayMetaLine(group: DayGroup): string {
  return [
    group.city,
    group.items.length > 1 ? formatDistanceKm(group.distanceKm) : null,
    placeCount(group.items.length),
  ].filter(Boolean).join(' · ');
}

export function formatDistanceKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return km >= 10 ? `${Math.round(km)}km` : `${km.toFixed(1)}km`;
}
