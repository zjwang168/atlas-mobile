import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Image } from 'react-native';
import * as Location from 'expo-location';
import { useAppDialog } from '../../components/feedback/AppDialog';
import { ContentPanelSnapProvider } from '../../components/content-panel/ContentPanelSnapProvider';
import { createAtlas as createAtlasService, deleteAtlas as deleteAtlasService, fetchAtlases, subscribeAtlases } from '../../services/atlas/atlasService';
import { addPlacesToAtlas as addPlacesToAtlasService, fetchAtlasPlaces, removePlaceFromAtlas as removePlaceFromAtlasService, subscribeAtlasPlaces } from '../../services/atlas/atlasPlacesService';
import type { ParsedPlace } from '../../services/import/importService';
import type { LocalEvent } from '../../types/event';
import { clearUserCache, getCurrentUserId } from '../../services/local/localStore';
import type { LocationPermissionStatus } from '../../services/location/locationService';
import { requestUserLocation } from '../../services/location/locationService';
import { flushQueue } from '../../services/local/syncQueue';
import type { SavedPlace } from '../../services/place/placeService';
import { deletePlace, fetchSavedPlaces, subscribeSavedPlaces, updatePlaceNote } from '../../services/place/placeService';
import { loadChatHistory, supabase } from '../../services/supabase/supabaseClient';
import type { Atlas } from '../../types/atlas';
import type { AtlasPlace, PlaceDetail } from '../../types/place';
import { DEFAULT_MAP_CENTER } from '../../utils/constants';
import type { MapMarker } from '../map/MapboxMap';
import type { AtlasChatPresentation } from '../../services/api/apiService';

// --- Chat History ---

export type ChatHistoryItem = {
  id: string;
  title: string;
  sourceUrl: string;
  locationCount: number;
  messageCount?: number;
  places: ParsedPlace[];
  createdAt: string;
  updatedAt?: string;
  /** Which import flow produced this chat: 'smart_text' | 'image_scan' |
      'reddit_links' | 'any_links' | 'link' | 'text'. Stored in
      conversations.source_type. */
  sourceType?: string;
  /** Present only while opening a newly saved import. The first assistant
      message is persisted by the backend; this context is not history data. */
  importWelcome?: {
    deselectedPlaces: ParsedPlace[];
  };
  /** Immediate client-side presentation while a new import chat is persisted. */
  initialImportWelcome?: AtlasChatPresentation;
  initialWelcomeText?: string;
  /** In-memory session returned before its background history write completes. */
  initialSessionId?: string;
  sessionInitializing?: boolean;
  /** Present only while opening a chat directly from a saved Atlas edit. */
  atlasWelcome?: { places: AtlasChatPresentation['places'] };
};

const MAX_CHAT_HISTORY = 50;

function hasRenderableCoordinates(place: SavedPlace): boolean {
  return Number.isFinite(place.latitude)
    && Number.isFinite(place.longitude)
    && place.latitude >= -90
    && place.latitude <= 90
    && place.longitude >= -180
    && place.longitude <= 180;
}

const prefetchedPhotoUrls = new Set<string>();
const prefetchingPhotoUrls = new Set<string>();

function uniquePhotoUrls(urls: Array<string | null | undefined>): string[] {
  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
}

function focusCardPhotoUrls(places: SavedPlace[]): string[] {
  const areas = new Map<string, SavedPlace[]>();
  places.forEach((place) => {
    const label = [place.city, place.region, place.country].find((value) => value?.trim());
    if (!label) return;
    const key = label.toLocaleLowerCase().trim();
    areas.set(key, [...(areas.get(key) ?? []), place]);
  });
  return uniquePhotoUrls(
    [...areas.values()]
      .sort((a, b) => b.length - a.length || (a[0]?.city ?? a[0]?.region ?? a[0]?.country ?? '').localeCompare(b[0]?.city ?? b[0]?.region ?? b[0]?.country ?? ''))
      .map((area) => area.find((place) => Boolean(place.photo_url))?.photo_url),
  );
}

function atlasCoverPhotoUrls(atlases: Atlas[], atlasPlaces: AtlasPlace[], savedPlaces: SavedPlace[]): string[] {
  const savedById = new Map(savedPlaces.map((place) => [place.id, place]));
  return uniquePhotoUrls(atlases.flatMap((atlas) => {
    const rows = atlasPlaces.filter((row) => row.atlas_id === atlas.id).sort((a, b) => a.sort_order - b.sort_order);
    for (const row of rows) {
      const uri = row.place_id ? savedById.get(row.place_id)?.photo_url : row.photo_url;
      if (uri) return [uri];
    }
    return [];
  }));
}

async function prefetchPhotoUrlsInOrder(urls: string[]): Promise<void> {
  for (const url of urls) {
    if (prefetchedPhotoUrls.has(url) || prefetchingPhotoUrls.has(url)) continue;
    prefetchingPhotoUrls.add(url);
    try {
      if (await Image.prefetch(url)) prefetchedPhotoUrls.add(url);
    } catch {
      // A later idle pass may retry transient image failures.
    } finally {
      prefetchingPhotoUrls.delete(url);
    }
  }
}

// --- Overlay ---

export type Overlay =
  | { kind: 'none' }
  | { kind: 'search' }
  | { kind: 'debug' }
  | { kind: 'placeDetail'; placeId: string; returnTo?: Overlay }
  | { kind: 'planDetail'; planId: string }
  | { kind: 'atlasDetail'; atlasId: string }
  | { kind: 'addPlace'; onSelect: (places: PlaceDetail[]) => void; excludeIds?: string[]; returnTo?: Overlay }
  // Carries the event itself rather than an id: a local event is not persisted
  // anywhere until the user saves it, so there is nothing to look it up from.
  | { kind: 'eventDetail'; event: LocalEvent; returnTo?: Overlay }
  | { kind: 'createPlan' };

/**
 * Temporary map ownership for the map-first Atlas editor. It deliberately
 * lives outside the editor panel so there is always one full-screen map.
 */
export type AtlasMapState = {
  markers: MapMarker[];
  /** Per-Atlas camera adjustment applied above the active bottom-panel padding. */
  cameraVerticalOffset?: number;
  /** Keeps the shared map stationary while the editor sheet is dragged. */
  lockCameraToScreen?: boolean;
  /** Moves map content vertically in screen points without changing panel layout. */
  cameraScreenOffsetY?: number;
  centerCoordinate?: [number, number];
  zoomLevel?: number;
  bounds?: { ne: [number, number]; sw: [number, number] };
  /** Lowest zoom accepted while fitting this Atlas view's bounds. */
  minimumBoundsZoom?: number;
  /** Keeps each AI recommendation visible as its own purple marker. */
  disableRecommendedClustering?: boolean;
  /** Changes when an Atlas view must re-apply identical bounds after reopening. */
  cameraKey?: string;
  /** Optional override for the shared map camera transition. */
  cameraAnimationDurationMs?: number;
  /** Resets the shared map to Atlas's north-up, top-down orientation. */
  resetCameraOrientation?: boolean;
  selectedMarkerId?: string | null;
  deletingMarkerId?: string | null;
  routeGeoJSON?: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>;
  routeVariant?: 'commute';
  routeDistanceLabels?: Array<{ id: string; coordinate: [number, number]; text: string }>;
  onMarkerPress?: (marker: MapMarker) => void;
  onMapPress?: () => void;
  onViewportChanged?: (center: [number, number], zoom: number) => void;
  /** Releases a one-shot bounds camera after it has been applied. */
  onBoundsCameraApplied?: () => void;
  /** Atlas-only controls live above the one shared map, never in its panel. */
  overlay?: ReactNode;
  /** Receives the live Edit atlas panel height so map overlays can follow it. */
  onPanelHeightChange?: (height: number) => void;
  /** Lets the initial Create Atlas camera ease with its collapsing sheet. */
  smoothPanelCameraFollow?: boolean;
  markerPopup?: { markerId: string; content: ReactNode } | null;
  hideTopSearchButton?: boolean;
  /** Briefly removes app chrome while an Atlas share image is captured. */
  hideChrome?: boolean;
} | null;

// Each domain below owns its own context + memoized value, so a component
// that only reads one domain (e.g. useHomePlaces()) doesn't re-render when
// an unrelated domain changes (e.g. chat history syncing from Supabase).
// useHome() composes all five for existing multi-domain consumers.

// --- Overlay domain: navigation/UI chrome, changes on most screen transitions ---

type OverlayContextValue = {
  overlay: Overlay;
  setOverlay: (overlay: Overlay) => void;
  tabBarVisible: boolean;
  setTabBarVisible: (visible: boolean) => void;
  atlasMapState: AtlasMapState;
  setAtlasMapState: (state: AtlasMapState) => void;
  activeSidekick: 'none' | 'aiChat' | 'places';
  setActiveSidekick: (sidekick: 'none' | 'aiChat' | 'places') => void;
  importNotification: {
    visible: boolean;
    title: string;
    places: ParsedPlace[];
  } | null;
  setImportNotification: (notification: {
    visible: boolean;
    title: string;
    places: ParsedPlace[];
  } | null) => void;
};

const OverlayContext = createContext<OverlayContextValue>({
  overlay: { kind: 'none' },
  setOverlay: () => {},
  tabBarVisible: true,
  setTabBarVisible: () => {},
  atlasMapState: null,
  setAtlasMapState: () => {},
  activeSidekick: 'none',
  setActiveSidekick: () => {},
  importNotification: null,
  setImportNotification: () => {},
});

export function useHomeOverlay() {
  return useContext(OverlayContext);
}

type OverlayActionsContextValue = Pick<
  OverlayContextValue,
  'setOverlay' | 'setTabBarVisible' | 'setAtlasMapState' | 'setActiveSidekick' | 'setImportNotification'
>;

const OverlayActionsContext = createContext<OverlayActionsContextValue>({
  setOverlay: () => {},
  setTabBarVisible: () => {},
  setAtlasMapState: () => {},
  setActiveSidekick: () => {},
  setImportNotification: () => {},
});

/** Stable overlay actions for components that publish map/UI state but do not
 * need to subscribe to every map-state update they publish. */
export function useHomeOverlayActions() {
  return useContext(OverlayActionsContext);
}

// --- Location domain: device position, set once on mount and on manual retry ---

type LocationContextValue = {
  userLocation: [number, number];
  locationStatus: LocationPermissionStatus;
  isLocationFallback: boolean;
  refreshUserLocation: () => Promise<[number, number]>;
};

const LocationContext = createContext<LocationContextValue>({
  userLocation: DEFAULT_MAP_CENTER,
  locationStatus: 'undetermined',
  isLocationFallback: true,
  refreshUserLocation: async () => DEFAULT_MAP_CENTER,
});

export function useHomeLocation() {
  return useContext(LocationContext);
}

// --- Places domain: saved places, in-progress imports, map selection ---

type PlacesContextValue = {
  parsedPlaces: ParsedPlace[];
  setParsedPlaces: (places: ParsedPlace[]) => void;
  savedPlaces: SavedPlace[];
  savedPlacesLoaded: boolean;
  setSavedPlaces: (places: SavedPlace[]) => void;
  refreshSavedPlaces: () => Promise<void>;
  deleteSavedPlace: (id: string) => Promise<void>;
  updateSavedPlaceNote: (id: string, note: string) => Promise<void>;
  selectedPlaceCoordinate: [number, number] | null;
  setSelectedPlaceCoordinate: (coord: [number, number] | null) => void;
  selectedPlaceId: string | null;
  setSelectedPlaceId: (id: string | null) => void;
};

const PlacesContext = createContext<PlacesContextValue>({
  parsedPlaces: [],
  setParsedPlaces: () => {},
  savedPlaces: [],
  savedPlacesLoaded: false,
  setSavedPlaces: () => {},
  refreshSavedPlaces: async () => {},
  deleteSavedPlace: async () => {},
  updateSavedPlaceNote: async () => {},
  selectedPlaceCoordinate: null,
  setSelectedPlaceCoordinate: () => {},
  selectedPlaceId: null,
  setSelectedPlaceId: () => {},
});

export function useHomePlaces() {
  return useContext(PlacesContext);
}

// --- Atlases domain: atlases + atlas_places join rows ---

type AtlasesContextValue = {
  atlases: Atlas[];
  refreshAtlases: () => Promise<void>;
  createAtlas: (title: string) => Promise<Atlas | null>;
  deleteAtlas: (id: string) => Promise<void>;
  atlasPlaces: AtlasPlace[];
  addPlacesToAtlas: (atlasId: string, placeIds: string[]) => Promise<void>;
  removePlaceFromAtlas: (joinRowId: string) => Promise<void>;
};

const AtlasesContext = createContext<AtlasesContextValue>({
  atlases: [],
  refreshAtlases: async () => {},
  createAtlas: async () => null,
  deleteAtlas: async () => {},
  atlasPlaces: [],
  addPlacesToAtlas: async () => {},
  removePlaceFromAtlas: async () => {},
});

export function useHomeAtlases() {
  return useContext(AtlasesContext);
}

// --- Chat history domain: cached import/chat sessions ---

type ChatHistoryContextValue = {
  chatHistory: ChatHistoryItem[];
  deletedChatHistory: ChatHistoryItem[];
  activeHistoryItem: ChatHistoryItem | null;
  setActiveHistoryItem: (item: ChatHistoryItem | null) => void;
  addChatHistoryItem: (item: Omit<ChatHistoryItem, 'id' | 'createdAt'>) => string;
  replaceChatHistoryItem: (tempId: string, item: ChatHistoryItem) => void;
  deleteChatHistoryItem: (id: string) => void;
  restoreChatHistoryItem: (id: string) => void;
  setChatHistory: (items: ChatHistoryItem[]) => void;
};

const ChatHistoryContext = createContext<ChatHistoryContextValue>({
  chatHistory: [],
  deletedChatHistory: [],
  activeHistoryItem: null,
  setActiveHistoryItem: () => {},
  addChatHistoryItem: () => '',
  replaceChatHistoryItem: () => {},
  deleteChatHistoryItem: () => {},
  restoreChatHistoryItem: () => {},
  setChatHistory: () => {},
});

export function useHomeChatHistory() {
  return useContext(ChatHistoryContext);
}

// --- Composite: everything, for consumers that span multiple domains ---

type HomeContextValue =
  & OverlayContextValue
  & LocationContextValue
  & PlacesContextValue
  & AtlasesContextValue
  & ChatHistoryContextValue;

export function useHome(): HomeContextValue {
  const overlay = useHomeOverlay();
  const location = useHomeLocation();
  const places = useHomePlaces();
  const atlases = useHomeAtlases();
  const chatHistory = useHomeChatHistory();
  return useMemo(
    () => ({ ...overlay, ...location, ...places, ...atlases, ...chatHistory }),
    [overlay, location, places, atlases, chatHistory],
  );
}

function mergeHistoryItems(existing: ChatHistoryItem[], incoming: ChatHistoryItem[]): ChatHistoryItem[] {
  const merged = new Map<string, ChatHistoryItem>();
  for (const item of [...incoming, ...existing]) {
    merged.set(item.id, item);
  }
  return [...merged.values()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_CHAT_HISTORY);
}

export function HomeProvider({ children }: { children: React.ReactNode }) {
  const { show: showDialog } = useAppDialog();
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [tabBarVisible, setTabBarVisible] = useState(true);
  const [atlasMapState, setAtlasMapState] = useState<AtlasMapState>(null);
  const [parsedPlaces, setParsedPlaces] = useState<ParsedPlace[]>([]);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [savedPlacesLoaded, setSavedPlacesLoaded] = useState(false);
  const [atlases, setAtlases] = useState<Atlas[]>([]);
  const [atlasesLoaded, setAtlasesLoaded] = useState(false);
  const [atlasPlaces, setAtlasPlaces] = useState<AtlasPlace[]>([]);
  const [atlasPlacesLoaded, setAtlasPlacesLoaded] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [deletedChatHistory, setDeletedChatHistory] = useState<ChatHistoryItem[]>([]);
  const [activeHistoryItem, setActiveHistoryItem] = useState<ChatHistoryItem | null>(null);
  const [selectedPlaceCoordinate, setSelectedPlaceCoordinate] = useState<[number, number] | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [importNotification, setImportNotification] = useState<{
    visible: boolean;
    title: string;
    places: ParsedPlace[];
  } | null>(null);
  const [activeSidekick, setActiveSidekick] = useState<'none' | 'aiChat' | 'places'>('none');
  const [userLocation, setUserLocation] = useState<[number, number]>(DEFAULT_MAP_CENTER);
  const [locationStatus, setLocationStatus] = useState<LocationPermissionStatus>('undetermined');
  const [isLocationFallback, setIsLocationFallback] = useState(true);

  const refreshUserLocation = useCallback(async (): Promise<[number, number]> => {
    const result = await requestUserLocation();
    setUserLocation(result.coordinate);
    setLocationStatus(result.status);
    setIsLocationFallback(result.isFallback);
    return result.coordinate;
  }, []);

  // Ask once on mount. A refusal leaves userLocation at the default center and
  // is never retried automatically — iOS won't re-prompt anyway, and the
  // locate button is the deliberate retry.
  useEffect(() => {
    void refreshUserLocation();
  }, [refreshUserLocation]);

  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) return;
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (mounted) setUserLocation([position.coords.longitude, position.coords.latitude]);
      } catch (error) {
        console.warn('[HomeContext] GPS location unavailable:', error);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const refreshSavedPlaces = useCallback(async () => {
    try {
      const places = await fetchSavedPlaces();
      const validPlaces = places.filter(hasRenderableCoordinates);
      const invalidPlaces = places.filter((place) => !hasRenderableCoordinates(place));
      setSavedPlaces(validPlaces);
      // An entry without legal coordinates cannot have its corresponding map pin.
      if (invalidPlaces.length) {
        void Promise.all(invalidPlaces.map((place) => deletePlace(place.id))).catch((error) => {
          console.warn('[HomeContext] invalid saved-place cleanup failed:', error);
        });
      }
    } catch (e) {
      console.error('[HomeContext] refreshSavedPlaces failed:', e);
    } finally {
      setSavedPlacesLoaded(true);
    }
  }, []);

  const refreshAtlases = useCallback(async () => {
    try {
      const rows = await fetchAtlases();
      setAtlases(rows);
    } catch (e) {
      console.error('[HomeContext] refreshAtlases failed:', e);
    } finally {
      setAtlasesLoaded(true);
    }
  }, []);

  const refreshAtlasPlaces = useCallback(async () => {
    try {
      const rows = await fetchAtlasPlaces();
      setAtlasPlaces(rows);
    } catch (e) {
      console.error('[HomeContext] refreshAtlasPlaces failed:', e);
    } finally {
      setAtlasPlacesLoaded(true);
    }
  }, []);

  const createAtlas = useCallback(async (title: string) => {
    try {
      return await createAtlasService(title);
    } catch (e) {
      console.error('[HomeContext] createAtlas failed:', e);
      return null;
    }
  }, []);

  const deleteAtlas = useCallback(async (id: string) => {
    try {
      await deleteAtlasService(id);
    } catch (e) {
      console.error('[HomeContext] deleteAtlas failed:', e);
      showDialog({ title: 'We couldn\'t delete this atlas', message: 'Nothing has changed. Please try again in a moment.', tone: 'warning' });
    }
  }, [showDialog]);

  const addPlacesToAtlas = useCallback(async (atlasId: string, placeIds: string[]) => {
    try {
      await addPlacesToAtlasService(atlasId, placeIds);
    } catch (e) {
      console.error('[HomeContext] addPlacesToAtlas failed:', e);
      showDialog({ title: 'We couldn\'t update this atlas', message: 'Those places are still in My Places. Please try again in a moment.', tone: 'warning' });
    }
  }, [showDialog]);

  const removePlaceFromAtlas = useCallback(async (joinRowId: string) => {
    try {
      await removePlaceFromAtlasService(joinRowId);
    } catch (e) {
      console.error('[HomeContext] removePlaceFromAtlas failed:', e);
      showDialog({ title: 'We couldn\'t update this atlas', message: 'That place is still in the atlas. Please try again in a moment.', tone: 'warning' });
    }
  }, [showDialog]);

  // 初始加载已保存地点，让地图在启动时显示已保存的标记
  useEffect(() => {
    refreshSavedPlaces();
    refreshAtlases();
    refreshAtlasPlaces();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => subscribeSavedPlaces((places) => {
    setSavedPlaces(places.filter(hasRenderableCoordinates));
    setSavedPlacesLoaded(true);
  }), []);

  // Idle prefetch intentionally mirrors the user-visible priority: Create an
  // Atlas focus cards, Bookmark Atlas covers, then My Places newest first.
  useEffect(() => {
    if (!savedPlacesLoaded || !atlasesLoaded || !atlasPlacesLoaded) return;
    const urls = uniquePhotoUrls([
      ...focusCardPhotoUrls(savedPlaces),
      ...atlasCoverPhotoUrls(atlases, atlasPlaces, savedPlaces),
      ...[...savedPlaces]
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .map((place) => place.photo_url),
    ]);
    if (!urls.length) return;
    const task = requestIdleCallback(() => {
      void prefetchPhotoUrlsInOrder(urls);
    });
    return () => cancelIdleCallback(task);
  }, [atlasPlaces, atlasPlacesLoaded, atlases, atlasesLoaded, savedPlaces, savedPlacesLoaded]);
  useEffect(() => subscribeAtlases(setAtlases), []);
  useEffect(() => subscribeAtlasPlaces(setAtlasPlaces), []);

  useEffect(() => {
    let mounted = true;
    getCurrentUserId()
      .then((userId) => {
        if (mounted) currentUserIdRef.current = userId;
      })
      .catch((error) => console.warn('[HomeContext] failed to read current user:', error));

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;
      const previousUserId = currentUserIdRef.current;
      if (previousUserId === nextUserId) return;
      currentUserIdRef.current = nextUserId;

      if (previousUserId) {
        flushQueue(previousUserId)
          .then((result) => {
            if (!result.success || result.remaining > 0) {
              showDialog({
                title: 'Some recent changes could not sync',
                message: 'A few changes were still waiting to upload when the account changed. Please check your saved places after signing in again.',
                tone: 'warning',
              });
            }
          })
          .catch((error) => {
            console.warn('[HomeContext] final queue flush failed:', error);
            showDialog({
              title: 'Some recent changes could not sync',
              message: 'A few changes were still waiting to upload when the account changed. Please check your saved places after signing in again.',
              tone: 'warning',
            });
          })
          .finally(() => {
            clearUserCache(previousUserId).catch((error) => console.warn('[HomeContext] clearUserCache failed:', error));
          });
      }

      setSavedPlaces([]);
      setSavedPlacesLoaded(false);
      refreshSavedPlaces();
      setAtlases([]);
      refreshAtlases();
      setAtlasPlaces([]);
      refreshAtlasPlaces();
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [refreshSavedPlaces, refreshAtlases, refreshAtlasPlaces, showDialog]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      getCurrentUserId()
        .then((userId) => {
          if (!userId) return;
          return flushQueue(userId).then(() => refreshSavedPlaces());
        })
        .catch((error) => console.warn('[HomeContext] foreground queue flush failed:', error));
    });

    return () => subscription.remove();
  }, [refreshSavedPlaces]);

  useEffect(() => {
    let cancelled = false;
    loadChatHistory()
      .then((items) => {
        if (!cancelled && items.length > 0) {
          setChatHistory((prev) => mergeHistoryItems(prev, items));
        }
      })
      .catch((e) => console.warn('[HomeContext] loadChatHistory failed:', e));
    return () => {
      cancelled = true;
    };
  }, []);

  const addChatHistoryItem = useCallback(
    (item: Omit<ChatHistoryItem, 'id' | 'createdAt'>) => {
      const tempId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const newItem: ChatHistoryItem = {
        ...item,
        id: tempId,
        createdAt: new Date().toISOString(),
      };
      setChatHistory((prev) => {
        const updated = [newItem, ...prev];
        return updated.slice(0, MAX_CHAT_HISTORY);
      });
      return tempId;
    },
    [],
  );

  const replaceChatHistoryItem = useCallback((tempId: string, item: ChatHistoryItem) => {
    setChatHistory((prev) => {
      const withoutTemp = prev.filter((entry) => entry.id !== tempId && entry.id !== item.id);
      return [item, ...withoutTemp]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, MAX_CHAT_HISTORY);
    });
    setDeletedChatHistory((prev) => prev.filter((entry) => entry.id !== tempId && entry.id !== item.id));
    setActiveHistoryItem((prev) => (prev?.id === tempId ? item : prev));
  }, []);

  const deleteSavedPlace = useCallback(async (id: string) => {
    // The map derives directly from savedPlaces, so optimistic removal makes
    // the list row and marker disappear together before persistence completes.
    setSavedPlaces((prev) => prev.filter((place) => place.id !== id));
    if (selectedPlaceId === id) {
      setSelectedPlaceId(null);
      setSelectedPlaceCoordinate(null);
    }
    try {
      await deletePlace(id);
    } catch (e) {
      console.error('[HomeContext] deleteSavedPlace failed:', e);
      void refreshSavedPlaces();
    }
  }, [refreshSavedPlaces, selectedPlaceId]);

  const updateSavedPlaceNote = useCallback(async (id: string, note: string) => {
    try {
      await updatePlaceNote(id, note);
      setSavedPlaces((prev) => prev.map((p) => (p.id === id ? { ...p, note: note.trim() || null } : p)));
    } catch (e) {
      console.error('[HomeContext] updateSavedPlaceNote failed:', e);
    }
  }, []);

  const deleteChatHistoryItem = useCallback((id: string) => {
    setChatHistory((prev) => {
      const item = prev.find((entry) => entry.id === id);
      if (item) {
        setDeletedChatHistory((deleted) => [item, ...deleted.filter((entry) => entry.id !== id)]);
      }
      return prev.filter((entry) => entry.id !== id);
    });
  }, []);

  const restoreChatHistoryItem = useCallback((id: string) => {
    setDeletedChatHistory((prev) => {
      const item = prev.find((entry) => entry.id === id);
      if (item) {
        setChatHistory((history) => [item, ...history.filter((entry) => entry.id !== id)].slice(0, MAX_CHAT_HISTORY));
      }
      return prev.filter((entry) => entry.id !== id);
    });
  }, []);

  const overlayValue = useMemo<OverlayContextValue>(
    () => ({
      overlay,
      setOverlay,
      tabBarVisible,
      setTabBarVisible,
      atlasMapState,
      setAtlasMapState,
      activeSidekick,
      setActiveSidekick,
      importNotification,
      setImportNotification,
    }),
    [overlay, tabBarVisible, atlasMapState, activeSidekick, importNotification],
  );

  const overlayActionsValue = useMemo<OverlayActionsContextValue>(
    () => ({
      setOverlay,
      setTabBarVisible,
      setAtlasMapState,
      setActiveSidekick,
      setImportNotification,
    }),
    [],
  );

  const locationValue = useMemo<LocationContextValue>(
    () => ({
      userLocation,
      locationStatus,
      isLocationFallback,
      refreshUserLocation,
    }),
    [userLocation, locationStatus, isLocationFallback, refreshUserLocation],
  );

  const placesValue = useMemo<PlacesContextValue>(
    () => ({
      parsedPlaces,
      setParsedPlaces,
      savedPlaces,
      savedPlacesLoaded,
      setSavedPlaces,
      refreshSavedPlaces,
      deleteSavedPlace,
      updateSavedPlaceNote,
      selectedPlaceCoordinate,
      setSelectedPlaceCoordinate,
      selectedPlaceId,
      setSelectedPlaceId,
    }),
    [parsedPlaces, savedPlaces, savedPlacesLoaded, refreshSavedPlaces, deleteSavedPlace, updateSavedPlaceNote, selectedPlaceCoordinate, selectedPlaceId],
  );

  const atlasesValue = useMemo<AtlasesContextValue>(
    () => ({
      atlases,
      refreshAtlases,
      createAtlas,
      deleteAtlas,
      atlasPlaces,
      addPlacesToAtlas,
      removePlaceFromAtlas,
    }),
    [atlases, refreshAtlases, createAtlas, deleteAtlas, atlasPlaces, addPlacesToAtlas, removePlaceFromAtlas],
  );

  const chatHistoryValue = useMemo<ChatHistoryContextValue>(
    () => ({
      chatHistory,
      deletedChatHistory,
      activeHistoryItem,
      setActiveHistoryItem,
      addChatHistoryItem,
      replaceChatHistoryItem,
      deleteChatHistoryItem,
      restoreChatHistoryItem,
      setChatHistory,
    }),
    [chatHistory, deletedChatHistory, activeHistoryItem, addChatHistoryItem, replaceChatHistoryItem, deleteChatHistoryItem, restoreChatHistoryItem],
  );

  return (
    <OverlayActionsContext.Provider value={overlayActionsValue}>
      <OverlayContext.Provider value={overlayValue}>
        <LocationContext.Provider value={locationValue}>
          <PlacesContext.Provider value={placesValue}>
            <AtlasesContext.Provider value={atlasesValue}>
              <ChatHistoryContext.Provider value={chatHistoryValue}>
                <ContentPanelSnapProvider>{children}</ContentPanelSnapProvider>
              </ChatHistoryContext.Provider>
            </AtlasesContext.Provider>
          </PlacesContext.Provider>
        </LocationContext.Provider>
      </OverlayContext.Provider>
    </OverlayActionsContext.Provider>
  );
}
