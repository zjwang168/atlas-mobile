import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppDialog } from '@/components/feedback/AppDialog';
import { Text } from '@/components/ui/text';
import VoiceInputButton from '@/components/voice-input/VoiceInputButton';
import { useHome } from '@/features/home/HomeContext';
import type { MapMarker } from '@/features/map/MapboxMap';
import { discoverAtlasPlaces, geocodeAtlasArea, requestAtlasRoute, type AtlasRouteResponse } from '@/services/api/apiService';
import { addAtlasOwnedPlaces, addPlacesToAtlas, removePlaceFromAtlas, reorderAtlasPlaces, updateAtlasPlace, type AtlasPlaceSnapshot } from '@/services/atlas/atlasPlacesService';
import { decodeAtlasPlaceMetadata, encodeAtlasPlaceMetadata, type AtlasTransportMode } from '@/services/atlas/atlasPlaceMetadata';
import { createAtlas, updateAtlas } from '@/services/atlas/atlasService';
import { createSearchSession, isAbortError, resolvePlace, suggestPlaces } from '@/services/place/placeSearchService';
import type { SavedPlace } from '@/services/place/placeService';
import type { AtlasPlace } from '@/types/place';
import type { GeocodedLocation } from '@/types/route';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  LayoutAnimation,
  Modal,
  PanResponder,
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
import Reanimated, { Extrapolation, FadeInDown, FadeOutUp, Layout, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
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
  | { kind: 'remote'; externalId: string; name: string; subtitle: string; featureType?: string };

type FocusArea = {
  label: string;
  coordinate: [number, number];
  count: number;
  photoUrl?: string | null;
  places: SavedPlace[];
  bounds: { ne: [number, number]; sw: [number, number] };
};

type AtlasBuilderProps = {
  onClose: () => void;
  onSaved: (atlasId: string, askAI: boolean, mapView?: { centerCoordinate: [number, number]; zoomLevel: number; markers: MapMarker[]; routeGeoJSON?: AtlasRouteResponse['route'] }) => void;
  atlasId?: string;
  initialCandidates?: DraftPlace[];
  initialItems?: DraftPlace[];
  initialCenter?: [number, number];
  initialBounds?: { ne: [number, number]; sw: [number, number] };
  initialLocation?: string;
  started?: boolean;
  onItemsChange?: (items: DraftPlace[]) => void;
  onFirstPlaceAdded?: () => void;
  onBuildPlan?: (location: string, candidates: DraftPlace[], center?: [number, number], bounds?: { ne: [number, number]; sw: [number, number] }) => void;
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

function zoomForBounds(bounds: { ne: [number, number]; sw: [number, number] }) {
  const longitudeSpan = Math.max(0.05, Math.abs(bounds.ne[0] - bounds.sw[0]));
  const latitudeSpan = Math.max(0.05, Math.abs(bounds.ne[1] - bounds.sw[1]));
  const widthZoom = Math.log2((360 * 390) / (512 * longitudeSpan));
  const heightZoom = Math.log2((170 * 360) / (512 * latitudeSpan));
  return Math.max(1.9, Math.min(14, Math.min(widthZoom, heightZoom) - 0.25));
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
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

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

function deriveFocusAreas(places: SavedPlace[]): FocusArea[] {
  const areas = new Map<string, SavedPlace[]>();
  places.forEach((place) => {
    const label = [place.city, place.region, place.country].find((value) => value?.trim());
    if (!label) return;
    const key = normalize(label);
    areas.set(key, [...(areas.get(key) ?? []), place]);
  });
  return [...areas.values()]
    .map((group) => ({
      label: group[0].city || group[0].region || group[0].country || '',
      photoUrl: group.find((place) => Boolean(place.photo_url))?.photo_url,
      places: group,
      coordinate: [
        group.reduce((sum, place) => sum + place.longitude, 0) / group.length,
        group.reduce((sum, place) => sum + place.latitude, 0) / group.length,
      ] as [number, number],
      count: group.length,
      bounds: focusBoundsForSavedPlaces([
        group.reduce((sum, place) => sum + place.longitude, 0) / group.length,
        group.reduce((sum, place) => sum + place.latitude, 0) / group.length,
      ], group),
    }))
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

export default function AtlasBuilder({ onClose, onSaved, atlasId, initialCandidates, initialItems, initialCenter, initialBounds, initialLocation, started = false, onItemsChange, onFirstPlaceAdded, onBuildPlan }: AtlasBuilderProps) {
  const { show: showDialog } = useAppDialog();
  const { savedPlaces, atlasPlaces, atlases, setAtlasMapState, setTabBarVisible, userLocation } = useHome();
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
  const [popupVisible, setPopupVisible] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>(initialCenter ?? CONTINENTAL_US_CENTER);
  const [mapZoom, setMapZoom] = useState(initialBounds ? zoomForBounds(initialBounds) : CONTINENTAL_US_ZOOM);
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
  const popupScale = useRef(new Animated.Value(0.92)).current;
  const popupOpacity = useRef(new Animated.Value(0)).current;
  const [popupBottom, setPopupBottom] = useState(0);
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
    if (initialCenter) setMapCenter(initialCenter);
    if (initialBounds) {
      setMapBounds(initialBounds);
      setMapZoom(zoomForBounds(initialBounds));
    }
    // The map is shared between the Create screen and the editor. A fresh key
    // forces Mapbox to apply the incoming Focus-area camera rather than retain
    // the previous screen's cached viewport.
    if (initialCenter || initialBounds) setCameraKey(`atlas-builder-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }, [initialBounds, initialCenter, started]);

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
    if (trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const timer = setTimeout(async () => {
      queryAbortRef.current?.abort();
      const controller = new AbortController();
      queryAbortRef.current = controller;
      const local = savedPlaces.filter((place) => isLocalMatch(place, trimmed)).slice(0, 8)
        .map((place): SearchResult => ({ kind: 'saved', place }));
      setResults([]);
      setSearching(true);
      try {
        const remote = await suggestPlaces(trimmed, searchSession, mapCenter ? { proximity: mapCenter } : {}, controller.signal);
        if (controller.signal.aborted) return;
        const uniqueRemote = remote
          .filter((suggestion) => !local.some((result) => result.kind === 'saved' && normalize(result.place.name) === normalize(suggestion.name)))
          .slice(0, 2)
          .map((suggestion): SearchResult => ({ kind: 'remote', externalId: suggestion.external_id, name: suggestion.name, subtitle: suggestion.place_formatted ?? suggestion.full_address ?? '', featureType: suggestion.feature_type }));
        setResults([...uniqueRemote, ...local].slice(0, 4));
      } catch (error) {
        if (!isAbortError(error)) {
          console.warn('[AtlasBuilder] search failed', error);
          setResults(local.slice(0, 4));
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [mapCenter, query, savedPlaces, searchSession]);

  const hideTransientUI = useCallback(() => {
    inputRef.current?.blur();
    setResults([]);
    setFocused(null);
    setPopupVisible(false);
  }, []);

  const focus = useCallback((place: DraftPlace, showPopup = false, bounds?: { ne: [number, number]; sw: [number, number] }) => {
    setFocused(place);
    setMapCenter([place.longitude, place.latitude]);
    setMapBounds(bounds);
    setMapZoom(bounds ? zoomForBounds(bounds) : 15);
    setPopupVisible(showPopup);
    if (showPopup) {
      popupScale.setValue(0.92);
      popupOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(popupScale, { toValue: 1, damping: 15, stiffness: 220, useNativeDriver: true }),
        Animated.timing(popupOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [popupOpacity, popupScale]);

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

  const discoverDeepSeekPlaces = useCallback(async (city: string, count: number, proximity?: [number, number]): Promise<DraftPlace[]> => {
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
      const result = await discoverAtlasPlaces(
        `Recommend exactly ${needed} famous places in ${city}.${proximityInstruction} This is turn ${attempt + 1} of one continuous Atlas editing conversation. Return only real places that are different from every place already discussed. Return each real place name, plausible decimal latitude and longitude, city/region context, category, and a location-specific license-plate-style English slogan in the description field (maximum 4 English words). Do not use a category as the description, do not truncate a sentence, and do not write a complete sentence. Coordinates are provisional and will be geocode-verified in parallel. Style references: The Emerald Needle; Where Fish Fly; Glass Without Limits; Rock Meets Tech; Art By The Sound; Skyline Capital; Rainforest Not Rain; Wisdom Under Cherry; Where Water Works; Wheel Over Waves.`,
        undefined,
        undefined,
        { sessionId: aiRecommendationSessionId, excludedPlaceNames: [...knownNames] },
      );
      result.locations.forEach((place, index) => {
        const name = normalize(place.name);
        if (!name || knownNames.has(name) || discoveries.length >= count || (proximity && !isNearCoordinate(place, proximity))) return;
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
    const isBroadArea = !area.places.some((place) => Boolean(place.city?.trim()));
    const clusterLocations = clusterLocationNames(area.places);
    const isMultiLocationCluster = clusterLocations.size > 1;
    let focusCoordinate = area.coordinate;
    if (!isBroadArea) {
      try {
        const areaQuery = [area.label, area.places[0]?.country].filter(Boolean).join(', ');
        const resolvedArea = await geocodeAtlasArea(areaQuery);
        if (resolvedArea) focusCoordinate = resolvedArea;
        else {
          const [deviceResolvedArea] = await Location.geocodeAsync(areaQuery);
          if (deviceResolvedArea) focusCoordinate = [deviceResolvedArea.longitude, deviceResolvedArea.latitude];
        }
      } catch (error) {
        console.warn('[AtlasBuilder] focus-area geocoding failed', error);
      }
    }
    const localSaved = uniquePlaces([
      ...area.places.filter((place) => isMultiLocationCluster || isBroadArea || isNearCoordinate(place, focusCoordinate)),
      ...savedPlaces.filter((place) => (
        isMultiLocationCluster
          ? clusterLocations.has(normalize(place.city ?? place.region ?? place.country ?? ''))
          : isBroadArea || isNearCoordinate(place, focusCoordinate)
      )),
    ]);
    const initial = localSaved.map((item) => toDraft(item));
    const bounds = isMultiLocationCluster && localSaved.length > 1
      ? focusBoundsForSavedPlaces(focusCoordinate, localSaved)
      : boundsFromRadius(focusCoordinate, FOCUS_SAVED_PLACES_RADIUS_KM);
    handoffToPlan(area.label, initial, focusCoordinate, bounds);
    try {
      const recommendations = await discoverDeepSeekPlaces(area.label, 6, isBroadArea ? undefined : focusCoordinate);
      setRecommendedPlaces(recommendations);
    } catch (error) {
      console.warn('[AtlasBuilder] plan discovery failed', error);
    }
  }, [discoverDeepSeekPlaces, handoffToPlan, savedPlaces]);

  const simpleStart = useCallback(async () => {
    const localSaved = savedPlaces.filter((place) => isNearCoordinate(place, userLocation));
    const nearbySaved = localSaved.map((place) => toDraft(place));
    const localBounds = boundsFromRadius(userLocation, FOCUS_SAVED_PLACES_RADIUS_KM);
    // Enter the Builder immediately. Reverse geocoding and AI discovery should
    // improve the map after it opens, never block the transition.
    const initialCity = nearbySaved.find((place) => place.city)?.city ?? 'San Francisco';
    handoffToPlan(initialCity, nearbySaved, userLocation, localBounds);

    let city = initialCity;
    try {
      const [address] = await Location.reverseGeocodeAsync({ latitude: userLocation[1], longitude: userLocation[0] });
      city = address?.city ?? address?.subregion ?? address?.region ?? initialCity;
    } catch (error) {
      console.warn('[AtlasBuilder] reverse geocoding failed', error);
    }
    try {
      const recommendations = await discoverDeepSeekPlaces(city, 6, userLocation);
      setRecommendedPlaces(recommendations);
      setFocusLabel(city);
    } catch (error) {
      // Recommendations are optional; search and saved places remain usable.
      console.warn('[AtlasBuilder] simple start recommendations failed', error);
    }
  }, [discoverDeepSeekPlaces, handoffToPlan, savedPlaces, userLocation]);

  useEffect(() => {
    if ((!started && !atlasId) || initialPlaceSelected.current) return;
    const selectedIds = new Set([
      ...items.map((item) => item.id),
      ...atlasPlaces
        .filter((row) => row.atlas_id === atlasId)
        .map((row) => row.place_id ?? row.external_place_id ?? row.id),
    ]);
    const candidateSource = started && initialCandidates?.length
      ? initialCandidates
      : savedPlaces.map((place) => toDraft(place));
    const candidates = candidateSource.filter((place) => (
      !selectedIds.has(place.id)
      && (!atlasId || isWithinBounds(place, mapBounds ?? initialBounds))
    ));
    const place = candidates[Math.floor(Math.random() * candidates.length)];
    if (!place) return;
    initialPlaceSelected.current = true;
    setFocused(place);
    setPopupVisible(true);
    popupScale.setValue(0.92);
    popupOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(popupScale, { toValue: 1, damping: 15, stiffness: 220, useNativeDriver: true }),
      Animated.timing(popupOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  }, [atlasId, atlasPlaces, initialBounds, initialCandidates, items, mapBounds, popupOpacity, popupScale, savedPlaces, started]);

  const resolveResult = useCallback(async (result: SearchResult): Promise<DraftPlace | null> => {
    if (result.kind === 'saved') return toDraft(result.place);
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
      const bounds = focusBoundsForSavedPlaces([place.longitude, place.latitude], placesInView);
      setMapCenter(centerOfBounds(bounds));
      setMapBounds(bounds);
      setMapZoom(zoomForBounds(bounds));
      setFocused(null);
      setPopupVisible(false);
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

  const dismissMapPopup = useCallback(() => {
    if (!popupVisible) return;
    Animated.parallel([
      Animated.timing(popupOpacity, { toValue: 0, duration: 170, useNativeDriver: true }),
      Animated.timing(popupScale, { toValue: 0.96, duration: 170, useNativeDriver: true }),
    ]).start(() => setPopupVisible(false));
  }, [popupOpacity, popupScale, popupVisible]);

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
    dismissMapPopup();
    setQuery('');
    setResults([]);
  }, [dismissMapPopup, items, onFirstPlaceAdded, onItemsChange, persistAddedPlace, showDialog]);

  const commitItems = useCallback((next: DraftPlace[]) => {
    setItems(next);
    onItemsChange?.(next);
  }, [onItemsChange]);

  const handleResultFocus = useCallback(async (result: SearchResult) => {
    try {
      const place = await resolveResult(result);
      if (place) focus(place, false);
      inputRef.current?.blur();
      setResults([]);
    } catch (error) {
      console.warn('[AtlasBuilder] resolving search result failed', error);
    }
  }, [focus, resolveResult]);

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
    dismissMapPopup();
    const persistedRowId = place.joinId
      ?? atlasPlaces.find((row) => row.atlas_id === atlasId && (row.place_id === place.id || row.external_place_id === place.id))?.id;
    if (persistedRowId) removePlaceFromAtlas(persistedRowId).catch((error) => console.warn('[AtlasBuilder] remove failed', error));
    setTimeout(() => setRemovingPlace((current) => current?.id === place.id ? null : current), 520);
  }, [atlasId, atlasPlaces, commitItems, dismissMapPopup, items]);

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

  const persist = useCallback(async (askAI: boolean) => {
    if (!items.length) {
      showDialog({ title: 'Choose a place first', message: 'Select at least one point on the map.', tone: 'warning' });
      return;
    }
    if (items.some((item) => item.provisional)) {
      showDialog({ title: 'Location verification in progress', message: 'Wait for AI map positions to be verified before saving this Atlas.', tone: 'warning' });
      return;
    }
    const overviewBounds = boundsFromPolygon(items.map((item) => [item.longitude, item.latitude] as [number, number]), 0.08);
    const overviewCenter: [number, number] = [
      items.reduce((sum, item) => sum + item.longitude, 0) / items.length,
      items.reduce((sum, item) => sum + item.latitude, 0) / items.length,
    ];
    const overviewZoom = zoomForBounds(overviewBounds);
    // A new Atlas resolves into its complete overview as it saves. Existing
    // Atlases deliberately retain the editor's exact current camera.
    if (!atlasId) {
      setMapBounds(undefined);
      setMapCenter(overviewCenter);
      setMapZoom(overviewZoom);
    }
    const savedMapView = {
      centerCoordinate: atlasId ? mapCenter : overviewCenter,
      zoomLevel: atlasId ? mapZoom : overviewZoom,
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
    };
    setSavingKind(askAI ? 'ai' : 'atlas');
    try {
      // Keep the save indicator and white marker breath on screen long enough
      // to be perceived before the editor hands its map state to the detail.
      await wait(460);
      const title = atlasId ? (atlasTitle.trim() || existingAtlas?.title || buildAtlasTitle(items)) : buildAtlasTitle(items);
      const atlas = atlasId ? existingAtlas : await createAtlas(title);
      if (!atlas) throw new Error('Atlas could not be created');
      const hasPendingRows = Boolean(atlasId) && items.some((item) => !item.joinId);
      if (atlasId && !hasPendingRows) {
        await Promise.all(items.map((item, index) => updateAtlasPlace(item.joinId!, {
          ...atlasPlaceSnapshot(item),
          sort_order: index,
          note: encodeAtlasPlaceMetadata(item.note, item.transport),
          timeline_day: item.timeline_day ?? null,
          timeline_time: item.timeline_time ?? null,
        })));
        await updateAtlas(atlas.id, { title, route_geojson: route?.route ?? null, route_visible: Boolean(route) });
        onSaved(atlas.id, askAI, savedMapView);
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
      await Promise.all(items.map((item, index) => {
        const join = item.joinId ? { id: item.joinId } : joins.get(item.id);
        return join ? updateAtlasPlace(join.id, {
          ...atlasPlaceSnapshot(item),
          sort_order: index,
          note: encodeAtlasPlaceMetadata(item.note, item.transport),
          timeline_day: item.timeline_day ?? null,
          timeline_time: item.timeline_time ?? null,
        }) : Promise.resolve();
      }));
      await updateAtlas(atlas.id, { title, route_geojson: route?.route ?? null, route_visible: Boolean(route) });
      onSaved(atlas.id, askAI, savedMapView);
    } catch (error) {
      console.warn('[AtlasBuilder] saving failed', error);
      showDialog({ title: 'Atlas was not saved', message: 'Please check your connection and try again.', tone: 'warning' });
    } finally {
      setSavingKind(null);
    }
  }, [atlasId, atlasPlaces, atlasTitle, existingAtlas, items, mapCenter, mapZoom, onSaved, route, savedPlaces, showDialog]);

  const mapMarkers = useMemo<MapMarker[]>(() => {
    const selected = new Set(items.map((item) => item.id));
    const saved = savedPlaces.map((place) => ({
      id: place.id,
      latitude: place.latitude,
      longitude: place.longitude,
      title: place.name,
      description: place.subtitle,
      tone: 'saved' as const,
    }));
    const recommended = recommendedPlaces
      .filter((place) => !savedPlaces.some((savedPlace) => savedPlace.id === place.id) && !selected.has(place.id))
      .map((place) => ({ id: place.id, latitude: place.latitude, longitude: place.longitude, title: place.name, description: place.subtitle, labelHint: place.aiDescription ?? undefined, ai: true, tone: 'recommended' as const }));
    const atlasItems = [...items, ...(removingPlace && !items.some((item) => item.id === removingPlace.id) ? [removingPlace] : [])]
      .map((item, index) => ({
        id: item.id,
        latitude: item.latitude,
        longitude: item.longitude,
        title: item.name,
        description: item.subtitle,
        tone: 'atlas' as const,
        order: items.findIndex((entry) => entry.id === item.id) + 1,
        entering: enteringPlaceIds.has(item.id),
        pulsing: savingKind !== null,
      }));
    const focusedSearch = focused && !selected.has(focused.id)
      && !savedPlaces.some((place) => place.id === focused.id)
      && !recommendedPlaces.some((place) => place.id === focused.id)
      ? [{ id: focused.id, latitude: focused.latitude, longitude: focused.longitude, title: focused.name, description: focused.subtitle, labelHint: focused.aiDescription ?? undefined, ai: focused.source === 'recommended', tone: focused.source === 'recommended' ? 'recommended' as const : 'atlas' as const }]
      : [];
    const byId = new Map<string, MapMarker>();
    saved.forEach((marker) => byId.set(marker.id, marker));
    recommended.forEach((marker) => { if (!byId.has(marker.id)) byId.set(marker.id, marker); });
    atlasItems.forEach((marker) => byId.set(marker.id, marker));
    focusedSearch.forEach((marker) => { if (!byId.has(marker.id)) byId.set(marker.id, marker); });
    return savingKind ? [...byId.values()].map((marker) => ({ ...marker, title: undefined, labelHint: undefined })) : [...byId.values()];
  }, [enteringPlaceIds, focused, items, recommendedPlaces, removingPlace, savedPlaces, savingKind]);

  const mapSearchOverlay = useMemo(() => <Animated.View pointerEvents="box-none" style={[styles.mapSearchLayer, { opacity: searchAppear, transform: [{ translateX: searchAppear.interpolate({ inputRange: [0, 1], outputRange: [-34, 0] }) }, { scaleX: searchAppear.interpolate({ inputRange: [0, 1], outputRange: [0.18, 1] }) }] }]}>
    <View pointerEvents="auto" style={styles.mapSearchBox}>
      <Ionicons name={focusSearchActive ? 'locate-outline' : 'search'} size={18} color={focusSearchActive ? '#0F766E' : '#6B7280'} />
      <TextInput ref={inputRef} value={query} onChangeText={setQuery} placeholder={focusSearchActive ? 'Search an area' : 'Search places'} placeholderTextColor="#8E8E93" style={styles.searchInput} returnKeyType="search" onSubmitEditing={openFullSearch} />
      {searching ? <ActivityIndicator size="small" color="#2563EB" /> : <TouchableOpacity accessibilityLabel={focusSearchActive ? 'Focus search area' : 'Search all places'} onPress={openFullSearch} style={styles.searchSubmit}><Ionicons name="arrow-forward" size={17} color="#2563EB" /></TouchableOpacity>}
      {focusSearchActive ? <TouchableOpacity accessibilityLabel="Close focus search" onPress={closeFocusSearch} style={styles.searchClose}><Ionicons name="close" size={16} color="#64748B" /></TouchableOpacity> : null}
    </View>
    {localMustSeesVisible ? <Animated.View style={[styles.localMustSeesNote, { opacity: localMustSeesOpacity }]}><View style={styles.localMustSeesDot} /><Text style={styles.localMustSeesText}>Local must-sees, handpicked by OurAtlas.</Text><TouchableOpacity accessibilityLabel="Dismiss local must-sees note" onPress={hideLocalMustSees} style={styles.localMustSeesClose}><Ionicons name="close" size={13} color="#5E6070" /></TouchableOpacity></Animated.View> : null}
    {nearbyPromptVisible ? <Animated.View style={{ opacity: nearbyPromptOpacity }}><View style={styles.nearbyPrompt}><TouchableOpacity accessibilityLabel="More nearby must-sees" disabled={nearbyRecommending} onPress={() => { void recommendNearby(); }} style={styles.nearbyPromptMain}><Ionicons name="sparkles" size={13} color="#6446B4" />{nearbyRecommending ? <><ActivityIndicator size="small" color="#6446B4" /><Text style={styles.nearbyPromptText}>Finding nearby must-sees...</Text></> : <Text style={styles.nearbyPromptText}>More nearby must-sees</Text>}</TouchableOpacity></View></Animated.View> : null}
    {results.length > 0 ? <View pointerEvents="auto" style={styles.results}>{results.map((result) => {
      const key = result.kind === 'saved' ? result.place.id : result.externalId;
      return <View key={key} style={styles.resultRow}><TouchableOpacity style={styles.resultCopy} onPress={() => focusSearchActive ? focusAreaResult(result) : handleResultFocus(result)}><View style={styles.resultTitleRow}><Text numberOfLines={1} style={styles.resultName}>{result.kind === 'saved' ? result.place.name : result.name}</Text>{result.kind === 'saved' ? <View style={styles.savedTag}><Text style={styles.savedTagText}>Saved</Text></View> : null}</View><Text numberOfLines={1} style={styles.resultAddress}>{result.kind === 'saved' ? result.place.subtitle : result.subtitle}</Text></TouchableOpacity><TouchableOpacity accessibilityLabel={focusSearchActive ? 'Focus this area' : 'Add to Atlas'} disabled={focusSearchActive ? false : addingResult === key} onPress={() => focusSearchActive ? focusAreaResult(result) : handleResultAdd(result)} style={[focusSearchActive ? styles.focusResultButton : styles.addResultButton, !focusSearchActive && addingResult === key && styles.addResultButtonPending]}>{!focusSearchActive && addingResult === key ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name={focusSearchActive ? 'locate-outline' : 'add'} size={18} color="#FFF" />}</TouchableOpacity></View>;
    })}</View> : null}
  </Animated.View>, [addingResult, closeFocusSearch, focusAreaResult, focusSearchActive, handleResultAdd, handleResultFocus, hideLocalMustSees, localMustSeesOpacity, localMustSeesVisible, nearbyPromptOpacity, nearbyPromptVisible, nearbyRecommending, openFullSearch, query, recommendNearby, recommendedPlaces.length, results, searchAppear, searching]);

  const handlePanelHeightChange = useCallback((height: number) => {
    // Keep layout-position state outside the native animation. Native Animated
    // only supports opacity and transforms, not `bottom`.
    setPopupBottom(Math.max(0, height + 12));
  }, []);

  const atlasMapOverlay = useMemo(() => <>
    {!savingKind ? mapSearchOverlay : null}
    {!savingKind && popupVisible && focused ? <View pointerEvents="box-none" style={[styles.mapCandidateLayer, { bottom: popupBottom }]}><Animated.View style={{ opacity: popupOpacity, transform: [{ scale: popupScale }] }}><View pointerEvents="auto"><MapPinPopup key={focused.id} place={focused} added={items.some((item) => item.id === focused.id)} showTutorial={started || Boolean(atlasId)} onAdd={() => addPlace(focused)} /></View></Animated.View></View> : null}
  </>, [addPlace, atlasId, focused, items, mapSearchOverlay, popupBottom, popupOpacity, popupScale, popupVisible, recommendedPlaces.length, savingKind, started]);

  useEffect(() => {
    setAtlasMapState({
      markers: mapMarkers,
      cameraVerticalOffset: 0,
      cameraScreenOffsetY: atlasId ? EDIT_ATLAS_CAMERA_SCREEN_OFFSET_Y : 0,
      centerCoordinate: mapCenter,
      zoomLevel: mapZoom,
      // Polygon bounds are used to derive mapZoom above. Passing bounds to
      // Mapbox as well creates a competing camera update on some devices.
      bounds: undefined,
      cameraKey,
      cameraAnimationDurationMs: atlasId ? 0 : undefined,
      selectedMarkerId: focused?.id ?? null,
      routeGeoJSON: route?.route,
      deletingMarkerId: removingPlace?.id,
      onMarkerPress: (marker) => {
        const atlasItem = items.find((item) => item.id === marker.id);
        const recommended = recommendedPlaces.find((item) => item.id === marker.id);
        if (atlasItem) focus(atlasItem, true);
        else if (recommended) focus(recommended, true);
        else {
          const saved = savedPlaces.find((item) => item.id === marker.id);
          if (saved) focus(toDraft(saved), true);
        }
      },
      onMapPress: hideTransientUI,
      onViewportChanged: scheduleNearbyPrompt,
      overlay: atlasMapOverlay,
      onPanelHeightChange: handlePanelHeightChange,
      hideTopSearchButton: true,
      markerPopup: null,
    });
  }, [atlasId, atlasMapOverlay, atlasPlaces, cameraKey, focus, focused, handlePanelHeightChange, hideTransientUI, mapBounds, mapCenter, mapMarkers, mapZoom, recommendedPlaces, removingPlace?.id, route?.route, savedPlaces, scheduleNearbyPrompt, setAtlasMapState]);

  useEffect(() => () => setAtlasMapState(null), [setAtlasMapState]);

  const timeTags = useMemo(() => items.filter((item) => item.timeline_day && item.timeline_time)
    .map((item) => ({ id: item.id, label: `Day ${item.timeline_day} · ${item.timeline_time}`, item })), [items]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.heading}>{atlasId || started || handoffStarted ? 'Edit atlas' : 'Create an atlas'}</Text>
          {items.length === 0 && !started && !handoffStarted && !atlasId ? <Text style={styles.landingLabel}>Pick a place to explore</Text> : null}
        </View>
        <View style={styles.headerRight}>
          {atlasId ? <TouchableOpacity accessibilityLabel={`Rename ${atlasTitle || existingAtlas?.title || 'Atlas'}`} onPress={renameAtlas} style={styles.focusAreaButton}><Text numberOfLines={1} style={styles.focusAreaButtonText}>{atlasTitle || existingAtlas?.title || 'Atlas'}</Text><Ionicons name="pencil-outline" size={15} color="#6A6A70" /></TouchableOpacity> : (started && focusLabel ? <TouchableOpacity accessibilityLabel={`Change focus area, currently ${focusLabel}`} onPress={openFocusSearch} style={styles.focusAreaButton}><Ionicons name="location-sharp" size={23} color="#303033" /><Text numberOfLines={1} style={styles.focusAreaButtonText}>{focusLabel}</Text></TouchableOpacity> : null)}
          <TouchableOpacity accessibilityLabel="Close Atlas editor" onPress={onClose} style={styles.headerIcon}><Ionicons name="close" size={19} color="#26262A" /></TouchableOpacity>
        </View>
      </View>

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

function AddHintTap({ visible }: { visible: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    progress.setValue(0);
    const tap = () => Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: 1500, useNativeDriver: true }),
      Animated.delay(180),
      Animated.timing(progress, { toValue: 0, duration: 460, useNativeDriver: true }),
      Animated.delay(220),
    ]);
    const animation = Animated.sequence([tap(), tap()]);
    animation.start();
    return () => animation.stop();
  }, [progress, visible]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] });
  const opacity = progress.interpolate({ inputRange: [0, 0.35, 0.68, 1], outputRange: [0, 0.58, 0.58, 0] });
  return <Animated.View pointerEvents="none" style={[styles.addHintTap, { opacity, transform: [{ scale }] }]} />;
}

function MapPinPopup({ place, added, showTutorial, onAdd }: { place: DraftPlace; added: boolean; showTutorial: boolean; onAdd: () => void }) {
  return <View style={styles.mapPopup}><View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.pinName}>{place.name}</Text><Text numberOfLines={1} style={styles.pinAddress}>{place.provisional ? 'Verifying map position...' : place.subtitle}</Text></View>{added ? <View style={styles.addedPill}><Ionicons name="checkmark" size={13} color="#A44D1A" /><Text style={styles.addedPillText}>Added</Text></View> : place.provisional ? <View style={styles.verifyingPill}><ActivityIndicator size="small" color="#7C5CE0" /><Text style={styles.verifyingPillText}>Verifying</Text></View> : <View style={styles.mapPinActionWrap}><AddHintTap visible={showTutorial} /><TouchableOpacity accessibilityLabel="Add to Atlas" onPress={onAdd} style={styles.mapPinAction}><Ionicons name="add" size={19} color="#FFF" /></TouchableOpacity></View>}</View>;
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

function AtlasItem({ item, index, onFocus, onRemove, onMove, onNote }: { item: DraftPlace; index: number; onFocus: () => void; onRemove: () => void; onMove: (index: number, delta: number) => void; onNote: (note: string) => void }) {
  const { show: showDialog } = useAppDialog();
  const [revealed, setRevealed] = useState(false);
  const reorderGesture = useMemo(() => Gesture.Pan().activateAfterLongPress(180).runOnJS(true).onEnd((event) => {
    if (event.translationY > 28) onMove(index, 1);
    if (event.translationY < -28) onMove(index, -1);
  }), [index, onMove]);
  const swipeResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 8,
    onPanResponderRelease: (_, gesture) => { if (gesture.dx < -32) setRevealed(true); if (gesture.dx > 25) setRevealed(false); },
  })).current;
  return <View style={styles.swipeShell}><TouchableOpacity accessibilityLabel="Delete place" onPress={onRemove} style={[styles.deleteReveal, !revealed && styles.deleteHidden]}><Ionicons name="trash-outline" size={17} color="#FFF" /></TouchableOpacity><Animated.View {...swipeResponder.panHandlers} style={[styles.item, { transform: [{ translateX: revealed ? -58 : 0 }] }]}>
    <View style={styles.orderBadge}><Text style={styles.orderBadgeText}>{index + 1}</Text></View>
    {item.photo_url ? <Image source={{ uri: item.photo_url }} style={styles.itemImage as import('react-native').ImageStyle} /> : <View style={[styles.itemImage, styles.imageFallback]}><Text style={styles.imageInitial}>{item.name.slice(0, 1).toUpperCase()}</Text></View>}
    <TouchableOpacity onPress={onFocus} style={styles.itemCopy}><Text numberOfLines={1} style={styles.itemName}>{item.name}</Text><Text numberOfLines={1} style={styles.itemAddress}>{item.subtitle}</Text>{item.note ? <Text numberOfLines={2} style={styles.itemNoteModern}>{item.note}</Text> : null}</TouchableOpacity>
    <VoiceInputButton label="Note" style={styles.noteButton} onShortPress={() => showDialog({ title: 'Note', input: { placeholder: 'Add a note', initialValue: item.note ?? '' }, actions: [{ label: 'Cancel' }, { label: 'Save', variant: 'primary', onPress: onNote }] })} onTranscript={(text) => onNote(item.note ? `${item.note} ${text}` : text)} />
    <GestureDetector gesture={reorderGesture}><View style={styles.dragHandle}><Ionicons name="reorder-three-outline" size={23} color="#66737C" /></View></GestureDetector>
  </Animated.View></View>;
}

function TimePickerModal({ visible, day, time, dayLocked, hasExisting, validationMessage, onChangeDay, onChangeTime, onClose, onRemove, onSave }: { visible: boolean; day: number | null; time: string; dayLocked: boolean; hasExisting: boolean; validationMessage?: string | null; onChangeDay: (day: number | null) => void; onChangeTime: (time: string) => void; onClose: () => void; onRemove: () => void; onSave: () => void }) {
  const dayOptions: Array<number | null> = [null, ...Array.from({ length: 14 }, (_, index) => index + 1)];
  return <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}><Pressable onPress={onClose} style={styles.modalBackdrop}><Pressable onPress={(event) => event.stopPropagation()} style={styles.modalSheet}><View style={styles.modalHeader}><TouchableOpacity onPress={onClose}><Text style={styles.modalCancel}>Cancel</Text></TouchableOpacity><View><Text style={styles.modalTitle}>Schedule time</Text><Text style={styles.modalSubtitle}>Place it in your itinerary</Text></View><TouchableOpacity onPress={onSave}><Text style={styles.modalSave}>Done</Text></TouchableOpacity></View>{validationMessage ? <View pointerEvents="none" style={styles.timeConflictToast}><Ionicons name="alert-circle-outline" size={16} color="#A15C00" /><Text numberOfLines={2} style={styles.timeConflictText}>{validationMessage}</Text></View> : null}<View style={styles.wheels}><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.wheelContent}>{dayOptions.map((value) => <TouchableOpacity disabled={dayLocked && value !== null} key={value ?? 'flexible-day'} onPress={() => onChangeDay(value)} style={[styles.wheelOption, day === value && styles.wheelOptionSelected, dayLocked && value !== null && styles.wheelOptionLocked]}><Text style={[styles.wheelText, day === value && styles.wheelTextSelected, dayLocked && value !== null && styles.wheelTextLocked]}>{value === null ? 'Flexible day' : `Day ${value}`}</Text></TouchableOpacity>)}</ScrollView><View style={styles.wheelDivider} /><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.wheelContent}>{PLANNING_HOURS.map((value) => <TouchableOpacity key={value} onPress={() => onChangeTime(value)} style={[styles.wheelOption, time === value && styles.wheelOptionSelected]}><Text style={[styles.wheelText, time === value && styles.wheelTextSelected]}>{value}</Text></TouchableOpacity>)}</ScrollView></View>{dayLocked ? <Text style={styles.noDayNote}>To assign a day, change a Flexible day time tag to a numbered day.</Text> : null}{hasExisting ? <TouchableOpacity onPress={onRemove} style={styles.modalRemoveButton}><Text style={styles.modalRemoveText}>Remove time</Text></TouchableOpacity> : null}</Pressable></Pressable></Modal>;
}

const styles = StyleSheet.create({
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
  mapCandidateLayer: { position: 'absolute', left: 16, right: 16, bottom: '60%', alignItems: 'center', zIndex: 30 },
  mapPopup: { width: 312, minHeight: 76, borderRadius: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 15, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', shadowColor: '#111827', shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 8 },
  mapPopupArrow: { position: 'absolute', top: -7, left: '50%', marginLeft: -7, width: 14, height: 14, backgroundColor: '#FFFFFF', transform: [{ rotate: '45deg' }] },
  mapPinActionWrap: { width: 34, height: 34, marginLeft: 8, alignItems: 'center', justifyContent: 'center' },
  mapPinAction: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#16A34A', alignItems: 'center', justifyContent: 'center' },
  verifyingPill: { minHeight: 30, paddingHorizontal: 8, borderRadius: 15, backgroundColor: '#F2EEFF', flexDirection: 'row', alignItems: 'center', gap: 5 },
  verifyingPillText: { color: '#6D4CC4', fontSize: 10, fontWeight: '700' },
  addHintTap: { position: 'absolute', width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(100, 116, 139, 0.28)' },
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
  root: { flex: 1, backgroundColor: '#FFFFFF' }, header: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E4ECEA' }, headerCopy: { flex: 1, minWidth: 0, paddingRight: 12 }, heading: { fontSize: 24, fontWeight: '700', color: '#183431' }, landingLabel: { color: '#0F766E', fontSize: 12, fontWeight: '800', marginTop: 4 }, subheading: { fontSize: 12, color: '#74747B', marginTop: 2 }, headerIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#F0F4F3', alignItems: 'center', justifyContent: 'center' }, searchLayer: { paddingHorizontal: 16, zIndex: 4 }, searchBox: { minHeight: 46, borderRadius: 14, backgroundColor: '#F4F5F6', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 8 }, searchInput: { flex: 1, fontSize: 16, color: '#1D1D21', paddingVertical: 9 }, results: { marginTop: 6, backgroundColor: '#FFF', borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.13, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 5 }, resultRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingVertical: 10, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E7E8EA' }, resultCopy: { flex: 1 }, resultTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, resultName: { color: '#1B1B1D', fontSize: 14, fontWeight: '600', flexShrink: 1 }, resultAddress: { color: '#77777D', fontSize: 12, marginTop: 2 }, savedTag: { backgroundColor: '#E9F3FF', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }, savedTagText: { color: '#2F78B4', fontSize: 10, fontWeight: '700' }, addResultButton: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#007AFF' }, pinPopup: { marginHorizontal: 16, marginTop: 10, borderRadius: 14, backgroundColor: '#FFFFFF', padding: 12, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.13, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 5 }, pinName: { color: '#19191B', fontSize: 14, fontWeight: '700' }, pinAddress: { color: '#77777D', fontSize: 12, marginTop: 2 }, pinAction: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center', marginLeft: 8 }, addedPill: { flexDirection: 'row', gap: 3, alignItems: 'center', backgroundColor: '#FFF0E6', borderRadius: 13, paddingHorizontal: 9, paddingVertical: 6 }, addedPillText: { color: '#B5551B', fontSize: 11, fontWeight: '700' }, listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 7 }, listHeading: { color: '#1A1A1C', fontSize: 18, fontWeight: '700' }, routeButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 34, paddingHorizontal: 10, borderWidth: 1, borderColor: '#B7D8D2', borderRadius: 10, backgroundColor: '#FFFFFF' }, routeButtonActive: { backgroundColor: '#0F766E', borderColor: '#0F766E' }, routeButtonText: { color: '#0F766E', fontSize: 12, fontWeight: '700' }, routeButtonTextActive: { color: '#FFF' }, timeTags: { paddingHorizontal: 16, paddingBottom: 5, gap: 6 }, routeTimeTag: { borderRadius: 12, backgroundColor: '#F2F5F7', paddingHorizontal: 9, paddingVertical: 5 }, routeTimeTagText: { color: '#53616B', fontSize: 11, fontWeight: '600' }, emptyList: { flex: 1, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14 }, emptyText: { color: '#71827F', fontSize: 14, lineHeight: 20, maxWidth: 260 }, focusSection: { marginTop: 18, flexDirection: 'row', gap: 10, height: 122 }, focusList: { flex: 1 }, focusListContent: { gap: 10, paddingBottom: 16 }, focusRow: { minHeight: 70, padding: 10, borderRadius: 14, backgroundColor: '#F6F8F7', flexDirection: 'row', alignItems: 'center', gap: 10 }, focusText: { color: '#274845', fontSize: 14, fontWeight: '700', flexShrink: 1 }, focusRail: { width: 23, borderRadius: 12, backgroundColor: '#EFF1F2', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 6 }, focusRailPaused: { backgroundColor: '#E0EDF7' }, focusRailThumb: { width: 4, height: 30, borderRadius: 2, backgroundColor: '#94B1C5' }, list: { flex: 1, paddingHorizontal: 15 }, listContent: { paddingBottom: 10 }, timeTag: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: '#EAF4FF', paddingHorizontal: 9, paddingVertical: 4, marginBottom: 5 }, timeTagText: { color: '#3179B7', fontSize: 11, fontWeight: '700' }, dividerAdd: { height: 19, alignItems: 'center', justifyContent: 'center' }, swipeShell: { marginBottom: 1, overflow: 'hidden', borderRadius: 14 }, deleteReveal: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 63, backgroundColor: '#E05252', borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, deleteHidden: { opacity: 0 }, item: { minHeight: 70, padding: 9, borderRadius: 14, backgroundColor: '#FAFAFB', flexDirection: 'row', alignItems: 'center', gap: 9 }, orderBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F5822A', alignItems: 'center', justifyContent: 'center' }, orderBadgeText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' }, itemImage: { width: 50, height: 50, borderRadius: 11, backgroundColor: '#E9EEF2' }, imageFallback: { alignItems: 'center', justifyContent: 'center' }, imageInitial: { color: '#426177', fontSize: 19, fontWeight: '700' }, itemCopy: { flex: 1, minWidth: 0 }, itemName: { fontSize: 14, fontWeight: '700', color: '#212124' }, itemAddress: { fontSize: 12, color: '#85858C', marginTop: 2 }, itemNote: { color: '#48708C', fontSize: 11, lineHeight: 15, marginTop: 4, fontStyle: 'italic' }, noteButton: { width: 40, height: 30, borderRadius: 9, backgroundColor: '#EEF6FD' }, dragHandle: { width: 28, height: 36, alignItems: 'center', justifyContent: 'center' }, footer: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#DDE7E5', backgroundColor: '#FFFFFF' }, secondarySave: { flex: 0.82, height: 50, borderRadius: 18, backgroundColor: '#EDF2F1', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }, secondarySaveText: { color: '#1F3938', fontSize: 14, fontWeight: '700' }, primarySave: { flex: 1.45, height: 50, borderRadius: 18, backgroundColor: '#0F766E', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }, primarySaveText: { color: '#FFF', fontSize: 14, fontWeight: '700' }, modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.28)' }, modalSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#FFF', paddingBottom: 28 }, modalHeader: { minHeight: 64, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5E8' }, modalCancel: { color: '#6D6D73', fontSize: 16 }, modalTitle: { color: '#1D1D20', fontSize: 16, fontWeight: '700', textAlign: 'center' }, modalSubtitle: { color: '#85858C', fontSize: 11, textAlign: 'center', marginTop: 2 }, modalSave: { color: '#007AFF', fontSize: 16, fontWeight: '700' }, wheels: { height: 236, flexDirection: 'row', paddingHorizontal: 30 }, wheelContent: { paddingVertical: 72, flexGrow: 1 }, wheelDivider: { width: StyleSheet.hairlineWidth, backgroundColor: '#E8E8EC', marginVertical: 25 }, wheelOption: { minHeight: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 10 }, wheelOptionSelected: { backgroundColor: '#EAF4FF' }, wheelOptionLocked: { opacity: 0.32 }, wheelText: { color: '#6A6A70', fontSize: 16 }, wheelTextSelected: { color: '#1874B8', fontWeight: '700' }, wheelTextLocked: { color: '#9CA3AF' }, noDayNote: { color: '#6B7280', fontSize: 12, lineHeight: 17, marginHorizontal: 30, marginTop: -12, textAlign: 'center' },
  timeConflictToast: { position: 'absolute', top: 70, left: 18, right: 18, minHeight: 38, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: '#FFF7E8', borderWidth: 1, borderColor: '#F3D29B', flexDirection: 'row', alignItems: 'center', gap: 7, zIndex: 10, shadowColor: '#9A6B2F', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 }, timeConflictText: { flex: 1, color: '#8A5600', fontSize: 12, lineHeight: 16, fontWeight: '600' },
});
