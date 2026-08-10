import { memo, useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import ContentPanel from '@/components/content-panel/ContentPanel';
import { PlaceCover } from '@/components/place-cover/PlaceCover';
import { useHome } from '@/features/home/HomeContext';
import { toPlaceDetail } from '@/services/place/placeService';
import type { PlaceDetail } from '@/types/place';

const FILTERS = ['Recommended', 'Best for Summer', 'Nearby', 'Not Yet Visited'];

type ResultRowProps = {
  item: PlaceDetail;
  isSelected: boolean;
  onToggle: (id: string) => void;
};

const ResultRow = memo(function ResultRow({ item, isSelected, onToggle }: ResultRowProps) {
  return (
    <TouchableOpacity
      onPress={() => onToggle(item.id)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        gap: 12,
      }}
    >
      <View style={{ width: 44, height: 44, borderRadius: 8, overflow: 'hidden', backgroundColor: '#f4f4f5' }}>
        {item.thumbnailUrl ? (
          <Image source={{ uri: item.thumbnailUrl }} style={{ width: 44, height: 44 }} resizeMode="cover" />
        ) : (
          <PlaceCover category={item.category} iconSize={20} />
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text className="text-base text-text-primary" numberOfLines={1}>
          {item.name}
        </Text>
        <Text className="text-sm text-text-tertiary" numberOfLines={1}>
          {item.subtitle}
        </Text>
      </View>

      {/* Checkbox */}
      <View
        className={
          isSelected
            ? 'bg-foreground rounded-[4px] items-center justify-center'
            : 'border border-border rounded-[4px] items-center justify-center'
        }
        style={{ width: 16, height: 16 }}
      >
        {isSelected && <Ionicons name="checkmark" size={11} color="#fafafa" />}
      </View>
    </TouchableOpacity>
  );
});

type AddPlaceProps = {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (places: PlaceDetail[]) => void;
  snapGroup?: string;
  onHeightChange?: (height: number) => void;
  /** Place ids to hide from the picker — e.g. places already in the target atlas. Omit to show every saved place (callers like the plan flow want duplicates selectable). */
  excludeIds?: string[];
};

export default function AddPlace({ visible, onDismiss, onSelect, snapGroup, onHeightChange, excludeIds }: AddPlaceProps) {
  const { savedPlaces } = useHome();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string | null>('Recommended');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const places = useMemo(() => {
    const excluded = excludeIds ? new Set(excludeIds) : null;
    const detailed = savedPlaces.map(toPlaceDetail);
    return excluded ? detailed.filter((p) => !excluded.has(p.id)) : detailed;
  }, [savedPlaces, excludeIds]);

  function resetState() {
    setSearch('');
    setActiveFilter('Recommended');
    setSelected(new Set());
  }

  // Memoized so a re-render caused by a sibling panel's snap-group broadcast
  // (this panel is always mounted, even while hidden) doesn't hand FlatList a
  // new array reference and force it to reconcile every row off-screen.
  const results = useMemo(
    () =>
      places.filter((p) => {
        const q = search.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.subtitle.toLowerCase().includes(q);
      }),
    [places, search],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function handleConfirm() {
    const chosen = places.filter((p) => selected.has(p.id));
    onSelect(chosen);
  }

  const keyExtractor = useCallback((item: PlaceDetail) => item.id, []);
  const renderItem = useCallback(
    ({ item }: { item: PlaceDetail }) => (
      <ResultRow item={item} isSelected={selected.has(item.id)} onToggle={toggleSelect} />
    ),
    [selected, toggleSelect],
  );

  const confirmLabel =
    selected.size === 0
      ? 'Select Places'
      : selected.size === 1
        ? 'Add 1 Place'
        : `Add ${selected.size} Places`;

  return (
    <ContentPanel
      visible={visible}
      onHidden={resetState}
      initialSnap="default"
      zIndex={50}
      snapGroup={snapGroup}
      minSnap="default"
      onHeightChange={onHeightChange}
    >
      {({ reportScrollY, bottomInset }) => (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingTop: 4,
              paddingBottom: 12,
            }}
          >
            <Text className="text-lg font-semibold text-foreground">Add Places</Text>
            <Button variant="ghost" size="icon" className="rounded-full" onPress={onDismiss}>
              <Ionicons name="close" size={20} color="#52525b" />
            </Button>
          </View>

          {/* Search row */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 16,
              paddingBottom: 10,
            }}
          >
            <View
              className="flex-1 flex-row items-center bg-muted rounded-[10px] px-[10px] gap-[6px]"
              style={{ height: 36 }}
            >
              <Ionicons name="search" size={16} color="#71717a" />
              <Input
                className="flex-1 bg-transparent border-0 shadow-none px-0 py-0 rounded-none h-full"
                placeholder="Search"
                placeholderTextColor="#a1a1aa"
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
                returnKeyType="search"
              />
              <Ionicons name="mic-outline" size={16} color="#71717a" />
            </View>
            <TouchableOpacity
              className="bg-muted rounded-full items-center justify-center"
              style={{ width: 36, height: 36 }}
            >
              <Ionicons name="options-outline" size={18} color="#52525b" />
            </TouchableOpacity>
          </View>

          {/* Filter pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingVertical: 8,
              gap: 8,
            }}
          >
            {FILTERS.map((filter) => {
              const isActive = activeFilter === filter;
              return (
                <TouchableOpacity
                  key={filter}
                  onPress={() => setActiveFilter(isActive ? null : filter)}
                  className={
                    isActive
                      ? 'bg-foreground rounded-full items-center justify-center px-[13px]'
                      : 'bg-background border border-border rounded-full items-center justify-center px-[13px]'
                  }
                  style={{ height: 44 }}
                >
                  <Text
                    className={
                      isActive
                        ? 'text-[15px] font-medium text-background'
                        : 'text-[15px] font-medium text-foreground'
                    }
                  >
                    {filter}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Divider */}
          <View className="h-px bg-border" />

          {/* Results list — flex: 1 so it fills remaining space and never pushes fixed sections */}
          <FlatList
            style={{ flex: 1 }}
            data={results}
            keyExtractor={keyExtractor}
            scrollEventThrottle={16}
            onScroll={(e) => reportScrollY(e.nativeEvent.contentOffset.y)}
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingTop: 12,
              paddingBottom: bottomInset + 16,
            }}
            ItemSeparatorComponent={() => <View className="h-px bg-border" />}
            ListEmptyComponent={
              <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                <Text className="text-sm text-text-tertiary">No saved places yet</Text>
              </View>
            }
            renderItem={renderItem}
          />

          {/* Confirm button */}
          <View style={{ paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8 }}>
            <Button
              size="lg"
              className="rounded-full h-[50px]"
              disabled={selected.size === 0}
              onPress={handleConfirm}
            >
              <Text className="text-[17px] font-medium text-primary-foreground">
                {confirmLabel}
              </Text>
            </Button>
          </View>
        </KeyboardAvoidingView>
      )}
    </ContentPanel>
  );
}
