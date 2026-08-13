import type Ionicons from "@expo/vector-icons/Ionicons";
import type { AtlasTransportMode } from "@/services/atlas/atlasPlaceMetadata";

export type TransportMode = AtlasTransportMode;

export const TRANSPORT_OPTIONS: Array<{
  mode: TransportMode;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { mode: "walk", label: "Walk", icon: "walk-outline" },
  { mode: "bike", label: "Bike", icon: "bicycle-outline" },
  { mode: "drive", label: "Drive", icon: "car-outline" },
  { mode: "taxi", label: "Taxi", icon: "car-sport-outline" },
  { mode: "bus", label: "Bus", icon: "bus-outline" },
  { mode: "coach", label: "Coach", icon: "bus-outline" },
  { mode: "subway", label: "Subway", icon: "train-outline" },
  { mode: "train", label: "Train", icon: "train-outline" },
  { mode: "ferry", label: "Ferry", icon: "boat-outline" },
  { mode: "flight", label: "Flight", icon: "airplane-outline" },
];

export const PLANNING_HOURS = Array.from({ length: 17 }, (_, index) => {
  const value = index + 7;
  const hour = value % 12 || 12;
  return `${hour}${value < 12 ? "am" : "pm"}`;
});

// The default Atlas overview intentionally uses an explicit camera instead of
// a rectangular fit. Adjust this zoom to widen/tighten the mainland-US view.
// A slightly northern center moves the mainland south on screen, clear of the
// Atlas search field, while this zoom leaves the entire lower 48 in view.
export const CONTINENTAL_US_CENTER = [-98.5, 46.0] as [number, number];
export const CONTINENTAL_US_ZOOM = 1.9;
export const FOCUS_SAVED_PLACES_RADIUS_KM = 65;
export const SEARCH_DEBOUNCE_MS = 350;

// Create an Atlas stays at the original camera position; editing an existing
// Atlas shifts its map content down by about 2 cm above the editing sheet.
export const EDIT_ATLAS_CAMERA_SCREEN_OFFSET_Y = 80;
