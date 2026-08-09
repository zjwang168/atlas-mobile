import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppDialog } from '@/components/feedback/AppDialog';
import { Text } from '@/components/ui/text';
import VoiceInputButton from '@/components/voice-input/VoiceInputButton';
import { useHome } from '@/features/home/HomeContext';
import type { MapMarker } from '@/features/map/MapboxMap';
import { discoverAtlasPlaces, requestAtlasRoute, type AtlasRouteResponse } from '@/services/api/apiService';
import { addAtlasOwnedPlaces, addPlacesToAtlas, removePlaceFromAtlas, reorderAtlasPlaces, updateAtlasPlace } from '@/services/atlas/atlasPlacesService';
import { createAtlas, updateAtlas } from '@/services/atlas/atlasService';
import { createSearchSession, isAbortError, resolvePlace, suggestPlaces } from '@/services/place/placeSearchService';
import type { SavedPlace } from '@/services/place/placeService';
import type { AtlasPlace } from '@/types/place';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  LayoutAnimation,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Location from 'expo-location';

export type DraftPlace = Pick<SavedPlace, 'id' | 'name' | 'subtitle' | 'latitude' | 'longitude' | 'photo_url' | 'city' | 'region' | 'country' | 'category'> & {
  source?: 'saved' | 'recommended' | 'search';
  aiDescription?: string | null;
  note?: string | null;
  timeline_day?: number | null;
  timeline_time?: string | null;
  transport?: TransportMode | null;
  joinId?: string;
};

type TransportMode = 'walk' | 'bike' | 'drive' | 'taxi' | 'bus' | 'coach' | 'subway' | 'train' | 'ferry' | 'flight';

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
  onSaved: (atlasId: string, askAI: boolean) => void;
  atlasId?: string;
  initialCandidates?: DraftPlace[];
  initialItems?: DraftPlace[];
  initialCenter?: [number, number];
  initialBounds?: { ne: [number, number]; sw: [number, number] };
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
const CONTINENTAL_US_CENTER = [-98.5, 40.4] as [number, number];
const CONTINENTAL_US_ZOOM = 1.9;

function boundsFromPolygon(polygon: Array<[number, number]>, padding = 0.06) {
  const minLng = Math.min(...polygon.map(([lng]) => lng));
  const maxLng = Math.max(...polygon.map(([lng]) => lng));
  const minLat = Math.min(...polygon.map(([, lat]) => lat));
  const maxLat = Math.max(...polygon.map(([, lat]) => lat));
  return { ne: [maxLng + padding, maxLat + padding] as [number, number], sw: [minLng - padding, minLat - padding] as [number, number] };
}

function zoomForBounds(bounds: { ne: [number, number]; sw: [number, number] }) {
  const longitudeSpan = Math.max(0.05, Math.abs(bounds.ne[0] - bounds.sw[0]));
  const latitudeSpan = Math.max(0.05, Math.abs(bounds.ne[1] - bounds.sw[1]));
  const widthZoom = Math.log2((360 * 390) / (512 * longitudeSpan));
  const heightZoom = Math.log2((170 * 360) / (512 * latitudeSpan));
  return Math.max(1.9, Math.min(14, Math.min(widthZoom, heightZoom) - 0.25));
}

function polygonAroundCoordinate([lng, lat]: [number, number], lngRadius: number, latRadius: number, points = 10) {
  return Array.from({ length: points }, (_, index) => {
    const angle = (Math.PI * 2 * index) / points;
    return [lng + Math.cos(angle) * lngRadius, lat + Math.sin(angle) * latRadius] as [number, number];
  });
}

function acceptAiDescription(value?: string | null) {
  const description = value?.trim();
  if (!description || description.split(/\s+/).length > 4) return null;
  return description;
}

const BAY_AREA_POLYGON: Array<[number, number]> = [
  [-122.75, 38.18], [-122.16, 38.16], [-121.66, 37.90], [-121.62, 37.28], [-122.06, 37.08],
  [-122.55, 37.15], [-123.00, 37.43], [-123.08, 37.88], [-122.95, 38.08], [-122.75, 38.18],
];
const BAY_AREA_BOUNDS = boundsFromPolygon(BAY_AREA_POLYGON, 0.08);

const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const timeRank = (day: number, time: string) => day * 24 + Math.max(0, PLANNING_HOURS.indexOf(time) + 7);

function toDraft(place: SavedPlace, row?: AtlasPlace): DraftPlace {
  return {
    id: place.id,
    name: place.name,
    subtitle: place.subtitle,
    latitude: place.latitude,
    longitude: place.longitude,
    photo_url: place.photo_url,
    city: place.city,
    region: place.region,
    country: place.country,
    category: place.category,
    source: 'saved',
    note: row?.note,
    timeline_day: row?.timeline_day,
    timeline_time: row?.timeline_time,
    joinId: row?.id,
  };
}

function toDraftFromRow(row: AtlasPlace, saved?: SavedPlace): DraftPlace | null {
  if (saved) return toDraft(saved, row);
  if (row.latitude == null || row.longitude == null || !row.place_name) return null;
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
    note: row.note,
    timeline_day: row.timeline_day,
    timeline_time: row.timeline_time,
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
  const latitudeDelta = Math.abs(place.latitude - center[1]);
  const longitudeDelta = Math.abs(place.longitude - center[0]);
  return latitudeDelta < 1.25 && longitudeDelta < 1.5;
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
      // The polygon is an internal camera footprint. It is intentionally a
      // little wider than the saved points so a regional plan remains useful.
      bounds: boundsFromPolygon(group.map((place) => [place.longitude, place.latitude] as [number, number]), 0.18),
    }))
    .filter((area) => Boolean(area.label))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildAtlasTitle(items: DraftPlace[]) {
  const categories = items.map((item) => normalize(item.category ?? item.name)).join(' ');
  if (/museum|gallery|art/.test(categories)) return 'Artful Day Out';
  if (/park|trail|garden|nature/.test(categories)) return 'A Day Outside';
  if (/restaurant|cafe|food|bakery/.test(categories)) return 'A Tasteful Day';
  return items.length === 1 ? 'A Place To Remember' : 'A Day Well Spent';
}

export default function AtlasBuilder({ onClose, onSaved, atlasId, initialCandidates, initialItems, initialCenter, initialBounds, started = false, onItemsChange, onFirstPlaceAdded, onBuildPlan }: AtlasBuilderProps) {
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
  const [mapZoom, setMapZoom] = useState(initialBounds ? CONTINENTAL_US_ZOOM : CONTINENTAL_US_ZOOM);
  const [mapBounds, setMapBounds] = useState<{ ne: [number, number]; sw: [number, number] } | undefined>(initialBounds);
  const [route, setRoute] = useState<AtlasRouteResponse | null>(null);
  const [generatingRoute, setGeneratingRoute] = useState(false);
  const [savingKind, setSavingKind] = useState<'atlas' | 'ai' | null>(null);
  const [timeModalIndex, setTimeModalIndex] = useState<number | null>(null);
  const [pendingDay, setPendingDay] = useState(1);
  const [pendingTime, setPendingTime] = useState('9am');
  const [transportModalIndex, setTransportModalIndex] = useState<number | null>(null);
  const [recommendedPlaces, setRecommendedPlaces] = useState<DraftPlace[]>(initialCandidates ?? []);
  const popupScale = useRef(new Animated.Value(0.92)).current;
  const popupOpacity = useRef(new Animated.Value(0)).current;
  const searchAppear = useRef(new Animated.Value(0)).current;
  const cameraKey = useRef(`atlas-builder-${Date.now()}-${Math.random().toString(36).slice(2)}`).current;
  const initialPlaceSelected = useRef(false);

  const existingAtlas = useMemo(() => atlases.find((atlas) => atlas.id === atlasId), [atlasId, atlases]);
  const focusAreas = useMemo(() => deriveFocusAreas(savedPlaces), [savedPlaces]);
  useEffect(() => {
    if (started && initialCandidates) setRecommendedPlaces(initialCandidates);
  }, [initialCandidates, started]);

  useEffect(() => {
    if (!started) return;
    if (initialCenter) setMapCenter(initialCenter);
    if (initialBounds) {
      setMapBounds(initialBounds);
      setMapZoom(zoomForBounds(initialBounds));
    }
  }, [initialBounds, initialCenter, started]);

  useEffect(() => {
    setTabBarVisible(false);
    return () => setTabBarVisible(true);
  }, [setTabBarVisible]);

  useEffect(() => {
    Animated.timing(searchAppear, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [searchAppear]);

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
    setRoute(existingAtlas?.route_geojson && existingAtlas.route_visible ? {
      route: existingAtlas.route_geojson,
      distance_km: 0,
      duration_minutes: 0,
    } : null);
  }, [atlasId, atlasPlaces, existingAtlas?.route_geojson, existingAtlas?.route_visible, savedPlaces]);

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
      const local = savedPlaces.filter((place) => isLocalMatch(place, trimmed)).slice(0, 2)
        .map((place): SearchResult => ({ kind: 'saved', place }));
      setResults(local);
      if (local.length === 2) {
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const remote = await suggestPlaces(trimmed, searchSession, mapCenter ? { proximity: mapCenter } : {}, controller.signal);
        if (controller.signal.aborted) return;
        const localIds = new Set(local.map((result) => result.kind === 'saved' ? result.place.id : ''));
        const uniqueRemote = remote
          .filter((suggestion) => !savedPlaces.some((place) => localIds.has(place.id) || normalize(place.name) === normalize(suggestion.name)))
          .slice(0, 2 - local.length)
          .map((suggestion): SearchResult => ({ kind: 'remote', externalId: suggestion.external_id, name: suggestion.name, subtitle: suggestion.place_formatted ?? suggestion.full_address ?? '', featureType: suggestion.feature_type }));
        setResults([...local, ...uniqueRemote]);
      } catch (error) {
        if (!isAbortError(error)) console.warn('[AtlasBuilder] search failed', error);
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
    setMapZoom(bounds ? CONTINENTAL_US_ZOOM : 15);
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

  const discoverDeepSeekPlaces = useCallback(async (city: string, count: number): Promise<DraftPlace[]> => {
    const result = await discoverAtlasPlaces(`推荐${city}${count}个出名地点。只需返回地名、坐标，以及一个description字段。description必须是每个地点专属的车牌式英文slogan，最多4个英文单词；不要返回地点分类，不要截取一句话的前4个词，也不要写完整句子。风格参考：The Emerald Needle、Where Fish Fly、Glass Without Limits、Rock Meets Tech、Art By The Sound、Skyline Capital、Rainforest Not Rain、Wisdom Under Cherry、Where Water Works、Wheel Over Waves。`);
    return result.locations.slice(0, count).map((place, index): DraftPlace => ({
      id: `deepseek-${city}-${place.external_id ?? index}`,
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
    }));
  }, []);

  const discoverFocusPolygon = useCallback(async (area: string) => {
    const result = await discoverAtlasPlaces(`我要用10个点做一个多边形框住${area}，给我这10个点的坐标。只返回10个边界坐标点，不要返回景点。`);
    const polygon = result.locations
      .slice(0, 10)
      .filter((point) => Number.isFinite(point.longitude) && Number.isFinite(point.latitude))
      .map((point) => [point.longitude, point.latitude] as [number, number]);
    return polygon.length >= 3 ? boundsFromPolygon(polygon, 0.12) : undefined;
  }, []);

  const handoffToPlan = useCallback((location: string, candidates: DraftPlace[], center?: [number, number], bounds?: FocusArea['bounds']) => {
    onBuildPlan?.(location, candidates, center, bounds);
  }, [onBuildPlan]);

  const focusArea = useCallback(async (area: FocusArea) => {
    const initial = area.places.map((item) => toDraft(item));
    if (!initial.length) return;
    handoffToPlan(area.label, initial, area.coordinate, area.bounds);
    try {
      const [recommendations, polygonBounds] = await Promise.all([
        discoverDeepSeekPlaces(area.label, 10),
        discoverFocusPolygon(area.label),
      ]);
      setRecommendedPlaces(recommendations);
      handoffToPlan(area.label, [...initial, ...recommendations], area.coordinate, polygonBounds ?? area.bounds);
    } catch (error) {
      console.warn('[AtlasBuilder] plan discovery failed', error);
    }
  }, [discoverDeepSeekPlaces, discoverFocusPolygon, handoffToPlan]);

  const simpleStart = useCallback(async () => {
    const nearbySaved = savedPlaces.filter((place) => isNearCoordinate(place, userLocation)).map((place) => toDraft(place));
    const localBounds = Math.abs(userLocation[0] + 122.4) < 1.1 && Math.abs(userLocation[1] - 37.7) < 0.9
      ? BAY_AREA_BOUNDS
      : boundsFromPolygon(polygonAroundCoordinate(userLocation, 1.1, 0.8), 0.08);
    // Enter the Builder immediately. Reverse geocoding and AI discovery should
    // improve the map after it opens, never block the transition.
    const initialCity = nearbySaved.find((place) => place.city)?.city ?? 'San Francisco';
    handoffToPlan(initialCity, nearbySaved, userLocation, localBounds);

    let city = 'your area';
    try {
      const [address] = await Location.reverseGeocodeAsync({ latitude: userLocation[1], longitude: userLocation[0] });
      city = address?.city ?? address?.subregion ?? address?.region ?? city;
    } catch (error) {
      console.warn('[AtlasBuilder] reverse geocoding failed', error);
    }
    try {
      const [recommendations, polygonBounds] = await Promise.all([
        discoverDeepSeekPlaces(city, 10),
        discoverFocusPolygon(city),
      ]);
      setRecommendedPlaces(recommendations);
      handoffToPlan(city, [...nearbySaved, ...recommendations], userLocation, polygonBounds ?? localBounds);
    } catch (error) {
      // Recommendations are optional; search and saved places remain usable.
      console.warn('[AtlasBuilder] simple start recommendations failed', error);
    }
  }, [discoverDeepSeekPlaces, discoverFocusPolygon, handoffToPlan, savedPlaces, userLocation]);

  useEffect(() => {
    if (!started || atlasId || initialPlaceSelected.current) return;
    const candidates = started && initialCandidates ? initialCandidates : savedPlaces.map((place) => toDraft(place));
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
  }, [atlasId, initialCandidates, popupOpacity, popupScale, savedPlaces, started]);

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

  const addPlace = useCallback((place: DraftPlace) => {
    const alreadyAdded = items.some((item) => item.id === place.id);
    if (!alreadyAdded) {
      const nextItems = [...items, place];
      setItems(nextItems);
      onItemsChange?.(nextItems);
      onFirstPlaceAdded?.();
    }
    setFocused(place);
    setPopupVisible(false);
    setQuery('');
    setResults([]);
  }, [items, onFirstPlaceAdded, onItemsChange]);

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
      setFullResults([...local, ...remote.map((suggestion): SearchResult => ({ kind: 'remote', externalId: suggestion.external_id, name: suggestion.name, subtitle: suggestion.place_formatted ?? suggestion.full_address ?? '', featureType: suggestion.feature_type }))].filter((result) => {
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
    const nextItems = items.filter((item) => item.id !== place.id);
    commitItems(nextItems);
    setFocused((current) => current?.id === place.id ? null : current);
    setPopupVisible(false);
    if (place.joinId) removePlaceFromAtlas(place.joinId).catch((error) => console.warn('[AtlasBuilder] remove failed', error));
  }, [commitItems, items]);

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
    setPendingDay(existing?.timeline_day ?? 1);
    setPendingTime(existing?.timeline_time ?? '9am');
    setTimeModalIndex(index);
  }, [items]);

  const saveTimeDivider = useCallback(() => {
    if (timeModalIndex === null) return;
    const rank = timeRank(pendingDay, pendingTime);
    const previous = items.slice(0, timeModalIndex).reverse().find((item) => item.timeline_day && item.timeline_time);
    const next = items.slice(timeModalIndex + 1).find((item) => item.timeline_day && item.timeline_time);
    if (previous && rank < timeRank(previous.timeline_day!, previous.timeline_time!)) {
      showDialog({ title: 'Time is out of order', message: 'Choose a time after the previous divider.', tone: 'warning' });
      return;
    }
    if (next && rank > timeRank(next.timeline_day!, next.timeline_time!)) {
      showDialog({ title: 'Time is out of order', message: 'Choose a time before the next divider.', tone: 'warning' });
      return;
    }
    commitItems(items.map((item, index) => index === timeModalIndex ? { ...item, timeline_day: pendingDay, timeline_time: pendingTime } : item));
    const persisted = items[timeModalIndex];
    if (persisted?.joinId) updateAtlasPlace(persisted.joinId, { timeline_day: pendingDay, timeline_time: pendingTime }).catch(console.warn);
    setTimeModalIndex(null);
  }, [commitItems, items, pendingDay, pendingTime, showDialog, timeModalIndex]);

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

  const persist = useCallback(async (askAI: boolean) => {
    if (!items.length) {
      showDialog({ title: 'Choose a place first', message: 'Select at least one point on the map.', tone: 'warning' });
      return;
    }
    setSavingKind(askAI ? 'ai' : 'atlas');
    try {
      const atlas = atlasId ? existingAtlas : await createAtlas(buildAtlasTitle(items));
      if (!atlas) throw new Error('Atlas could not be created');
      const existingRows = atlasPlaces.filter((row) => row.atlas_id === atlas.id);
      const existingIds = new Set(existingRows.map((row) => row.place_id ?? row.external_place_id));
      const savedIds = new Set(savedPlaces.map((place) => place.id));
      const newSaved = items.filter((item) => savedIds.has(item.id) && !existingIds.has(item.id));
      const newOwned = items.filter((item) => !savedIds.has(item.id) && !existingIds.has(item.id));
      const [savedRows, ownedRows] = await Promise.all([
        addPlacesToAtlas(atlas.id, newSaved.map((item) => item.id)),
        addAtlasOwnedPlaces(atlas.id, newOwned.map((item) => ({ ...item, external_place_id: item.id }))),
      ]);
      const joins = new Map([...existingRows, ...savedRows, ...ownedRows].map((row) => [row.place_id ?? row.external_place_id, row]));
      await Promise.all(items.map((item, index) => {
        const join = item.joinId ? { id: item.joinId } : joins.get(item.id);
        return join ? updateAtlasPlace(join.id, { sort_order: index, note: item.note ?? null, timeline_day: item.timeline_day ?? null, timeline_time: item.timeline_time ?? null }) : Promise.resolve();
      }));
      await updateAtlas(atlas.id, { title: atlas.title, route_geojson: route?.route ?? null, route_visible: Boolean(route) });
      onSaved(atlas.id, askAI);
    } catch (error) {
      console.warn('[AtlasBuilder] saving failed', error);
      showDialog({ title: 'Atlas was not saved', message: 'Please check your connection and try again.', tone: 'warning' });
    } finally {
      setSavingKind(null);
    }
  }, [atlasId, atlasPlaces, existingAtlas, items, onSaved, route, savedPlaces, showDialog]);

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
    const atlasItems = items.map((item, index) => ({ id: item.id, latitude: item.latitude, longitude: item.longitude, title: item.name, description: item.subtitle, tone: 'atlas' as const, order: index + 1 }));
    const focusedSearch = focused && !selected.has(focused.id)
      && !savedPlaces.some((place) => place.id === focused.id)
      && !recommendedPlaces.some((place) => place.id === focused.id)
      ? [{ id: focused.id, latitude: focused.latitude, longitude: focused.longitude, title: focused.name, description: focused.subtitle, labelHint: focused.aiDescription ?? undefined, ai: focused.source === 'recommended', tone: focused.source === 'recommended' ? 'recommended' as const : 'atlas' as const }]
      : [];
    return [...saved, ...recommended, ...atlasItems, ...focusedSearch];
  }, [focused, initialCandidates, items, recommendedPlaces, savedPlaces, started]);

  const mapSearchOverlay = useMemo(() => <Animated.View pointerEvents="box-none" style={[styles.mapSearchLayer, { opacity: searchAppear, transform: [{ translateX: searchAppear.interpolate({ inputRange: [0, 1], outputRange: [-34, 0] }) }, { scaleX: searchAppear.interpolate({ inputRange: [0, 1], outputRange: [0.18, 1] }) }] }]}>
    <View pointerEvents="auto" style={styles.mapSearchBox}>
      <Ionicons name="search" size={18} color="#6B7280" />
      <TextInput ref={inputRef} value={query} onChangeText={setQuery} placeholder="Search places" placeholderTextColor="#8E8E93" style={styles.searchInput} returnKeyType="search" onSubmitEditing={openFullSearch} />
      {searching ? <ActivityIndicator size="small" color="#2563EB" /> : <TouchableOpacity accessibilityLabel="Search all places" onPress={openFullSearch} style={styles.searchSubmit}><Ionicons name="arrow-forward" size={17} color="#2563EB" /></TouchableOpacity>}
    </View>
    {results.length > 0 ? <View pointerEvents="auto" style={styles.results}>{results.map((result) => {
      const key = result.kind === 'saved' ? result.place.id : result.externalId;
      return <View key={key} style={styles.resultRow}><TouchableOpacity style={styles.resultCopy} onPress={() => handleResultFocus(result)}><View style={styles.resultTitleRow}><Text numberOfLines={1} style={styles.resultName}>{result.kind === 'saved' ? result.place.name : result.name}</Text>{result.kind === 'saved' ? <View style={styles.savedTag}><Text style={styles.savedTagText}>Saved</Text></View> : null}</View><Text numberOfLines={1} style={styles.resultAddress}>{result.kind === 'saved' ? result.place.subtitle : result.subtitle}</Text></TouchableOpacity><TouchableOpacity accessibilityLabel="Add to Atlas" disabled={addingResult === key} onPress={() => handleResultAdd(result)} style={[styles.addResultButton, addingResult === key && styles.addResultButtonPending]}>{addingResult === key ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="add" size={18} color="#FFF" />}</TouchableOpacity></View>;
    })}</View> : null}
  </Animated.View>, [addingResult, handleResultAdd, handleResultFocus, openFullSearch, query, results, searchAppear, searching]);

  const atlasMapOverlay = useMemo(() => <>
    {mapSearchOverlay}
    {popupVisible && focused ? <View pointerEvents="box-none" style={styles.mapCandidateLayer}><View pointerEvents="auto"><MapPinPopup place={focused} added={items.some((item) => item.id === focused.id)} onAdd={() => addPlace(focused)} /></View></View> : null}
  </>, [addPlace, focused, items, mapSearchOverlay, popupVisible, recommendedPlaces.length]);

  useEffect(() => {
    setAtlasMapState({
      markers: mapMarkers,
      centerCoordinate: mapCenter,
      zoomLevel: mapZoom,
      // Polygon bounds are used to derive mapZoom above. Passing bounds to
      // Mapbox as well creates a competing camera update on some devices.
      bounds: undefined,
      cameraKey,
      selectedMarkerId: focused?.id ?? null,
      routeGeoJSON: route?.route,
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
      overlay: atlasMapOverlay,
      hideTopSearchButton: true,
      markerPopup: null,
    });
  }, [atlasId, atlasMapOverlay, atlasPlaces, cameraKey, focus, focused, hideTransientUI, mapBounds, mapCenter, mapMarkers, mapZoom, recommendedPlaces, route?.route, savedPlaces, setAtlasMapState]);

  useEffect(() => () => setAtlasMapState(null), [setAtlasMapState]);

  const timeTags = useMemo(() => items.filter((item) => item.timeline_day && item.timeline_time)
    .map((item) => ({ id: item.id, label: `Day ${item.timeline_day} · ${item.timeline_time}`, item })), [items]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.heading}>{atlasId || started ? 'Edit atlas' : 'Create an atlas'}</Text>
          {items.length === 0 && !started && !atlasId ? <Text style={styles.landingLabel}>Pick a place to explore</Text> : null}
        </View>
        <View style={styles.headerRight}><TouchableOpacity accessibilityLabel="Close Atlas editor" onPress={onClose} style={styles.headerIcon}><Ionicons name="close" size={19} color="#26262A" /></TouchableOpacity></View>
      </View>

      {!atlasId && items.length === 0 && !started ? <View style={styles.createLanding}>
        <View style={styles.simpleStartHero}><TouchableOpacity onPress={simpleStart} style={styles.simpleStartHeroButton}><View style={styles.simpleStartHeroTop}><View style={styles.simpleStartHeroIcon}><Ionicons name="map-outline" size={26} color="#0F766E" /></View><Ionicons name="arrow-forward" size={21} color="#0F766E" /></View><View style={styles.simpleStartHeroCopy}><Text style={styles.simpleStartHeroTitle}>Simple Start</Text><Text style={styles.simpleStartHeroSubtitle}>Build an atlas from scratch</Text></View></TouchableOpacity></View>
        <View style={styles.planListSection}><FocusAreas areas={focusAreas} onFocus={focusArea} /></View>
      </View> : items.length === 0 ? <AtlasEmptySkeleton /> : <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {items.map((item, index) => <View key={item.id}>
          <View style={styles.itemActionsRow}>
            {!item.timeline_day || !item.timeline_time ? <TimeInsert onPress={() => openTimePicker(index)} /> : <View style={styles.timeTagInline}><Text style={styles.timeTagText}>Day {item.timeline_day} · {item.timeline_time}</Text></View>}
            <TransportInsert mode={item.transport ?? null} onPress={() => setTransportModalIndex(index)} />
          </View>
          {item.transport ? <TransportConnector mode={item.transport} first={index === 0} /> : null}
          <AtlasItem item={item} index={index} onFocus={() => focus(item)} onRemove={() => removePlace(item)} onMove={movePlace} onNote={(note) => { commitItems(items.map((entry) => entry.id === item.id ? { ...entry, note } : entry)); if (item.joinId) updateAtlasPlace(item.joinId, { note }).catch(console.warn); }} />
        </View>)}
      </ScrollView>}

      {items.length > 0 ? <View style={styles.footer}><TouchableOpacity disabled={savingKind !== null} onPress={() => persist(false)} style={styles.secondarySave}>{savingKind === 'atlas' ? <ActivityIndicator color="#1F3938" /> : <><Ionicons name="bookmark-outline" size={16} color="#1F3938" /><Text style={styles.secondarySaveText}>Save</Text></>}</TouchableOpacity><TouchableOpacity disabled={savingKind !== null} onPress={() => persist(true)} style={styles.primarySave}>{savingKind === 'ai' ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="sparkles" size={16} color="#FFF" /><Text style={styles.primarySaveText}>Save and Ask AI</Text></>}</TouchableOpacity></View> : null}
      <TimePickerModal visible={timeModalIndex !== null} day={pendingDay} time={pendingTime} onChangeDay={setPendingDay} onChangeTime={setPendingTime} onClose={() => setTimeModalIndex(null)} onSave={saveTimeDivider} />
      <TransportPickerModal visible={transportModalIndex !== null} selected={transportModalIndex === null ? null : items[transportModalIndex]?.transport ?? null} onSelect={(mode) => { if (transportModalIndex !== null) commitItems(items.map((entry, index) => index === transportModalIndex ? { ...entry, transport: mode } : entry)); setTransportModalIndex(null); }} onClose={() => setTransportModalIndex(null)} />
      <Modal visible={fullResults !== null} animationType="slide" onRequestClose={() => setFullResults(null)}><View style={styles.fullSearch}><View style={styles.fullSearchHeader}><TouchableOpacity onPress={() => setFullResults(null)} style={styles.headerIcon}><Ionicons name="chevron-back" size={20} color="#26262A" /></TouchableOpacity><Text style={styles.fullSearchTitle}>Search results</Text><View style={styles.headerIcon} /></View><ScrollView contentContainerStyle={styles.fullResults}>{fullResults?.map((result) => { const key = result.kind === 'saved' ? result.place.id : result.externalId; return <View key={key} style={styles.fullResultRow}><TouchableOpacity style={styles.resultCopy} onPress={() => { setFullResults(null); handleResultFocus(result); }}><Text style={styles.resultName}>{result.kind === 'saved' ? result.place.name : result.name}</Text><Text style={styles.resultAddress}>{result.kind === 'saved' ? result.place.subtitle : result.subtitle}</Text></TouchableOpacity><TouchableOpacity disabled={addingResult === key} onPress={() => { setFullResults(null); handleResultAdd(result); }} style={styles.addResultButton}>{addingResult === key ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="add" size={18} color="#FFF" />}</TouchableOpacity></View>; })}</ScrollView></View></Modal>
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
  const [typedHint, setTypedHint] = useState('');
  const hint = '现在，加入第一个点进入 Atlas';

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

  useEffect(() => {
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setTypedHint(hint.slice(0, index));
      if (index >= hint.length) clearInterval(timer);
    }, 115);
    return () => clearInterval(timer);
  }, [hint]);

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
            <Text style={styles.emptyAtlasHint}>{typedHint}</Text>
            <Text style={styles.emptyAtlasHintSub}>点击上方地点标签的 + 添加点</Text>
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

function MapPinPopup({ place, added, onAdd }: { place: DraftPlace; added: boolean; onAdd: () => void }) {
  return <View style={styles.mapPopup}><View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.pinName}>{place.name}</Text><Text numberOfLines={1} style={styles.pinAddress}>{place.subtitle}</Text></View>{added ? <View style={styles.addedPill}><Ionicons name="checkmark" size={13} color="#A44D1A" /><Text style={styles.addedPillText}>Added</Text></View> : <TouchableOpacity accessibilityLabel="Add to Atlas" onPress={onAdd} style={styles.mapPinAction}><Ionicons name="add" size={19} color="#FFF" /></TouchableOpacity>}</View>;
}

function TimeInsert({ onPress }: { onPress: () => void }) {
  return <TouchableOpacity accessibilityLabel="Add a time divider" onPress={onPress} style={styles.transportInsertButton}><Ionicons name="time-outline" size={13} color="#64748B" /><Text style={styles.dividerAddText}>Add time</Text></TouchableOpacity>;
}

function TransportInsert({ mode, onPress }: { mode: TransportMode | null; onPress: () => void }) {
  const option = TRANSPORT_OPTIONS.find((entry) => entry.mode === mode);
  return <TouchableOpacity accessibilityLabel="Add transport" onPress={onPress} style={styles.transportInsertButton}>
    <Ionicons name={option?.icon ?? 'swap-horizontal-outline'} size={13} color="#64748B" />
    <Text style={styles.dividerAddText}>{option?.label ?? 'Add transport'}</Text>
  </TouchableOpacity>;
}

function TransportConnector({ mode, first }: { mode: TransportMode; first: boolean }) {
  const option = TRANSPORT_OPTIONS.find((entry) => entry.mode === mode);
  if (!option) return null;
  return <View style={[styles.transportConnector, first && styles.transportConnectorFirst]} pointerEvents="none">
    <View style={styles.transportConnectorLine} />
    <View style={styles.transportConnectorIcon}><Ionicons name={option.icon} size={15} color="#64748B" /></View>
    <View style={styles.transportConnectorLine} />
  </View>;
}

function TransportPickerModal({ visible, selected, onSelect, onClose }: { visible: boolean; selected: TransportMode | null; onSelect: (mode: TransportMode) => void; onClose: () => void }) {
  return <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
    <Pressable onPress={onClose} style={styles.modalBackdrop}>
      <Pressable onPress={(event) => event.stopPropagation()} style={styles.modalSheet}>
        <View style={styles.modalHeader}><TouchableOpacity onPress={onClose}><Text style={styles.modalCancel}>Cancel</Text></TouchableOpacity><Text style={styles.modalTitle}>Add transport</Text><View style={{ width: 48 }} /></View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.transportOptions}>
          {TRANSPORT_OPTIONS.map((option) => <TouchableOpacity key={option.mode} onPress={() => onSelect(option.mode)} style={[styles.transportOption, selected === option.mode && styles.transportOptionSelected]}><Ionicons name={option.icon} size={21} color={selected === option.mode ? '#0F766E' : '#64748B'} /><Text style={[styles.transportOptionText, selected === option.mode && styles.transportOptionTextSelected]}>{option.label}</Text></TouchableOpacity>)}
        </ScrollView>
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

function TimePickerModal({ visible, day, time, onChangeDay, onChangeTime, onClose, onSave }: { visible: boolean; day: number; time: string; onChangeDay: (day: number) => void; onChangeTime: (time: string) => void; onClose: () => void; onSave: () => void }) {
  return <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}><Pressable onPress={onClose} style={styles.modalBackdrop}><Pressable onPress={(event) => event.stopPropagation()} style={styles.modalSheet}><View style={styles.modalHeader}><TouchableOpacity onPress={onClose}><Text style={styles.modalCancel}>Cancel</Text></TouchableOpacity><View><Text style={styles.modalTitle}>Schedule time</Text><Text style={styles.modalSubtitle}>Place it in your itinerary</Text></View><TouchableOpacity onPress={onSave}><Text style={styles.modalSave}>Done</Text></TouchableOpacity></View><View style={styles.wheels}><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.wheelContent}>{Array.from({ length: 14 }, (_, index) => index + 1).map((value) => <TouchableOpacity key={value} onPress={() => onChangeDay(value)} style={[styles.wheelOption, day === value && styles.wheelOptionSelected]}><Text style={[styles.wheelText, day === value && styles.wheelTextSelected]}>Day {value}</Text></TouchableOpacity>)}</ScrollView><View style={styles.wheelDivider} /><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.wheelContent}>{PLANNING_HOURS.map((value) => <TouchableOpacity key={value} onPress={() => onChangeTime(value)} style={[styles.wheelOption, time === value && styles.wheelOptionSelected]}><Text style={[styles.wheelText, time === value && styles.wheelTextSelected]}>{value}</Text></TouchableOpacity>)}</ScrollView></View></Pressable></Pressable></Modal>;
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
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '55%' },
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
  emptyAtlasHint: { color: '#64727A', fontSize: 13, lineHeight: 18, fontWeight: '700', minHeight: 18 },
  emptyAtlasHintSub: { color: '#98A4AA', fontSize: 10, lineHeight: 14, minHeight: 14 },
  emptyAtlasLine: { width: '78%', height: 11, borderRadius: 6, backgroundColor: '#D3DBDE' },
  emptyAtlasLineShort: { width: '48%', height: 9, backgroundColor: '#DEE4E7' },
  emptyAtlasHandle: { width: 25, height: 34, borderRadius: 8, backgroundColor: '#E0E6E8' },
  emptyAtlasConnector: { width: 2, height: 16, borderRadius: 1, alignSelf: 'center', backgroundColor: '#DDE4E7' },
  mapSearchLayer: { position: 'absolute', top: 62, left: 16, right: 16, zIndex: 20 },
  mapSearchBox: { minHeight: 46, borderRadius: 18, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 8, shadowColor: '#111827', shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 7 },
  searchSubmit: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  addResultButtonPending: { backgroundColor: '#94A3B8' },
  mapCandidateLayer: { position: 'absolute', left: 16, right: 16, bottom: '60%', alignItems: 'center', zIndex: 30 },
  mapPopup: { width: 312, minHeight: 76, borderRadius: 14, backgroundColor: '#FFFFFF', paddingHorizontal: 15, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', shadowColor: '#111827', shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 8 },
  mapPopupArrow: { position: 'absolute', top: -7, left: '50%', marginLeft: -7, width: 14, height: 14, backgroundColor: '#FFFFFF', transform: [{ rotate: '45deg' }] },
  mapPinAction: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#16A34A', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  itemNoteModern: { color: '#475569', fontSize: 12, lineHeight: 17, marginTop: 5, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: '#CBD5E1', fontWeight: '500' },
  fullSearch: { flex: 1, backgroundColor: '#FFFFFF', paddingTop: 54 },
  fullSearchHeader: { minHeight: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  fullSearchTitle: { color: '#18181B', fontSize: 17, fontWeight: '700' },
  fullResults: { padding: 16, gap: 8 },
  fullResultRow: { minHeight: 62, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 14, backgroundColor: '#F8FAFC', flexDirection: 'row', alignItems: 'center', gap: 8 },
  dividerAddText: { color: '#64748B', fontSize: 10, fontWeight: '700' },
  itemActionsRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  transportInsertButton: { minHeight: 26, paddingHorizontal: 9, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, backgroundColor: '#F1F5F9' },
  transportConnector: { height: 28, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  transportConnectorFirst: { marginTop: 1 },
  transportConnectorLine: { width: 1, height: 11, backgroundColor: '#CBD5E1' },
  transportConnectorIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  timeTagInline: { borderRadius: 12, backgroundColor: '#EAF4FF', paddingHorizontal: 9, paddingVertical: 5 },
  transportOptions: { paddingHorizontal: 18, paddingBottom: 28, gap: 8 },
  transportOption: { minHeight: 48, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F8FAFC' },
  transportOptionSelected: { backgroundColor: '#E6F5F1' },
  transportOptionText: { color: '#475569', fontSize: 15, fontWeight: '600' },
  transportOptionTextSelected: { color: '#0F766E' },
  root: { flex: 1, backgroundColor: '#FFFFFF' }, header: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E4ECEA' }, headerCopy: { flex: 1, minWidth: 0, paddingRight: 12 }, heading: { fontSize: 24, fontWeight: '700', color: '#183431' }, landingLabel: { color: '#0F766E', fontSize: 12, fontWeight: '800', marginTop: 4 }, subheading: { fontSize: 12, color: '#74747B', marginTop: 2 }, headerIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#F0F4F3', alignItems: 'center', justifyContent: 'center' }, searchLayer: { paddingHorizontal: 16, zIndex: 4 }, searchBox: { minHeight: 46, borderRadius: 14, backgroundColor: '#F4F5F6', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 8 }, searchInput: { flex: 1, fontSize: 16, color: '#1D1D21', paddingVertical: 9 }, results: { marginTop: 6, backgroundColor: '#FFF', borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.13, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 5 }, resultRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingVertical: 10, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E7E8EA' }, resultCopy: { flex: 1 }, resultTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, resultName: { color: '#1B1B1D', fontSize: 14, fontWeight: '600', flexShrink: 1 }, resultAddress: { color: '#77777D', fontSize: 12, marginTop: 2 }, savedTag: { backgroundColor: '#E9F3FF', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }, savedTagText: { color: '#2F78B4', fontSize: 10, fontWeight: '700' }, addResultButton: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#007AFF' }, pinPopup: { marginHorizontal: 16, marginTop: 10, borderRadius: 14, backgroundColor: '#FFFFFF', padding: 12, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.13, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 5 }, pinName: { color: '#19191B', fontSize: 14, fontWeight: '700' }, pinAddress: { color: '#77777D', fontSize: 12, marginTop: 2 }, pinAction: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center', marginLeft: 8 }, addedPill: { flexDirection: 'row', gap: 3, alignItems: 'center', backgroundColor: '#FFF0E6', borderRadius: 13, paddingHorizontal: 9, paddingVertical: 6 }, addedPillText: { color: '#B5551B', fontSize: 11, fontWeight: '700' }, listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 7 }, listHeading: { color: '#1A1A1C', fontSize: 18, fontWeight: '700' }, routeButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 34, paddingHorizontal: 10, borderWidth: 1, borderColor: '#B7D8D2', borderRadius: 10, backgroundColor: '#FFFFFF' }, routeButtonActive: { backgroundColor: '#0F766E', borderColor: '#0F766E' }, routeButtonText: { color: '#0F766E', fontSize: 12, fontWeight: '700' }, routeButtonTextActive: { color: '#FFF' }, timeTags: { paddingHorizontal: 16, paddingBottom: 5, gap: 6 }, routeTimeTag: { borderRadius: 12, backgroundColor: '#F2F5F7', paddingHorizontal: 9, paddingVertical: 5 }, routeTimeTagText: { color: '#53616B', fontSize: 11, fontWeight: '600' }, emptyList: { flex: 1, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14 }, emptyText: { color: '#71827F', fontSize: 14, lineHeight: 20, maxWidth: 260 }, focusSection: { marginTop: 18, flexDirection: 'row', gap: 10, height: 122 }, focusList: { flex: 1 }, focusListContent: { gap: 10, paddingBottom: 16 }, focusRow: { minHeight: 70, padding: 10, borderRadius: 14, backgroundColor: '#F6F8F7', flexDirection: 'row', alignItems: 'center', gap: 10 }, focusText: { color: '#274845', fontSize: 14, fontWeight: '700', flexShrink: 1 }, focusRail: { width: 23, borderRadius: 12, backgroundColor: '#EFF1F2', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 6 }, focusRailPaused: { backgroundColor: '#E0EDF7' }, focusRailThumb: { width: 4, height: 30, borderRadius: 2, backgroundColor: '#94B1C5' }, list: { flex: 1, paddingHorizontal: 15 }, listContent: { paddingBottom: 10 }, timeTag: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: '#EAF4FF', paddingHorizontal: 9, paddingVertical: 4, marginBottom: 5 }, timeTagText: { color: '#3179B7', fontSize: 11, fontWeight: '700' }, dividerAdd: { height: 19, alignItems: 'center', justifyContent: 'center' }, swipeShell: { marginBottom: 1, overflow: 'hidden', borderRadius: 14 }, deleteReveal: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 63, backgroundColor: '#E05252', borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, deleteHidden: { opacity: 0 }, item: { minHeight: 70, padding: 9, borderRadius: 14, backgroundColor: '#FAFAFB', flexDirection: 'row', alignItems: 'center', gap: 9 }, orderBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F5822A', alignItems: 'center', justifyContent: 'center' }, orderBadgeText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' }, itemImage: { width: 50, height: 50, borderRadius: 11, backgroundColor: '#E9EEF2' }, imageFallback: { alignItems: 'center', justifyContent: 'center' }, imageInitial: { color: '#426177', fontSize: 19, fontWeight: '700' }, itemCopy: { flex: 1, minWidth: 0 }, itemName: { fontSize: 14, fontWeight: '700', color: '#212124' }, itemAddress: { fontSize: 12, color: '#85858C', marginTop: 2 }, itemNote: { color: '#48708C', fontSize: 11, lineHeight: 15, marginTop: 4, fontStyle: 'italic' }, noteButton: { width: 40, height: 30, borderRadius: 9, backgroundColor: '#EEF6FD' }, dragHandle: { width: 28, height: 36, alignItems: 'center', justifyContent: 'center' }, footer: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#DDE7E5', backgroundColor: '#FFFFFF' }, secondarySave: { flex: 0.82, height: 48, borderRadius: 12, backgroundColor: '#EDF2F1', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }, secondarySaveText: { color: '#1F3938', fontSize: 14, fontWeight: '700' }, primarySave: { flex: 1.45, height: 48, borderRadius: 12, backgroundColor: '#0F766E', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }, primarySaveText: { color: '#FFF', fontSize: 14, fontWeight: '700' }, modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.28)' }, modalSheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#FFF', paddingBottom: 28 }, modalHeader: { minHeight: 64, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5E8' }, modalCancel: { color: '#6D6D73', fontSize: 16 }, modalTitle: { color: '#1D1D20', fontSize: 16, fontWeight: '700', textAlign: 'center' }, modalSubtitle: { color: '#85858C', fontSize: 11, textAlign: 'center', marginTop: 2 }, modalSave: { color: '#007AFF', fontSize: 16, fontWeight: '700' }, wheels: { height: 236, flexDirection: 'row', paddingHorizontal: 30 }, wheelContent: { paddingVertical: 72, flexGrow: 1 }, wheelDivider: { width: StyleSheet.hairlineWidth, backgroundColor: '#E8E8EC', marginVertical: 25 }, wheelOption: { minHeight: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 10 }, wheelOptionSelected: { backgroundColor: '#EAF4FF' }, wheelText: { color: '#6A6A70', fontSize: 16 }, wheelTextSelected: { color: '#1874B8', fontWeight: '700' },
});
