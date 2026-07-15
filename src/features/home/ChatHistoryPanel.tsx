import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Display labels for conversations.source_type values. */
const SOURCE_TYPE_LABELS: Record<string, string> = {
  smart_text: 'Smart Text',
  image_scan: 'Image Scan',
  find_image_places: 'Find Image Places',
  reddit_links: 'Reddit Links',
  any_links: 'Any Links',
  youtube_links: 'YouTube Links',
};

import { loadChatHistory } from '../../services/supabase/supabaseClient';
import type { ChatHistoryItem } from './HomeContext';
import { useHome } from './HomeContext';

type ChatHistoryPanelProps = {
  onClose: () => void;
};

export default function ChatHistoryPanel({ onClose }: ChatHistoryPanelProps) {
  const { top } = useSafeAreaInsets();
  const {
    chatHistory,
    deletedChatHistory,
    setChatHistory,
    setParsedPlaces,
    setActiveHistoryItem,
    setActiveSidekick,
    setOverlay,
    deleteChatHistoryItem,
    restoreChatHistoryItem,
    setSelectedPlaceCoordinate,
    setSelectedPlaceId,
  } = useHome();
  const [loading, setLoading] = useState(false);
  const apiBase = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

  /** 删除 Chat 时同步清除后端缓存 */
  const handleDelete = useCallback((item: ChatHistoryItem) => {
    deleteChatHistoryItem(item.id);
    if (item.sourceUrl && item.sourceUrl.startsWith('http')) {
      fetch(`${apiBase}/cache/invalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.sourceUrl }),
      }).catch(() => {});
    }
  }, [deleteChatHistoryItem, apiBase]);
  const [view, setView] = useState<'history' | 'trash'>('history');
  const visibleItems = view === 'history' ? chatHistory : deletedChatHistory;

  // 加载 Chat History（缓存已有时从缓存取，否则从 Supabase 拉取）
  useEffect(() => {
    setLoading(true);
    loadChatHistory()
      .then((items) => {
        setChatHistory(items);
      })
      .catch((e) => console.warn('[ChatHistoryPanel] load failed:', e))
      .finally(() => setLoading(false));
  }, [setChatHistory]);

  const handleItemPress = useCallback(
    (item: ChatHistoryItem) => {
      // 关闭 panel → 设置 parsedPlaces → 地图显示标记
      setParsedPlaces(item.places);
      setActiveHistoryItem(item);
      setActiveSidekick('none');
      setSelectedPlaceCoordinate(null);
      setSelectedPlaceId(null);
      setOverlay({ kind: 'none' });
    },
    [setActiveHistoryItem, setActiveSidekick, setParsedPlaces, setOverlay, setSelectedPlaceCoordinate, setSelectedPlaceId],
  );

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const renderItem = ({ item }: { item: ChatHistoryItem }) => (
    <TouchableOpacity
      style={styles.itemContainer}
      activeOpacity={0.7}
      onPress={() => view === 'history' ? handleItemPress(item) : undefined}
    >
      <View style={styles.itemHeader}>
        <Text style={styles.itemTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <View style={styles.itemActions}>
          {item.sourceType ? (
            <View style={styles.sourceChip}>
              <Text style={styles.sourceChipText}>
                {SOURCE_TYPE_LABELS[item.sourceType] ?? item.sourceType}
              </Text>
            </View>
          ) : null}
          <Text style={styles.itemCount}>{item.locationCount} 个地点</Text>
          <TouchableOpacity
            style={styles.iconButton}
            hitSlop={8}
            onPress={() => {
              if (view === 'history') handleDelete(item);
              else restoreChatHistoryItem(item.id);
            }}
          >
            <Ionicons
              name={view === 'history' ? 'trash-outline' : 'arrow-undo-outline'}
              size={16}
              color={view === 'history' ? '#DC2626' : '#007AFF'}
            />
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.itemDate}>{formatDate(item.createdAt)}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { paddingTop: top + 60 }]}>
      {/* 标题栏 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chat History</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeText}>关闭</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.segment}>
        <TouchableOpacity
          style={[styles.segmentButton, view === 'history' && styles.segmentButtonActive]}
          onPress={() => setView('history')}
        >
          <Text style={[styles.segmentText, view === 'history' && styles.segmentTextActive]}>
            History
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segmentButton, view === 'trash' && styles.segmentButtonActive]}
          onPress={() => setView('trash')}
        >
          <Text style={[styles.segmentText, view === 'trash' && styles.segmentTextActive]}>
            Trash
          </Text>
        </TouchableOpacity>
      </View>

      {/* 列表 */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      ) : visibleItems.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>{view === 'history' ? '暂无历史记录' : '垃圾站为空'}</Text>
        </View>
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.96)',
    zIndex: 100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
  },
  closeButton: {
    padding: 6,
  },
  closeText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 40,
  },
  segment: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  segmentButton: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: '#F2F2F7',
    paddingVertical: 10,
    alignItems: 'center',
  },
  segmentButtonActive: {
    backgroundColor: '#111827',
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6B7280',
  },
  segmentTextActive: {
    color: '#FFFFFF',
  },
  itemContainer: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    flex: 1,
    marginRight: 12,
  },
  sourceChip: {
    backgroundColor: 'rgba(0, 122, 255, 0.10)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 6,
  },
  sourceChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#007AFF',
  },
  itemCount: {
    fontSize: 13,
    fontWeight: '500',
    color: '#007AFF',
    backgroundColor: '#E8F0FE',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  itemDate: {
    fontSize: 13,
    color: '#8E8E93',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#8E8E93',
  },
});
