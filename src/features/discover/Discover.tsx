import { MapPinCover } from '@/components/map-pin-cover/MapPinCover';
import { SaveAffordance } from '@/components/save-affordance/SaveAffordance';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { useHome } from '@/features/home/HomeContext';
import { MIN_QUERY_LENGTH } from '@/services/place/placeSearchService';
import { usePlaceSearch } from '@/services/place/usePlaceSearch';
import type { PlaceSaveOutcome } from '@/types/place';
import type { PlaceSuggestion } from '@/types/route';
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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

/** Hoisted so it keeps one identity — an inline separator would remount every
    row's neighbour on each render and defeat the cards' memo. */
function CardGap() {
  return <View style={styles.cardGap} />;
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

function formatDistance(metres: number | null | undefined): string | null {
  if (metres == null) return null;
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

type SuggestionCardProps = {
  suggestion: PlaceSuggestion;
  outcome: PlaceSaveOutcome | null;
  saving: boolean;
  onPress: (suggestion: PlaceSuggestion) => void;
};

/** Memoized for the same reason as the search panel's row: the list swaps its
    whole dataset on every settled keystroke. */
const SuggestionCard = memo(function SuggestionCard({
  suggestion,
  outcome,
  saving,
  onPress,
}: SuggestionCardProps) {
  const handlePress = useCallback(() => onPress(suggestion), [onPress, suggestion]);
  const distance = formatDistance(suggestion.distance_m);
  const address = suggestion.full_address || suggestion.place_formatted || '';

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={suggestion.name}
      onPress={handlePress}
      disabled={outcome !== null || saving}
      scaleTo={0.985}
      style={styles.card}
    >
      {/* A suggestion has no photo — one only exists once it is resolved. */}
      <View style={styles.cardThumbnail}>
        <MapPinCover pinSize={22} />
      </View>

      <View style={styles.cardContent}>
        <Text numberOfLines={1} style={styles.cardTitle}>
          {suggestion.name}
        </Text>
        {address ? (
          <Text numberOfLines={1} style={styles.cardSubtitle}>
            {address}
          </Text>
        ) : null}
        {suggestion.category || distance || outcome === 'duplicate' ? (
          <View style={styles.cardChips}>
            {suggestion.category ? (
              <View style={styles.chip}>
                <Text style={styles.chipLabel}>{suggestion.category}</Text>
              </View>
            ) : null}
            {distance ? <Text style={styles.cardMeta}>{distance}</Text> : null}
            {outcome === 'duplicate' ? (
              <Text style={styles.cardMeta}>Already in My Places</Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <SaveAffordance outcome={outcome} saving={saving} />
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
  /**
   * Not rendered today — the search row searches inline. Kept plumbed so the
   * row can be flipped back to a button that opens `SearchPanel` if the inline
   * path has to be backed out.
   */
  onSearchPress?: () => void;
};

function Discover({
  bottomInset = 0,
  onScroll,
  verticalScrollEnabled = true,
  active = true,
}: DiscoverProps) {
  const [sortMode, setSortMode] = useState<DiscoverSortMode>('distance');
  const [category, setCategory] = useState<DiscoverCategory>('all');
  const [trendingOnly, setTrendingOnly] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const onViewableItemsChanged = useRef(() => {}).current;

  const { userLocation, refreshSavedPlaces, savedPlaces } = useHome();
  const { query, setQuery, suggestions, status, savingId, outcomeFor, pick, reset } =
    usePlaceSearch({
      proximity: userLocation,
      onSaved: refreshSavedPlaces,
      savedPlaces,
    });

  // The sheet hides this pane rather than unmounting it, so leaving Discover is
  // the only moment that can end the typing session — and ending it is what
  // rotates the billed Mapbox session.
  useEffect(() => {
    if (active) return;
    searchInputRef.current?.blur();
    Keyboard.dismiss();
    reset();
  }, [active, reset]);

  // Any typed text is search intent, including the first character, which is
  // shorter than the backend accepts — the sample list would be a confusing
  // thing to leave on screen underneath it.
  const trimmedQuery = query.trim();
  const searchMode = trimmedQuery.length > 0;

  const visiblePlaces = useMemo(() => (
    FAKE_PLACES
      .filter((place) => (
        (category === 'all' || place.category === category)
        && (!trendingOnly || place.trending)
      ))
      .sort((a, b) => (
        sortMode === 'distance'
          ? a.distanceKm - b.distanceKm
          : b.rating - a.rating
      ))
  ), [category, sortMode, trendingOnly]);

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

  const renderSuggestion = useCallback(({ item }: { item: PlaceSuggestion }) => (
    <SuggestionCard
      suggestion={item}
      outcome={outcomeFor(item)}
      saving={savingId === item.external_id}
      onPress={pick}
    />
  ), [outcomeFor, pick, savingId]);

  const renderSample = useCallback(({ item }: { item: DiscoverPlace }) => (
    <DiscoverPlaceCard place={item} />
  ), []);

  const suggestionKey = useCallback((item: PlaceSuggestion) => item.external_id, []);
  const sampleKey = useCallback((item: DiscoverPlace) => item.id, []);

  const searchEmptyState = useMemo(() => {
    if (status === 'searching') return null;
    if (status === 'error') return 'Search is unavailable right now. Try again in a moment.';
    if (trimmedQuery.length < MIN_QUERY_LENGTH) return 'Keep typing to search for a place.';
    if (status === 'ready' && suggestions.length === 0) {
      return `No places found for "${trimmedQuery}".`;
    }
    return null;
  }, [status, trimmedQuery, suggestions.length]);

  const listProps = {
    scrollEnabled: verticalScrollEnabled,
    contentContainerStyle: [styles.listContent, { paddingBottom: bottomInset + 44 }],
    showsVerticalScrollIndicator: false,
    keyboardShouldPersistTaps: 'handled' as const,
    keyboardDismissMode: 'on-drag' as const,
    onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) =>
      onScroll?.(e.nativeEvent.contentOffset.y),
    scrollEventThrottle: 16,
    ItemSeparatorComponent: CardGap,
  };

  return (
    <View style={styles.root}>
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
              clearButtonMode="while-editing"
              style={styles.searchInput}
            />
          ) : null}
          {status === 'searching' ? <ActivityIndicator size="small" /> : null}
        </Pressable>
      </View>

      {/* Two lists rather than one branching list: the sample browse rows and
          the search suggestions carry different data, and the filter menus have
          nothing to sort or filter on a Mapbox result. */}
      {searchMode ? (
        <FlatList
          key="discover-search-results"
          data={suggestions}
          keyExtractor={suggestionKey}
          renderItem={renderSuggestion}
          {...listProps}
          ListEmptyComponent={searchEmptyState ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>{searchEmptyState}</Text>
            </View>
          ) : null}
          ListFooterComponent={suggestions.length > 0 ? (
            <View style={styles.attribution}>
              {/* Required wherever Mapbox search results are displayed. */}
              <Text style={styles.attributionText}>© Mapbox © OpenStreetMap</Text>
            </View>
          ) : null}
        />
      ) : (
        <FlatList
          key="discover-places-list"
          data={visiblePlaces}
          keyExtractor={sampleKey}
          renderItem={renderSample}
          {...listProps}
          onViewableItemsChanged={onViewableItemsChanged}
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
      )}
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
  attribution: {
    paddingTop: 12,
    paddingBottom: 4,
  },
  attributionText: {
    color: '#8A8A8A',
    fontSize: 12,
    lineHeight: 18,
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
  cardSubtitle: {
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    color: '#717171',
  },
  cardMeta: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 18,
    color: '#717171',
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
