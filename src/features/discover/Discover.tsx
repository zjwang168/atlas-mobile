import { MapPinCover } from '@/components/map-pin-cover/MapPinCover';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import { ArrowsDownUpIcon } from 'phosphor-react-native/src/icons/ArrowsDownUp';
import { CaretDownIcon } from 'phosphor-react-native/src/icons/CaretDown';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { CoffeeBeanIcon } from 'phosphor-react-native/src/icons/CoffeeBean';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { ParkIcon } from 'phosphor-react-native/src/icons/Park';
import { ShoppingBagIcon } from 'phosphor-react-native/src/icons/ShoppingBag';
import { StarIcon } from 'phosphor-react-native/src/icons/Star';
import { TreeIcon } from 'phosphor-react-native/src/icons/Tree';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type ImageSourcePropType,
} from 'react-native';

// -- Fake data ----------------------------------------------------------

type DiscoverPlace = {
  id: string;
  name: string;
  category: string;
  categoryIcon: 'park' | 'shopping' | 'cafe' | 'tree';
  rating: number;
  distanceKm: number;
  trending: boolean;
  thumbnailSource?: ImageSourcePropType;
};

const FAKE_PLACES: DiscoverPlace[] = [
  { id: '1', name: 'Newcastle Beach Park', category: 'Parks', categoryIcon: 'tree', rating: 4.1, distanceKm: 0.8, trending: true, thumbnailSource: require('../../../assets/images/discover/park.jpg') },
  { id: '2', name: 'City Center Mall', category: 'Shopping', categoryIcon: 'shopping', rating: 4.5, distanceKm: 1.2, trending: true, thumbnailSource: require('../../../assets/images/discover/mall.jpg') },
  { id: '3', name: 'Riverfront Cafe', category: 'Cafe', categoryIcon: 'cafe', rating: 4.3, distanceKm: 1.7, trending: false, thumbnailSource: require('../../../assets/images/discover/cafe.jpg') },
  { id: '4', name: 'Green Valley Trail', category: 'Parks', categoryIcon: 'park', rating: 4.7, distanceKm: 2.1, trending: true, thumbnailSource: require('../../../assets/images/discover/fallback.jpg') },
  { id: '5', name: 'Pike Place Market', category: 'Shopping', categoryIcon: 'shopping', rating: 4.6, distanceKm: 2.8, trending: true, thumbnailSource: require('../../../assets/images/discover/mall.jpg') },
  { id: '6', name: 'Lighthouse Coffee', category: 'Cafe', categoryIcon: 'cafe', rating: 4.2, distanceKm: 3.4, trending: false, thumbnailSource: require('../../../assets/images/discover/cafe.jpg') },
];

type DiscoverSortMode = 'distance' | 'rating';
type DiscoverCategory = 'all' | 'Parks' | 'Shopping' | 'Cafe';

// -- Category icon mapping ------------------------------------------------

const CATEGORY_ICONS = {
  park: { Icon: ParkIcon, color: '#4CAF50' },
  shopping: { Icon: ShoppingBagIcon, color: '#E91E8E' },
  cafe: { Icon: CoffeeBeanIcon, color: '#FF6259' },
  tree: { Icon: TreeIcon, color: '#4CAF50' },
} as const;

// -- Components -----------------------------------------------------------

function CategoryChip({ category, iconKey }: { category: string; iconKey: DiscoverPlace['categoryIcon'] }) {
  const { Icon, color } = CATEGORY_ICONS[iconKey];
  return (
    <View style={styles.chip}>
      <Icon size={13} weight="fill" color={color} />
      <Text style={styles.chipLabel}>{category}</Text>
    </View>
  );
}

function RatingChip({ rating }: { rating: number }) {
  return (
    <View style={styles.chip}>
      <StarIcon size={13} weight="fill" color="#F5A000" />
      <Text style={styles.chipLabel}>{rating}</Text>
    </View>
  );
}

const DiscoverPlaceCard = memo(function DiscoverPlaceCard({
  place,
}: {
  place: DiscoverPlace;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={place.name}
      onPress={() => {}}
      scaleTo={0.985}
      style={styles.card}
    >
      <View style={styles.cardThumbnail}>
        {place.thumbnailSource ? (
          <Image
            source={place.thumbnailSource}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <MapPinCover pinSize={22} />
        )}
      </View>

      <View style={styles.cardContent}>
        <Text numberOfLines={1} style={styles.cardTitle}>
          {place.name}
        </Text>
        <View style={styles.cardChips}>
          <CategoryChip category={place.category} iconKey={place.categoryIcon} />
          <RatingChip rating={place.rating} />
        </View>
      </View>

      <CaretRightIcon size={16} weight="bold" color="#C7C7C7" />
    </PressableScale>
  );
});

function FilterButton({
  label,
  showIcon,
  actions,
  onSelect,
}: {
  label: string;
  showIcon?: boolean;
  actions: MenuAction[];
  onSelect: (id: string) => void;
}) {
  return (
    <MenuView
      actions={actions}
      style={styles.filterMenu}
      onPressAction={({ nativeEvent }) => onSelect(nativeEvent.event)}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`Filter by ${label.toLowerCase()}`}
        onTouchStart={Keyboard.dismiss}
        style={styles.filterButton}
      >
        {showIcon ? <ArrowsDownUpIcon size={16} weight="bold" color="#717171" /> : null}
        <Text style={styles.filterButtonLabel}>{label}</Text>
        <CaretDownIcon size={12} weight="fill" color="#717171" />
      </View>
    </MenuView>
  );
}

// -- Main -----------------------------------------------------------------

type DiscoverProps = {
  bottomInset?: number;
  onScroll?: (y: number) => void;
  verticalScrollEnabled?: boolean;
  active?: boolean;
};

function Discover({
  bottomInset = 0,
  onScroll,
  verticalScrollEnabled = true,
  active = true,
}: DiscoverProps) {
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<DiscoverSortMode>('distance');
  const [category, setCategory] = useState<DiscoverCategory>('all');
  const [trendingOnly, setTrendingOnly] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const onViewableItemsChanged = useRef(() => {}).current;

  useEffect(() => {
    if (active) return;
    searchInputRef.current?.blur();
    Keyboard.dismiss();
  }, [active]);

  const visiblePlaces = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return FAKE_PLACES
      .filter((place) => (
        (!normalizedQuery
          || place.name.toLocaleLowerCase().includes(normalizedQuery)
          || place.category.toLocaleLowerCase().includes(normalizedQuery))
        && (category === 'all' || place.category === category)
        && (!trendingOnly || place.trending)
      ))
      .sort((a, b) => (
        sortMode === 'distance'
          ? a.distanceKm - b.distanceKm
          : b.rating - a.rating
      ));
  }, [category, query, sortMode, trendingOnly]);

  const distanceActions = useMemo<MenuAction[]>(() => [
    { id: 'distance', title: 'Distance', state: sortMode === 'distance' ? 'on' : 'off' },
    { id: 'rating', title: 'Highest rated', state: sortMode === 'rating' ? 'on' : 'off' },
  ], [sortMode]);

  const categoryActions = useMemo<MenuAction[]>(() => [
    { id: 'all', title: 'All categories', state: category === 'all' ? 'on' : 'off' },
    { id: 'Parks', title: 'Parks', state: category === 'Parks' ? 'on' : 'off' },
    { id: 'Shopping', title: 'Shopping', state: category === 'Shopping' ? 'on' : 'off' },
    { id: 'Cafe', title: 'Cafe', state: category === 'Cafe' ? 'on' : 'off' },
  ], [category]);

  const trendingActions = useMemo<MenuAction[]>(() => [
    { id: 'all', title: 'All places', state: !trendingOnly ? 'on' : 'off' },
    { id: 'trending', title: 'Trending', state: trendingOnly ? 'on' : 'off' },
  ], [trendingOnly]);

  return (
    <View style={styles.root}>
      {/* Search bar */}
      <View style={styles.searchRow}>
        <Pressable
          accessibilityRole="search"
          onPress={() => {
            if (active) searchInputRef.current?.focus();
          }}
          style={styles.searchField}
        >
          <MagnifyingGlassIcon size={16} weight="bold" color="#717171" />
          {active ? (
            <TextInput
              ref={searchInputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Search places of interests..."
              placeholderTextColor="#8A8A8A"
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.searchInput}
            />
          ) : null}
        </Pressable>
      </View>

      {/* Filters + list */}
      <FlatList
        key="discover-places-list"
        data={visiblePlaces}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <DiscoverPlaceCard place={item} />}
        scrollEnabled={verticalScrollEnabled}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: bottomInset + 44 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => onScroll?.(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        onViewableItemsChanged={onViewableItemsChanged}
        ItemSeparatorComponent={() => <View style={styles.cardGap} />}
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No places match these filters.</Text>
          </View>
        )}
        ListHeaderComponent={
          <View style={styles.filtersRow}>
            <FilterButton
              label={sortMode === 'distance' ? 'Distance' : 'Rating'}
              showIcon
              actions={distanceActions}
              onSelect={(id) => {
                if (id === 'distance' || id === 'rating') setSortMode(id);
              }}
            />
            <FilterButton
              label={category === 'all' ? 'Category' : category}
              actions={categoryActions}
              onSelect={(id) => {
                if (id === 'all' || id === 'Parks' || id === 'Shopping' || id === 'Cafe') {
                  setCategory(id);
                }
              }}
            />
            <FilterButton
              label="Trending"
              actions={trendingActions}
              onSelect={(id) => setTrendingOnly(id === 'trending')}
            />
          </View>
        }
      />
    </View>
  );
}

export default memo(Discover);

// -- Styles ---------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },

  // Search
  searchRow: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  searchField: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 30,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(0,0,0,0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    height: 36,
    paddingHorizontal: 0,
    paddingVertical: 0,
    color: '#1A1A1A',
    fontSize: 14,
    fontWeight: '400',
  },
  // Filters
  filtersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 8,
  },
  filterMenu: {
    alignSelf: 'flex-start',
  },
  filterButton: {
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  filterButtonLabel: {
    color: '#717171',
    fontSize: 14,
    fontWeight: '600',
  },

  // List
  listContent: {
    paddingHorizontal: 16,
  },
  cardGap: {
    height: 8,
  },
  emptyState: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyStateText: {
    color: '#717171',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },

  // Card
  card: {
    paddingLeft: 8,
    paddingRight: 20,
    paddingVertical: 8,
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 0.5,
    borderColor: '#EBEBEB',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    boxShadow: '0 7px 7px rgba(0,0,0,0.03)',
  },
  cardThumbnail: {
    width: 72,
    height: 72,
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: 'rgba(60,60,67,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    color: '#1A1A1A',
  },
  cardChips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  // Chips
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingLeft: 6,
    paddingRight: 8,
    paddingVertical: 3,
    borderRadius: 100,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 18,
    color: '#717171',
  },
});
