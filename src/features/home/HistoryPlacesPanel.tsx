import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { typography } from '../../theme/typography';
import type { ChatHistoryItem } from './HomeContext';
import { useHome } from './HomeContext';
import { isSamePlace } from '../../services/place/placeService';

type HistoryPlacesPanelProps = {
  item: ChatHistoryItem;
  selectedPlaceId: string | null;
  onClose: () => void;
  onPlacePress: (placeId: string) => void;
  onSavePlaces: (selectedIds: string[]) => void;
  onScroll?: (y: number) => void;
  bottomInset?: number;
};

function sentimentLabel(sentiment?: string | null) {
  if (sentiment === 'positive') return 'Recommended';
  if (sentiment === 'negative') return 'Not recommended';
  return 'Neutral';
}

function isPlaceSaved(
  place: { name: string; latitude: number; longitude: number },
  savedPlaces: { name: string; latitude: number; longitude: number }[],
): boolean {
  return savedPlaces.some((s) => isSamePlace(place, s));
}

export default function HistoryPlacesPanel({
  item,
  selectedPlaceId,
  onClose,
  onPlacePress,
  onSavePlaces,
  onScroll,
  bottomInset = 0,
}: HistoryPlacesPanelProps) {
  const { savedPlaces } = useHome();
  const [selected, setSelected] = useState<string[]>([]);
  const listRef = useRef<FlatList>(null);

  // 每个地点是否已保存（通过稳定键判断，不是用 ID）
  const savedSet = useMemo(() => {
    const set = new Set<string>();
    for (const place of item.places) {
      if (isPlaceSaved(place, savedPlaces)) {
        set.add(place.id);
      }
    }
    return set;
  }, [item.places, savedPlaces]);

  // 初始时已保存的打勾，未保存的不打勾
  useEffect(() => {
    const initial: string[] = [];
    for (const place of item.places) {
      if (!isPlaceSaved(place, savedPlaces)) {
        initial.push(place.id);
      }
    }
    setSelected(initial);
  }, [item.places, savedPlaces]);

  useEffect(() => {
    if (selectedPlaceId && item.places.length > 0) {
      const idx = item.places.findIndex((p) => p.id === selectedPlaceId);
      if (idx >= 0) {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
      }
    }
  }, [selectedPlaceId, item.places]);

  const toggleSelect = useCallback((id: string) => {
    if (savedSet.has(id)) return;
    setSelected((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  }, []);

  const handleSave = useCallback(() => {
    const unsavedSelected = selected.filter((id) => !savedSet.has(id));
    if (unsavedSelected.length > 0) {
      onSavePlaces(unsavedSelected);
    }
  }, [selected, savedSet, onSavePlaces]);

  const selectableCount = item.places.length - savedSet.size;
  const selectedUnsavedCount = selected.filter((id) => !savedSet.has(id)).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.subtitle}>{item.locationCount} places from chat history</Text>
        </View>
        <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.75}>
          <Ionicons name="close" size={20} color="#1A1A1A" />
        </TouchableOpacity>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.saveButton, selectableCount === 0 && styles.saveButtonDisabled]}
          onPress={handleSave}
          activeOpacity={0.8}
          disabled={selectedUnsavedCount === 0}
        >
          <Ionicons name="bookmark-outline" size={16} color="#FFFFFF" />
          <Text style={styles.saveButtonText}>Save places</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={listRef}
        data={item.places}
        keyExtractor={(place) => place.id}
        style={styles.list}
        contentContainerStyle={{ paddingBottom: bottomInset + 96 }}
        onScroll={(event) => onScroll?.(event.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item: place }) => {
          const active = selectedPlaceId === place.id;
          const isSaved = savedSet.has(place.id);
          const isChecked = selected.includes(place.id);
          return (
            <Pressable
              style={[styles.row, active && styles.rowActive]}
              onPress={() => onPlacePress(place.id)}
            >
              <View style={[styles.pin, active && styles.pinActive]}>
                <Ionicons name="location" size={16} color={active ? '#FFFFFF' : '#2563EB'} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.placeName} numberOfLines={1}>{place.name}</Text>
                <Text style={styles.placeSubtitle} numberOfLines={2}>{place.subtitle}</Text>
                <View style={[
                  styles.chip,
                  place.sentiment === 'positive' && styles.chipPositive,
                  place.sentiment === 'negative' && styles.chipNegative,
                ]}>
                  <Text style={styles.chipText}>{sentimentLabel(place.sentiment)}</Text>
                </View>
              </View>
              {isSaved ? (
                <View style={styles.savedBadge}>
                  <Text style={styles.savedBadgeText}>Saved</Text>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => toggleSelect(place.id)}
                  hitSlop={10}
                  activeOpacity={0.7}
                  style={[styles.check, isChecked ? styles.checkOn : styles.checkOff]}
                >
                  {isChecked ? <Ionicons name="checkmark" size={16} color="#FFFFFF" /> : null}
                </TouchableOpacity>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...typography.display,
    color: '#09090B',
  },
  subtitle: {
    marginTop: 2,
    ...typography.bodySmall,
    color: '#717171',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  saveButton: {
    height: 44,
    borderRadius: 999,
    backgroundColor: '#12C170',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  saveButtonDisabled: {
    opacity: 0.45,
  },
  list: {
    flex: 1,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 20,
    padding: 12,
  },
  rowActive: {
    backgroundColor: '#F2FBF6',
  },
  pin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinActive: {
    backgroundColor: '#12C170',
  },
  rowText: {
    flex: 1,
    gap: 4,
  },
  placeName: {
    ...typography.h3,
    color: '#1A1A1A',
  },
  placeSubtitle: {
    ...typography.bodySmall,
    color: '#717171',
  },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  chipPositive: {
    backgroundColor: '#E9FBF1',
  },
  chipNegative: {
    backgroundColor: '#FDECEC',
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(60,60,67,0.08)',
    marginHorizontal: 12,
  },
  savedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#E9FBF1',
    alignSelf: 'center',
  },
  savedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0C8149',
    letterSpacing: 0.2,
  },
  check: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: '#12C170' },
  checkOff: { borderWidth: 1.5, borderColor: '#D7D7DC' },
});
