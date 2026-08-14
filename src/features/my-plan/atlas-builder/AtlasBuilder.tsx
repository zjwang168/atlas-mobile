import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppDialog } from '@/components/feedback/AppDialog';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useHomeAtlases, useHomeLocation, useHomeOverlayActions, useHomePlaces } from '@/features/home/HomeContext';
import type { MapMarker } from '@/features/map/MapboxMap';
import { discoverAtlasPlaces, geocodeAtlasArea, geocodePlaceSearch, getLandmarkSeeds, requestAtlasRoute, type AtlasRouteResponse } from '@/services/api/apiService';
import { addAtlasOwnedPlaces, addPlacesToAtlas, removePlaceFromAtlas, reorderAtlasPlaces, updateAtlasPlaces, updateAtlasPlace } from '@/services/atlas/atlasPlacesService';
import { encodeAtlasPlaceMetadata } from '@/services/atlas/atlasPlaceMetadata';
import { createAtlas, updateAtlas } from '@/services/atlas/atlasService';
import { createSearchSession, isAbortError, resolvePlace, suggestPlaces } from '@/services/place/placeSearchService';
import type { GeocodedLocation } from '@/types/route';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  LayoutAnimation,
  Modal,
  Platform,
  ScrollView,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import Reanimated, { FadeInDown, FadeOutUp, Layout } from 'react-native-reanimated';
import * as Location from 'expo-location';

import { AtlasCandidateCard } from './AtlasCandidateCard';
import { AtlasEmptySkeleton } from './AtlasEmptySkeleton';
import { AtlasItem } from './AtlasItem';
import { ATLAS_MINIMUM_BOUNDS_ZOOM, CONTINENTAL_US_CENTER, CONTINENTAL_US_ZOOM, FOCUS_SAVED_PLACES_RADIUS_KM, SEARCH_DEBOUNCE_MS, type TransportMode } from './constants';
import { FocusAreas } from './FocusAreas';
import { TimeInsert, TransportInsert } from './InsertControls';
import { atlasPlaceSnapshot, toDraft, toDraftFromRow } from './mappers';
import { styles } from './styles';
import { TimePickerModal } from './TimePickerModal';
import { TransportPickerModal } from './TransportPickerModal';
import type { AtlasBuilderProps, DraftPlace, FocusArea, SearchResult } from './types';
import {
  acceptAiDescription,
  boundsFromPolygon,
  boundsFromRadius,
  buildAtlasTitle,
  centerOfBounds,
  clusterLocationNames,
  deriveFocusAreas,
  expandBounds,
  focusBoundsForSavedPlaces,
  isLocalMatch,
  isMarkerOverlap,
  isNearCoordinate,
  isWithinBounds,
  normalize,
  savedPlacesMatchingAdministrativeFocus,
  timeOfDayRank,
  timeRank,
  uniquePlaces,
  waitForFirstAtlasPaint,
  zoomForBounds,
} from './utils';

export type { AtlasSavedMapView, DraftPlace } from './types';

// Roughly 0.5 cm on an iPhone 17 Pro Max. Applied only to the blank Create
// landing camera so the GPS-country map sits a little higher above the sheet.
const CREATE_ATLAS_CAMERA_VERTICAL_OFFSET = 48;
// Tune these while checking the Edit Atlas onboarding hint on device.
const EDIT_ATLAS_PINCH_HINT_DELAY_MS = 4000;
const EDIT_ATLAS_PINCH_HINT_VISIBLE_MS = 3000;

export default function AtlasBuilder({ onClose, onSaved, atlasId, initialCandidates, initialItems, initialCenter, initialBounds, initialLocation, started = false, autoFocusCreateSearch = false, onItemsChange, onFirstPlaceAdded, onCreateCameraSettled, onBuildPlan, onReturnToCreateSearch }: AtlasBuilderProps) {
  const { show: showDialog } = useAppDialog();
  const { savedPlaces } = useHomePlaces();
  const { atlasPlaces, atlases } = useHomeAtlases();
  const { setAtlasMapState, setTabBarVisible } = useHomeOverlayActions();
  const { userLocation, isLocationFallback, refreshUserLocation } = useHomeLocation();
  /**
   * The token for the search the user is currently typing. Keystrokes share it
   * — that is what makes them one session rather than one each — and the
   * `/retrieve` that resolves the chosen result ends it, after which
   * `resolveResult` rotates it. A ref, not a value, precisely so it can be
   * replaced when Mapbox considers the session spent.
   */
  const searchSessionRef = useRef(createSearchSession());
  const queryAbortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingResult, setAddingResult] = useState<string | null>(null);
  const [fullResults, setFullResults] = useState<SearchResult[] | null>(null);
  const [items, setItems] = useState<DraftPlace[]>(initialItems ?? []);
  const [focused, setFocused] = useState<DraftPlace | null>(null);
  const [searchCandidateVisible, setSearchCandidateVisible] = useState(false);
  const seedAttemptedRef = useRef(false);
  const seedUserInteractedRef = useRef(false);
  const seedRequestIdRef = useRef(0);
  const seedAutoSelectedRef = useRef(false);
  const seedCameraAdjustedRef = useRef(false);
  const [seedNoteVisible, setSeedNoteVisible] = useState(false);
  const seedNoteOpacity = useRef(new Animated.Value(0)).current;
  const seedNoteShownRef = useRef(false);
  const seedNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>(initialCenter ?? CONTINENTAL_US_CENTER);
  const [mapZoom, setMapZoom] = useState(initialBounds ? zoomForBounds(initialBounds, 1.2) : CONTINENTAL_US_ZOOM);
  const [mapBounds, setMapBounds] = useState<{ ne: [number, number]; sw: [number, number] } | undefined>(initialBounds);
  const [route, setRoute] = useState<AtlasRouteResponse | null>(null);
  const [generatingRoute, setGeneratingRoute] = useState(false);
  const [savingKind, setSavingKind] = useState<'atlas' | 'ai' | null>(null);
  const [saveActionsOpen, setSaveActionsOpen] = useState(false);
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
  const [pinchHintVisible, setPinchHintVisible] = useState(false);
  const [nearbyRecommending, setNearbyRecommending] = useState(false);
  const isCreateAtlasLanding = !atlasId && !started && !handoffStarted;
  const searchAppear = useRef(new Animated.Value(0)).current;
  const localMustSeesOpacity = useRef(new Animated.Value(0)).current;
  const nearbyPromptOpacity = useRef(new Animated.Value(0)).current;
  const pinchHintOpacity = useRef(new Animated.Value(0)).current;
  const pinchHintScale = useRef(new Animated.Value(0.94)).current;
  const pinchHintGesture = useRef(new Animated.Value(0)).current;
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
  const pinchHintShownRef = useRef(false);
  const pinchHintShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinchHintHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinchHintGestureAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  // Each mounted editor owns one recommendation conversation. Closing an
  // Atlas and entering Edit Atlas again mounts a fresh editor and new session.
  const aiRecommendationSessionId = useRef(`atlas-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`).current;
  const aiRecommendedNamesRef = useRef(new Set((initialCandidates ?? []).map((place) => normalize(place.name)).filter(Boolean)));
  const [cameraKey, setCameraKey] = useState(`atlas-builder-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [searchCandidateBottom, setSearchCandidateBottom] = useState(0);
  // Country bounds can resolve before the editor sheet has reported its real
  // height. Hold one correction so the GPS-country camera is always fitted
  // against the upper, unobscured map viewport rather than the full screen.
  const pendingCreateCountryBoundsRef = useRef<{ ne: [number, number]; sw: [number, number] } | null>(null);
  const createCountryBoundsAlignedRef = useRef(false);
  const createCameraAwaitingIdleRef = useRef(false);
  const createCameraSettledRef = useRef(false);
  const createCameraSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelHeightRef = useRef(0);
  const initialPlaceSelected = useRef(false);
  const timeConflictTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Saving hands the shared map directly to the completed Atlas. Its unmount
  // must not clear that handoff before the detail page has hydrated its rows.
  const preserveMapOnUnmountRef = useRef(false);

  const schedulePinchHint = useCallback(() => {
    if (isCreateAtlasLanding || pinchHintShownRef.current) return;
    pinchHintShownRef.current = true;
    if (pinchHintShowTimerRef.current) clearTimeout(pinchHintShowTimerRef.current);
    if (pinchHintHideTimerRef.current) clearTimeout(pinchHintHideTimerRef.current);
    pinchHintShowTimerRef.current = setTimeout(() => {
      setPinchHintVisible(true);
      Animated.parallel([
        Animated.timing(pinchHintOpacity, { toValue: 1, duration: 240, useNativeDriver: true }),
        Animated.spring(pinchHintScale, { toValue: 1, damping: 16, stiffness: 190, useNativeDriver: true }),
      ]).start();
      pinchHintGestureAnimationRef.current?.stop();
      pinchHintGesture.setValue(0);
      pinchHintGestureAnimationRef.current = Animated.loop(Animated.sequence([
        Animated.timing(pinchHintGesture, { toValue: 1, duration: 760, useNativeDriver: true }),
        Animated.timing(pinchHintGesture, { toValue: 0, duration: 760, useNativeDriver: true }),
      ]));
      pinchHintGestureAnimationRef.current.start();
      pinchHintHideTimerRef.current = setTimeout(() => {
        pinchHintGestureAnimationRef.current?.stop();
        Animated.parallel([
          Animated.timing(pinchHintOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
          Animated.timing(pinchHintScale, { toValue: 0.96, duration: 220, useNativeDriver: true }),
        ]).start(({ finished }) => {
          if (finished) setPinchHintVisible(false);
        });
      }, EDIT_ATLAS_PINCH_HINT_VISIBLE_MS);
    }, EDIT_ATLAS_PINCH_HINT_DELAY_MS);
  }, [isCreateAtlasLanding, pinchHintGesture, pinchHintOpacity, pinchHintScale]);

  const finishCreateCameraSettle = useCallback(() => {
    if (!isCreateAtlasLanding || createCameraSettledRef.current) return;
    createCameraAwaitingIdleRef.current = false;
    createCameraSettledRef.current = true;
    if (createCameraSettleTimerRef.current) {
      clearTimeout(createCameraSettleTimerRef.current);
      createCameraSettleTimerRef.current = null;
    }
    onCreateCameraSettled?.();
  }, [isCreateAtlasLanding, onCreateCameraSettled]);

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

  useEffect(() => () => {
    if (pinchHintShowTimerRef.current) clearTimeout(pinchHintShowTimerRef.current);
    if (pinchHintHideTimerRef.current) clearTimeout(pinchHintHideTimerRef.current);
    pinchHintGestureAnimationRef.current?.stop();
    if (createCameraSettleTimerRef.current) clearTimeout(createCameraSettleTimerRef.current);
  }, []);

  useEffect(() => {
    schedulePinchHint();
  }, [schedulePinchHint]);

  useEffect(() => {
    if (initialLocation && normalize(initialLocation) !== 'your area') setFocusLabel(initialLocation);
  }, [initialLocation]);

  const existingAtlas = useMemo(() => atlases.find((atlas) => atlas.id === atlasId), [atlasId, atlases]);
  useEffect(() => {
    if (existingAtlas?.title) setAtlasTitle(existingAtlas.title);
  }, [existingAtlas?.title]);
  const focusAreas = useMemo(() => deriveFocusAreas(savedPlaces), [savedPlaces]);
  const undefinedDayLocked = useMemo(() => items.some((item) => Boolean(item.timeline_time) && !item.timeline_day), [items]);
  const saveDisabled = items.length === 0;
  useEffect(() => {
    if (saveDisabled) setSaveActionsOpen(false);
  }, [saveDisabled]);
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
        // Keep the initial view in the flat-map range while the country
        // boundary resolves. The final bounds fit respects Home's live
        // bottom-sheet padding, so the country stays in the usable upper map
        // viewport without briefly showing the globe.
        setMapCenter(deviceLocation);
        setMapBounds(undefined);
        setMapZoom(ATLAS_MINIMUM_BOUNDS_ZOOM);
        const [address] = await Location.reverseGeocodeAsync({
          latitude: deviceLocation[1],
          longitude: deviceLocation[0],
        });
        const country = address?.country ?? address?.isoCountryCode;
        if (!country) return;
        const resolvedCountry = await geocodeAtlasArea(country);
        if (cancelled || !resolvedCountry?.bounds) return;
        // Leave a little more geographic breathing room on the initial
        // Create screen. Search and completed-Atlas cameras remain unchanged.
        const countryBounds = expandBounds(resolvedCountry.bounds, 0.3);
        viewportCenterRef.current = centerOfBounds(countryBounds);
        viewportZoomRef.current = zoomForBounds(countryBounds, 1.1);
        pendingCreateCountryBoundsRef.current = countryBounds;
        // If the sheet has already reported, this first fit already receives
        // its current padding. Otherwise `handlePanelHeightChange` below
        // replays the bounds when the panel becomes measurable.
        createCountryBoundsAlignedRef.current = panelHeightRef.current > 0;
        if (createCountryBoundsAlignedRef.current) pendingCreateCountryBoundsRef.current = null;
        setMapCenter(viewportCenterRef.current);
        setMapBounds(countryBounds);
        setMapZoom(viewportZoomRef.current);
        setCameraKey(`atlas-country-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        // Mapbox normally confirms this command through onMapIdle. Start the
        // same once-only fallback here too, because a reused native map can
        // occasionally skip the bounds-applied callback during first mount.
        if (createCameraSettleTimerRef.current) clearTimeout(createCameraSettleTimerRef.current);
        createCameraSettleTimerRef.current = setTimeout(finishCreateCameraSettle, 1800);
      } catch (error) {
        // Location and country lookup are a presentation enhancement; search
        // remains available when either service is unavailable.
        console.warn('[AtlasBuilder] country camera unavailable', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [finishCreateCameraSettle, isCreateAtlasLanding, refreshUserLocation]);

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

  const scheduleNearbyPrompt = useCallback((center: [number, number], delay = 3_000) => {
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
    const timeout = setTimeout(hideLocalMustSees, 3_000);
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
      if (!isCreateAtlasLanding) console.info('[AtlasEditSearch] cleared');
      setResults([]);
      setSearching(false);
      return;
    }
    queryAbortRef.current?.abort();
    const controller = new AbortController();
    queryAbortRef.current = controller;
    // Edit Atlas always searches a fixed 70 km radius around the focus area
    // it opened with. It does not blend in saved-place matches.
    // The restored green seed is the authoritative Edit Atlas focus. The
    // initial bounds can be a stale/wide handoff viewport (and may not even
    // contain the recovered focus), so never derive POI search from it when a
    // focused place is available.
    const editSearchCenter = focused
      ? [focused.longitude, focused.latitude] as [number, number]
      : initialCenter ?? (initialBounds ? centerOfBounds(initialBounds) : mapCenter);
    const editFocusBounds = !isCreateAtlasLanding ? boundsFromRadius(editSearchCenter, 70) : undefined;
    const local: SearchResult[] = [];
    setResults([]);
    setSearching(true);
    let geographicResult: SearchResult | null = null;
    const withGeographicResult = (remote: SearchResult[]) => geographicResult
      ? [geographicResult, ...remote.filter((result) => result.kind !== 'remote' || normalize(result.name) !== normalize(geographicResult?.kind === 'remote' ? geographicResult.name : ''))].slice(0, 8)
      : remote;

    // Search Box is capped at 10 requests/s per access token. Waiting briefly
    // after typing stops avoids turning each keystroke into an upstream call.
    // `proximity` only biases Mapbox's ranking. The bbox is the hard 70 km
    // filter that prevents remote POIs from leaking into Edit Atlas results.
    const editFocusBbox = editFocusBounds
      ? `${editFocusBounds.sw[0]},${editFocusBounds.sw[1]},${editFocusBounds.ne[0]},${editFocusBounds.ne[1]}`
      : undefined;
    const logContext = { query: trimmed, center: editSearchCenter, radiusKm: 70, bbox: editFocusBbox };
    if (!isCreateAtlasLanding) console.info('[AtlasEditSearch] scheduled', logContext);
    const timer = setTimeout(() => void suggestPlaces(
      trimmed,
      searchSessionRef.current,
      isCreateAtlasLanding
        ? { proximity: mapCenter, types: 'poi,place,locality,district,region,country', includeNonPoi: true }
        : { ...(mapCenter ? { proximity: mapCenter } : {}), ...(editFocusBbox ? { bbox: editFocusBbox } : {}) },
      controller.signal,
    ).then(async (remote) => {
      if (controller.signal.aborted) return;
      if (!isCreateAtlasLanding) console.info('[AtlasEditSearch] response', { ...logContext, received: remote.length, names: remote.map((item) => item.name) });
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
      let nextResults = isCreateAtlasLanding ? withGeographicResult(uniqueRemote) : uniqueRemote.slice(0, 4);
      // Search Box does not reliably index local-language and pinyin POIs.
      // Only when it produced no usable POI do we ask the existing geocoder
      // for one fallback, then keep the same Atlas-area boundary guarantee.
      if (!isCreateAtlasLanding && nextResults.length === 0 && trimmed.length >= 2) {
        const fallback = await geocodePlaceSearch(trimmed, controller.signal);
        if (controller.signal.aborted) return;
        if (fallback && (!editFocusBounds || isWithinBounds({ latitude: fallback.latitude, longitude: fallback.longitude }, editFocusBounds))) {
          nextResults = [{
            kind: 'remote',
            externalId: `geocoder-${fallback.longitude},${fallback.latitude}`,
            name: fallback.name,
            subtitle: fallback.full_address,
            featureType: fallback.category ?? 'poi',
            coordinate: [fallback.longitude, fallback.latitude],
          }];
        }
      }
      if (!isCreateAtlasLanding) console.info('[AtlasEditSearch] displayed', { ...logContext, count: nextResults.length, names: nextResults.map((item) => item.kind === 'remote' ? item.name : item.place.name) });
      setResults(nextResults);
    }).catch((error) => {
      if (!controller.signal.aborted && !isAbortError(error)) {
        console.warn('[AtlasBuilder] search failed', error);
        if (!isCreateAtlasLanding) console.warn('[AtlasEditSearch] failed', { ...logContext, error: error instanceof Error ? error.message : String(error) });
        setResults([]);
      }
    }).finally(() => {
      if (!controller.signal.aborted) {
        if (!isCreateAtlasLanding) console.info('[AtlasEditSearch] finished', logContext);
        setSearching(false);
      }
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
  }, [focused, initialBounds, initialCenter, isCreateAtlasLanding, mapCenter, query]);

  const hideTransientUI = useCallback(() => {
    seedUserInteractedRef.current = true;
    if (seedNoteTimerRef.current) clearTimeout(seedNoteTimerRef.current);
    setSeedNoteVisible(false);
    Keyboard.dismiss();
    inputRef.current?.blur();
    setResults([]);
    setFocused(null);
    setSearchCandidateVisible(false);
  }, []);

  const handleQueryChange = useCallback((nextQuery: string) => {
    // State set from TextInput's event is visible one render earlier than a
    // useEffect, so the spinner responds on the actual keystroke. Abort the
    // previous query here as well; waiting for effect cleanup lets slow mobile
    // networks accumulate obsolete requests while somebody is still typing.
    queryAbortRef.current?.abort();
    if (atlasId) console.info('[AtlasEditSearch] input', { query: nextQuery });
    setQuery(nextQuery);
    if (nextQuery.trim().length >= 1) {
      setResults([]);
      setSearching(true);
    } else {
      setResults([]);
      setSearching(false);
    }
  }, []);

  const focus = useCallback((place: DraftPlace, bounds?: { ne: [number, number]; sw: [number, number] }, showSearchCandidate = false) => {
    seedUserInteractedRef.current = true;
    if (seedNoteTimerRef.current) clearTimeout(seedNoteTimerRef.current);
    setSeedNoteVisible(false);
    setFocused(place);
    setMapCenter([place.longitude, place.latitude]);
    setMapBounds(bounds);
    setMapZoom(bounds ? zoomForBounds(bounds) : 15);
    setSearchCandidateVisible(showSearchCandidate);
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

  // Pick one real, saveable POI for an otherwise empty focus area. This is a
  // fast Mapbox path; AI recommendations can arrive later without blocking the
  // first Add action.
  const resolveFocusSeed = useCallback(async (center: [number, number], bounds?: { ne: [number, number]; sw: [number, number] }, areaLabel?: string) => {
    const startedAt = Date.now();
    const log = (message: string, data?: Record<string, unknown>) => console.info('[AtlasSeed]', message, { ...data, elapsedMs: Date.now() - startedAt });
    log('start', { center, bounds });
    try {
      const landmarks = await getLandmarkSeeds(center);
      log('landmark-index', { count: landmarks.length, names: landmarks.slice(0, 5).map((landmark) => landmark.name) });
      for (const landmark of landmarks) {
        const candidate: DraftPlace = {
          id: landmark.id,
          name: landmark.name,
          subtitle: areaLabel?.trim() || 'Landmark',
          longitude: landmark.longitude,
          latitude: landmark.latitude,
          photo_url: null,
          city: areaLabel?.trim() || null,
          region: null,
          country: null,
          category: landmark.category,
          source: 'search',
        };
        const duplicateSaved = savedPlaces.some((saved) => isMarkerOverlap(saved, candidate));
        const insideBounds = !bounds || isWithinBounds(candidate, bounds);
        log('landmark-candidate', { name: candidate.name, insideBounds, duplicateSaved, source: landmark.source });
        if (insideBounds && !duplicateSaved) {
          log('landmark-selected', { name: candidate.name, source: landmark.source });
          return candidate;
        }
      }
    } catch (error) {
      console.warn('[AtlasSeed] landmark-index-failed', { error });
    }
    const area = areaLabel?.trim();
    const queries = [
      ...(area ? [`${area} attractions`, `${area} landmarks`, `${area} parks`] : []),
      'attractions',
      'landmark',
      'park',
    ];
    for (const query of queries) {
      // Seeding is the one path that resolves several candidates in a row: a
      // suggestion carries no coordinates, so each has to be retrieved before
      // its bounds and duplicate checks can run. Every `/retrieve` ends a
      // session at Mapbox, so each pairing gets its own token rather than
      // stacking retrieves onto one — which is what the API calls reusing a
      // token across sessions, and bills unpredictably.
      let seedSession = createSearchSession();
      const suggestions = await suggestPlaces(query, seedSession, { proximity: center, includeNonPoi: true, types: 'poi' });
      log('suggestions', { query, count: suggestions.length, names: suggestions.slice(0, 5).map((item) => item.name) });
      for (const suggestion of suggestions) {
        const resolved = await resolvePlace(suggestion, seedSession);
        // Spent the moment the retrieve above returns; the next candidate in
        // this loop must not inherit it.
        seedSession = createSearchSession();
        if (!resolved) {
          log('retrieve-empty', { query, id: suggestion.external_id, name: suggestion.name });
          continue;
        }
        const candidate: DraftPlace = {
        id: suggestion.external_id,
        name: resolved.name,
        subtitle: resolved.subtitle,
        latitude: resolved.latitude,
        longitude: resolved.longitude,
        photo_url: resolved.imageUri ?? null,
        city: resolved.city ?? null,
        region: null,
        country: resolved.country ?? null,
        category: resolved.type ?? suggestion.feature_type ?? null,
        source: 'search',
        };
        const duplicateSaved = savedPlaces.some((saved) => isMarkerOverlap(saved, candidate));
        const insideBounds = !bounds || isWithinBounds(candidate, bounds);
        log('candidate', { query, name: candidate.name, coordinate: [candidate.longitude, candidate.latitude], insideBounds, duplicateSaved });
        if (insideBounds && !duplicateSaved) {
          log('selected', { name: candidate.name });
          return candidate;
        }
        log('rejected', { name: candidate.name, reason: !insideBounds ? 'outside-focus-bounds' : 'saved-place-overlap' });
      }
    }
    log('no-candidate');
    return null;
  }, [savedPlaces]);

  useEffect(() => {
    // This is only for a newly opened focus area with no saved-pin candidate.
    // An existing Atlas hydrates its persisted items asynchronously and must
    // never receive an unsolicited seed point.
    if (!started || atlasId || seedAttemptedRef.current || items.length > 0 || focused) return;
    const center = initialCenter ?? mapCenter;
    const bounds = mapBounds ?? initialBounds;
    const savedCandidatesInBounds = savedPlaces
      .filter((place) => bounds ? isWithinBounds(place, bounds) : isNearCoordinate(place, center))
      .sort((left, right) => {
        const leftDistance = (left.longitude - center[0]) ** 2 + (left.latitude - center[1]) ** 2;
        const rightDistance = (right.longitude - center[0]) ** 2 + (right.latitude - center[1]) ** 2;
        return leftDistance - rightDistance;
      });
    const focusName = normalize(initialLocation ?? '');
    const savedCandidatesMatchingFocus = focusName
      ? savedPlaces.filter((place) => [place.city, place.region, place.country].some((value) => normalize(value ?? '') === focusName))
      : [];
    // A stale or malformed entry coordinate can point at a different region
    // from the focus label. Recover using the user's saved places for that
    // named area instead of attempting remote discovery around the bad center.
    const recoveredFocus = !savedCandidatesInBounds.length && savedCandidatesMatchingFocus.length > 0;
    const candidatePool = recoveredFocus ? savedCandidatesMatchingFocus : savedCandidatesInBounds;
    const savedCandidate = candidatePool.length
      ? candidatePool[Math.floor(Math.random() * candidatePool.length)]
      : undefined;
    if (savedCandidate) {
      seedAttemptedRef.current = true;
      seedAutoSelectedRef.current = true;
      if (recoveredFocus) {
        const recoveredBounds = focusBoundsForSavedPlaces(
          [savedCandidate.longitude, savedCandidate.latitude],
          savedCandidatesMatchingFocus,
        );
        setMapCenter(centerOfBounds(recoveredBounds));
        setMapBounds(recoveredBounds);
        setMapZoom(zoomForBounds(recoveredBounds));
      }
      console.info('[AtlasSeed] saved-place-selected', {
        name: savedCandidate.name,
        coordinate: [savedCandidate.longitude, savedCandidate.latitude],
        source: 'seed-effect',
        inBoundsCount: savedCandidatesInBounds.length,
        matchingFocusCount: savedCandidatesMatchingFocus.length,
        recoveredFocus,
        initialLocation,
      });
      setFocused(toDraft(savedCandidate));
      return;
    }
    seedAttemptedRef.current = true;
    const requestId = ++seedRequestIdRef.current;
    console.info('[AtlasSeed] effect-start', { requestId, center, bounds, savedPlaces: savedPlaces.length });
    void resolveFocusSeed(center, bounds, initialLocation).then((place) => {
      const stale = requestId !== seedRequestIdRef.current;
      console.info('[AtlasSeed] result', { requestId, place: place?.name ?? null, stale, userInteracted: seedUserInteractedRef.current });
      if (!stale && !seedUserInteractedRef.current && place) {
        seedAutoSelectedRef.current = true;
        setFocused(place);
      }
    }).catch((error) => {
      console.warn('[AtlasSeed] failed', { requestId, error });
    });
    return () => {
      // Do not cancel an in-flight request when savedPlaces finishes hydrating;
      // that context update recreates resolveFocusSeed and used to strand the
      // one-shot seed before Mapbox retrieve could run.
    };
  }, [atlasId, focused, initialBounds, initialCenter, initialLocation, items.length, mapBounds, mapCenter, resolveFocusSeed, savedPlaces, started]);

  useEffect(() => {
    // Mapbox Search Box can return generic POIs from another region for broad
    // queries. Once Atlas AI has already supplied visible, verified purple
    // pins, one of those is a better guaranteed default than leaving the Add
    // bar empty while Mapbox exhausts its fallback terms.
    if (!started || atlasId || focused || items.length > 0 || seedUserInteractedRef.current) return;
    const fallback = recommendedPlaces.find((place) => (
      place.source === 'recommended'
      && !place.provisional
      && !savedPlaces.some((saved) => isMarkerOverlap(saved, place))
    ));
    if (!fallback) return;
    console.info('[AtlasSeed] ai-fallback-selected', {
      name: fallback.name,
      coordinate: [fallback.longitude, fallback.latitude],
    });
    seedAutoSelectedRef.current = true;
    setFocused(fallback);
  }, [atlasId, focused, items.length, recommendedPlaces, savedPlaces, started]);

  useEffect(() => {
    // Preserve the entry camera until its focus bounds have been applied.
    // When the actual GPS fix is part of that entry area, fit it with the
    // automatic green candidate. Otherwise retain the normal candidate focus.
    if (!focused || !seedAutoSelectedRef.current || seedCameraAdjustedRef.current || mapBounds) return;
    seedCameraAdjustedRef.current = true;
    const seedCoordinate: [number, number] = [focused.longitude, focused.latitude];
    const deviceIsInEntryArea = !isLocationFallback
      && Boolean(initialBounds)
      && isWithinBounds({ longitude: userLocation[0], latitude: userLocation[1] }, initialBounds);
    const seedBounds = deviceIsInEntryArea
      ? focusBoundsForSavedPlaces(seedCoordinate, [{ longitude: userLocation[0], latitude: userLocation[1] }])
      : undefined;
    const seedVisibleZoom = seedBounds ? zoomForBounds(seedBounds, 10.5) : Math.max(mapZoom, 10.5);
    if (seedBounds) setMapBounds(seedBounds);
    if (seedVisibleZoom !== mapZoom) setMapZoom(seedVisibleZoom);
    // HomeScreen supplies the bottom-sheet height as Mapbox camera padding.
    // Centering on the candidate here therefore places it at the center of the
    // remaining visible (upper) map viewport, rather than at the full-screen
    // center where the sheet can obscure it.
    setMapCenter(seedBounds ? centerOfBounds(seedBounds) : seedCoordinate);
    console.info('[AtlasSeed] camera-visibility-focus', {
      name: focused.name,
      previousCenter: mapCenter,
      center: seedBounds ? centerOfBounds(seedBounds) : seedCoordinate,
      previousZoom: mapZoom,
      zoom: seedVisibleZoom,
      includedDeviceLocation: deviceIsInEntryArea,
    });
  }, [focused, initialBounds, isLocationFallback, mapBounds, mapCenter, mapZoom, userLocation]);

  useEffect(() => {
    if (!focused || !seedAutoSelectedRef.current || seedNoteShownRef.current || items.length > 0) return;
    seedNoteShownRef.current = true;
    seedNoteTimerRef.current = setTimeout(() => {
      if (seedUserInteractedRef.current) return;
      setSeedNoteVisible(true);
      seedNoteOpacity.setValue(0);
      Animated.timing(seedNoteOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      seedNoteTimerRef.current = setTimeout(() => {
        Animated.timing(seedNoteOpacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setSeedNoteVisible(false));
        seedNoteTimerRef.current = null;
      }, 3000);
    }, 2000);
    return () => {
      if (seedNoteTimerRef.current) clearTimeout(seedNoteTimerRef.current);
    };
  }, [focused, items.length, seedNoteOpacity]);

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
    hideNearbyPrompt();
    setNearbyRecommending(true);
    const [longitude, latitude] = viewportCenterRef.current;
    try {
      const recommendationCount = 3;
      // The seed endpoint caps radius_km at 12. Keeping this request within
      // its contract prevents FastAPI from rejecting the button tap with 422.
      const landmarks = await getLandmarkSeeds([longitude, latitude], 12);
      const existingPlaces = [...items, ...recommendedPlaces, ...savedPlaces];
      const nearby = landmarks.reduce<DraftPlace[]>((places, landmark) => {
        const candidate: DraftPlace = {
          id: landmark.id,
          name: landmark.name,
          subtitle: 'Landmark',
          longitude: landmark.longitude,
          latitude: landmark.latitude,
          photo_url: null,
          city: null,
          region: null,
          country: null,
          category: landmark.category,
          // Keep the established purple recommendation marker treatment.
          source: 'recommended',
        };
        if (
          places.length >= recommendationCount
          || existingPlaces.some((place) => isMarkerOverlap(place, candidate))
          || places.some((place) => isMarkerOverlap(place, candidate))
        ) return places;
        places.push(candidate);
        return places;
      }, []);
      // Dense areas normally have enough indexed landmarks. When they do not,
      // complete this tap's promised three purple pins with new, nearby AI
      // recommendations while preserving the same duplicate checks.
      if (nearby.length < recommendationCount) {
        existingPlaces.forEach((place) => aiRecommendedNamesRef.current.add(normalize(place.name)));
        nearby.forEach((place) => aiRecommendedNamesRef.current.add(normalize(place.name)));
        const city = focused?.city || focusLabel || 'the current map area';
        const aiNearby = await discoverDeepSeekPlaces(city, recommendationCount - nearby.length, [longitude, latitude]);
        aiNearby.forEach((candidate) => {
          if (
            nearby.length < recommendationCount
            && !existingPlaces.some((place) => isMarkerOverlap(place, candidate))
            && !nearby.some((place) => isMarkerOverlap(place, candidate))
          ) nearby.push(candidate);
        });
      }
      console.info('[AtlasNearby] wikidata-landmarks', {
        center: [longitude, latitude],
        received: landmarks.length,
        added: nearby.map((place) => place.name),
      });
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
  }, [discoverDeepSeekPlaces, focusLabel, focused?.city, hideNearbyPrompt, items, nearbyRecommending, recommendedPlaces, savedPlaces, scheduleNearbyPrompt]);

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

    // Enter the editor immediately. Its focus-seed effect resolves a real POI
    // in the background, rather than making this transition wait on Mapbox or
    // offering the device coordinate itself as a fake Atlas place.
    handoffToPlan(city, [], deviceLocation, localBounds);
    await waitForFirstAtlasPaint();

    try {
      const recommendations = await discoverDeepSeekPlaces(city, 3, deviceLocation);
      setRecommendedPlaces(recommendations);
      setFocusLabel(city);
    } catch (error) {
      // Recommendations are optional; search and saved places remain usable.
      console.warn('[AtlasBuilder] simple start recommendations failed', error);
    }
  }, [discoverDeepSeekPlaces, handoffToPlan, refreshUserLocation]);

  const revealInitialCandidate = useCallback((place: DraftPlace) => {
    if (initialPlaceSelected.current) return;
    initialPlaceSelected.current = true;
    // Search and plan handoffs can supply their first green candidate before
    // the editor's seed lookup runs. Treat it as the same automatic first
    // selection so the conditional GPS-inclusive camera policy applies.
    seedAutoSelectedRef.current = true;
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
    // Pairs with the suggests above: those keystrokes and this retrieve are one
    // session. Mapbox ends it here, so the token is replaced before the user
    // can start typing the next search onto it.
    const sessionToken = searchSessionRef.current;
    searchSessionRef.current = createSearchSession();
    const resolved = await resolvePlace({ external_id: result.externalId, name: result.name, feature_type: 'poi', source: 'mapbox' }, sessionToken);
    if (!resolved) return null;
    const place: DraftPlace = {
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
    const editSearchCenter = focused
      ? [focused.longitude, focused.latitude] as [number, number]
      : initialCenter ?? (initialBounds ? centerOfBounds(initialBounds) : mapCenter);
    const editFocusBounds = !isCreateAtlasLanding
      ? boundsFromRadius(editSearchCenter, 70)
      : undefined;
    if (editFocusBounds && !isWithinBounds(place, editFocusBounds)) {
      console.warn('[AtlasBuilder] rejected out-of-focus search result', {
        name: place.name,
        coordinate: [place.longitude, place.latitude],
        bounds: editFocusBounds,
      });
      return null;
    }
    return place;
  }, [focused, initialBounds, initialCenter, isCreateAtlasLanding, mapCenter]);

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
    seedUserInteractedRef.current = true;
    if (seedNoteTimerRef.current) clearTimeout(seedNoteTimerRef.current);
    setSeedNoteVisible(false);
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
    // Once added, clear the candidate action bar so the next map selection
    // is visibly a fresh place to add rather than the already-added name.
    setFocused(null);
    setSearchCandidateVisible(false);
    setSaveActionsOpen(false);
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
      if (place) focus(place, undefined, true);
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
      // Administrative search results define the focus area, not the first
      // Atlas item. The mounted editor resolves a nearby `attractions` POI
      // inside this area through the same fast seed path as Simple Start.
      const place = selectedPlace;
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
      const candidates: DraftPlace[] = result.kind === 'remote' && result.featureType === 'poi'
        ? [{ ...place, source: 'search' as const }]
        : [];
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
  }, [discoverDeepSeekPlaces, handoffToPlan, resolveResult, savedPlaces]);

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
      const remote = await suggestPlaces(trimmed, searchSessionRef.current, mapCenter ? { proximity: mapCenter } : {});
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
  }, [mapCenter, query, savedPlaces]);

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
    if (!atlasId) return;
    showDialog({
      title: 'Rename Atlas',
      message: 'Choose a title that makes this trip easy to find.',
      input: { placeholder: 'Atlas title', initialValue: atlasTitle || existingAtlas?.title || 'Untitled Atlas' },
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
  }, [atlasId, atlasTitle, existingAtlas?.title, showDialog]);

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
      <Ionicons name={focusSearchActive ? 'locate-outline' : 'search'} size={18} color={focusSearchActive ? '#12C170' : '#6B7280'} />
      <TextInput ref={inputRef} value={query} onChangeText={handleQueryChange} placeholder={focusSearchActive ? 'Search an area' : isCreateAtlasLanding ? 'Building Atlas in...' : 'Search places'} placeholderTextColor="#8E8E93" style={styles.searchInput} returnKeyType="search" onSubmitEditing={focusSearchActive ? openFullSearch : undefined} />
      {searching ? <ActivityIndicator size="small" color="#2563EB" /> : focusSearchActive ? <TouchableOpacity accessibilityLabel="Focus search area" onPress={openFullSearch} style={styles.searchSubmit}><Ionicons name="arrow-forward" size={17} color="#2563EB" /></TouchableOpacity> : null}
      {focusSearchActive ? <TouchableOpacity accessibilityLabel="Close focus search" onPress={closeFocusSearch} style={styles.searchClose}><Ionicons name="close" size={16} color="#64748B" /></TouchableOpacity> : null}
    </View>
    {seedNoteVisible ? <Animated.View pointerEvents="none" style={[styles.seedNote, { opacity: seedNoteOpacity }]}><Text style={styles.seedNoteText}>Tap any point on the map or search to choose a different place to add.</Text></Animated.View> : null}
    {nearbyPromptVisible ? <Animated.View pointerEvents="box-none" style={[styles.nearbyPromptRow, { opacity: nearbyPromptOpacity }]}><View pointerEvents="auto" style={styles.nearbyPrompt}><TouchableOpacity accessibilityLabel="More nearby must-sees" disabled={nearbyRecommending} onPress={() => { void recommendNearby(); }} style={styles.nearbyPromptMain}><Ionicons name="sparkles" size={13} color="#6446B4" />{nearbyRecommending ? <><ActivityIndicator size="small" color="#6446B4" /><Text style={styles.nearbyPromptText}>Finding nearby must-sees...</Text></> : <Text style={styles.nearbyPromptText}>More nearby must-sees</Text>}</TouchableOpacity></View></Animated.View> : null}
    {results.length > 0 ? <View pointerEvents="auto" style={styles.results}><ScrollView nestedScrollEnabled keyboardShouldPersistTaps="always" showsVerticalScrollIndicator style={styles.searchResultsScroll}>{results.map((result) => {
      const key = result.kind === 'saved' ? result.place.id : result.externalId;
      const createSearchAction = isCreateAtlasLanding && !focusSearchActive;
      const resultContent = <><View style={styles.resultTitleRow}><Text numberOfLines={1} style={styles.resultName}>{result.kind === 'saved' ? result.place.name : result.name}</Text>{result.kind === 'saved' ? <View style={styles.savedTag}><Text style={styles.savedTagText}>Saved</Text></View> : null}</View><Text numberOfLines={1} style={styles.resultAddress}>{result.kind === 'saved' ? result.place.subtitle : result.subtitle}</Text></>;
      const copy = createSearchAction ? <View style={styles.resultCopy}>{resultContent}</View> : <TouchableOpacity style={styles.resultCopy} onPress={() => focusSearchActive ? focusAreaResult(result) : handleResultFocus(result)}>{resultContent}</TouchableOpacity>;
      return <View key={key} style={[styles.resultRow, styles.searchResultRow]}>{copy}<TouchableOpacity accessibilityLabel={focusSearchActive ? 'Focus this area' : createSearchAction ? 'Open this place in Atlas' : 'Add to Atlas'} disabled={!focusSearchActive && addingResult === key} onPress={() => focusSearchActive ? focusAreaResult(result) : createSearchAction ? beginAtlasFromSearchResult(result) : handleResultAdd(result)} style={[focusSearchActive ? styles.focusResultButton : styles.addResultButton, !focusSearchActive && addingResult === key && styles.addResultButtonPending]}>{!focusSearchActive && addingResult === key ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name={focusSearchActive ? 'locate-outline' : createSearchAction ? 'arrow-forward' : 'add'} size={18} color="#FFF" />}</TouchableOpacity></View>;
    })}</ScrollView></View> : null}
  </Animated.View>, [addingResult, beginAtlasFromSearchResult, closeFocusSearch, focusAreaResult, focusSearchActive, handleQueryChange, handleResultAdd, handleResultFocus, hideLocalMustSees, isCreateAtlasLanding, localMustSeesOpacity, localMustSeesVisible, nearbyPromptOpacity, nearbyPromptVisible, nearbyRecommending, openFullSearch, query, recommendNearby, recommendedPlaces.length, results, searchAppear, searching]);

  const atlasMapOverlay = useMemo(() => (
    !savingKind ? <>
      {mapSearchOverlay}
      {localMustSeesVisible ? <Animated.View pointerEvents="none" style={[styles.localMustSeesToast, { opacity: localMustSeesOpacity }]}><View style={styles.localMustSeesDot} /><Text style={styles.localMustSeesText}>Local must-sees, handpicked by OurAtlas.</Text></Animated.View> : null}
      {pinchHintVisible ? <Animated.View pointerEvents="none" style={[styles.pinchHint, { opacity: pinchHintOpacity, transform: [{ scale: pinchHintScale }] }]}><View style={styles.pinchHintGesture}><Animated.View style={[styles.pinchHintTouch, { transform: [{ translateX: pinchHintGesture.interpolate({ inputRange: [0, 1], outputRange: [-6, -14] }) }] }]} /><Animated.View style={[styles.pinchHintTouch, { transform: [{ translateX: pinchHintGesture.interpolate({ inputRange: [0, 1], outputRange: [6, 14] }) }] }]} /></View><Text style={styles.pinchHintText}>Pinch the map to explore nearby places</Text></Animated.View> : null}
      {searchCandidateVisible && focused ? <View pointerEvents="box-none" style={[styles.searchCandidateLayer, { bottom: searchCandidateBottom }]}><View pointerEvents="auto" style={styles.searchCandidateCard}><View style={styles.searchCandidateCopy}><Text numberOfLines={1} style={styles.searchCandidateName}>{focused.name}</Text><Text numberOfLines={1} style={styles.searchCandidateAddress}>{focused.subtitle}</Text></View><TouchableOpacity accessibilityLabel={`Add ${focused.name} to Atlas`} onPress={() => addPlace(focused)} style={styles.searchCandidateAdd}><Ionicons name="add" size={19} color="#FFFFFF" /></TouchableOpacity></View></View> : null}
    </> : null
  ), [addPlace, focused, localMustSeesOpacity, localMustSeesVisible, mapSearchOverlay, pinchHintGesture, pinchHintOpacity, pinchHintScale, pinchHintVisible, savingKind, searchCandidateBottom, searchCandidateVisible]);

  const handlePanelHeightChange = useCallback((height: number) => {
    panelHeightRef.current = height;
    setSearchCandidateBottom(Math.max(0, height + 12));
    const pendingCountryBounds = pendingCreateCountryBoundsRef.current;
    if (!isCreateAtlasLanding || height <= 0 || !pendingCountryBounds || createCountryBoundsAlignedRef.current) return;

    // Mapbox may have received the country bounds while the shared panel was
    // still transitioning from its previous detent. Re-submit those bounds
    // after the first measured height so its padding centers the country in
    // the top map area on every entry path.
    createCountryBoundsAlignedRef.current = true;
    pendingCreateCountryBoundsRef.current = null;
    setMapBounds(pendingCountryBounds);
    setCameraKey(`atlas-country-panel-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }, [isCreateAtlasLanding]);

  const handleBoundsCameraApplied = useCallback(() => {
    if (isCreateAtlasLanding && !createCameraSettledRef.current) {
      createCameraAwaitingIdleRef.current = true;
      if (createCameraSettleTimerRef.current) clearTimeout(createCameraSettleTimerRef.current);
      // HomeScreen gives Atlas cameras a 1.5 s transition. Mapbox normally
      // reports its completion through onMapIdle; this protects the sheet
      // transition when that native event is skipped during initial mount.
      createCameraSettleTimerRef.current = setTimeout(finishCreateCameraSettle, 1800);
    }
    // Bounds are a one-shot fit command, not a permanent camera lock.
    // Leaving them in shared state makes unrelated editor updates re-own
    // the native map camera and blocks later pan/zoom gestures.
    setMapBounds((current) => current ? undefined : current);
  }, [finishCreateCameraSettle, isCreateAtlasLanding]);

  const handleViewportChanged = useCallback((center: [number, number], zoom: number) => {
    viewportCenterRef.current = center;
    viewportZoomRef.current = zoom;
    scheduleNearbyPrompt(center);
    if (!isCreateAtlasLanding || !createCameraAwaitingIdleRef.current || createCameraSettledRef.current) return;
    finishCreateCameraSettle();
  }, [finishCreateCameraSettle, isCreateAtlasLanding, scheduleNearbyPrompt]);

  useLayoutEffect(() => {
    setAtlasMapState({
      markers: mapMarkers,
      cameraVerticalOffset: isCreateAtlasLanding ? CREATE_ATLAS_CAMERA_VERTICAL_OFFSET : 0,
      smoothPanelCameraFollow: isCreateAtlasLanding,
      // The editor sheet occupies the lower screen. Let HomeScreen pass its
      // measured height as camera padding so both a GPS-country camera and an
      // Edit Atlas focus area center in the remaining upper map viewport.
      lockCameraToScreen: false,
      minimumBoundsZoom: ATLAS_MINIMUM_BOUNDS_ZOOM,
      disableRecommendedClustering: true,
      centerCoordinate: mapCenter,
      zoomLevel: mapZoom,
      // Edit mode, selected Create-search areas, and the location-aware blank
      // Create screen own an explicit bounds camera.
      bounds: atlasId || started || isCreateAtlasLanding ? mapBounds : undefined,
      cameraKey,
      resetCameraOrientation: true,
      cameraAnimationDurationMs: atlasId ? 0 : undefined,
      selectedMarkerId: focused?.id ?? null,
      routeGeoJSON: route?.route,
      deletingMarkerId: removingPlace?.id,
      onMarkerPress: (marker) => {
        setSearchCandidateVisible(false);
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
      onViewportChanged: handleViewportChanged,
      onPanelHeightChange: handlePanelHeightChange,
      onBoundsCameraApplied: handleBoundsCameraApplied,
      overlay: atlasMapOverlay,
      hideTopSearchButton: true,
      markerPopup: null,
    });
  }, [atlasId, atlasMapOverlay, atlasPlaces, cameraKey, focus, focused, handleBoundsCameraApplied, handlePanelHeightChange, handleViewportChanged, hideTransientUI, isCreateAtlasLanding, mapBounds, mapCenter, mapMarkers, mapZoom, recommendedPlaces, removingPlace?.id, route?.route, savedPlaces, setAtlasMapState]);

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

          {items.length === 0 && !started && !handoffStarted && !atlasId ? <Text style={styles.landingLabel}>Pick a focus area to start</Text> : null}
        </View>
        <View style={styles.headerRight}>
          {atlasId ? <TouchableOpacity accessibilityLabel={`Rename ${atlasTitle || existingAtlas?.title || 'Atlas'}`} onPress={renameAtlas} style={styles.focusAreaButton}><Text numberOfLines={1} style={styles.focusAreaButtonText}>{atlasTitle || existingAtlas?.title || 'Atlas'}</Text><Ionicons name="pencil-outline" size={15} color="#6A6A70" /></TouchableOpacity> : (started && focusLabel ? <TouchableOpacity accessibilityLabel={`Change focus area, currently ${focusLabel}`} onPress={onReturnToCreateSearch ? returnToCreateSearch : openFocusSearch} style={styles.focusAreaButton}><Ionicons name="location-sharp" size={23} color="#303033" /><Text numberOfLines={1} style={styles.focusAreaButtonText}>{focusLabel}</Text></TouchableOpacity> : null)}
          <Button accessibilityLabel="Close Atlas editor" onPress={closeEditor} size="icon" variant="ghost" className="h-9 w-9 rounded-xl bg-muted"><Ionicons name="close" size={19} color="#1A1A1A" /></Button>
        </View>
      </View>

      {!atlasId && items.length === 0 && !started && !handoffStarted ? <View style={styles.createLanding}>
        <View style={styles.simpleStartHero}><TouchableOpacity onPress={simpleStart} style={styles.simpleStartHeroButton}><View style={styles.simpleStartHeroTop}><View style={styles.simpleStartHeroIcon}><Ionicons name="map-outline" size={26} color="#12C170" /></View><Ionicons name="arrow-forward" size={21} color="#12C170" /></View><View style={styles.simpleStartHeroCopy}><Text style={styles.simpleStartHeroTitle}>Simple Start</Text><Text style={styles.simpleStartHeroSubtitle}>Build an atlas from scratch</Text></View></TouchableOpacity></View>
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

      {atlasId || started || handoffStarted ? <AtlasCandidateCard place={focused} added={Boolean(focused && items.some((item) => item.id === focused.id))} saveActionsOpen={saveActionsOpen} savingKind={savingKind} finishDisabled={saveDisabled} promptFirstAdd={Boolean(atlasId) && items.length === 0} showFinishHint={items.length > 0 && !focused && !saveActionsOpen} onAdd={() => { if (focused) addPlace(focused); }} onToggleSaveActions={() => setSaveActionsOpen((open) => !open)} onSave={(askAI) => { setSaveActionsOpen(false); void persist(askAI); }} /> : null}

      <TimePickerModal visible={timeModalIndex !== null} day={pendingDay} time={pendingTime} dayLocked={undefinedDayLocked} hasExisting={timeModalIndex !== null && Boolean(items[timeModalIndex]?.timeline_time)} validationMessage={timeConflictMessage} onChangeDay={setPendingDay} onChangeTime={setPendingTime} onClose={() => { setTimeConflictMessage(null); setTimeModalIndex(null); }} onRemove={() => { if (timeModalIndex === null) return; const existing = items[timeModalIndex]; commitItems(items.map((entry, index) => index === timeModalIndex ? { ...entry, timeline_day: null, timeline_time: null } : entry)); if (existing?.joinId) updateAtlasPlace(existing.joinId, { timeline_day: null, timeline_time: null }).catch(console.warn); setTimeModalIndex(null); }} onSave={saveTimeDivider} />
      <TransportPickerModal visible={transportModalIndex !== null} selected={transportModalIndex === null ? null : items[transportModalIndex]?.transport ?? null} onSelect={saveTransport} onRemove={() => saveTransport(null)} onClose={() => setTransportModalIndex(null)} />
      <Modal visible={fullResults !== null} animationType="slide" onRequestClose={() => focusSearchActive ? closeFocusSearch() : setFullResults(null)}><View style={styles.fullSearch}><View style={styles.fullSearchHeader}><TouchableOpacity onPress={() => focusSearchActive ? closeFocusSearch() : setFullResults(null)} style={styles.headerIcon}><Ionicons name={focusSearchActive ? 'close' : 'chevron-back'} size={20} color="#1A1A1A" /></TouchableOpacity><Text style={styles.fullSearchTitle}>{focusSearchActive ? 'Choose an area' : 'Search results'}</Text><View style={styles.headerIcon} /></View><ScrollView contentContainerStyle={styles.fullResults}>{fullResults?.map((result) => { const key = result.kind === 'saved' ? result.place.id : result.externalId; return <View key={key} style={styles.fullResultRow}><TouchableOpacity style={styles.resultCopy} onPress={() => { setFullResults(null); focusSearchActive ? focusAreaResult(result) : handleResultFocus(result); }}><Text style={styles.resultName}>{result.kind === 'saved' ? result.place.name : result.name}</Text><Text style={styles.resultAddress}>{result.kind === 'saved' ? result.place.subtitle : result.subtitle}</Text></TouchableOpacity><TouchableOpacity disabled={!focusSearchActive && addingResult === key} onPress={() => { setFullResults(null); focusSearchActive ? focusAreaResult(result) : handleResultAdd(result); }} style={focusSearchActive ? styles.focusResultButton : styles.addResultButton}>{!focusSearchActive && addingResult === key ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name={focusSearchActive ? 'locate-outline' : 'add'} size={18} color="#FFF" />}</TouchableOpacity></View>; })}</ScrollView></View></Modal>
    </View>
  );
}
