import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { useAppDialog } from '../../components/feedback/AppDialog';
import { ContentPanelSnapProvider } from '../../components/content-panel/ContentPanelSnapProvider';
import { createAtlas as createAtlasService, deleteAtlas as deleteAtlasService, fetchAtlases, subscribeAtlases } from '../../services/atlas/atlasService';
import { addPlacesToAtlas as addPlacesToAtlasService, fetchAtlasPlaces, removePlaceFromAtlas as removePlaceFromAtlasService, subscribeAtlasPlaces } from '../../services/atlas/atlasPlacesService';
import type { ParsedPlace } from '../../services/import/importService';
import { clearUserCache, getCurrentUserId } from '../../services/local/localStore';
import { flushQueue } from '../../services/local/syncQueue';
import type { SavedPlace } from '../../services/place/placeService';
import { deletePlace, fetchSavedPlaces, subscribeSavedPlaces, updatePlaceNote } from '../../services/place/placeService';
import { loadChatHistory, supabase } from '../../services/supabase/supabaseClient';
import type { Atlas } from '../../types/atlas';
import type { AtlasPlace, PlaceDetail } from '../../types/place';
import type { MapMarker } from '../map/MapboxMap';

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

// --- Overlay ---

export type Overlay =
  | { kind: 'none' }
  | { kind: 'search' }
  | { kind: 'debug' }
  | { kind: 'placeDetail'; placeId: string; returnTo?: Overlay }
  | { kind: 'planDetail'; planId: string }
  | { kind: 'atlasDetail'; atlasId: string }
  | { kind: 'addPlace'; onSelect: (places: PlaceDetail[]) => void; excludeIds?: string[]; returnTo?: Overlay }
  | { kind: 'createPlan' };

/**
 * Temporary map ownership for the map-first Atlas editor. It deliberately
 * lives outside the editor panel so there is always one full-screen map.
 */
export type AtlasMapState = {
  markers: MapMarker[];
  centerCoordinate?: [number, number];
  zoomLevel?: number;
  bounds?: { ne: [number, number]; sw: [number, number] };
  /** Changes when an Atlas view must re-apply identical bounds after reopening. */
  cameraKey?: string;
  selectedMarkerId?: string | null;
  routeGeoJSON?: GeoJSON.Feature<GeoJSON.LineString>;
  onMarkerPress?: (marker: MapMarker) => void;
  onMapPress?: () => void;
  /** Atlas-only controls live above the one shared map, never in its panel. */
  overlay?: ReactNode;
  /** Receives the live Edit atlas panel height so map overlays can follow it. */
  onPanelHeightChange?: (height: number) => void;
  markerPopup?: { markerId: string; content: ReactNode } | null;
  hideTopSearchButton?: boolean;
} | null;

type HomeContextValue = {
  overlay: Overlay;
  setOverlay: (overlay: Overlay) => void;
  tabBarVisible: boolean;
  setTabBarVisible: (visible: boolean) => void;
  atlasMapState: AtlasMapState;
  setAtlasMapState: (state: AtlasMapState) => void;
  /** 最新解析出的地点（来自 import 流程），供 HomeScreen 地图显示 */
  parsedPlaces: ParsedPlace[];
  setParsedPlaces: (places: ParsedPlace[]) => void;
  /** 从 Supabase 已加载的已保存地点 */
  savedPlaces: SavedPlace[];
  /** Whether the initial saved-place read has completed. */
  savedPlacesLoaded: boolean;
  setSavedPlaces: (places: SavedPlace[]) => void;
  /** 从 Supabase 刷新已保存地点列表 */
  refreshSavedPlaces: () => Promise<void>;
  /** Chat History 列表（最近 50 条） */
  chatHistory: ChatHistoryItem[];
  deletedChatHistory: ChatHistoryItem[];
  activeHistoryItem: ChatHistoryItem | null;
  setActiveHistoryItem: (item: ChatHistoryItem | null) => void;
  /** 添加一条新的 Chat History 记录 */
  addChatHistoryItem: (item: Omit<ChatHistoryItem, 'id' | 'createdAt'>) => string;
  replaceChatHistoryItem: (tempId: string, item: ChatHistoryItem) => void;
  deleteChatHistoryItem: (id: string) => void;
  restoreChatHistoryItem: (id: string) => void;
  /** 批量设置 Chat History（用于从 Supabase 加载） */
  setChatHistory: (items: ChatHistoryItem[]) => void;
  /** 选中地点的坐标，用于地图居中 */
  selectedPlaceCoordinate: [number, number] | null;
  setSelectedPlaceCoordinate: (coord: [number, number] | null) => void;
  selectedPlaceId: string | null;
  setSelectedPlaceId: (id: string | null) => void;
  /** Import 通知弹窗状态 */
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
  /** 从 Supabase 删除一个已保存地点 */
  deleteSavedPlace: (id: string) => Promise<void>;
  /** 更新已保存地点的备注（本地立即生效，联网后同步到 Supabase） */
  updateSavedPlaceNote: (id: string, note: string) => Promise<void>;
  /** Loaded atlases (local cache + Supabase sync) */
  atlases: Atlas[];
  /** Refreshes the atlas list from Supabase */
  refreshAtlases: () => Promise<void>;
  /** Creates a new atlas (local cache first, syncs to Supabase); returns null on failure */
  createAtlas: (title: string) => Promise<Atlas | null>;
  /** Deletes an atlas (local cache first, syncs to Supabase); atlas_places rows cascade */
  deleteAtlas: (id: string) => Promise<void>;
  /** Every atlas_places row for every atlas (local cache + Supabase sync); filter by atlas_id for one atlas */
  atlasPlaces: AtlasPlace[];
  /** Adds places to an atlas (local cache first, syncs to Supabase); skips places already in the atlas */
  addPlacesToAtlas: (atlasId: string, placeIds: string[]) => Promise<void>;
  /** Removes a place from an atlas by its atlas_places row id (local cache first, syncs to Supabase) */
  removePlaceFromAtlas: (joinRowId: string) => Promise<void>;
  /** 当前激活的 sidekick */
  activeSidekick: 'none' | 'aiChat' | 'places';
  setActiveSidekick: (sidekick: 'none' | 'aiChat' | 'places') => void;
  /** 用户当前位置坐标 [lng, lat]（默认西雅图） */
  userLocation: [number, number];
};

const HomeContext = createContext<HomeContextValue>({
  overlay: { kind: 'none' },
  setOverlay: () => {},
  tabBarVisible: true,
  setTabBarVisible: () => {},
  atlasMapState: null,
  setAtlasMapState: () => {},
  parsedPlaces: [],
  setParsedPlaces: () => {},
  savedPlaces: [],
  savedPlacesLoaded: false,
  setSavedPlaces: () => {},
  refreshSavedPlaces: async () => {},
  chatHistory: [],
  deletedChatHistory: [],
  activeHistoryItem: null,
  setActiveHistoryItem: () => {},
  addChatHistoryItem: () => '',
  replaceChatHistoryItem: () => {},
  deleteChatHistoryItem: () => {},
  restoreChatHistoryItem: () => {},
  setChatHistory: () => {},
  selectedPlaceCoordinate: null,
  setSelectedPlaceCoordinate: () => {},
  selectedPlaceId: null,
  setSelectedPlaceId: () => {},
  importNotification: null,
  setImportNotification: () => {},
  deleteSavedPlace: async () => {},
  updateSavedPlaceNote: async () => {},
  atlases: [],
  refreshAtlases: async () => {},
  createAtlas: async () => null,
  deleteAtlas: async () => {},
  atlasPlaces: [],
  addPlacesToAtlas: async () => {},
  removePlaceFromAtlas: async () => {},
  activeSidekick: 'none',
  setActiveSidekick: () => {},
  userLocation: [-122.3321, 47.6062],
});

export function useHome() {
  return useContext(HomeContext);
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
  const [atlasPlaces, setAtlasPlaces] = useState<AtlasPlace[]>([]);
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
  const [userLocation, setUserLocation] = useState<[number, number]>([-122.3321, 47.6062]);
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
    }
  }, []);

  const refreshAtlasPlaces = useCallback(async () => {
    try {
      const rows = await fetchAtlasPlaces();
      setAtlasPlaces(rows);
    } catch (e) {
      console.error('[HomeContext] refreshAtlasPlaces failed:', e);
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

  const contextValue = useMemo<HomeContextValue>(
    () => ({
      overlay,
      setOverlay,
      tabBarVisible,
      setTabBarVisible,
      atlasMapState,
      setAtlasMapState,
      parsedPlaces,
      setParsedPlaces,
      savedPlaces,
      savedPlacesLoaded,
      setSavedPlaces,
      refreshSavedPlaces,
      chatHistory,
      deletedChatHistory,
      activeHistoryItem,
      setActiveHistoryItem,
      addChatHistoryItem,
      replaceChatHistoryItem,
      deleteSavedPlace,
      updateSavedPlaceNote,
      atlases,
      refreshAtlases,
      createAtlas,
      deleteAtlas,
      atlasPlaces,
      addPlacesToAtlas,
      removePlaceFromAtlas,
      deleteChatHistoryItem,
      restoreChatHistoryItem,
      setChatHistory,
      selectedPlaceCoordinate,
      setSelectedPlaceCoordinate,
      selectedPlaceId,
      setSelectedPlaceId,
      importNotification,
      setImportNotification,
      activeSidekick,
      setActiveSidekick,
      userLocation,
    }),
    [
      overlay,
      tabBarVisible,
      atlasMapState,
      parsedPlaces,
      savedPlaces,
      savedPlacesLoaded,
      refreshSavedPlaces,
      chatHistory,
      deletedChatHistory,
      activeHistoryItem,
      addChatHistoryItem,
      replaceChatHistoryItem,
      deleteSavedPlace,
      updateSavedPlaceNote,
      atlases,
      refreshAtlases,
      createAtlas,
      deleteAtlas,
      atlasPlaces,
      addPlacesToAtlas,
      removePlaceFromAtlas,
      deleteChatHistoryItem,
      restoreChatHistoryItem,
      selectedPlaceCoordinate,
      selectedPlaceId,
      importNotification,
      activeSidekick,
      userLocation,
    ],
  );

  return (
    <HomeContext.Provider value={contextValue}>
      <ContentPanelSnapProvider>{children}</ContentPanelSnapProvider>
    </HomeContext.Provider>
  );
}
