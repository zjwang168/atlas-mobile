import Ionicons from '@expo/vector-icons/Ionicons';
import { NotePencilIcon } from 'phosphor-react-native/src/icons/NotePencil';
import { useAppDialog } from '@/components/feedback/AppDialog';
import { Text } from '@/components/ui/text';
import VoiceInputButton from '@/components/voice-input/VoiceInputButton';
import { useHome } from '@/features/home/HomeContext';
import type { MapMarker } from '@/features/map/MapboxMap';
import { discoverAtlasPlaces, geocodeAtlasArea, requestAtlasRoute, type AtlasRouteResponse } from '@/services/api/apiService';
import { addAtlasOwnedPlaces, addPlacesToAtlas, removePlaceFromAtlas, reorderAtlasPlaces, updateAtlasPlaces, updateAtlasPlace, type AtlasPlaceSnapshot } from '@/services/atlas/atlasPlacesService';
import { decodeAtlasPlaceMetadata, encodeAtlasPlaceMetadata, type AtlasTransportMode } from '@/services/atlas/atlasPlaceMetadata';
import { createAtlas, updateAtlas } from '@/services/atlas/atlasService';
import { createSearchSession, isAbortError, resolvePlace, suggestPlaces } from '@/services/place/placeSearchService';
import type { SavedPlace } from '@/services/place/placeService';
import type { AtlasPlace } from '@/types/place';
import type { GeocodedLocation } from '@/types/route';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, { Extrapolation, FadeInDown, FadeOutUp, Layout, type SharedValue, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import * as Location from 'expo-location';

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

type TransportMode = AtlasTransportMode;

const TRANSPORT_OPTIONS: Array<{ mode: TransportMode; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { mode: 'walk', label: 'Walk', icon: 'walk-outline' },
  { mode: 'bike', label: 'Bike', icon: 'bicycle-outline' },
  { mode: 'drive', label: 'Drive', icon: 'car-outline' },
  { mode: 'taxi', label: 'Taxi', icon: 'car-sport-outline' },
  { mode: 'bus', label: 'Bus', icon: 'bus-outline' },
  { mode: 'coach', label: 'Coach', icon: 'bus-outline' },
  { mode: 'subway', label: 'Subway', icon: 'train-outline' },
  { mode: 'train', label: 'Train', icon: 'train-outline' },
  { mode: 'ferry', label: 'Ferry', icon: 'boat-outline' },
  { mode: 'flight', label: 'Flight', icon: 'airplane-outline' },
];

type SearchResult =
  | { kind: 'saved'; place: SavedPlace }
  | { kind: 'remote'; externalId: string; name: string; subtitle: string; featureType?: string; coordinate?: [number, number]; bounds?: { ne: [number, number]; sw: [number, number] } };

type FocusArea = {
  label: string;
  scope: 'city' | 'region' | 'country';
  coordinate: [number, number];
  count: number;
  photoUrl?: string | null;
  places: SavedPlace[];
  bounds: { ne: [number, number]; sw: [number, number] };
};

type AtlasBuilderProps = {
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
  onBuildPlan?: (location: string, candidates: DraftPlace[], center?: [number, number], bounds?: { ne: [number, number]; sw: [number, number] }) => void;
  onReturnToCreateSearch?: () => void;
};

const PLANNING_HOURS = Array.from({ length: 17 }, (_, index) => {
  const value = index + 7;
  const hour = value % 12 || 12;
  return `${hour}${value < 12 ? 'am' : 'pm'}`;
});

// The default Atlas overview intentionally uses an explicit camera instead of
// a rectangular fit. Adjust this zoom to widen/tighten the mainland-US view.
// A slightly northern center moves the mainland south on screen, clear of the
// Atlas search field, while this zoom leaves the entire lower 48 in view.
const CONTINENTAL_US_CENTER = [-98.5, 46.0] as [number, number];
const CONTINENTAL_US_ZOOM = 1.9;
const FOCUS_SAVED_PLACES_RADIUS_KM = 65;
const SEARCH_DEBOUNCE_MS = 350;

function boundsFromPolygon(polygon: Array<[number, number]>, padding = 0.06) {
  const minLng = Math.min(...polygon.map(([lng]) => lng));
  const maxLng = Math.max(...polygon.map(([lng]) => lng));
  const minLat = Math.min(...polygon.map(([, lat]) => lat));
  const maxLat = Math.max(...polygon.map(([, lat]) => lat));
  return { ne: [maxLng + padding, maxLat + padding] as [number, number], sw: [minLng - padding, minLat - padding] as [number, number] };
}

function boundsFromRadius([longitude, latitude]: [number, number], radiusKm: number) {
  const latitudeRadius = radiusKm / 110.574;
  const longitudeRadius = radiusKm / Math.max(0.01, 111.320 * Math.cos((latitude * Math.PI) / 180));
  return {
    ne: [longitude + longitudeRadius, latitude + latitudeRadius] as [number, number],
    sw: [longitude - longitudeRadius, latitude - latitudeRadius] as [number, number],
  };
}

function expandBounds(bounds: { ne: [number, number]; sw: [number, number] }, fraction = 0.1) {
  const longitudeSpan = Math.max(0.05, Math.abs(bounds.ne[0] - bounds.sw[0]));
  const latitudeSpan = Math.max(0.05, Math.abs(bounds.ne[1] - bounds.sw[1]));
  return {
    ne: [Math.min(180, bounds.ne[0] + longitudeSpan * fraction), Math.min(85, bounds.ne[1] + latitudeSpan * fraction)] as [number, number],
    sw: [Math.max(-180, bounds.sw[0] - longitudeSpan * fraction), Math.max(-85, bounds.sw[1] - latitudeSpan * fraction)] as [number, number],
  };
}

function zoomForBounds(bounds: { ne: [number, number]; sw: [number, number] }, minimumZoom = 1.9) {
  const longitudeSpan = Math.max(0.05, Math.abs(bounds.ne[0] - bounds.sw[0]));
  const latitudeSpan = Math.max(0.05, Math.abs(bounds.ne[1] - bounds.sw[1]));
  const widthZoom = Math.log2((360 * 390) / (512 * longitudeSpan));
  const heightZoom = Math.log2((170 * 360) / (512 * latitudeSpan));
  return Math.max(minimumZoom, Math.min(14, Math.min(widthZoom, heightZoom) - 0.25));
}

function acceptAiDescription(value?: string | null) {
  const description = value?.trim();
  if (!description || description.split(/\s+/).length > 4) return null;
  return description;
}

// Create an Atlas stays at the original camera position; editing an existing
// Atlas shifts its map content down by about 2 cm above the editing sheet.
const EDIT_ATLAS_CAMERA_SCREEN_OFFSET_Y = 80;

const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const timeRank = (day: number, time: string) => day * 24 + Math.max(0, PLANNING_HOURS.indexOf(time) + 7);
const timeOfDayRank = (time: string) => Math.max(0, PLANNING_HOURS.indexOf(time));
// Let the editor commit its initial UI and Mapbox markers before kicking off
// location services or recommendation work on the native/JS bridge.
const waitForFirstAtlasPaint = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
});

function toDraft(place: SavedPlace, row?: AtlasPlace): DraftPlace {
  const metadata = decodeAtlasPlaceMetadata(row?.note);
  const hasSnapshotCoordinates = row?.latitude != null && row.longitude != null;
  return {
    id: place.id,
    name: row?.place_name ?? place.name,
    subtitle: row?.place_subtitle ?? place.subtitle,
    latitude: hasSnapshotCoordinates ? row.latitude! : place.latitude,
    longitude: hasSnapshotCoordinates ? row.longitude! : place.longitude,
    photo_url: row?.photo_url ?? place.photo_url,
    city: row?.city ?? place.city,
    region: row?.region ?? place.region,
    country: row?.country ?? place.country,
    category: place.category,
    source: 'saved',
    note: metadata.note,
    timeline_day: row?.timeline_day,
    timeline_time: row?.timeline_time,
    transport: metadata.transport,
    joinId: row?.id,
  };
}

function atlasPlaceSnapshot(place: DraftPlace): AtlasPlaceSnapshot {
  return {
    place_name: place.name,
    place_subtitle: place.subtitle,
    latitude: place.latitude,
    longitude: place.longitude,
    photo_url: place.photo_url ?? null,
    city: place.city ?? null,
    region: place.region ?? null,
    country: place.country ?? null,
  };
}

function toDraftFromRow(row: AtlasPlace, saved?: SavedPlace): DraftPlace | null {
  if (saved) return toDraft(saved, row);
  if (row.latitude == null || row.longitude == null || !row.place_name) return null;
  const metadata = decodeAtlasPlaceMetadata(row.note);
  return {
    id: row.external_place_id ?? row.id,
    name: row.place_name,
    subtitle: row.place_subtitle ?? '',
    latitude: row.latitude,
    longitude: row.longitude,
    photo_url: row.photo_url ?? null,
    city: row.city ?? null,
    region: row.region ?? null,
    country: row.country ?? null,
    category: null,
    source: 'search',
    note: metadata.note,
    timeline_day: row.timeline_day,
    timeline_time: row.timeline_time,
    transport: metadata.transport,
    joinId: row.id,
  };
}

function isLocalMatch(place: SavedPlace, query: string) {
  const terms = normalize(query).split(' ').filter(Boolean);
  if (!terms.length) return false;
  const haystack = normalize([place.name, place.subtitle, place.city, place.region, place.country].filter(Boolean).join(' '));
  if (terms.length > 1) return haystack.includes(terms.join(' '));
  return haystack.split(' ').some((word) => word === terms[0] || (terms[0].length >= 3 && word.startsWith(terms[0])));
}

function isNearCoordinate(place: { latitude: number; longitude: number }, center: [number, number]) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(place.latitude - center[1]);
  const longitudeDelta = toRadians(place.longitude - center[0]);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(center[1])) * Math.cos(toRadians(place.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  const distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return distanceKm <= FOCUS_SAVED_PLACES_RADIUS_KM;
}

function centerOfBounds(bounds: { ne: [number, number]; sw: [number, number] }): [number, number] {
  return [(bounds.ne[0] + bounds.sw[0]) / 2, (bounds.ne[1] + bounds.sw[1]) / 2];
}

function focusBoundsForSavedPlaces(center: [number, number], places: Array<{ latitude: number; longitude: number }>) {
  const coordinates = [center, ...places.map((place) => [place.longitude, place.latitude] as [number, number])];
  const longitudeSpan = Math.max(...coordinates.map(([longitude]) => longitude)) - Math.min(...coordinates.map(([longitude]) => longitude));
  const latitudeSpan = Math.max(...coordinates.map(([, latitude]) => latitude)) - Math.min(...coordinates.map(([, latitude]) => latitude));
  // The breathing room grows with the true footprint. This keeps a local
  // collection useful while allowing country-scale collections to zoom out.
  const padding = Math.max(0.06, Math.min(3, Math.max(longitudeSpan, latitudeSpan) * 0.12));
  return boundsFromPolygon(coordinates, padding);
}

function uniquePlaces(places: SavedPlace[]) {
  return [...new Map(places.map((place) => [place.id, place])).values()];
}

function clusterLocationNames(places: SavedPlace[]) {
  return new Set(
    places.map((place) => normalize(place.city ?? place.region ?? place.country ?? '')).filter(Boolean),
  );
}

function savedPlacesMatchingAdministrativeFocus(place: DraftPlace, savedPlaces: SavedPlace[], featureType?: string) {
  const administrativeField = featureType === 'country' ? 'country' : 'region';
  const focusTerm = normalize(
    administrativeField === 'country'
      ? place.country ?? place.name
      : place.region ?? place.name,
  );
  if (!focusTerm) return [];
  return savedPlaces.filter((savedPlace) => (
    normalize(savedPlace[administrativeField] ?? '') === focusTerm
  ));
}

function isWithinBounds(place: { latitude: number; longitude: number }, bounds?: { ne: [number, number]; sw: [number, number] }) {
  if (!bounds) return true;
  const [east, north] = bounds.ne;
  const [west, south] = bounds.sw;
  const withinLatitude = place.latitude >= south && place.latitude <= north;
  const withinLongitude = west <= east
    ? place.longitude >= west && place.longitude <= east
    : place.longitude >= west || place.longitude <= east;
  return withinLatitude && withinLongitude;
}

function isMarkerOverlap(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const latitudeDistance = (a.latitude - b.latitude) * 111_320;
  const longitudeDistance = (a.longitude - b.longitude) * 111_320 * Math.cos((a.latitude + b.latitude) * Math.PI / 360);
  return Math.hypot(latitudeDistance, longitudeDistance) < 48;
}

function deriveFocusAreas(places: SavedPlace[]): FocusArea[] {
  const areas = new Map<string, SavedPlace[]>();
  places.forEach((place) => {
    const label = [place.city, place.region, place.country].find((value) => value?.trim());
    if (!label) return;
    const key = normalize(label);
    areas.set(key, [...(areas.get(key) ?? []), place]);
  });
  return [...areas.values()]
    .map((group) => {
      const first = group[0];
      const scope: FocusArea['scope'] = first.city?.trim() ? 'city' : first.region?.trim() ? 'region' : 'country';
      const coordinate: [number, number] = [
        group.reduce((sum, place) => sum + place.longitude, 0) / group.length,
        group.reduce((sum, place) => sum + place.latitude, 0) / group.length,
      ];
      return {
        label: first.city || first.region || first.country || '',
        scope,
        photoUrl: group.find((place) => Boolean(place.photo_url))?.photo_url,
        places: group,
        coordinate,
        count: group.length,
        bounds: focusBoundsForSavedPlaces(coordinate, group),
      };
    })
    .filter((area) => Boolean(area.label))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildAtlasTitle(items: DraftPlace[]) {
  const categories = items.map((item) => normalize(item.category ?? item.name)).join(' ');
  const location = items.find((item) => item.city || item.region || item.country);
  const place = location?.city ?? location?.region ?? location?.country ?? items[0]?.name ?? 'Your Atlas';
  const slogan = /museum|gallery|art/.test(categories)
    ? 'Art Around Every Corner'
    : /park|trail|garden|nature/.test(categories)
      ? 'Wild At Heart'
      : /restaurant|cafe|food|bakery/.test(categories)
        ? 'Taste The Town'
        : 'Made To Wander';
  return `${place}: ${slogan}`;
}

export default function AtlasBuilder({ onClose, onSaved, atlasId, initialCandidates, initialItems, initialCenter, initialBounds, initialLocation, started = false, autoFocusCreateSearch = false, onItemsChange, onFirstPlaceAdded, onBuildPlan, onReturnToCreateSearch }: AtlasBuilderProps) {
  const { show: showDialog } = useAppDialog();
  const { savedPlaces, atlasPlaces, atlases, setAtlasMapState, setTabBarVisible, userLocation, refreshUserLocation } = useHome();
  const searchSession = useRef(createSearchSession()).current;
  const queryAbortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingResult, setAddingResult] = useState<string | null>(null);
  const [fullResults, setFullResults] = useState<SearchResult[] | null>(null);
  const [items, setItems] = useState<DraftPlace[]>(initialItems ?? []);
  const [focused, setFocused] = useState<DraftPlace | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>(initialCenter ?? CONTINENTAL_US_CENTER);
  const [mapZoom, setMapZoom] = useState(initialBounds ? zoomForBounds(initialBounds, 1.2) : CONTINENTAL_US_ZOOM);
  const [mapBounds, setMapBounds] = useState<{ ne: [number, number]; sw: [number, number] } | undefined>(initialBounds);
  const [route, setRoute] = useState<AtlasRouteResponse | null>(null);
  const [generatingRoute, setGeneratingRoute] = useState(false);
  const [savingKind, setSavingKind] = useState<'atlas' | 'ai' | null>(null);
  const [timeModalIndex, setTimeModalIndex] = useState<number | null>(null);
  const [pendingDay, setPendingDay] = useState<number | null>(1);
  const [pendingTime, setPendingTime] = useState('9am');
  const [timeConflictMessage, setTimeConflictMessage] = useState<string | null>(null);
  const [transportModalIndex, setTransportModalIndex] = useState<number | null>(null);
  const [focusLabel, setFocusLabel] = useState(initialLocation && normalize(initialLocation) !== 'your area' ? initialLocation : '');
  const [atlasTitle, setAtlasTitle] = useState('');
  const [focusSearchActive, setFocusSearchActive] = useState(false);
  const [handoffStarted, setHandoffStarted] = useState(false);
  const [recommendedPlaces, setRecommendedPlaces] = useState<DraftPlace[]>(initialCandidates ?? []);
  const [enteringPlaceIds, setEnteringPlaceIds] = useState<Set<string>>(() => new Set());
  const [removingPlace, setRemovingPlace] = useState<DraftPlace | null>(null);
  const [localMustSeesVisible, setLocalMustSeesVisible] = useState(false);
  const [localMustSeesPending, setLocalMustSeesPending] = useState(false);
  const [nearbyPromptVisible, setNearbyPromptVisible] = useState(false);
  const [nearbyRecommending, setNearbyRecommending] = useState(false);
  const isCreateAtlasLanding = !atlasId && !started && !handoffStarted;
  const searchAppear = useRef(new Animated.Value(0)).current;
  const localMustSeesOpacity = useRef(new Animated.Value(0)).current;
  const nearbyPromptOpacity = useRef(new Animated.Value(0)).current;
  const localMustSeesShownRef = useRef(false);
  const localMustSeesVisibleRef = useRef(false);
  const nearbyPromptEligibleRef = useRef(false);
  // Saved candidates can seed Create an Atlas, but only actual AI-recommended
  // pins are allowed to trigger the local-must-sees note.
  const pinnedAiPlaceIdsRef = useRef(new Set((initialCandidates ?? []).filter((place) => place.source === 'recommended').map((place) => place.id)));
  const viewportCenterRef = useRef<[number, number]>(initialCenter ?? CONTINENTAL_US_CENTER);
  const viewportZoomRef = useRef(initialBounds ? zoomForBounds(initialBounds, 1.2) : CONTINENTAL_US_ZOOM);
  const nearbyIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearbyAfterLocalNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearbyPromptDismissedRef = useRef(false);
  const nearbyPromptVisibleRef = useRef(false);
  // Each mounted editor owns one recommendation conversation. Closing an
  // Atlas and entering Edit Atlas again mounts a fresh editor and new session.
  const aiRecommendationSessionId = useRef(`atlas-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`).current;
  const aiRecommendedNamesRef = useRef(new Set((initialCandidates ?? []).map((place) => normalize(place.name)).filter(Boolean)));
  const [cameraKey, setCameraKey] = useState(`atlas-builder-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const initialPlaceSelected = useRef(false);
  const timeConflictTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Saving hands the shared map directly to the completed Atlas. Its unmount
  // must not clear that handoff before the detail page has hydrated its rows.
  const preserveMapOnUnmountRef = useRef(false);

  const showTimeConflict = useCallback((message: string) => {
    if (timeConflictTimer.current) clearTimeout(timeConflictTimer.current);
    setTimeConflictMessage(message);
    timeConflictTimer.current = setTimeout(() => {
      setTimeConflictMessage(null);
      timeConflictTimer.current = null;
    }, 3000);
  }, []);

  useEffect(() => () => {
    if (timeConflictTimer.current) clearTimeout(timeConflictTimer.current);
  }, []);

  useEffect(() => {
    if (initialLocation && normalize(initialLocation) !== 'your area') setFocusLabel(initialLocation);
  }, [initialLocation]);

  const existingAtlas = useMemo(() => atlases.find((atlas) => atlas.id === atlasId), [atlasId, atlases]);
  useEffect(() => {
    if (existingAtlas?.title) setAtlasTitle(existingAtlas.title);
  }, [existingAtlas?.title]);
  const focusAreas = useMemo(() => deriveFocusAreas(savedPlaces), [savedPlaces]);
  const undefinedDayLocked = useMemo(() => items.some((item) => Boolean(item.timeline_time) && !item.timeline_day), [items]);
  useEffect(() => {
    if (started && initialCandidates) setRecommendedPlaces(initialCandidates);
  }, [initialCandidates, started]);

  // If a user opened a provisional pin while geocoding was still running,
  // refresh the popup object silently when the verified coordinates arrive.
  useEffect(() => {
    if (!focused || focused.source !== 'recommended') return;
    const latest = recommendedPlaces.find((place) => place.id === focused.id);
    if (!latest) return;
    if (latest.latitude === focused.latitude && latest.longitude === focused.longitude && latest.provisional === focused.provisional) return;
    setFocused(latest);
  }, [focused, recommendedPlaces]);

  useEffect(() => {
    if (!started) return;
    if (initialCenter) {
      viewportCenterRef.current = initialCenter;
      setMapCenter(initialCenter);
    }
    if (initialBounds) {
      viewportZoomRef.current = zoomForBounds(initialBounds, 1.2);
      setMapBounds(initialBounds);
      setMapZoom(zoomForBounds(initialBounds, 1.2));
    }
    // The map is shared between the Create screen and the editor. A fresh key
    // forces Mapbox to apply the incoming Focus-area camera rather than retain
    // the previous screen's cached viewport.
    if (initialCenter || initialBounds) setCameraKey(`atlas-builder-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }, [initialBounds, initialCenter, started]);

  useEffect(() => {
    if (!isCreateAtlasLanding) return;
    let cancelled = false;
    void (async () => {
      try {
        const deviceLocation = await refreshUserLocation();
        if (cancelled) return;
        // Do not leave the Create screen on its continental-US fallback while
        // country boundaries resolve. The final bounds fit respects Home's
        // live bottom-sheet padding, so the full country stays in the usable
        // upper map viewport.
        setMapCenter(deviceLocation);
        setMapBounds(undefined);
        setMapZoom(4);
        const [address] = await Location.reverseGeocodeAsync({
          latitude: deviceLocation[1],
          longitude: deviceLocation[0],
        });
        const country = address?.country ?? address?.isoCountryCode;
        if (!country) return;
        const resolvedCountry = await geocodeAtlasArea(country);
        if (cancelled || !resolvedCountry?.bounds) return;
        const countryBounds = expandBounds(resolvedCountry.bounds, 0.12);
        viewportCenterRef.current = centerOfBounds(countryBounds);
        viewportZoomRef.current = zoomForBounds(countryBounds, 1.1);
        setMapCenter(viewportCenterRef.current);
        setMapBounds(countryBounds);
        setMapZoom(viewportZoomRef.current);
        setCameraKey(`atlas-country-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      } catch (error) {
        // Location and country lookup are a presentation enhancement; search
        // remains available when either service is unavailable.
        console.warn('[AtlasBuilder] country camera unavailable', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCreateAtlasLanding, refreshUserLocation]);

  useEffect(() => {
    setTabBarVisible(false);
    return () => setTabBarVisible(true);
  }, [setTabBarVisible]);

  useEffect(() => {
    if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
  }, []);

  useEffect(() => {
    Animated.timing(searchAppear, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [searchAppear]);

  useEffect(() => {
    if (!autoFocusCreateSearch || !isCreateAtlasLanding) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [autoFocusCreateSearch, isCreateAtlasLanding]);

  const hideNearbyPrompt = useCallback((permanent = false) => {
    if (permanent) nearbyPromptDismissedRef.current = true;
    if (nearbyIdleTimerRef.current) clearTimeout(nearbyIdleTimerRef.current);
    if (permanent && nearbyAfterLocalNoteTimerRef.current) clearTimeout(nearbyAfterLocalNoteTimerRef.current);
    if (!nearbyPromptVisibleRef.current) return;
    Animated.timing(nearbyPromptOpacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
      nearbyPromptVisibleRef.current = false;
      setNearbyPromptVisible(false);
    });
  }, [nearbyPromptOpacity]);

  const showNearbyPrompt = useCallback(() => {
    if ((!atlasId && !started) || !nearbyPromptEligibleRef.current || nearbyPromptDismissedRef.current || localMustSeesVisibleRef.current || nearbyPromptVisibleRef.current) return;
    nearbyPromptOpacity.setValue(0);
    nearbyPromptVisibleRef.current = true;
    setNearbyPromptVisible(true);
    Animated.timing(nearbyPromptOpacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [atlasId, nearbyPromptOpacity, started]);

  const scheduleNearbyPrompt = useCallback((center: [number, number], delay = 10_000) => {
    viewportCenterRef.current = center;
    if ((!atlasId && !started) || !nearbyPromptEligibleRef.current || nearbyPromptDismissedRef.current || localMustSeesVisibleRef.current || nearbyPromptVisibleRef.current) return;
    if (nearbyIdleTimerRef.current) clearTimeout(nearbyIdleTimerRef.current);
    nearbyIdleTimerRef.current = setTimeout(() => {
      showNearbyPrompt();
    }, delay);
  }, [atlasId, showNearbyPrompt, started]);

  const hideLocalMustSees = useCallback(() => {
    if (!localMustSeesVisibleRef.current) return;
    Animated.timing(localMustSeesOpacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
      localMustSeesVisibleRef.current = false;
      setLocalMustSeesVisible(false);
      nearbyPromptEligibleRef.current = true;
      if (nearbyAfterLocalNoteTimerRef.current) clearTimeout(nearbyAfterLocalNoteTimerRef.current);
      nearbyAfterLocalNoteTimerRef.current = setTimeout(showNearbyPrompt, 2000);
    });
  }, [localMustSeesOpacity, showNearbyPrompt]);

  useEffect(() => {
    const pinnedAiPlaceIds = new Set(recommendedPlaces.filter((place) => place.source === 'recommended').map((place) => place.id));
    const hasNewAiPlace = [...pinnedAiPlaceIds].some((id) => !pinnedAiPlaceIdsRef.current.has(id));
    pinnedAiPlaceIdsRef.current = pinnedAiPlaceIds;
    if (hasNewAiPlace && !localMustSeesShownRef.current) setLocalMustSeesPending(true);
  }, [recommendedPlaces]);

  useEffect(() => {
    // A single note accompanies the first AI pin. It never stacks with the
    // nearby recommendation control.
    if (!localMustSeesPending || localMustSeesShownRef.current || localMustSeesVisibleRef.current) return;
    hideNearbyPrompt();
    localMustSeesShownRef.current = true;
    localMustSeesVisibleRef.current = true;
    setLocalMustSeesVisible(true);
    localMustSeesOpacity.stopAnimation();
    Animated.timing(localMustSeesOpacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    const timeout = setTimeout(hideLocalMustSees, 10_000);
    return () => clearTimeout(timeout);
  }, [hideLocalMustSees, hideNearbyPrompt, localMustSeesOpacity, localMustSeesPending]);

  useEffect(() => {
    scheduleNearbyPrompt(mapCenter);
    return () => {
      if (nearbyIdleTimerRef.current) clearTimeout(nearbyIdleTimerRef.current);
      if (nearbyAfterLocalNoteTimerRef.current) clearTimeout(nearbyAfterLocalNoteTimerRef.current);
    };
  }, [mapCenter, scheduleNearbyPrompt]);

  useEffect(() => {
    if (!atlasId) return;
    const placesById = new Map(savedPlaces.map((place) => [place.id, place]));
    const restored = atlasPlaces
      .filter((row) => row.atlas_id === atlasId)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((row) => {
        return toDraftFromRow(row, row.place_id ? placesById.get(row.place_id) : undefined);
      })
      .filter((place): place is DraftPlace => Boolean(place));
    setItems(restored);
    if (!initialLocation || normalize(initialLocation) === 'your area') {
      const firstArea = restored.find((place) => place.city || place.region || place.country);
      if (firstArea) setFocusLabel(firstArea.city ?? firstArea.region ?? firstArea.country ?? firstArea.name);
    }
    setRoute(existingAtlas?.route_geojson && existingAtlas.route_visible ? {
      route: existingAtlas.route_geojson,
      distance_km: 0,
      duration_minutes: 0,
    } : null);
  }, [atlasId, atlasPlaces, existingAtlas?.route_geojson, existingAtlas?.route_visible, initialLocation, savedPlaces]);

  useEffect(() => () => {
    queryAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setResults([]);
      setSearching(false);
      return;
    }
    queryAbortRef.current?.abort();
    const controller = new AbortController();
    queryAbortRef.current = controller;
    const local = isCreateAtlasLanding
      ? []
      : savedPlaces.filter((place) => isLocalMatch(place, trimmed)).slice(0, 8)
        .map((place): SearchResult => ({ kind: 'saved', place }));
    setResults([]);
    setSearching(true);
    let geographicResult: SearchResult | null = null;
    const withGeographicResult = (remote: SearchResult[]) => geographicResult
      ? [geographicResult, ...remote.filter((result) => result.kind !== 'remote' || normalize(result.name) !== normalize(geographicResult?.kind === 'remote' ? geographicResult.name : ''))].slice(0, 8)
      : remote;

    // Search Box is capped at 10 requests/s per access token. Waiting briefly
    // after typing stops avoids turning each keystroke into an upstream call.
    const timer = setTimeout(() => void suggestPlaces(
      trimmed,
      searchSession,
      isCreateAtlasLanding
        ? { proximity: mapCenter, types: 'poi,place,locality,district,region,country', includeNonPoi: true }
        : mapCenter ? { proximity: mapCenter } : {},
      controller.signal,
    ).then((remote) => {
      if (controller.signal.aborted) return;
      const normalizedQuery = normalize(trimmed);
      const searchScore = (suggestion: typeof remote[number]) => {
        const geographic = ['place', 'locality', 'district', 'region', 'country'].includes(suggestion.feature_type);
        const exact = normalize(suggestion.name) === normalizedQuery;
        return exact && geographic ? 0 : geographic ? 1 : exact ? 2 : 3;
      };
      const uniqueRemote = remote
        .filter((suggestion) => !local.some((result) => result.kind === 'saved' && normalize(result.place.name) === normalize(suggestion.name)))
        .sort((left, right) => searchScore(left) - searchScore(right) || left.name.localeCompare(right.name))
        .slice(0, isCreateAtlasLanding ? 8 : 2)
        .map((suggestion): SearchResult => ({ kind: 'remote', externalId: suggestion.external_id, name: suggestion.name, subtitle: suggestion.place_formatted ?? suggestion.full_address ?? '', featureType: suggestion.feature_type }));
      setResults(isCreateAtlasLanding ? withGeographicResult(uniqueRemote) : [...uniqueRemote, ...local].slice(0, 4));
    }).catch((error) => {
      if (!controller.signal.aborted && !isAbortError(error)) {
        console.warn('[AtlasBuilder] search failed', error);
        setResults(isCreateAtlasLanding ? [] : local.slice(0, 4));
      }
    }).finally(() => {
      if (!controller.signal.aborted) setSearching(false);
    }), SEARCH_DEBOUNCE_MS);

    // This corrects ambiguous names such as California and Beijing after the
    // fast list is already visible. It never delays the search interaction.
    if (isCreateAtlasLanding && trimmed.length >= 2) {
      void geocodeAtlasArea(trimmed, controller.signal).then((resolvedArea) => {
        if (controller.signal.aborted || !resolvedArea || !['place', 'region', 'country'].includes(resolvedArea.featureType ?? '')) return;
        geographicResult = {
          kind: 'remote',
          externalId: `atlas-area-${resolvedArea.featureType}-${resolvedArea.center.join(',')}`,
          name: resolvedArea.label ?? trimmed,
          subtitle: resolvedArea.subtitle ?? '',
          featureType: resolvedArea.featureType,
          coordinate: resolvedArea.center,
          bounds: resolvedArea.bounds,
        };
        setResults((current) => withGeographicResult(current));
      });
    }
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isCreateAtlasLanding, mapCenter, query, savedPlaces, searchSession]);

  const hideTransientUI = useCallback(() => {
    inputRef.current?.blur();
    setResults([]);
    setFocused(null);
  }, []);

  const handleQueryChange = useCallback((nextQuery: string) => {
    // State set from TextInput's event is visible one render earlier than a
    // useEffect, so the spinner responds on the actual keystroke. Abort the
    // previous query here as well; waiting for effect cleanup lets slow mobile
    // networks accumulate obsolete requests while somebody is still typing.
    queryAbortRef.current?.abort();
    setQuery(nextQuery);
    if (nextQuery.trim().length >= 1) {
      setResults([]);
      setSearching(true);
    } else {
      setResults([]);
      setSearching(false);
    }
  }, []);

  const focus = useCallback((place: DraftPlace, bounds?: { ne: [number, number]; sw: [number, number] }) => {
    setFocused(place);
    setMapCenter([place.longitude, place.latitude]);
    setMapBounds(bounds);
    setMapZoom(bounds ? zoomForBounds(bounds) : 15);
  }, []);

  const openFocusSearch = useCallback(() => {
    setFocusSearchActive(true);
    setQuery('');
    setResults([]);
    setTimeout(() => inputRef.current?.focus(), 40);
  }, []);

  const closeFocusSearch = useCallback(() => {
    inputRef.current?.blur();
    setFocusSearchActive(false);
    setQuery('');
    setResults([]);
    setFullResults(null);
  }, []);

  const returnToCreateSearch = useCallback(() => {
    // The replacement Create screen installs its own continental camera in a
    // layout effect. Keep the shared map alive during this one-render handoff
    // so Home never falls back to its GPS camera in between.
    preserveMapOnUnmountRef.current = true;
    onReturnToCreateSearch?.();
  }, [onReturnToCreateSearch]);

  const resolveFirstMapboxPoi = useCallback(async (query: string, proximity: [number, number]): Promise<DraftPlace | null> => {
    const [first] = await suggestPlaces(query, searchSession, { proximity });
    if (!first) return null;
    const resolved = await resolvePlace(first, searchSession);
    if (!resolved) return null;
    return {
      id: first.external_id,
      name: resolved.name,
      subtitle: resolved.subtitle,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      photo_url: resolved.imageUri ?? null,
      city: resolved.city ?? null,
      region: null,
      country: resolved.country ?? null,
      category: resolved.type ?? first.feature_type ?? null,
      source: 'search',
    };
  }, [searchSession]);

  const discoverDeepSeekPlaces = useCallback(async (city: string, count: number, proximity?: [number, number], administrativeBounds?: { ne: [number, number]; sw: [number, number] }): Promise<DraftPlace[]> => {
    const toDraftRecommendation = (place: GeocodedLocation, index: number): DraftPlace => ({
      id: `deepseek-${aiRecommendationSessionId}-${place.external_id ?? `${normalize(place.name)}-${index}`}`,
      name: place.name,
      subtitle: place.full_address,
      latitude: place.latitude,
      longitude: place.longitude,
      photo_url: place.photo_url ?? null,
      city: place.city ?? city,
      region: null,
      country: place.country ?? 'United States',
      category: place.category ?? 'Tourist Attractions',
      source: 'recommended',
      // The prompt asks DeepSeek to generate this field within four words;
      // preserve that authored phrase instead of truncating a sentence.
      aiDescription: acceptAiDescription(place.description),
      // AI recommendations remain immediately actionable. The service may
      // refine coordinates in the background, but never blocks the add flow.
      provisional: false,
      confidence: place.confidence ?? null,
    });
    const discoveries: DraftPlace[] = [];
    const knownNames = new Set(aiRecommendedNamesRef.current);

    // A model can occasionally return one already-known landmark despite the
    // exclusion list. Retry only for the missing count and enforce the same
    // normalized-name check locally before any pin reaches the map.
    for (let attempt = 0; attempt < 3 && discoveries.length < count; attempt += 1) {
      const needed = count - discoveries.length;
      const proximityInstruction = proximity
        ? ` The requested area is centered at ${proximity[1].toFixed(4)}, ${proximity[0].toFixed(4)}. Every returned place must be within ${FOCUS_SAVED_PLACES_RADIUS_KM} km of that coordinate; do not return places from another city or state.`
        : '';
      const administrativeInstruction = administrativeBounds
        ? ` Every returned place must be inside the requested administrative area: longitude ${administrativeBounds.sw[0].toFixed(4)} to ${administrativeBounds.ne[0].toFixed(4)}, latitude ${administrativeBounds.sw[1].toFixed(4)} to ${administrativeBounds.ne[1].toFixed(4)}. Do not return a place outside those boundaries.`
        : '';
      const result = await discoverAtlasPlaces(
        `Recommend exactly ${needed} famous places in ${city}.${proximityInstruction}${administrativeInstruction} This is turn ${attempt + 1} of one continuous Atlas editing conversation. Return only real places that are different from every place already discussed. Return each real place name, plausible decimal latitude and longitude, city/region context, category, and a location-specific license-plate-style English slogan in the description field (maximum 4 English words). Do not use a category as the description, do not truncate a sentence, and do not write a complete sentence. Coordinates are provisional and will be geocode-verified in parallel. Style references: The Emerald Needle; Where Fish Fly; Glass Without Limits; Rock Meets Tech; Art By The Sound; Skyline Capital; Rainforest Not Rain; Wisdom Under Cherry; Where Water Works; Wheel Over Waves.`,
        undefined,
        undefined,
        { sessionId: aiRecommendationSessionId, excludedPlaceNames: [...knownNames] },
      );
      result.locations.forEach((place, index) => {
        const name = normalize(place.name);
        if (!name || knownNames.has(name) || discoveries.length >= count || (proximity && !isNearCoordinate(place, proximity)) || (administrativeBounds && !isWithinBounds(place, administrativeBounds))) return;
        knownNames.add(name);
        aiRecommendedNamesRef.current.add(name);
        discoveries.push(toDraftRecommendation(place, discoveries.length + index));
      });
    }
    return discoveries;
  }, [aiRecommendationSessionId]);

  const recommendNearby = useCallback(async () => {
    if (nearbyRecommending) return;
    setNearbyRecommending(true);
    const [longitude, latitude] = viewportCenterRef.current;
    try {
      const nearby = await discoverDeepSeekPlaces(`within 20 km of ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, 5);
      setRecommendedPlaces((current) => {
        const seen = new Set(current.map((place) => place.id));
        return [...current, ...nearby.filter((place) => !seen.has(place.id))];
      });
      const coverage = [...items, ...recommendedPlaces, ...nearby];
      if (coverage.length) {
        const bounds = boundsFromPolygon(coverage.map((place) => [place.longitude, place.latitude] as [number, number]), 0.035);
        setMapCenter([(bounds.ne[0] + bounds.sw[0]) / 2, (bounds.ne[1] + bounds.sw[1]) / 2]);
        setMapBounds(undefined);
        setMapZoom(zoomForBounds(bounds));
      }
    } catch (error) {
      console.warn('[AtlasBuilder] nearby recommendation failed', error);
    } finally {
      setNearbyRecommending(false);
      scheduleNearbyPrompt(viewportCenterRef.current);
    }
  }, [discoverDeepSeekPlaces, items, nearbyRecommending, recommendedPlaces, scheduleNearbyPrompt]);

  const handoffToPlan = useCallback((location: string, candidates: DraftPlace[], center?: [number, number], bounds?: FocusArea['bounds']) => {
    setHandoffStarted(true);
    // AtlasBuilder draws from center/zoom rather than Mapbox fitBounds, so
    // derive the passed center from the same bounds used for the zoom.
    onBuildPlan?.(location, candidates, bounds ? centerOfBounds(bounds) : center, bounds);
  }, [onBuildPlan]);

  const focusArea = useCallback(async (area: FocusArea) => {
    const isCountry = area.scope === 'country';
    const clusterLocations = clusterLocationNames(area.places);
    const isMultiLocationCluster = !isCountry && clusterLocations.size > 1;
    // The saved-place cluster already gives us a valid first camera. Do not
    // wait for remote geocoding before mounting Edit Atlas: that starved the
    // typewriter and delayed both pins and their + popups on slow networks.
    const initialCoordinate = area.coordinate;
    const initialLocalSaved = uniquePlaces([
      ...area.places.filter((place) => isCountry || isMultiLocationCluster || isNearCoordinate(place, initialCoordinate)),
      ...savedPlaces.filter((place) => (
        isCountry
          ? normalize(place.country ?? '') === normalize(area.label)
          : isMultiLocationCluster
            ? clusterLocations.has(normalize(place.city ?? place.region ?? place.country ?? ''))
            : isNearCoordinate(place, initialCoordinate)
      )),
    ]);
    const initialBounds = isCountry
      ? expandBounds(area.bounds)
      : isMultiLocationCluster && initialLocalSaved.length > 1
        ? focusBoundsForSavedPlaces(initialCoordinate, initialLocalSaved)
        : boundsFromRadius(initialCoordinate, FOCUS_SAVED_PLACES_RADIUS_KM);
    handoffToPlan(area.label, initialLocalSaved.map((item) => toDraft(item)), initialCoordinate, initialBounds);
    setFocusLabel(area.label);

    // Yield two frames so the initial editor, tutorial text, and first pin
    // popup are visible before any asynchronous location work begins.
    await waitForFirstAtlasPaint();

    let focusCoordinate = initialCoordinate;
    let countryBounds: FocusArea['bounds'] | undefined;
    try {
      const areaQuery = isCountry ? area.label : [area.label, area.places[0]?.country].filter(Boolean).join(', ');
      const resolvedArea = await geocodeAtlasArea(areaQuery);
      if (resolvedArea) {
        focusCoordinate = resolvedArea.center;
        if (isCountry) countryBounds = resolvedArea.bounds;
      } else if (!isCountry) {
        const [deviceResolvedArea] = await Location.geocodeAsync(areaQuery);
        if (deviceResolvedArea) focusCoordinate = [deviceResolvedArea.longitude, deviceResolvedArea.latitude];
      }
    } catch (error) {
      console.warn('[AtlasBuilder] focus-area geocoding failed', error);
    }
    const localSaved = uniquePlaces([
      ...area.places.filter((place) => isCountry || isMultiLocationCluster || isNearCoordinate(place, focusCoordinate)),
      ...savedPlaces.filter((place) => (
        isCountry
          ? normalize(place.country ?? '') === normalize(area.label)
          : isMultiLocationCluster
          ? clusterLocations.has(normalize(place.city ?? place.region ?? place.country ?? ''))
          : isNearCoordinate(place, focusCoordinate)
      )),
    ]);
    const bounds = isCountry
      ? expandBounds(countryBounds ?? focusBoundsForSavedPlaces(focusCoordinate, localSaved))
      : isMultiLocationCluster && localSaved.length > 1
        ? focusBoundsForSavedPlaces(focusCoordinate, localSaved)
        : boundsFromRadius(focusCoordinate, FOCUS_SAVED_PLACES_RADIUS_KM);
    // Refine only the already-visible editor camera once geocoding returns.
    setMapCenter(centerOfBounds(bounds));
    setMapBounds(bounds);
    setMapZoom(zoomForBounds(bounds, isCountry ? 1.2 : 1.9));
    try {
      const recommendations = await discoverDeepSeekPlaces(area.label, 3, isCountry ? undefined : focusCoordinate);
      setRecommendedPlaces(recommendations);
    } catch (error) {
      console.warn('[AtlasBuilder] plan discovery failed', error);
    }
  }, [discoverDeepSeekPlaces, handoffToPlan, savedPlaces]);

  const simpleStart = useCallback(async () => {
    // The context may still hold its startup fallback while the user opens the
    // editor. Refresh here so Simple Start is anchored and labelled from the
    // device's actual GPS fix whenever permission is available.
    const deviceLocation = await refreshUserLocation();
    const localBounds = boundsFromRadius(deviceLocation, FOCUS_SAVED_PLACES_RADIUS_KM);
    let city = 'Your area';
    try {
      const [address] = await Location.reverseGeocodeAsync({ latitude: deviceLocation[1], longitude: deviceLocation[0] });
      city = address?.city ?? address?.subregion ?? address?.region ?? city;
    } catch (error) {
      console.warn('[AtlasBuilder] reverse geocoding failed', error);
    }

    const gpsAnchor: DraftPlace = {
      id: `gps-anchor-${deviceLocation[0].toFixed(5)}-${deviceLocation[1].toFixed(5)}`,
      name: city,
      subtitle: 'Current location',
      longitude: deviceLocation[0],
      latitude: deviceLocation[1],
      photo_url: null,
      city,
      region: null,
      country: null,
      category: 'Current location',
      source: 'search',
    };
    let firstPoi = gpsAnchor;
    try {
      // Mapbox Search Box requires a text query. "attractions" with the GPS
      // proximity gives us its first nearby POI, rather than a saved place.
      firstPoi = await resolveFirstMapboxPoi('attractions', deviceLocation) ?? gpsAnchor;
    } catch (error) {
      console.warn('[AtlasBuilder] nearby Mapbox POI unavailable', error);
    }
    handoffToPlan(city, [firstPoi], deviceLocation, localBounds);
    await waitForFirstAtlasPaint();

    try {
      const recommendations = await discoverDeepSeekPlaces(city, 3, deviceLocation);
      setRecommendedPlaces(recommendations);
      setFocusLabel(city);
    } catch (error) {
      // Recommendations are optional; search and saved places remain usable.
      console.warn('[AtlasBuilder] simple start recommendations failed', error);
    }
  }, [discoverDeepSeekPlaces, handoffToPlan, refreshUserLocation, resolveFirstMapboxPoi]);

  const revealInitialCandidate = useCallback((place: DraftPlace) => {
    if (initialPlaceSelected.current) return;
    initialPlaceSelected.current = true;
    setFocused(place);
  }, []);

  useEffect(() => {
    if ((!started && !atlasId) || initialPlaceSelected.current) return;
    const selectedIds = new Set([
      ...items.map((item) => item.id),
      ...atlasPlaces
        .filter((row) => row.atlas_id === atlasId)
        .map((row) => row.place_id ?? row.external_place_id ?? row.id),
    ]);
    const areaBounds = mapBounds ?? initialBounds ?? (initialCenter ? boundsFromRadius(initialCenter, FOCUS_SAVED_PLACES_RADIUS_KM) : undefined);
    const fallbackCandidates = (initialCandidates ?? []).filter((place) => (
      !selectedIds.has(place.id)
      && isWithinBounds(place, areaBounds)
    ));
    const place = fallbackCandidates[0];
    if (!place) return;
    revealInitialCandidate(place);
  }, [atlasId, atlasPlaces, initialBounds, initialCandidates, initialCenter, items, mapBounds, revealInitialCandidate, started]);

  const resolveResult = useCallback(async (result: SearchResult): Promise<DraftPlace | null> => {
    if (result.kind === 'saved') return toDraft(result.place);
    if (result.coordinate) {
      return {
        id: result.externalId,
        name: result.name,
        subtitle: result.subtitle,
        latitude: result.coordinate[1],
        longitude: result.coordinate[0],
        photo_url: null,
        city: result.featureType === 'place' ? result.name : null,
        region: result.featureType === 'region' ? result.name : null,
        country: result.featureType === 'country' ? result.name : null,
        category: result.featureType ?? null,
        source: 'search',
      };
    }
    const resolved = await resolvePlace({ external_id: result.externalId, name: result.name, feature_type: 'poi', source: 'mapbox' }, searchSession);
    if (!resolved) return null;
    return {
      id: result.externalId,
      name: resolved.name,
      subtitle: resolved.subtitle,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      photo_url: resolved.imageUri ?? null,
      city: resolved.city ?? null,
      region: null,
      country: resolved.country ?? null,
      category: resolved.type ?? result.featureType ?? null,
    };
  }, [searchSession]);

  const focusAreaResult = useCallback(async (result: SearchResult) => {
    try {
      const place = await resolveResult(result);
      if (!place) return;
      const nearbySaved = savedPlaces.filter((savedPlace) => isNearCoordinate(savedPlace, [place.longitude, place.latitude]));
      // Country and region searches can legitimately span thousands of
      // kilometres. A city result also contains its country metadata, so only
      // explicit administrative searches may expand beyond the local radius.
      const isAdministrativeSearch = result.kind === 'remote'
        && (result.featureType === 'country' || result.featureType === 'region');
      const scopedSaved = isAdministrativeSearch
        ? savedPlacesMatchingAdministrativeFocus(place, savedPlaces, result.featureType)
        : [];
      const placesInView = scopedSaved.length ? scopedSaved : nearbySaved;
      const isCountrySearch = result.kind === 'remote' && result.featureType === 'country';
      const resolvedCountry = isCountrySearch
        ? await geocodeAtlasArea(place.country ?? place.name)
        : null;
      const bounds = isCountrySearch && resolvedCountry?.bounds
        ? expandBounds(resolvedCountry.bounds)
        : focusBoundsForSavedPlaces([place.longitude, place.latitude], placesInView);
      setMapCenter(centerOfBounds(bounds));
      setMapBounds(bounds);
      setMapZoom(zoomForBounds(bounds, isCountrySearch ? 1.2 : 1.9));
      setFocused(null);
      setFocusLabel(place.city ?? place.region ?? place.name);
      closeFocusSearch();
    } catch (error) {
      console.warn('[AtlasBuilder] focusing search area failed', error);
    }
  }, [closeFocusSearch, resolveResult, savedPlaces]);

  const persistAddedPlace = useCallback(async (place: DraftPlace): Promise<string | undefined> => {
    if (!atlasId) return undefined;
    try {
      if (savedPlaces.some((saved) => saved.id === place.id)) {
        const [row] = await addPlacesToAtlas(atlasId, [place.id], new Map([[place.id, atlasPlaceSnapshot(place)]]));
        return row?.id;
      }
      const [row] = await addAtlasOwnedPlaces(atlasId, [{
        id: place.id,
        name: place.name,
        subtitle: place.subtitle,
        latitude: place.latitude,
        longitude: place.longitude,
        photo_url: place.photo_url,
        external_place_id: place.id,
        city: place.city,
        region: place.region,
        country: place.country,
      }]);
      return row?.id;
    } catch (error) {
      console.warn('[AtlasBuilder] autosave place failed', error);
      return undefined;
    }
  }, [atlasId, savedPlaces]);

  const addPlace = useCallback((place: DraftPlace) => {
    if (place.provisional) {
      showDialog({ title: 'Location is still being verified', message: 'This AI recommendation will be available to add when its map position is confirmed.', tone: 'warning' });
      return;
    }
    const alreadyAdded = items.some((item) => item.id === place.id);
    if (!alreadyAdded) {
      LayoutAnimation.configureNext({
        duration: 260,
        update: { type: LayoutAnimation.Types.easeInEaseOut },
        create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
        delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      });
      const nextItems = [...items, place];
      setItems(nextItems);
      onItemsChange?.(nextItems);
      setEnteringPlaceIds((current) => new Set(current).add(place.id));
      setTimeout(() => setEnteringPlaceIds((current) => {
        const next = new Set(current);
        next.delete(place.id);
        return next;
      }), 520);
      onFirstPlaceAdded?.();
      void persistAddedPlace(place).then((joinId) => {
        if (!joinId) return;
        setItems((current) => current.map((item) => item.id === place.id ? { ...item, joinId } : item));
      });
    }
    setFocused(place);
    setQuery('');
    setResults([]);
  }, [items, onFirstPlaceAdded, onItemsChange, persistAddedPlace, showDialog]);

  const commitItems = useCallback((next: DraftPlace[]) => {
    setItems(next);
    onItemsChange?.(next);
  }, [onItemsChange]);

  const handleResultFocus = useCallback(async (result: SearchResult) => {
    try {
      const place = await resolveResult(result);
      if (place) focus(place);
      inputRef.current?.blur();
      setResults([]);
    } catch (error) {
      console.warn('[AtlasBuilder] resolving search result failed', error);
    }
  }, [focus, resolveResult]);

  const beginAtlasFromSearchResult = useCallback(async (result: SearchResult) => {
    const key = result.kind === 'saved' ? result.place.id : result.externalId;
    setAddingResult(key);
    try {
      const selectedPlace = result.kind === 'saved' ? toDraft(result.place) : await resolveResult(result);
      if (!selectedPlace) return;
      const firstPoi = await resolveFirstMapboxPoi(
        query.trim() || selectedPlace.name,
        [selectedPlace.longitude, selectedPlace.latitude],
      ).catch((error) => {
        console.warn('[AtlasBuilder] first Mapbox search POI unavailable', error);
        return null;
      });
      const place = firstPoi ?? selectedPlace;
      if (!place) return;
      const coordinate: [number, number] = [place.longitude, place.latitude];
      const areaSaved = result.kind === 'remote' && result.featureType === 'country'
        ? savedPlaces.filter((savedPlace) => normalize(savedPlace.country ?? '') === normalize(place.name))
        : result.kind === 'remote' && result.featureType === 'region'
          ? savedPlaces.filter((savedPlace) => normalize(savedPlace.region ?? '') === normalize(place.name))
          : result.kind === 'remote' && result.featureType === 'place'
            ? savedPlaces.filter((savedPlace) => normalize(savedPlace.city ?? '') === normalize(place.name))
            : [];
      // Keep camera padding separate from candidate eligibility. A padded
      // provincial/state bbox can spill into a neighbouring jurisdiction, so
      // green candidates must always satisfy the original Mapbox boundary.
      const candidateBounds = result.kind === 'remote' && result.bounds
        ? result.bounds
        : undefined;
      const nearbySaved = savedPlaces.filter((savedPlace) => isNearCoordinate(savedPlace, coordinate));
      const localSaved = (areaSaved.length ? areaSaved : nearbySaved)
        .filter((savedPlace) => isWithinBounds(savedPlace, candidateBounds));
      const bounds = candidateBounds
        ? expandBounds(candidateBounds)
        : localSaved.length
        ? focusBoundsForSavedPlaces(coordinate, localSaved)
        : boundsFromRadius(coordinate, 18);
      const location = place.city ?? place.region ?? place.name;
      // The selected search result is the fastest and most predictable first
      // green + candidate. It also avoids waiting for another POI retrieval.
      const candidates = [{ ...place, source: 'search' as const }];
      // Stop all type-ahead work before the view transition. In particular,
      // old geocoding requests must not publish results over Edit Atlas.
      queryAbortRef.current?.abort();
      inputRef.current?.blur();
      setQuery('');
      setResults([]);
      setSearching(false);
      handoffToPlan(location, candidates, centerOfBounds(bounds), bounds);

      // Match the other entry paths: let the editor paint, then load three
      // independent purple AI recommendations without blocking navigation.
      void (async () => {
        await waitForFirstAtlasPaint();
        try {
          const areaSelection = result.kind === 'remote' && ['place', 'region', 'country'].includes(result.featureType ?? '');
          const aiLocation = areaSelection ? location : place.city ?? place.region ?? location;
          const resolvedAiArea = candidateBounds
            ? { bounds: candidateBounds }
            : await geocodeAtlasArea(aiLocation);
          const recommendations = await discoverDeepSeekPlaces(
            aiLocation,
            3,
            undefined,
            resolvedAiArea?.bounds,
          );
          setRecommendedPlaces(recommendations);
          setFocusLabel(aiLocation);
        } catch (error) {
          console.warn('[AtlasBuilder] search-area discovery failed', error);
        }
      })();
    } catch (error) {
      console.warn('[AtlasBuilder] starting Atlas from search result failed', error);
    } finally {
      setAddingResult(null);
    }
  }, [discoverDeepSeekPlaces, handoffToPlan, query, resolveFirstMapboxPoi, resolveResult, savedPlaces]);

  const handleResultAdd = useCallback(async (result: SearchResult) => {
    const key = result.kind === 'saved' ? result.place.id : result.externalId;
    setAddingResult(key);
    try {
      const place = result.kind === 'saved' ? toDraft(result.place) : await resolveResult(result);
      if (place) addPlace(place);
    } catch (error) {
      console.warn('[AtlasBuilder] adding search result failed', error);
    } finally {
      setAddingResult(null);
    }
  }, [addPlace, resolveResult]);

  const openFullSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    setSearching(true);
    try {
      const remote = await suggestPlaces(trimmed, searchSession, mapCenter ? { proximity: mapCenter } : {});
      const local = savedPlaces.filter((place) => isLocalMatch(place, trimmed)).map((place): SearchResult => ({ kind: 'saved', place }));
      const seen = new Set<string>();
      setFullResults([...remote.map((suggestion): SearchResult => ({ kind: 'remote', externalId: suggestion.external_id, name: suggestion.name, subtitle: suggestion.place_formatted ?? suggestion.full_address ?? '', featureType: suggestion.feature_type })), ...local].filter((result) => {
        const key = result.kind === 'saved' ? result.place.id : result.externalId;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 8));
    } catch (error) {
      console.warn('[AtlasBuilder] full search failed', error);
    } finally {
      setSearching(false);
    }
  }, [mapCenter, query, savedPlaces, searchSession]);

  const removePlace = useCallback((place: DraftPlace) => {
    LayoutAnimation.configureNext({
      duration: 260,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    });
    setRemovingPlace(place);
    const nextItems = items.filter((item) => item.id !== place.id);
    commitItems(nextItems);
    setFocused((current) => current?.id === place.id ? null : current);
    const persistedRowId = place.joinId
      ?? atlasPlaces.find((row) => row.atlas_id === atlasId && (row.place_id === place.id || row.external_place_id === place.id))?.id;
    if (persistedRowId) removePlaceFromAtlas(persistedRowId).catch((error) => console.warn('[AtlasBuilder] remove failed', error));
    setTimeout(() => setRemovingPlace((current) => current?.id === place.id ? null : current), 520);
  }, [atlasId, atlasPlaces, commitItems, items]);

  const movePlace = useCallback((from: number, delta: number) => {
    const to = Math.max(0, Math.min(items.length - 1, from + delta));
    if (from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    LayoutAnimation.configureNext({
      duration: 240,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
      delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
    });
    const persisted = next.filter((item) => item.joinId).map((item, index) => ({ id: item.joinId!, sort_order: index }));
    if (persisted.length) reorderAtlasPlaces(persisted).catch((error) => console.warn('[AtlasBuilder] reorder failed', error));
    commitItems(next);
  }, [commitItems, items]);

  const openTimePicker = useCallback((index: number) => {
    const existing = items[index];
    setPendingDay(undefinedDayLocked ? null : (existing?.timeline_day ?? 1));
    setPendingTime(existing?.timeline_time ?? '9am');
    setTimeModalIndex(index);
  }, [items, undefinedDayLocked]);

  const saveTimeDivider = useCallback(() => {
    if (timeModalIndex === null) return;
    const rank = pendingDay === null ? null : timeRank(pendingDay, pendingTime);
    const previous = items.slice(0, timeModalIndex).reverse().find((item) => item.timeline_time && (pendingDay === null ? item.timeline_day === null : item.timeline_day));
    const next = items.slice(timeModalIndex + 1).find((item) => item.timeline_time && (pendingDay === null ? item.timeline_day === null : item.timeline_day));
    if (pendingDay === null && previous?.timeline_time && timeOfDayRank(pendingTime) < timeOfDayRank(previous.timeline_time)) {
      showTimeConflict('Choose a time after the previous stop.');
      return;
    }
    if (pendingDay === null && next?.timeline_time && timeOfDayRank(pendingTime) > timeOfDayRank(next.timeline_time)) {
      showTimeConflict('Choose a time before the next stop.');
      return;
    }
    if (rank !== null && previous && rank < timeRank(previous.timeline_day!, previous.timeline_time!)) {
      showTimeConflict('Choose a time after the previous stop.');
      return;
    }
    if (rank !== null && next && rank > timeRank(next.timeline_day!, next.timeline_time!)) {
      showTimeConflict('Choose a time before the next stop.');
      return;
    }
    commitItems(items.map((item, index) => index === timeModalIndex ? { ...item, timeline_day: pendingDay, timeline_time: pendingTime } : item));
    const persisted = items[timeModalIndex];
    if (persisted?.joinId) updateAtlasPlace(persisted.joinId, { timeline_day: pendingDay, timeline_time: pendingTime }).catch(console.warn);
    setTimeModalIndex(null);
  }, [commitItems, items, pendingDay, pendingTime, showTimeConflict, timeModalIndex]);

  const saveTransport = useCallback((transport: TransportMode | null) => {
    if (transportModalIndex === null) return;
    const current = items[transportModalIndex];
    commitItems(items.map((item, index) => index === transportModalIndex ? { ...item, transport } : item));
    if (current?.joinId) {
      updateAtlasPlace(current.joinId, { note: encodeAtlasPlaceMetadata(current.note, transport) }).catch(console.warn);
    }
    setTransportModalIndex(null);
  }, [commitItems, items, transportModalIndex]);

  const generateRoute = useCallback(async () => {
    if (route) {
      setRoute(null);
      if (atlasId) updateAtlas(atlasId, { route_geojson: null, route_visible: false }).catch(console.warn);
      return;
    }
    if (items.length < 2) {
      showDialog({ title: 'Add two places first', message: 'A route needs at least two Atlas places.', tone: 'warning' });
      return;
    }
    if (items.some((item) => item.provisional)) {
      showDialog({ title: 'Verify AI locations first', message: 'Wait for AI map positions to be verified before creating a route.', tone: 'warning' });
      return;
    }
    setGeneratingRoute(true);
    try {
      const nextRoute = await requestAtlasRoute(items.map((item) => [item.longitude, item.latitude] as [number, number]));
      setRoute(nextRoute);
      if (atlasId) updateAtlas(atlasId, { route_geojson: nextRoute.route, route_visible: true }).catch(console.warn);
    } catch {
      showDialog({ title: 'Route unavailable', message: 'We could not generate a navigable route right now.', tone: 'warning' });
    } finally {
      setGeneratingRoute(false);
    }
  }, [atlasId, items, route, showDialog]);

  const renameAtlas = useCallback(() => {
    if (!atlasId || !existingAtlas) return;
    showDialog({
      title: 'Rename Atlas',
      message: 'Choose a title that makes this trip easy to find.',
      input: { placeholder: 'Atlas title', initialValue: atlasTitle || existingAtlas.title },
      actions: [
        { label: 'Cancel' },
        { label: 'Save', variant: 'primary', onPress: (name) => {
          const title = name.trim();
          if (!title) return;
          setAtlasTitle(title);
          void updateAtlas(atlasId, { title }).catch((error) => console.warn('[AtlasBuilder] could not rename Atlas:', error));
        } },
      ],
    });
  }, [atlasId, atlasTitle, existingAtlas, showDialog]);

  const closeEditor = useCallback(() => {
    // AtlasDetail synchronously restores the completed Atlas overview. Keep the
    // shared map alive during that handoff so Home never installs its GPS camera.
    preserveMapOnUnmountRef.current = Boolean(atlasId);
    onClose();
  }, [atlasId, onClose]);

  const persist = useCallback(async (askAI: boolean) => {
    if (!items.length) {
      showDialog({ title: 'Choose a place first', message: 'Select at least one point on the map.', tone: 'warning' });
      return;
    }
    if (items.some((item) => item.provisional)) {
      showDialog({ title: 'Location verification in progress', message: 'Wait for AI map positions to be verified before saving this Atlas.', tone: 'warning' });
      return;
    }
    const title = atlasId ? (atlasTitle.trim() || existingAtlas?.title || buildAtlasTitle(items)) : buildAtlasTitle(items);
    // Saving must never move the map. The completed Atlas receives this exact
    // editor presentation and keeps it until its close button is used.
    const savedMapView = {
      title,
      centerCoordinate: viewportCenterRef.current,
      zoomLevel: viewportZoomRef.current,
      markers: items.map((item, index) => ({
        id: item.id,
        title: item.name,
        description: item.subtitle,
        latitude: item.latitude,
        longitude: item.longitude,
        tone: 'atlas' as const,
        order: index + 1,
      })),
      routeGeoJSON: route?.route,
      places: items,
    };
    setSavingKind(askAI ? 'ai' : 'atlas');
    try {
      const atlas = atlasId ? existingAtlas : await createAtlas(title);
      if (!atlas) throw new Error('Atlas could not be created');
      // Hand the completed page its orange pins before cache/network writes.
      // Persistence is local-first, so the map transition never waits for a
      // round trip or for atlas_places subscribers to hydrate the detail.
      preserveMapOnUnmountRef.current = true;
      // The chat receives the exact editor snapshot, so it does not need to
      // wait for the remote Atlas writes below. Those writes have already
      // applied their optimistic local state and continue in the background.
      onSaved(atlas.id, askAI, savedMapView);
      const hasPendingRows = Boolean(atlasId) && items.some((item) => !item.joinId);
      if (atlasId && !hasPendingRows) {
        await updateAtlasPlaces(items.map((item, index) => ({ joinRowId: item.joinId!, patch: {
          ...atlasPlaceSnapshot(item),
          sort_order: index,
          note: encodeAtlasPlaceMetadata(item.note, item.transport),
          timeline_day: item.timeline_day ?? null,
          timeline_time: item.timeline_time ?? null,
        } })));
        await updateAtlas(atlas.id, { title, route_geojson: route?.route ?? null, route_visible: Boolean(route) });
        return;
      }
      const existingRows = atlasPlaces.filter((row) => row.atlas_id === atlas.id);
      const existingIds = new Set(existingRows.map((row) => row.place_id ?? row.external_place_id));
      const savedIds = new Set(savedPlaces.map((place) => place.id));
      const newSaved = items.filter((item) => savedIds.has(item.id) && !existingIds.has(item.id));
      const newOwned = items.filter((item) => !savedIds.has(item.id) && !existingIds.has(item.id));
      const [savedRows, ownedRows] = await Promise.all([
        addPlacesToAtlas(atlas.id, newSaved.map((item) => item.id), new Map(newSaved.map((item) => [item.id, atlasPlaceSnapshot(item)]))),
        addAtlasOwnedPlaces(atlas.id, newOwned.map((item) => ({ ...item, external_place_id: item.id }))),
      ]);
      const joins = new Map([...existingRows, ...savedRows, ...ownedRows].map((row) => [row.place_id ?? row.external_place_id, row]));
      await updateAtlasPlaces(items.flatMap((item, index) => {
        const join = item.joinId ? { id: item.joinId } : joins.get(item.id);
        return join ? [{ joinRowId: join.id, patch: {
          ...atlasPlaceSnapshot(item),
          sort_order: index,
          note: encodeAtlasPlaceMetadata(item.note, item.transport),
          timeline_day: item.timeline_day ?? null,
          timeline_time: item.timeline_time ?? null,
        } }] : [];
      }));
      await updateAtlas(atlas.id, { title, route_geojson: route?.route ?? null, route_visible: Boolean(route) });
    } catch (error) {
      console.warn('[AtlasBuilder] saving failed', error);
      showDialog({ title: 'Atlas was not saved', message: 'Please check your connection and try again.', tone: 'warning' });
    } finally {
      setSavingKind(null);
    }
  }, [atlasId, atlasPlaces, atlasTitle, existingAtlas, items, mapCenter, mapZoom, onSaved, route, savedPlaces, showDialog]);

  const mapMarkers = useMemo<MapMarker[]>(() => {
    const selected = new Set(items.map((item) => item.id));
    const focusedAtlasItem = focused ? items.find((item) => item.id === focused.id) : undefined;
    const saved = savedPlaces
      .filter((place) => !focused || !isMarkerOverlap(place, focused))
      .map((place) => ({
      id: place.id,
      latitude: place.latitude,
      longitude: place.longitude,
      title: place.name,
      description: place.subtitle,
      tone: 'saved' as const,
    }));
    const recommended = recommendedPlaces
      .filter((place) => place.source === 'recommended'
        && !selected.has(place.id)
        && !savedPlaces.some((savedPlace) => isMarkerOverlap(savedPlace, place))
        && (!focused || !isMarkerOverlap(place, focused)))
      .map((place) => ({ id: place.id, latitude: place.latitude, longitude: place.longitude, title: place.name, description: place.subtitle, labelHint: place.aiDescription ?? undefined, ai: true, tone: 'recommended' as const }));
    const atlasItems = [...items, ...(removingPlace && !items.some((item) => item.id === removingPlace.id) ? [removingPlace] : [])]
      .map((item, index) => ({
        id: item.id,
        latitude: item.latitude,
        longitude: item.longitude,
        title: item.name,
        description: item.subtitle,
        tone: focused?.id === item.id ? 'focused' as const : 'atlas' as const,
        order: items.findIndex((entry) => entry.id === item.id) + 1,
        entering: enteringPlaceIds.has(item.id),
        pulsing: savingKind !== null,
      }));
    const focusedMarker = focused && !focusedAtlasItem
      ? [{ id: focused.id, latitude: focused.latitude, longitude: focused.longitude, title: focused.name, description: focused.subtitle, labelHint: focused.aiDescription ?? undefined, ai: focused.source === 'recommended', tone: 'focused' as const }]
      : [];
    const byId = new Map<string, MapMarker>();
    saved.forEach((marker) => byId.set(marker.id, marker));
    recommended.forEach((marker) => { if (!byId.has(marker.id)) byId.set(marker.id, marker); });
    atlasItems.forEach((marker) => byId.set(marker.id, marker));
    focusedMarker.forEach((marker) => byId.set(marker.id, marker));
    return savingKind ? [...byId.values()].map((marker) => ({ ...marker, title: undefined, labelHint: undefined })) : [...byId.values()];
  }, [enteringPlaceIds, focused, items, recommendedPlaces, removingPlace, savedPlaces, savingKind]);

  const mapSearchOverlay = useMemo(() => <Animated.View pointerEvents="box-none" style={[styles.mapSearchLayer, { opacity: searchAppear, transform: [{ translateX: searchAppear.interpolate({ inputRange: [0, 1], outputRange: [-34, 0] }) }, { scaleX: searchAppear.interpolate({ inputRange: [0, 1], outputRange: [0.18, 1] }) }] }]}>
    <View pointerEvents="auto" style={styles.mapSearchBox}>
      <Ionicons name={focusSearchActive ? 'locate-outline' : 'search'} size={18} color={focusSearchActive ? '#0F766E' : '#6B7280'} />
      <TextInput ref={inputRef} value={query} onChangeText={handleQueryChange} placeholder={focusSearchActive ? 'Search an area' : 'Search places'} placeholderTextColor="#8E8E93" style={styles.searchInput} returnKeyType="search" onSubmitEditing={focusSearchActive ? openFullSearch : undefined} />
      {searching ? <ActivityIndicator size="small" color="#2563EB" /> : focusSearchActive ? <TouchableOpacity accessibilityLabel="Focus search area" onPress={openFullSearch} style={styles.searchSubmit}><Ionicons name="arrow-forward" size={17} color="#2563EB" /></TouchableOpacity> : null}
      {focusSearchActive ? <TouchableOpacity accessibilityLabel="Close focus search" onPress={closeFocusSearch} style={styles.searchClose}><Ionicons name="close" size={16} color="#64748B" /></TouchableOpacity> : null}
    </View>
    {localMustSeesVisible ? <Animated.View style={[styles.localMustSeesNote, { opacity: localMustSeesOpacity }]}><View style={styles.localMustSeesDot} /><Text style={styles.localMustSeesText}>Local must-sees, handpicked by OurAtlas.</Text><TouchableOpacity accessibilityLabel="Dismiss local must-sees note" onPress={hideLocalMustSees} style={styles.localMustSeesClose}><Ionicons name="close" size={13} color="#5E6070" /></TouchableOpacity></Animated.View> : null}
    {nearbyPromptVisible ? <Animated.View style={{ opacity: nearbyPromptOpacity }}><View style={styles.nearbyPrompt}><TouchableOpacity accessibilityLabel="More nearby must-sees" disabled={nearbyRecommending} onPress={() => { void recommendNearby(); }} style={styles.nearbyPromptMain}><Ionicons name="sparkles" size={13} color="#6446B4" />{nearbyRecommending ? <><ActivityIndicator size="small" color="#6446B4" /><Text style={styles.nearbyPromptText}>Finding nearby must-sees...</Text></> : <Text style={styles.nearbyPromptText}>More nearby must-sees</Text>}</TouchableOpacity></View></Animated.View> : null}
    {results.length > 0 ? <View pointerEvents="auto" style={styles.results}><ScrollView nestedScrollEnabled showsVerticalScrollIndicator style={styles.searchResultsScroll}>{results.map((result) => {
      const key = result.kind === 'saved' ? result.place.id : result.externalId;
      const createSearchAction = isCreateAtlasLanding && !focusSearchActive;
      const resultContent = <><View style={styles.resultTitleRow}><Text numberOfLines={1} style={styles.resultName}>{result.kind === 'saved' ? result.place.name : result.name}</Text>{result.kind === 'saved' ? <View style={styles.savedTag}><Text style={styles.savedTagText}>Saved</Text></View> : null}</View><Text numberOfLines={1} style={styles.resultAddress}>{result.kind === 'saved' ? result.place.subtitle : result.subtitle}</Text></>;
      const copy = createSearchAction ? <View style={styles.resultCopy}>{resultContent}</View> : <TouchableOpacity style={styles.resultCopy} onPress={() => focusSearchActive ? focusAreaResult(result) : handleResultFocus(result)}>{resultContent}</TouchableOpacity>;
      return <View key={key} style={[styles.resultRow, styles.searchResultRow]}>{copy}<TouchableOpacity accessibilityLabel={focusSearchActive ? 'Focus this area' : createSearchAction ? 'Open this place in Atlas' : 'Add to Atlas'} disabled={!focusSearchActive && addingResult === key} onPress={() => focusSearchActive ? focusAreaResult(result) : createSearchAction ? beginAtlasFromSearchResult(result) : handleResultAdd(result)} style={[focusSearchActive ? styles.focusResultButton : styles.addResultButton, !focusSearchActive && addingResult === key && styles.addResultButtonPending]}>{!focusSearchActive && addingResult === key ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name={focusSearchActive ? 'locate-outline' : createSearchAction ? 'arrow-forward' : 'add'} size={18} color="#FFF" />}</TouchableOpacity></View>;
    })}</ScrollView></View> : null}
  </Animated.View>, [addingResult, beginAtlasFromSearchResult, closeFocusSearch, focusAreaResult, focusSearchActive, handleQueryChange, handleResultAdd, handleResultFocus, hideLocalMustSees, isCreateAtlasLanding, localMustSeesOpacity, localMustSeesVisible, nearbyPromptOpacity, nearbyPromptVisible, nearbyRecommending, openFullSearch, query, recommendNearby, recommendedPlaces.length, results, searchAppear, searching]);

  const atlasMapOverlay = useMemo(() => (
    !savingKind ? mapSearchOverlay : null
  ), [mapSearchOverlay, savingKind]);

  useLayoutEffect(() => {
    setAtlasMapState({
      markers: mapMarkers,
      cameraVerticalOffset: 0,
      cameraScreenOffsetY: atlasId ? EDIT_ATLAS_CAMERA_SCREEN_OFFSET_Y : 0,
      centerCoordinate: mapCenter,
      zoomLevel: mapZoom,
      // Edit mode, selected Create-search areas, and the location-aware blank
      // Create screen own an explicit bounds camera.
      bounds: atlasId || started || isCreateAtlasLanding ? mapBounds : undefined,
      cameraKey,
      cameraAnimationDurationMs: atlasId ? 0 : undefined,
      selectedMarkerId: focused?.id ?? null,
      routeGeoJSON: route?.route,
      deletingMarkerId: removingPlace?.id,
      onMarkerPress: (marker) => {
        const atlasItem = items.find((item) => item.id === marker.id);
        const recommended = recommendedPlaces.find((item) => item.id === marker.id);
        if (atlasItem) focus(atlasItem);
        else if (recommended) focus(recommended);
        else {
          const saved = savedPlaces.find((item) => item.id === marker.id);
          if (saved) focus(toDraft(saved));
        }
      },
      onMapPress: hideTransientUI,
      onViewportChanged: (center, zoom) => {
        viewportCenterRef.current = center;
        viewportZoomRef.current = zoom;
        scheduleNearbyPrompt(center);
      },
      overlay: atlasMapOverlay,
      hideTopSearchButton: true,
      markerPopup: null,
    });
  }, [atlasId, atlasMapOverlay, atlasPlaces, cameraKey, focus, focused, hideTransientUI, isCreateAtlasLanding, mapBounds, mapCenter, mapMarkers, mapZoom, recommendedPlaces, removingPlace?.id, route?.route, savedPlaces, scheduleNearbyPrompt, setAtlasMapState]);

  useEffect(() => () => {
    if (!preserveMapOnUnmountRef.current) setAtlasMapState(null);
  }, [setAtlasMapState]);

  const timeTags = useMemo(() => items.filter((item) => item.timeline_day && item.timeline_time)
    .map((item) => ({ id: item.id, label: `Day ${item.timeline_day} · ${item.timeline_time}`, item })), [items]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[styles.heading, styles.atlasHeadingSafe]}>{atlasId || started || handoffStarted ? 'Edit atlas' : 'Create an atlas'}</Text>
          
          {items.length === 0 && !started && !handoffStarted && !atlasId ? <Text style={styles.landingLabel}>Pick a place to explore</Text> : null}
        </View>
        <View style={styles.headerRight}>
          {atlasId ? <TouchableOpacity accessibilityLabel={`Rename ${atlasTitle || existingAtlas?.title || 'Atlas'}`} onPress={renameAtlas} style={styles.focusAreaButton}><Text numberOfLines={1} style={styles.focusAreaButtonText}>{atlasTitle || existingAtlas?.title || 'Atlas'}</Text><Ionicons name="pencil-outline" size={15} color="#6A6A70" /></TouchableOpacity> : (started && focusLabel ? <TouchableOpacity accessibilityLabel={`Change focus area, currently ${focusLabel}`} onPress={onReturnToCreateSearch ? returnToCreateSearch : openFocusSearch} style={styles.focusAreaButton}><Ionicons name="location-sharp" size={23} color="#303033" /><Text numberOfLines={1} style={styles.focusAreaButtonText}>{focusLabel}</Text></TouchableOpacity> : null)}
          <TouchableOpacity accessibilityLabel="Close Atlas editor" onPress={closeEditor} style={styles.headerIcon}><Ionicons name="close" size={19} color="#26262A" /></TouchableOpacity>
        </View>
      </View>

      {atlasId || started || handoffStarted ? <AtlasCandidateCard place={focused} added={Boolean(focused && items.some((item) => item.id === focused.id))} onAdd={() => { if (focused) addPlace(focused); }} /> : null}

      {!atlasId && items.length === 0 && !started && !handoffStarted ? <View style={styles.createLanding}>
        <View style={styles.simpleStartHero}><TouchableOpacity onPress={simpleStart} style={styles.simpleStartHeroButton}><View style={styles.simpleStartHeroTop}><View style={styles.simpleStartHeroIcon}><Ionicons name="map-outline" size={26} color="#0F766E" /></View><Ionicons name="arrow-forward" size={21} color="#0F766E" /></View><View style={styles.simpleStartHeroCopy}><Text style={styles.simpleStartHeroTitle}>Simple Start</Text><Text style={styles.simpleStartHeroSubtitle}>Build an atlas from scratch</Text></View></TouchableOpacity></View>
        <View style={styles.planListSection}><FocusAreas areas={focusAreas} onFocus={focusArea} /></View>
      </View> : items.length === 0 ? <AtlasEmptySkeleton /> : <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {items.map((item, index) => <Reanimated.View key={item.id} entering={FadeInDown.duration(340)} exiting={FadeOutUp.duration(260)} layout={Layout.duration(260)}>
          <View style={styles.itemActionsRow}>
            {!item.timeline_time ? <TimeInsert onPress={() => openTimePicker(index)} /> : <TouchableOpacity accessibilityLabel="Edit scheduled time" onPress={() => openTimePicker(index)} style={styles.timeTagInline}><Text style={styles.timeTagText}>{item.timeline_day ? `Day ${item.timeline_day} · ${item.timeline_time}` : item.timeline_time}</Text></TouchableOpacity>}
            <TransportInsert mode={item.transport ?? null} onPress={() => setTransportModalIndex(index)} />
          </View>
          <AtlasItem item={item} index={index} onFocus={() => focus(item)} onRemove={() => removePlace(item)} onMove={movePlace} onNote={(note) => { commitItems(items.map((entry) => entry.id === item.id ? { ...entry, note } : entry)); if (item.joinId) updateAtlasPlace(item.joinId, { note: encodeAtlasPlaceMetadata(note, item.transport) }).catch(console.warn); }} />
        </Reanimated.View>)}
      </ScrollView>}

      {items.length > 0 ? <View style={styles.footer}><TouchableOpacity disabled={savingKind !== null} onPress={() => persist(false)} style={styles.secondarySave}>{savingKind === 'atlas' ? <ActivityIndicator color="#1F3938" /> : <><Ionicons name="bookmark-outline" size={16} color="#1F3938" /><Text style={styles.secondarySaveText}>Save</Text></>}</TouchableOpacity><TouchableOpacity disabled={savingKind !== null} onPress={() => persist(true)} style={styles.primarySave}>{savingKind === 'ai' ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="sparkles" size={16} color="#FFF" /><Text style={styles.primarySaveText}>Save and Ask AI</Text></>}</TouchableOpacity></View> : null}
      <TimePickerModal visible={timeModalIndex !== null} day={pendingDay} time={pendingTime} dayLocked={undefinedDayLocked} hasExisting={timeModalIndex !== null && Boolean(items[timeModalIndex]?.timeline_time)} validationMessage={timeConflictMessage} onChangeDay={setPendingDay} onChangeTime={setPendingTime} onClose={() => { setTimeConflictMessage(null); setTimeModalIndex(null); }} onRemove={() => { if (timeModalIndex === null) return; const existing = items[timeModalIndex]; commitItems(items.map((entry, index) => index === timeModalIndex ? { ...entry, timeline_day: null, timeline_time: null } : entry)); if (existing?.joinId) updateAtlasPlace(existing.joinId, { timeline_day: null, timeline_time: null }).catch(console.warn); setTimeModalIndex(null); }} onSave={saveTimeDivider} />
      <TransportPickerModal visible={transportModalIndex !== null} selected={transportModalIndex === null ? null : items[transportModalIndex]?.transport ?? null} onSelect={saveTransport} onRemove={() => saveTransport(null)} onClose={() => setTransportModalIndex(null)} />
      <Modal visible={fullResults !== null} animationType="slide" onRequestClose={() => focusSearchActive ? closeFocusSearch() : setFullResults(null)}><View style={styles.fullSearch}><View style={styles.fullSearchHeader}><TouchableOpacity onPress={() => focusSearchActive ? closeFocusSearch() : setFullResults(null)} style={styles.headerIcon}><Ionicons name={focusSearchActive ? 'close' : 'chevron-back'} size={20} color="#26262A" /></TouchableOpacity><Text style={styles.fullSearchTitle}>{focusSearchActive ? 'Choose an area' : 'Search results'}</Text><View style={styles.headerIcon} /></View><ScrollView contentContainerStyle={styles.fullResults}>{fullResults?.map((result) => { const key = result.kind === 'saved' ? result.place.id : result.externalId; return <View key={key} style={styles.fullResultRow}><TouchableOpacity style={styles.resultCopy} onPress={() => { setFullResults(null); focusSearchActive ? focusAreaResult(result) : handleResultFocus(result); }}><Text style={styles.resultName}>{result.kind === 'saved' ? result.place.name : result.name}</Text><Text style={styles.resultAddress}>{result.kind === 'saved' ? result.place.subtitle : result.subtitle}</Text></TouchableOpacity><TouchableOpacity disabled={!focusSearchActive && addingResult === key} onPress={() => { setFullResults(null); focusSearchActive ? focusAreaResult(result) : handleResultAdd(result); }} style={focusSearchActive ? styles.focusResultButton : styles.addResultButton}>{!focusSearchActive && addingResult === key ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name={focusSearchActive ? 'locate-outline' : 'add'} size={18} color="#FFF" />}</TouchableOpacity></View>; })}</ScrollView></View></Modal>
    </View>
  );
}

function FocusAreas({ areas, onFocus, disabled, autoScroll = true }: { areas: FocusArea[]; onFocus: (area: FocusArea) => void; disabled?: boolean; autoScroll?: boolean }) {
  const scrollRef = useRef<ScrollView>(null);
  const stoppedRef = useRef(false);
  const offsetRef = useRef(0);
  const contentHeightRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const loopAreas = areas.length > 1 ? [...areas, ...areas] : areas;
  const stopAutoScroll = useCallback(() => {
    stoppedRef.current = true;
  }, []);

  useEffect(() => {
    stoppedRef.current = false;
    offsetRef.current = 0;
    if (!autoScroll) {
      stoppedRef.current = true;
      return;
    }
    const timer = setInterval(() => {
      if (stoppedRef.current) return;
      const cycleHeight = areas.length > 1 ? contentHeightRef.current / 2 : contentHeightRef.current - viewportHeightRef.current;
      if (cycleHeight <= 8) return;
      const nextOffset = offsetRef.current + 0.72;
      offsetRef.current = nextOffset >= cycleHeight ? 0 : nextOffset;
      scrollRef.current?.scrollTo({ y: offsetRef.current, animated: false });
    }, 70);
    return () => clearInterval(timer);
  }, [areas.length, autoScroll]);

  return <ScrollView
    ref={scrollRef}
    style={styles.focusList}
    contentContainerStyle={styles.focusListContent}
    showsVerticalScrollIndicator={false}
    nestedScrollEnabled
    onLayout={(event) => { viewportHeightRef.current = event.nativeEvent.layout.height; }}
    onContentSizeChange={(_, height) => { contentHeightRef.current = height; }}
    onTouchStart={stopAutoScroll}
    onScrollBeginDrag={stopAutoScroll}
  >
    {loopAreas.map((area, index) => <TouchableOpacity disabled={disabled} key={`${area.label}-${index}`} onPress={() => { stopAutoScroll(); onFocus(area); }} style={styles.focusRow}><View style={styles.focusImageWrap}>{area.photoUrl ? <Image source={{ uri: area.photoUrl }} style={styles.focusImage} /> : <View style={styles.focusImageFallback}><Ionicons name="image-outline" size={17} color="#4F6B68" /></View>}</View><View style={styles.focusRowCopy}><Text numberOfLines={1} style={styles.focusText}>Plan {area.label}</Text><Text numberOfLines={1} style={styles.focusMeta}>{area.count} saved place{area.count === 1 ? '' : 's'}</Text></View><Ionicons name="arrow-forward" size={17} color="#6B807E" /></TouchableOpacity>)}
  </ScrollView>;
}

function AtlasEmptySkeleton() {
  const pulse = useRef(new Animated.Value(0.58)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.8, duration: 1800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.58, duration: 1800, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return <Animated.View style={[styles.emptyAtlas, { opacity: pulse }]}>
    <View style={styles.emptyAtlasIntro}>
      <View style={styles.emptyAtlasKicker} />
      <View style={styles.emptyAtlasTitle} />
    </View>
    {[0, 1, 2].map((index) => <View key={index} style={styles.emptyAtlasGroup}>
      <View style={styles.emptyAtlasActions}>
        <View style={styles.emptyAtlasAction} />
        <View style={[styles.emptyAtlasAction, styles.emptyAtlasActionShort]} />
      </View>
      <View style={styles.emptyAtlasRow}>
        <View style={styles.emptyAtlasOrder} />
        <View style={styles.emptyAtlasImage} />
        <View style={styles.emptyAtlasCopy}>
          {index === 0 ? <>
            <TypewriterHint />
            <Text style={styles.emptyAtlasHintSub}>Tap a pin or search, then add it here.</Text>
          </> : <>
            <View style={styles.emptyAtlasLine} />
            <View style={[styles.emptyAtlasLine, styles.emptyAtlasLineShort]} />
          </>}
        </View>
        <View style={styles.emptyAtlasHandle} />
      </View>
      {index < 2 ? <View style={styles.emptyAtlasConnector} /> : null}
    </View>)}
  </Animated.View>;
}

function TypewriterHint() {
  const characters = 'Now, add your first pin.'.split('');
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(withTiming(characters.length + 0.5, { duration: 2500 }), -1, false);
  }, [characters.length, progress]);
  return <View style={styles.typewriterLine}>{characters.map((character, index) => <TypewriterCharacter key={`${character}-${index}`} character={character} index={index} progress={progress} />)}</View>;
}

function TypewriterCharacter({ character, index, progress }: { character: string; index: number; progress: { value: number } }) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [index - 0.25, index + 0.55], [0, 1], Extrapolation.CLAMP),
  }));
  return <Reanimated.View style={animatedStyle}><Text style={styles.emptyAtlasHint}>{character}</Text></Reanimated.View>;
}

function AtlasCandidateCard({ place, added, onAdd }: { place: DraftPlace | null; added: boolean; onAdd: () => void }) {
  const unavailable = Boolean(place?.provisional);
  return <View style={styles.candidateSlot}>
    <View style={[styles.candidateCard, !place && styles.candidateCardEmpty]}>
      {place ? <>
        <View style={styles.candidateMarker}><Ionicons name="location" size={16} color="#FFFFFF" /></View>
        <View style={styles.candidateCopy}>
          <Text numberOfLines={1} style={styles.candidateName}>{place.name}</Text>
          <Text numberOfLines={1} style={styles.candidateAddress}>{unavailable ? 'Verifying map position...' : place.subtitle || 'Selected location'}</Text>
        </View>
        {added ? <View style={styles.candidateAdded}><Ionicons name="checkmark" size={13} color="#167A58" /><Text style={styles.candidateAddedText}>Added</Text></View> : unavailable ? <View style={styles.candidateVerifying}><ActivityIndicator size="small" color="#6D4CC4" /></View> : <TouchableOpacity accessibilityLabel={`Add ${place.name} to Atlas`} onPress={onAdd} style={styles.candidateAdd}><Ionicons name="add" size={21} color="#FFFFFF" /></TouchableOpacity>}
      </> : <>
        <View style={styles.candidateMarkerEmpty}><Ionicons name="location-outline" size={16} color="#8A9695" /></View>
        <View style={styles.candidateCopy}><Text style={styles.candidateEmptyTitle}>Choose a place on the map</Text><Text style={styles.candidateEmptySubtitle}>Its details will appear here</Text></View>
      </>}
    </View>
  </View>;
}

function TimeInsert({ onPress }: { onPress: () => void }) {
  return <TouchableOpacity accessibilityLabel="Add a time divider" onPress={onPress} style={styles.transportInsertButton}><Ionicons name="time-outline" size={13} color="#64748B" /><Text style={styles.dividerAddText}>Add time</Text></TouchableOpacity>;
}

function TransportInsert({ mode, onPress }: { mode: TransportMode | null; onPress: () => void }) {
  const option = TRANSPORT_OPTIONS.find((entry) => entry.mode === mode);
  return <TouchableOpacity accessibilityLabel="Add transport" onPress={onPress} style={[styles.transportInsertButton, option && styles.transportInsertButtonSelected]}>
    <Ionicons name={option?.icon ?? 'swap-horizontal-outline'} size={13} color={option ? '#167A58' : '#64748B'} />
    {!option ? <Text style={styles.dividerAddText}>Add transport</Text> : null}
  </TouchableOpacity>;
}

function TransportPickerModal({ visible, selected, onSelect, onRemove, onClose }: { visible: boolean; selected: TransportMode | null; onSelect: (mode: TransportMode) => void; onRemove: () => void; onClose: () => void }) {
  return <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
    <Pressable onPress={onClose} style={styles.modalBackdrop}>
      <Pressable onPress={(event) => event.stopPropagation()} style={styles.modalSheet}>
        <View style={styles.modalHeader}><TouchableOpacity onPress={onClose}><Text style={styles.modalCancel}>Cancel</Text></TouchableOpacity><Text style={styles.modalTitle}>Add transport</Text><View style={{ width: 48 }} /></View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.transportOptions}>
          {TRANSPORT_OPTIONS.map((option) => <TouchableOpacity key={option.mode} onPress={() => onSelect(option.mode)} style={[styles.transportOption, selected === option.mode && styles.transportOptionSelected]}><Ionicons name={option.icon} size={21} color={selected === option.mode ? '#0F766E' : '#64748B'} /><Text style={[styles.transportOptionText, selected === option.mode && styles.transportOptionTextSelected]}>{option.label}</Text></TouchableOpacity>)}
        </ScrollView>
        {selected ? <TouchableOpacity onPress={onRemove} style={styles.modalRemoveButton}><Text style={styles.modalRemoveText}>Remove transport</Text></TouchableOpacity> : null}
      </Pressable>
    </Pressable>
  </Modal>;
}

/** Fixed at the right edge behind the row — doesn't translate with the
    swipe. Scale and fade track swipe progress directly, matching
    PlaceCard.tsx's DeleteAction. */
function AtlasItemDeleteAction({ progress, onDelete }: { progress: SharedValue<number>; onDelete: () => void }) {
  const style = useAnimatedStyle(() => {
    const amount = Math.min(progress.value, 1);
    return { opacity: amount, transform: [{ scale: amount }] };
  });
  return (
    <Reanimated.View style={[styles.deleteReveal, style]}>
      <TouchableOpacity accessibilityLabel="Delete place" onPress={onDelete} style={styles.deleteRevealHit}>
        <Ionicons name="trash-outline" size={17} color="#FFF" />
      </TouchableOpacity>
    </Reanimated.View>
  );
}

function AtlasItem({ item, index, onFocus, onRemove, onMove, onNote }: { item: DraftPlace; index: number; onFocus: () => void; onRemove: () => void; onMove: (index: number, delta: number) => void; onNote: (note: string) => void }) {
  const { show: showDialog } = useAppDialog();
  const reorderGesture = useMemo(() => Gesture.Pan().activateAfterLongPress(180).runOnJS(true).onEnd((event) => {
    if (event.translationY > 28) onMove(index, 1);
    if (event.translationY < -28) onMove(index, -1);
  }), [index, onMove]);
  return <View style={styles.swipeShell}>
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={29}
      overshootRight
      overshootFriction={2}
      animationOptions={{ mass: 1, damping: 14, stiffness: 90, overshootClamping: false }}
      renderRightActions={(progress) => <AtlasItemDeleteAction progress={progress} onDelete={onRemove} />}
    >
      <View style={styles.item}>
        <View style={styles.orderBadge}><Text style={styles.orderBadgeText}>{index + 1}</Text></View>
        {item.photo_url ? <Image source={{ uri: item.photo_url }} style={styles.itemImage as import('react-native').ImageStyle} /> : <View style={[styles.itemImage, styles.imageFallback]}><Text style={styles.imageInitial}>{item.name.slice(0, 1).toUpperCase()}</Text></View>}
        <TouchableOpacity onPress={onFocus} style={styles.itemCopy}><Text numberOfLines={1} style={styles.itemName}>{item.name}</Text><Text numberOfLines={1} style={styles.itemAddress}>{item.subtitle}</Text>{item.note ? <Text numberOfLines={2} style={styles.itemNoteModern}>{item.note}</Text> : null}</TouchableOpacity>
        <VoiceInputButton icon={NotePencilIcon} showVoiceBadge style={styles.noteButton} onShortPress={() => showDialog({ title: 'Note', input: { placeholder: 'Add a note', initialValue: item.note ?? '', hint: 'Tip: press and hold the voice button to add it by voice.' }, actions: [{ label: 'Cancel' }, { label: 'Save', variant: 'primary', onPress: onNote }] })} onTranscript={(text) => onNote(item.note ? `${item.note} ${text}` : text)} />
        <GestureDetector gesture={reorderGesture}><View style={styles.dragHandle}><Ionicons name="reorder-three-outline" size={23} color="#66737C" /></View></GestureDetector>
      </View>
    </ReanimatedSwipeable>
  </View>;
}

function TimePickerModal({ visible, day, time, dayLocked, hasExisting, validationMessage, onChangeDay, onChangeTime, onClose, onRemove, onSave }: { visible: boolean; day: number | null; time: string; dayLocked: boolean; hasExisting: boolean; validationMessage?: string | null; onChangeDay: (day: number | null) => void; onChangeTime: (time: string) => void; onClose: () => void; onRemove: () => void; onSave: () => void }) {
  const dayOptions: Array<number | null> = [null, ...Array.from({ length: 14 }, (_, index) => index + 1)];
  return <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}><Pressable onPress={onClose} style={styles.modalBackdrop}><Pressable onPress={(event) => event.stopPropagation()} style={styles.modalSheet}><View style={styles.modalHeader}><TouchableOpacity onPress={onClose}><Text style={styles.modalCancel}>Cancel</Text></TouchableOpacity><View><Text style={styles.modalTitle}>Schedule time</Text><Text style={styles.modalSubtitle}>Place it in your itinerary</Text></View><TouchableOpacity onPress={onSave}><Text style={styles.modalSave}>Done</Text></TouchableOpacity></View>{validationMessage ? <View pointerEvents="none" style={styles.timeConflictToast}><Ionicons name="alert-circle-outline" size={16} color="#A15C00" /><Text numberOfLines={2} style={styles.timeConflictText}>{validationMessage}</Text></View> : null}<View style={styles.wheels}><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.wheelContent}>{dayOptions.map((value) => <TouchableOpacity disabled={dayLocked && value !== null} key={value ?? 'flexible-day'} onPress={() => onChangeDay(value)} style={[styles.wheelOption, day === value && styles.wheelOptionSelected, dayLocked && value !== null && styles.wheelOptionLocked]}><Text style={[styles.wheelText, day === value && styles.wheelTextSelected, dayLocked && value !== null && styles.wheelTextLocked]}>{value === null ? 'Flexible day' : `Day ${value}`}</Text></TouchableOpacity>)}</ScrollView><View style={styles.wheelDivider} /><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.wheelContent}>{PLANNING_HOURS.map((value) => <TouchableOpacity key={value} onPress={() => onChangeTime(value)} style={[styles.wheelOption, time === value && styles.wheelOptionSelected]}><Text style={[styles.wheelText, time === value && styles.wheelTextSelected]}>{value}</Text></TouchableOpacity>)}</ScrollView></View>{dayLocked ? <Text style={styles.noDayNote}>To assign a day, change a Flexible day time tag to a numbered day.</Text> : null}{hasExisting ? <TouchableOpacity onPress={onRemove} style={styles.modalRemoveButton}><Text style={styles.modalRemoveText}>Remove time</Text></TouchableOpacity> : null}</Pressable></Pressable></Modal>;
}

const styles = StyleSheet.create({
  searchResultRow: { minHeight: 62 },
  searchResultsScroll: { maxHeight: 186 },
  // Atlas landing page: a quieter, editorial hierarchy that keeps the list
  // dense enough to browse without turning it into a stack of blue controls.
  eyebrow: { color: '#0F766E', fontSize: 10, fontWeight: '800', letterSpacing: 1.1, marginBottom: 3 },
  planningBar: { marginHorizontal: 16, marginBottom: 4, padding: 12, borderRadius: 16, backgroundColor: '#F1F7F6', flexDirection: 'row', alignItems: 'center', gap: 10 },
  planningBarDisabled: { opacity: 0.55 },
  planningIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#D7ECE8', alignItems: 'center', justifyContent: 'center' },
  planningCopy: { flex: 1, minWidth: 0 },
  planningTitle: { color: '#173D3A', fontSize: 13, fontWeight: '700' },
  planningSubtitle: { color: '#62817E', fontSize: 11, lineHeight: 15, marginTop: 2 },
  sectionLabel: { color: '#0F766E', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  focusIntro: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 10 },
  focusHeading: { color: '#193432', fontSize: 18, fontWeight: '700', marginTop: 3 },
  focusCount: { color: '#6B807E', fontSize: 12, fontWeight: '600', marginBottom: 2 },
  focusMeta: { color: '#71827F', fontSize: 11, marginTop: 3 },
  focusRowCopy: { flex: 1, minWidth: 0 },
  focusImageWrap: { width: 48, height: 48, borderRadius: 12, overflow: 'hidden', backgroundColor: '#DFEBE8' },
  focusImage: { width: '100%', height: '100%' },
  focusImageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  simpleStartRow: { minHeight: 68, padding: 9, borderRadius: 14, backgroundColor: '#F4F0FF', borderWidth: 1, borderColor: '#E1D7FF', flexDirection: 'row', alignItems: 'center', gap: 10 },
  simpleStartButton: { minHeight: 68, marginTop: 12, padding: 9, borderRadius: 14, backgroundColor: '#F4F0FF', borderWidth: 1, borderColor: '#E1D7FF', flexDirection: 'row', alignItems: 'center', gap: 10 },
  createLanding: { flex: 1, paddingHorizontal: 16, paddingBottom: 10 },
  simpleStartHero: { flex: 0.4, justifyContent: 'center' },
  simpleStartHeroButton: { width: '88%', minHeight: 132, alignSelf: 'center', padding: 16, borderRadius: 24, backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: '#DCE7E4', justifyContent: 'space-between', shadowColor: '#0F766E', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  simpleStartHeroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  simpleStartHeroIcon: { width: 54, height: 54, borderRadius: 17, backgroundColor: '#E8F9EF', alignItems: 'center', justifyContent: 'center' },
  simpleStartHeroCopy: { minWidth: 0 },
  simpleStartHeroTitle: { color: '#183431', fontSize: 19, fontWeight: '800' },
  simpleStartHeroSubtitle: { color: '#6B807E', fontSize: 12, lineHeight: 17, marginTop: 4 },
  planListSection: { flex: 0.6, minHeight: 0 },
  simpleStartIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#885CF6', alignItems: 'center', justifyContent: 'center', shadowColor: '#885CF6', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  simpleStartTitle: { color: '#5137A1', fontSize: 14, fontWeight: '800' },
  headerRight: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '52%' },
  focusAreaButton: { flexShrink: 1, maxWidth: 150, minHeight: 36, paddingHorizontal: 8, borderRadius: 10, backgroundColor: '#F4F4F5', flexDirection: 'row', alignItems: 'center', gap: 7 },
  focusAreaButtonText: { color: '#303033', fontSize: 16, fontWeight: '500', flexShrink: 1 },
  emptyAtlas: { flex: 1, paddingHorizontal: 15, paddingTop: 14, paddingBottom: 14, backgroundColor: '#FFFFFF' },
  emptyAtlasIntro: { paddingHorizontal: 4, paddingBottom: 15, gap: 8 },
  emptyAtlasKicker: { width: 76, height: 8, borderRadius: 4, backgroundColor: '#D9E1E4' },
  emptyAtlasTitle: { width: '58%', height: 15, borderRadius: 7, backgroundColor: '#CBD5D9' },
  emptyAtlasGroup: { marginBottom: 8 },
  emptyAtlasActions: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 4 },
  emptyAtlasAction: { width: 74, height: 20, borderRadius: 10, backgroundColor: '#E2E8EB' },
  emptyAtlasActionShort: { width: 92 },
  emptyAtlasRow: { minHeight: 74, padding: 10, borderRadius: 14, backgroundColor: '#F4F6F7', flexDirection: 'row', alignItems: 'center', gap: 10 },
  emptyAtlasOrder: { width: 27, height: 27, borderRadius: 14, backgroundColor: '#D7DEE1' },
  emptyAtlasImage: { width: 52, height: 52, borderRadius: 12, backgroundColor: '#DCE3E6' },
  emptyAtlasCopy: { flex: 1, gap: 9 },
  typewriterLine: { flexDirection: 'row', minHeight: 18 },
  emptyAtlasHint: { color: '#64727A', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  emptyAtlasHintSub: { color: '#98A4AA', fontSize: 10, lineHeight: 14, minHeight: 14 },
  emptyAtlasLine: { width: '78%', height: 11, borderRadius: 6, backgroundColor: '#D3DBDE' },
  emptyAtlasLineShort: { width: '48%', height: 9, backgroundColor: '#DEE4E7' },
  emptyAtlasHandle: { width: 25, height: 34, borderRadius: 8, backgroundColor: '#E0E6E8' },
  emptyAtlasConnector: { width: 2, height: 16, borderRadius: 1, alignSelf: 'center', backgroundColor: '#DDE4E7' },
  mapSearchLayer: { position: 'absolute', top: 62, left: 16, right: 16, zIndex: 20 },
  mapSearchBox: { minHeight: 46, borderRadius: 18, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 8, shadowColor: '#111827', shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 7 },
  localMustSeesNote: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: 30, marginTop: 7, paddingLeft: 9, paddingRight: 5, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.94)', flexDirection: 'row', alignItems: 'center', gap: 6, shadowColor: '#111827', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  localMustSeesDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#8B5CF6' },
  localMustSeesText: { color: '#555162', fontSize: 10, fontWeight: '700', flexShrink: 1 },
  localMustSeesClose: { width: 24, height: 26, alignItems: 'center', justifyContent: 'center' },
  nearbyPrompt: { alignSelf: 'flex-start', minHeight: 32, marginTop: 5, paddingHorizontal: 10, borderRadius: 13, backgroundColor: '#F4F0FF', borderWidth: StyleSheet.hairlineWidth, borderColor: '#DED3FF', flexDirection: 'row', alignItems: 'center', shadowColor: '#4C347E', shadowOpacity: 0.1, shadowRadius: 7, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  nearbyPromptMain: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 6 },
  nearbyPromptText: { color: '#6043AD', fontSize: 10, fontWeight: '800' },
  searchClose: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  searchSubmit: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  addResultButtonPending: { backgroundColor: '#94A3B8' },
  focusResultButton: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F766E' },
  candidateSlot: { minHeight: 82, paddingHorizontal: 15, paddingTop: 10, paddingBottom: 5 },
  candidateCard: { minHeight: 67, borderRadius: 20, backgroundColor: '#F1F7F5', borderWidth: StyleSheet.hairlineWidth, borderColor: '#CDE2DB', paddingHorizontal: 11, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  candidateCardEmpty: { backgroundColor: '#F6F8F8', borderColor: '#E2E8E7' },
  candidateMarker: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#16A34A', alignItems: 'center', justifyContent: 'center' },
  candidateMarkerEmpty: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#E8EFED', alignItems: 'center', justifyContent: 'center' },
  candidateCopy: { flex: 1, minWidth: 0 },
  candidateName: { color: '#173A34', fontSize: 14, lineHeight: 18, fontWeight: '700' },
  candidateAddress: { color: '#638078', fontSize: 11, lineHeight: 15, marginTop: 1 },
  candidateAdd: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#16A34A', alignItems: 'center', justifyContent: 'center', shadowColor: '#166534', shadowOpacity: 0.18, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  candidateAdded: { minHeight: 30, paddingHorizontal: 9, borderRadius: 15, backgroundColor: '#E2F5E8', flexDirection: 'row', alignItems: 'center', gap: 4 },
  candidateAddedText: { color: '#167A58', fontSize: 11, fontWeight: '700' },
  candidateVerifying: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F2EEFF', alignItems: 'center', justifyContent: 'center' },
  candidateEmptyTitle: { color: '#697A76', fontSize: 13, lineHeight: 17, fontWeight: '700' },
  candidateEmptySubtitle: { color: '#96A39F', fontSize: 11, lineHeight: 15, marginTop: 1 },
  itemNoteModern: { color: '#475569', fontSize: 12, lineHeight: 17, marginTop: 5, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: '#CBD5E1', fontWeight: '500' },
  fullSearch: { flex: 1, backgroundColor: '#FFFFFF', paddingTop: 54 },
  fullSearchHeader: { minHeight: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  fullSearchTitle: { color: '#18181B', fontSize: 17, fontWeight: '700' },
  fullResults: { padding: 16, gap: 8 },
  fullResultRow: { minHeight: 62, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 14, backgroundColor: '#F8FAFC', flexDirection: 'row', alignItems: 'center', gap: 8 },
  dividerAddText: { color: '#64748B', fontSize: 10, fontWeight: '700' },
  dividerAddTextSelected: { color: '#167A58' },
  itemActionsRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  transportInsertButton: { minHeight: 26, paddingHorizontal: 9, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, backgroundColor: '#F1F5F9' },
  transportInsertButtonSelected: { backgroundColor: '#E6F5EC', borderWidth: StyleSheet.hairlineWidth, borderColor: '#B7E4CE' },
  timeTagInline: { borderRadius: 12, backgroundColor: '#EAF4FF', paddingHorizontal: 9, paddingVertical: 5 },
  modalRemoveButton: { alignSelf: 'center', marginTop: 6, marginBottom: 2, minHeight: 34, paddingHorizontal: 14, justifyContent: 'center' },
  modalRemoveText: { color: '#C24141', fontSize: 13, fontWeight: '700' },
  transportOptions: { paddingHorizontal: 18, paddingBottom: 28, gap: 8 },
  transportOption: { minHeight: 48, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F8FAFC' },
  transportOptionSelected: { backgroundColor: '#E6F5F1' },
  transportOptionText: { color: '#475569', fontSize: 15, fontWeight: '600' },
  transportOptionTextSelected: { color: '#0F766E' },
  root: { flex: 1, backgroundColor: '#FFFFFF' }, header: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E4ECEA' }, headerCopy: { flex: 1, minWidth: 0, paddingRight: 12 }, heading: { fontSize: 24, fontWeight: '700', color: '#183431' }, landingLabel: { color: '#0F766E', fontSize: 12, fontWeight: '800', marginTop: 4 }, subheading: { fontSize: 12, color: '#74747B', marginTop: 2 }, headerIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#F0F4F3', alignItems: 'center', justifyContent: 'center' }, searchLayer: { paddingHorizontal: 16, zIndex: 4 }, searchBox: { minHeight: 46, borderRadius: 14, backgroundColor: '#F4F5F6', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 8 }, searchInput: { flex: 1, fontSize: 16, color: '#1D1D21', paddingVertical: 9 }, results: { marginTop: 6, backgroundColor: '#FFF', borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.13, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 5 }, resultRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingVertical: 10, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E7E8EA' }, resultCopy: { flex: 1 }, resultTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, resultName: { color: '#1B1B1D', fontSize: 14, fontWeight: '600', flexShrink: 1 }, resultAddress: { color: '#77777D', fontSize: 12, marginTop: 2 }, savedTag: { backgroundColor: '#E9F3FF', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }, savedTagText: { color: '#2F78B4', fontSize: 10, fontWeight: '700' }, addResultButton: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#007AFF' }, pinPopup: { marginHorizontal: 16, marginTop: 10, borderRadius: 14, backgroundColor: '#FFFFFF', padding: 12, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.13, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 5 }, pinName: { color: '#19191B', fontSize: 14, fontWeight: '700' }, pinAddress: { color: '#77777D', fontSize: 12, marginTop: 2 }, pinAction: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center', marginLeft: 8 }, addedPill: { flexDirection: 'row', gap: 3, alignItems: 'center', backgroundColor: '#FFF0E6', borderRadius: 13, paddingHorizontal: 9, paddingVertical: 6 }, addedPillText: { color: '#B5551B', fontSize: 11, fontWeight: '700' }, listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 7 }, listHeading: { color: '#1A1A1C', fontSize: 18, fontWeight: '700' }, routeButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 34, paddingHorizontal: 10, borderWidth: 1, borderColor: '#B7D8D2', borderRadius: 10, backgroundColor: '#FFFFFF' }, routeButtonActive: { backgroundColor: '#0F766E', borderColor: '#0F766E' }, routeButtonText: { color: '#0F766E', fontSize: 12, fontWeight: '700' }, routeButtonTextActive: { color: '#FFF' }, timeTags: { paddingHorizontal: 16, paddingBottom: 5, gap: 6 }, routeTimeTag: { borderRadius: 12, backgroundColor: '#F2F5F7', paddingHorizontal: 9, paddingVertical: 5 }, routeTimeTagText: { color: '#53616B', fontSize: 11, fontWeight: '600' }, emptyList: { flex: 1, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14 }, emptyText: { color: '#71827F', fontSize: 14, lineHeight: 20, maxWidth: 260 }, focusSection: { marginTop: 18, flexDirection: 'row', gap: 10, height: 122 }, focusList: { flex: 1 }, focusListContent: { gap: 10, paddingBottom: 16 }, focusRow: { minHeight: 70, padding: 10, borderRadius: 14, backgroundColor: '#F6F8F7', flexDirection: 'row', alignItems: 'center', gap: 10 }, focusText: { color: '#274845', fontSize: 14, fontWeight: '700', flexShrink: 1 }, focusRail: { width: 23, borderRadius: 12, backgroundColor: '#EFF1F2', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 6 }, focusRailPaused: { backgroundColor: '#E0EDF7' }, focusRailThumb: { width: 4, height: 30, borderRadius: 2, backgroundColor: '#94B1C5' }, list: { flex: 1, paddingHorizontal: 15 }, listContent: { paddingBottom: 10 }, timeTag: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: '#EAF4FF', paddingHorizontal: 9, paddingVertical: 4, marginBottom: 5 }, timeTagText: { color: '#3179B7', fontSize: 11, fontWeight: '700' }, dividerAdd: { height: 19, alignItems: 'center', justifyContent: 'center' }, swipeShell: { marginBottom: 1, overflow: 'hidden', borderRadius: 14 }, deleteReveal: { width: 63, alignItems: 'center', justifyContent: 'center' }, deleteRevealHit: { width: 63, height: '100%', backgroundColor: '#E05252', alignItems: 'center', justifyContent: 'center' }, item: { minHeight: 70, padding: 9, borderRadius: 14, backgroundColor: '#FAFAFB', flexDirection: 'row', alignItems: 'center', gap: 9 }, orderBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F5822A', alignItems: 'center', justifyContent: 'center' }, orderBadgeText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' }, itemImage: { width: 50, height: 50, borderRadius: 11, backgroundColor: '#E9EEF2' }, imageFallback: { alignItems: 'center', justifyContent: 'center' }, imageInitial: { color: '#426177', fontSize: 19, fontWeight: '700' }, itemCopy: { flex: 1, minWidth: 0 }, itemName: { fontSize: 14, fontWeight: '700', color: '#212124' }, itemAddress: { fontSize: 12, color: '#85858C', marginTop: 2 }, itemNote: { color: '#48708C', fontSize: 11, lineHeight: 15, marginTop: 4, fontStyle: 'italic' }, noteButton: { width: 40, height: 30, borderRadius: 9, backgroundColor: '#EEF6FD' }, dragHandle: { width: 28, height: 36, alignItems: 'center', justifyContent: 'center' }, footer: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#DDE7E5', backgroundColor: '#FFFFFF' }, secondarySave: { flex: 0.82, height: 50, borderRadius: 18, backgroundColor: '#EDF2F1', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }, secondarySaveText: { color: '#1F3938', fontSize: 14, fontWeight: '700' }, primarySave: { flex: 1.45, height: 50, borderRadius: 18, backgroundColor: '#0F766E', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }, primarySaveText: { color: '#FFF', fontSize: 14, fontWeight: '700' }, modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.28)' }, modalSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#FFF', paddingBottom: 28 }, modalHeader: { minHeight: 64, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5E8' }, modalCancel: { color: '#6D6D73', fontSize: 16 }, modalTitle: { color: '#1D1D20', fontSize: 16, fontWeight: '700', textAlign: 'center' }, modalSubtitle: { color: '#85858C', fontSize: 11, textAlign: 'center', marginTop: 2 }, modalSave: { color: '#007AFF', fontSize: 16, fontWeight: '700' }, wheels: { height: 236, flexDirection: 'row', paddingHorizontal: 30 }, wheelContent: { paddingVertical: 72, flexGrow: 1 }, wheelDivider: { width: StyleSheet.hairlineWidth, backgroundColor: '#E8E8EC', marginVertical: 25 }, wheelOption: { minHeight: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 10 }, wheelOptionSelected: { backgroundColor: '#EAF4FF' }, wheelOptionLocked: { opacity: 0.32 }, wheelText: { color: '#6A6A70', fontSize: 16 }, wheelTextSelected: { color: '#1874B8', fontWeight: '700' }, wheelTextLocked: { color: '#9CA3AF' }, noDayNote: { color: '#6B7280', fontSize: 12, lineHeight: 17, marginHorizontal: 30, marginTop: -12, textAlign: 'center' },
  editGuide: { color: '#667085', fontSize: 10, lineHeight: 14, fontWeight: '600', marginTop: 3 },
  atlasHeadingSafe: { lineHeight: 32, paddingTop: 2, includeFontPadding: true },
  timeConflictToast: { position: 'absolute', top: 70, left: 18, right: 18, minHeight: 38, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: '#FFF7E8', borderWidth: 1, borderColor: '#F3D29B', flexDirection: 'row', alignItems: 'center', gap: 7, zIndex: 10, shadowColor: '#9A6B2F', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 }, timeConflictText: { flex: 1, color: '#8A5600', fontSize: 12, lineHeight: 16, fontWeight: '600' },
});
