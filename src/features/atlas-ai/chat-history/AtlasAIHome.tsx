import BottomSheet from '@expo/ui/community/bottom-sheet';
import { ArrowLeftIcon } from 'phosphor-react-native/src/icons/ArrowLeft';
import { ChatCircleIcon } from 'phosphor-react-native/src/icons/ChatCircle';
import { TrashIcon } from 'phosphor-react-native/src/icons/Trash';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';

import { Text } from '@/components/ui/text';
import TopBlurFade from '@/components/ui/top-blur-fade';
import { useAppDialog } from '@/components/feedback/AppDialog';
import { deleteConversation } from '@/services/api/apiService';
import { loadChatHistory } from '@/services/supabase/supabaseClient';
import { useHome, type ChatHistoryItem } from '@/features/home/HomeContext';

const COLOR = {
  background: '#FFFFFF',
  foreground: '#1A1A1A',
  secondary: '#717171',
  primaryStrong: '#0C8149',
} as const;

const HISTORY_HEADER_INSET = 70;
const HISTORY_HEADER_MATERIAL_HEIGHT = 120;

type HistorySection = {
  title: string;
  data: ChatHistoryItem[];
};

type AtlasAIHomeProps = {
  visible?: boolean;
  onHeightChange?: (height: number) => void;
  onOpenChat: (item: ChatHistoryItem) => void;
  onOpenPlaces: (item: ChatHistoryItem) => void;
  onLongPressDebug: () => void;
  /** Returns to the AI chat that opened chat history. */
  onBackToChat?: () => void;
  /** Exits chat history and returns to My Places. */
  onClose?: () => void;
};

function getHistoryTimestamp(item: ChatHistoryItem): number {
  const timestamp = new Date(item.updatedAt || item.createdAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getHistoryMonth(item: ChatHistoryItem): string {
  const date = new Date(getHistoryTimestamp(item));
  if (!Number.isFinite(date.getTime()) || date.getTime() === 0) return 'Earlier';
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function getPlacesLabel(count: number): string {
  return `${count} ${count === 1 ? 'place' : 'places'}`;
}

export default function AtlasAIHome({
  visible = true,
  onOpenChat,
  onLongPressDebug,
  onBackToChat,
  onClose,
}: AtlasAIHomeProps) {
  const {
    chatHistory,
    setChatHistory,
    deleteChatHistoryItem,
    setTabBarVisible,
  } = useHome();
  const { show: showDialog } = useAppDialog();
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [deleteModeId, setDeleteModeId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const cards = useMemo(() => chatHistory, [chatHistory]);
  const sections = useMemo<HistorySection[]>(() => {
    const grouped = new Map<string, ChatHistoryItem[]>();
    const sortedCards = [...cards].sort(
      (a, b) => getHistoryTimestamp(b) - getHistoryTimestamp(a),
    );

    for (const item of sortedCards) {
      const month = getHistoryMonth(item);
      const monthItems = grouped.get(month);
      if (monthItems) monthItems.push(item);
      else grouped.set(month, [item]);
    }

    return Array.from(grouped, ([title, data]) => ({ title, data }));
  }, [cards]);

  useEffect(() => {
    setTabBarVisible(true);
  }, [setTabBarVisible]);

  const loadOlderHistory = useCallback(async () => {
    if (loadingMore || !hasMore || chatHistory.length === 0) return;
    setLoadingMore(true);
    try {
      const lastItem = chatHistory[chatHistory.length - 1];
      const olderItems = await loadChatHistory({
        limit: 50,
        beforeUpdatedAt: lastItem.updatedAt || lastItem.createdAt,
      });
      if (olderItems.length === 0) {
        setHasMore(false);
        return;
      }
      const seen = new Set(chatHistory.map((item) => item.id));
      const merged = [...chatHistory];
      for (const item of olderItems) {
        if (!seen.has(item.id)) merged.push(item);
      }
      setChatHistory(merged);
      setHasMore(olderItems.length >= 50);
    } catch (error) {
      console.warn('[AtlasAIHome] loadOlderHistory failed:', error);
    } finally {
      setLoadingMore(false);
    }
  }, [chatHistory, hasMore, loadingMore, setChatHistory]);

  const deleteHistoryItem = useCallback((item: ChatHistoryItem) => {
    showDialog({
      title: 'Delete this chat?',
      message: 'This permanently removes the conversation, its messages, and attached places from chat history.',
      tone: 'danger',
      actions: [
        { label: 'Cancel', variant: 'secondary' },
        {
          label: 'Delete',
          variant: 'destructive',
          onPress: () => {
            setDeletingId(item.id);
            void deleteConversation(item.id)
              .then(() => {
                deleteChatHistoryItem(item.id);
                setDeleteModeId((current) => (current === item.id ? null : current));
              })
              .catch((error) => {
                console.warn('[AtlasAIHome] deleteConversation failed:', error);
                showDialog({
                  title: 'Could not delete this chat',
                  message: 'Nothing has changed. Please try again in a moment.',
                  tone: 'warning',
                });
              })
              .finally(() => setDeletingId(null));
          },
        },
      ],
    });
  }, [deleteChatHistoryItem, showDialog]);

  return (
    <BottomSheet
      index={visible ? 0 : -1}
      snapPoints={['100%']}
      enableDynamicSizing={false}
      enablePanDownToClose
      backgroundStyle={styles.sheetBackground}
      onClose={onClose}
    >
      <View style={styles.container}>
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          contentInsetAdjustmentBehavior="never"
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          scrollIndicatorInsets={{ top: HISTORY_HEADER_INSET, bottom: 96 }}
          onScrollBeginDrag={() => setTabBarVisible(true)}
          onEndReachedThreshold={0.35}
          onEndReached={loadOlderHistory}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionTitle}>{section.title}</Text>
          )}
          renderSectionFooter={() => <View style={styles.sectionFooter} />}
          renderItem={({ item, index, section }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${getPlacesLabel(item.locationCount ?? 0)}`}
              accessibilityHint="Long press to show the delete button"
              onPress={() => {
                if (deleteModeId === item.id) {
                  setDeleteModeId(null);
                  return;
                }
                onOpenChat(item);
              }}
              onLongPress={() => setDeleteModeId(item.id)}
              delayLongPress={500}
              style={({ pressed }) => [
                styles.historyRow,
                index < section.data.length - 1 && styles.historyRowSpacing,
                pressed && styles.historyRowPressed,
              ]}
            >
              <ChatCircleIcon
                size={24}
                weight="regular"
                color={COLOR.secondary}
              />
              <View style={styles.historyRowText}>
                <Text style={styles.historyTitle} numberOfLines={1} ellipsizeMode="tail">
                  {item.title}
                </Text>
                <Text style={styles.historyMeta}>
                  {getPlacesLabel(item.locationCount ?? 0)}
                </Text>
              </View>
              {deleteModeId === item.id ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Delete chat"
                  disabled={deletingId === item.id}
                  hitSlop={10}
                  onPress={() => deleteHistoryItem(item)}
                  style={({ pressed }) => [styles.deleteButton, pressed && styles.deleteButtonPressed]}
                >
                  {deletingId === item.id ? (
                    <ActivityIndicator size="small" color="#C0392B" />
                  ) : (
                    <TrashIcon size={21} weight="regular" color="#C0392B" />
                  )}
                </Pressable>
              ) : null}
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No chat history yet</Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.loadingMore}>
                <ActivityIndicator size="small" color={COLOR.primaryStrong} />
                <Text style={styles.loadingMoreText}>Loading older chats...</Text>
              </View>
            ) : null
          }
        />

        <TopBlurFade
          height={HISTORY_HEADER_MATERIAL_HEIGHT}
          intensity={40}
          tint="systemThinMaterialLight"
          scrim={1}
        />

        <TopBlurFade
          edge="bottom"
          height={96}
          intensity={10}
          tint="systemUltraThinMaterialLight"
          scrim={1}
        />

        <View
          pointerEvents="box-none"
          style={styles.header}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Return to AI chat"
            hitSlop={10}
            onPress={onBackToChat}
            style={({ pressed }) => [styles.headerButton, styles.backButton, pressed && styles.headerButtonPressed]}
          >
            <ArrowLeftIcon size={21} weight="bold" color={COLOR.foreground} />
          </Pressable>
          <Pressable
            onLongPress={onLongPressDebug}
            delayLongPress={700}
            style={styles.titleHitArea}
          >
            <Text pointerEvents="none" style={styles.title}>
              Chat history
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close chat history and return to My Places"
            hitSlop={10}
            onPress={onClose}
            style={({ pressed }) => [styles.headerButton, styles.closeButton, pressed && styles.headerButtonPressed]}
          >
            <XIcon size={21} weight="bold" color={COLOR.foreground} />
          </Pressable>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: COLOR.background,
  },
  container: {
    flex: 1,
    position: 'relative',
    backgroundColor: COLOR.background,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 3,
    height: 54,
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: 'transparent',
  },
  headerButton: {
    position: 'absolute',
    top: 7,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  backButton: { left: 12 },
  closeButton: { right: 12 },
  headerButtonPressed: { backgroundColor: 'rgba(0, 0, 0, 0.08)' },
  titleHitArea: {
    height: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#333333',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: -0.17,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingTop: HISTORY_HEADER_INSET,
    paddingBottom: 104,
  },
  sectionTitle: {
    height: 24,
    marginHorizontal: 20,
    marginBottom: 12,
    color: COLOR.secondary,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    letterSpacing: -0.16,
  },
  sectionFooter: {
    height: 20,
  },
  historyRow: {
    height: 46,
    marginHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  historyRowSpacing: {
    marginBottom: 12,
  },
  historyRowPressed: {
    opacity: 0.55,
  },
  historyRowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  deleteButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButtonPressed: {
    opacity: 0.55,
  },
  historyTitle: {
    width: '100%',
    color: COLOR.foreground,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    letterSpacing: -0.16,
  },
  historyMeta: {
    width: '100%',
    color: COLOR.secondary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: -0.14,
  },
  emptyState: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  emptyStateText: {
    color: COLOR.secondary,
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: -0.16,
  },
  loadingMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  loadingMoreText: {
    color: COLOR.secondary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
});
