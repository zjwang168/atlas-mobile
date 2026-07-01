/** A single geocoded location returned from the backend */
export interface GeocodedLocation {
  name: string;
  latitude: number;
  longitude: number;
  full_address: string;
  sentiment?: 'positive' | 'neutral' | 'negative' | null;
  description?: string | null;
  category?: string | null;
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

// === v2 Agentic Pipeline Types ===

export interface HierarchyInfo {
  name: string;
  reason: string;
  parent_of?: string;
}

export interface NoiseInfo {
  name: string;
  reason: string;
}

export interface ParseResultV2 extends ParseResult {
  session_id: string;
  removed_hierarchy?: HierarchyInfo[];
  inferred_region?: string;
  source_type?: string;
  is_multi_region?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  source_url: string | null;
  location_count: number;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail {
  status: string;
  session: {
    session_id: string;
    conversation_id: string | null;
    source_url: string | null;
    source_type: string | null;
    title: string;
    locations: GeocodedLocation[];
    route: RouteResult | null;
    removed_noise: NoiseInfo[] | null;
    removed_hierarchy: HierarchyInfo[] | null;
    inferred_region: string | null;
    is_multi_region: boolean;
    message_count: number;
    created_at: number;
    updated_at: number;
  };
  messages: ChatMessage[];
}

export interface ChatRequest {
  session_id: string;
  message: string;
}

export interface ChatResponse {
  session_id: string;
  response: string;
  locations?: GeocodedLocation[];
  route?: RouteResult;
  status: string;
  partial?: boolean;
}

export interface MapUpdate {
  action: 'add_pin' | 'remove_pin' | 'reorder_route' | 'optimize_route';
  params?: Record<string, unknown>;
}
