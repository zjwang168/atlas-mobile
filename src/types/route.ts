/** A single geocoded location returned from the backend */
export interface GeocodedLocation {
  name: string;
  latitude: number;
  longitude: number;
  full_address: string;
}

/** A segment between two consecutive locations in the route */
export interface RouteSegment {
  from_name: string;
  to_name: string;
  distance_km: number;
}

/** The complete route result from the backend */
export interface RouteResult {
  ordered_locations: GeocodedLocation[];
  total_distance_km: number;
  segments: RouteSegment[];
}

/** Top-level response from POST /parse_link */
export interface ParseResult {
  title: string;
  locations: GeocodedLocation[];
  route: RouteResult;
  removed_noise: string[] | null;
}

/** A single message in the sidekick chat */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
}
