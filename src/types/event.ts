/** Local events returned by the backend's `GET /events`. */

/** The category set the backend normalizes every source onto. */
export const EVENT_CATEGORIES = [
  'festival',
  'market',
  'music',
  'arts',
  'outdoors',
  'history',
  'community',
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export type EventSourceId = 'usda' | 'nps' | 'curated';

export type LocalEvent = {
  id: string;
  source: EventSourceId;
  title: string;
  category: EventCategory;
  /**
   * ISO datetime for a dated event. Null on a recurring one — a farmers
   * market or a season-long festival — which carries `schedule_text` instead.
   * Read `starts_at` first and fall back to `schedule_text`; never branch on
   * `source` to decide which to show.
   */
  starts_at: string | null;
  ends_at: string | null;
  schedule_text: string | null;
  location_name: string | null;
  address: string | null;
  /** Never null: the backend drops rows it could not place. */
  latitude: number;
  longitude: number;
  distance_km: number;
  url: string | null;
  image_url: string | null;
  /** Whose photo it is, e.g. `"NPS"`. Null when the image is stock. */
  image_attribution: string | null;
  /**
   * True when `image_url` is a generic photo for the category rather than a
   * picture of this event. Never caption a stock image as if it showed the
   * real thing.
   */
  image_is_stock: boolean;
  blurb: string | null;
  is_free: boolean | null;
  /** A signature event; the backend protects these from the result limit. */
  featured: boolean;
};

export type EventSourceStatus = {
  id: EventSourceId;
  status: 'ok' | 'unavailable' | 'not_configured';
  count: number;
  detail: string | null;
};

export type EventsResult = {
  events: LocalEvent[];
  /** Per-source outcome, so a partial answer can be labelled as partial. */
  sources: EventSourceStatus[];
  attribution: string;
  radius_km: number;
  window_days: number;
};
