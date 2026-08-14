import type { MapMarker } from '@/features/map/MapboxMap';
import type { AtlasRouteResponse } from '@/services/api/apiService';
import type { SavedPlace } from '@/services/place/placeService';
import type { TransportMode } from './constants';

export type DraftPlace = Pick<SavedPlace, 'id' | 'name' | 'subtitle' | 'latitude' | 'longitude' | 'photo_url' | 'city' | 'region' | 'country' | 'category'> & {
  source?: 'saved' | 'recommended' | 'search';
  provisional?: boolean;
  confidence?: number | null;
  aiDescription?: string | null;
  note?: string | null;
  timeline_day?: number | null;
  timeline_time?: string | null;
  transport?: TransportMode | null;
  joinId?: string;
};

export type AtlasSavedMapView = {
  title: string;
  centerCoordinate: [number, number];
  zoomLevel: number;
  markers: MapMarker[];
  routeGeoJSON?: AtlasRouteResponse['route'];
  places: DraftPlace[];
};

export type SearchResult =
  | { kind: 'saved'; place: SavedPlace }
  | { kind: 'remote'; externalId: string; name: string; subtitle: string; featureType?: string; coordinate?: [number, number]; bounds?: { ne: [number, number]; sw: [number, number] } };

export type FocusArea = {
  label: string;
  scope: 'city' | 'region' | 'country';
  coordinate: [number, number];
  count: number;
  photoUrl?: string | null;
  places: SavedPlace[];
  bounds: { ne: [number, number]; sw: [number, number] };
};

export type AtlasBuilderProps = {
  onClose: () => void;
  onSaved: (atlasId: string, askAI: boolean, mapView?: AtlasSavedMapView) => void;
  atlasId?: string;
  initialCandidates?: DraftPlace[];
  initialItems?: DraftPlace[];
  initialCenter?: [number, number];
  initialBounds?: { ne: [number, number]; sw: [number, number] };
  initialLocation?: string;
  started?: boolean;
  autoFocusCreateSearch?: boolean;
  onItemsChange?: (items: DraftPlace[]) => void;
  onFirstPlaceAdded?: () => void;
  /** Called after the blank Create Atlas country camera has reached Mapbox idle. */
  onCreateCameraSettled?: () => void;
  onBuildPlan?: (location: string, candidates: DraftPlace[], center?: [number, number], bounds?: { ne: [number, number]; sw: [number, number] }) => void;
  onReturnToCreateSearch?: () => void;
  /** Lets an enclosing full-screen Atlas surface display recording feedback. */
  onNoteVoiceRecordingChange?: (recording: boolean) => void;
};
