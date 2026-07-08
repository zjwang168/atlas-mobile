import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ParsedPlace } from '../../services/import/importService';
import type { SavedPlace } from '../../services/place/placeService';
import { deletePlace, fetchSavedPlaces } from '../../services/place/placeService';
import { loadChatHistory } from '../../services/supabase/supabaseClient';
import type { PlannedPlace } from '../my-plan/create-plan/plan-place/types';

// --- Chat History ---

export type ChatHistoryItem = {
  id: string;
  title: string;
  sourceUrl: string;
  locationCount: number;
  places: ParsedPlace[];
  createdAt: string;
};

const MAX_CHAT_HISTORY = 50;

// --- Overlay ---

export type Overlay =
  | { kind: 'none' }
  | { kind: 'search' }
  | { kind: 'chatHistory' }
  | { kind: 'placeDetail'; placeName: string }
  | { kind: 'planDetail'; planId: string }
  | { kind: 'addPlaceToPlan'; onSelect: (places: PlannedPlace[]) => void }
  | { kind: 'createPlan' };

type HomeContextValue = {
  overlay: Overlay;
  setOverlay: (overlay: Overlay) => void;
  tabBarVisible: boolean;
  setTabBarVisible: (visible: boolean) => void;
  /** 最新解析出的地点（来自 import 流程），供 HomeScreen 地图显示 */
  parsedPlaces: ParsedPlace[];
  setParsedPlaces: (places: ParsedPlace[]) => void;
  /** 从 Supabase 已加载的已保存地点 */
  savedPlaces: SavedPlace[];
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
  parsedPlaces: [],
  setParsedPlaces: () => {},
  savedPlaces: [],
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
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [tabBarVisible, setTabBarVisible] = useState(true);
  const [parsedPlaces, setParsedPlaces] = useState<ParsedPlace[]>([]);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
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
  const [userLocation] = useState<[number, number]>([-122.3321, 47.6062]);

  const refreshSavedPlaces = useCallback(async () => {
    try {
      const places = await fetchSavedPlaces();
      setSavedPlaces(places);
    } catch (e) {
      console.error('[HomeContext] refreshSavedPlaces failed:', e);
    }
  }, []);

  // 初始加载已保存地点，让地图在启动时显示已保存的标记
  useEffect(() => {
    refreshSavedPlaces();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    try {
      await deletePlace(id);
      setSavedPlaces((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      console.error('[HomeContext] deleteSavedPlace failed:', e);
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
      parsedPlaces,
      setParsedPlaces,
      savedPlaces,
      setSavedPlaces,
      refreshSavedPlaces,
      chatHistory,
      deletedChatHistory,
      activeHistoryItem,
      setActiveHistoryItem,
      addChatHistoryItem,
      replaceChatHistoryItem,
      deleteSavedPlace,
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
      parsedPlaces,
      savedPlaces,
      refreshSavedPlaces,
      chatHistory,
      deletedChatHistory,
      activeHistoryItem,
      addChatHistoryItem,
      replaceChatHistoryItem,
      deleteSavedPlace,
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
      {children}
    </HomeContext.Provider>
  );
}
