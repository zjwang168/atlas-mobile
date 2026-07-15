import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { Text } from '@/components/ui/text';
import ContentPanel from '../../components/content-panel/ContentPanel';
import { parseInput } from '../../services/import/importService';
import { countChatHistory, loadChatHistory, saveChatHistory } from '../../services/supabase/supabaseClient';
import { typography } from '../../theme/typography';
import { useHome, type ChatHistoryItem } from './HomeContext';

const GREEN = {
  primary: '#12C170',
  primaryLight: '#E9FBF1',
  primaryLighter: '#F2FBF6',
  primaryStrong: '#0C8149',
  text: '#111827',
  textMuted: '#6B7280',
  border: '#D7F2E2',
  borderSoft: '#EAF7EF',
} as const;

const SOURCE_ICON_BY_TYPE: Record<string, keyof typeof Ionicons.glyphMap> = {
  smart_text: 'document-text-outline',
  image_scan: 'image-outline',
  find_image_places: 'camera-outline',
  reddit_links: 'logo-reddit',
  youtube_links: 'logo-youtube',
  any_links: 'link-outline',
};

function inferDisplaySourceType(item: Pick<ChatHistoryItem, 'title' | 'sourceUrl' | 'sourceType'>): keyof typeof SOURCE_ICON_BY_TYPE {
  const sourceType = item.sourceType ?? '';
  if (sourceType in SOURCE_ICON_BY_TYPE) return sourceType as keyof typeof SOURCE_ICON_BY_TYPE;

  const title = (item.title || '').toLowerCase();
  const sourceUrl = (item.sourceUrl || '').toLowerCase();
  const haystack = `${title} ${sourceUrl}`;

  if (title.includes('atlas ai chat')) return 'smart_text';
  if (title.includes('youtube') || haystack.includes('youtube.com') || haystack.includes('youtu.be')) return 'youtube_links';
  if (title.includes('reddit') || haystack.includes('reddit.com')) return 'reddit_links';
  if (haystack.includes('find image') || haystack.includes('photo')) return 'find_image_places';
  if (haystack.includes('image_scan') || haystack.includes('scan image')) return 'image_scan';
  if (haystack.includes('http://') || haystack.includes('https://') || haystack.includes('www.')) return 'any_links';
  return 'smart_text';
}

type AtlasAIHomeProps = {
  visible?: boolean;
  onHeightChange?: (height: number) => void;
  onOpenChat: (item: ChatHistoryItem) => void;
  onOpenPlaces: (item: ChatHistoryItem) => void;
  onLongPressDebug: () => void;
};

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function looksLikeUrl(value: string): boolean {
  return /^(https?:\/\/|www\.)\S+$/i.test(value.trim());
}

export default function AtlasAIHome({
  visible = true,
  onHeightChange,
  onOpenChat,
  onOpenPlaces,
  onLongPressDebug,
}: AtlasAIHomeProps) {
  const {
    chatHistory,
    setChatHistory,
    setActiveHistoryItem,
    setParsedPlaces,
    setActiveSidekick,
    setTabBarVisible,
  } = useHome();
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [totalChats, setTotalChats] = useState(0);

  const cards = useMemo(() => chatHistory, [chatHistory]);

  useEffect(() => {
    setTabBarVisible(true);
  }, [setTabBarVisible]);

  useEffect(() => {
    countChatHistory()
      .then((total) => setTotalChats(total))
      .catch((error) => console.warn('[AtlasAIHome] countChatHistory failed:', error));
  }, []);

  const refreshHistory = useCallback(async () => {
    const [items, total] = await Promise.all([loadChatHistory(), countChatHistory()]);
    setChatHistory(items);
    setTotalChats(total);
  }, [setChatHistory]);

  const handleCreateChat = useCallback(async () => {
    const text = input.trim();
    if (!text || submitting) return;

    setSubmitting(true);
    try {
      const result = await parseInput(text);
      const titleLower = (result.sourceTitle || text).toLowerCase();
      const sourceType =
        titleLower.includes('youtube') ? 'youtube_links'
        : titleLower.includes('reddit') ? 'reddit_links'
        : titleLower === 'atlas ai chat' || titleLower.includes('atlas ai chat') ? 'smart_text'
        : looksLikeUrl(text) ? 'any_links'
        : 'smart_text';
      const item: ChatHistoryItem = {
        id: `atlas_${Date.now()}`,
        title: result.sourceTitle || text.slice(0, 60) || 'Atlas AI',
        sourceUrl: text,
        locationCount: result.places.length,
        messageCount: 1,
        places: result.places,
        createdAt: new Date().toISOString(),
        sourceType,
      };

      const saved = await saveChatHistory({
        title: item.title,
        sourceUrl: item.sourceUrl,
        sourceType: item.sourceType,
        locationCount: item.locationCount,
        messageCount: item.messageCount,
        places: item.places,
      });

      const nextItem = { ...item, id: saved.id, createdAt: saved.createdAt };
      setParsedPlaces(result.places);
      setActiveHistoryItem(nextItem);
      setActiveSidekick('none');
      await refreshHistory();
      if (nextItem.locationCount > 0) {
        onOpenPlaces(nextItem);
      }
      setInput('');
    } catch (error) {
      console.warn('[AtlasAIHome] create chat failed:', error);
    } finally {
      setSubmitting(false);
    }
  }, [input, onOpenPlaces, refreshHistory, setActiveHistoryItem, setActiveSidekick, setParsedPlaces, submitting]);

  return (
    <ContentPanel initialSnap="default" visible={visible} onHeightChange={onHeightChange} zIndex={46}>
      {({ reportScrollY, bottomInset }) => (
        <View style={styles.container}>
          <Pressable onLongPress={onLongPressDebug} delayLongPress={700} style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Atlas AI (Chats)</Text>
            </View>
            <View style={styles.badge}>
              <Ionicons name="sparkles" size={14} color={GREEN.primaryStrong} />
              <Text style={styles.badgeText}>{totalChats || cards.length} chats</Text>
            </View>
          </Pressable>

          <FlatList
            data={cards}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.listContent, { paddingBottom: bottomInset + 180 }]}
            showsVerticalScrollIndicator={false}
            onScroll={(event) => {
              reportScrollY(event.nativeEvent.contentOffset.y);
              setTabBarVisible(true);
            }}
            onScrollBeginDrag={() => setTabBarVisible(true)}
            scrollEventThrottle={16}
            renderItem={({ item }) => {
              const hasPlaces = (item.locationCount ?? 0) > 0;
              const displaySourceType = inferDisplaySourceType(item);
              const sourceIcon = SOURCE_ICON_BY_TYPE[displaySourceType] ?? 'sparkles';
              return (
                <View style={styles.cardWrap}>
                  <TouchableOpacity
                    activeOpacity={0.84}
                    style={styles.card}
                    onPress={() => onOpenChat(item)}
                  >
                    <View style={styles.cardRowTop}>
                      <Ionicons name={sourceIcon as any} size={16} color={GREEN.primaryStrong} />
                      <Text style={styles.cardTitle} numberOfLines={1} ellipsizeMode="tail">
                        {item.title}
                      </Text>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        disabled={!hasPlaces}
                        onPress={() => onOpenPlaces(item)}
                        style={[styles.placesPill, !hasPlaces && styles.placesPillDisabled]}
                      >
                        <Ionicons
                          name="map-outline"
                          size={14}
                          color={hasPlaces ? GREEN.primaryStrong : '#A1A1AA'}
                        />
                        <Text style={[styles.placesPillText, !hasPlaces && styles.placesPillTextDisabled]}>
                          {hasPlaces ? `${item.locationCount} places` : 'No places yet'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {formatDate(item.createdAt)}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            }}
          />

        </View>
      )}
    </ContentPanel>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
  },
  header: {
    paddingHorizontal: 4,
    paddingTop: 2,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...typography.display,
    color: GREEN.text,
    fontSize: 24,
    lineHeight: 30,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  badgeText: {
    ...typography.bodySmall,
    color: GREEN.textMuted,
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 120,
    gap: 12,
  },
  cardWrap: {
    gap: 8,
  },
  card: {
    minHeight: 96,
    borderRadius: 24,
    backgroundColor: '#FBFCFD',
    padding: 18,
    borderWidth: 1,
    borderColor: '#E7EEF5',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14,
    elevation: 3,
  },
  cardRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 24,
  },
  cardTitle: {
    flex: 1,
    ...typography.h3,
    color: GREEN.text,
    fontSize: 16,
    lineHeight: 20,
    paddingRight: 10,
  },
  cardMeta: {
    ...typography.bodySmall,
    color: GREEN.textMuted,
    flexShrink: 1,
    lineHeight: 18,
    fontSize: 12,
    marginTop: 8,
  },
  placesPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#EAF7EF',
    paddingHorizontal: 14,
    paddingVertical: 7,
    alignSelf: 'flex-start',
    flexShrink: 0,
    minHeight: 32,
  },
  placesPillDisabled: {
    backgroundColor: '#F3F4F6',
  },
  placesPillText: {
    ...typography.bodySmall,
    color: GREEN.primaryStrong,
    fontWeight: '700',
  },
  placesPillTextDisabled: {
    color: '#A1A1AA',
  },
});
