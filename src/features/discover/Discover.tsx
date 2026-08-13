import type { SnapState } from '@/components/content-panel/ContentPanel';
import { PlaceCover } from '@/components/place-cover/PlaceCover';
import { SaveAffordance } from '@/components/save-affordance/SaveAffordance';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { useHomeLocation, useHomeOverlay, useHomePlaces } from '@/features/home/HomeContext';
import { MIN_QUERY_LENGTH } from '@/services/place/placeSearchService';
import { usePlaceSearch } from '@/services/place/usePlaceSearch';
import type { EventCategory, LocalEvent } from '@/types/event';
import type { PlaceSaveOutcome } from '@/types/place';
import type { PlaceSuggestion } from '@/types/route';
import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import { ArrowsDownUpIcon } from 'phosphor-react-native/src/icons/ArrowsDownUp';
import { CaretDownIcon } from 'phosphor-react-native/src/icons/CaretDown';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {
  EventCard,
  FEATURED_CARD_WIDTH,
  FeaturedEventCard,
} from './EventCard';
import { useLocalEvents, type EventTimeframe } from './useLocalEvents';

type DiscoverCategoryFilter = 'all' | EventCategory;

/** Filter-button labels. The menu spells each option out in full; the button
    shows the current one, so both maps are the short form. */
const CATEGORY_LABELS: Record<DiscoverCategoryFilter, string> = {
  all: 'Category',
  festival: 'Festivals',
  market: 'Markets',
  music: 'Music',
  arts: 'Arts',
  outdoors: 'Outdoors',
  history: 'History',
  community: 'Community',
};

const TIMEFRAME_LABELS: Record<EventTimeframe, string> = {
  weekend: 'This weekend',
  week: 'Next 7 days',
  month: 'Next 30 days',
};

// -- Components -----------------------------------------------------------

/** Hoisted so it keeps one identity — an inline separator would remount every
    row's neighbour on each render and defeat the cards' memo. */
function CardGap() {
  return <View style={styles.cardGap} />;
}

/** Module scope for the same reason the separators are: one identity for the
    whole app rather than one per mounted pane. */
function suggestionKeyExtractor(item: PlaceSuggestion): string {
  return item.external_id;
}

function eventKeyExtractor(item: LocalEvent): string {
  return item.id;
}

/** Same reason as CardGap, for the horizontal featured strip. The width is
    shared with the strip's snap interval, so a card always lands flush. */
const FEATURED_GAP = 10;

function FeaturedGap() {
  return <View style={styles.featuredGap} />;
}

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
        <PlaceCover category={suggestion.category} iconSize={22} />
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
  snapTo?: (state: SnapState, animated?: boolean) => void;
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
  snapTo,
}: DiscoverProps) {
  const searchInputRef = useRef<TextInput>(null);
  const onViewableItemsChanged = useRef(() => {}).current;

  // Two narrow hooks rather than useHome(): this pane reads only location and
  // places, and its subtree — an image-carrying featured strip over a long
  // event list — is expensive enough that re-rendering it when chat history
  // syncs is worth avoiding. See HOME.md on the domain split.
  const { userLocation } = useHomeLocation();
  const { overlay, setOverlay } = useHomeOverlay();
  const { refreshSavedPlaces, savedPlaces } = useHomePlaces();
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

  // Results are unusable at the shorter detents — a third of the screen, and
  // the hosts disable this list's scrolling below `tall`. Focusing the field is
  // the moment the user commits to searching, so take the height then.
  const handleSearchFocus = useCallback(() => snapTo?.('tall'), [snapTo]);

  const {
    status: eventsStatus,
    events,
    featured,
    outOfCoverage,
    degradedSources,
    timeframe,
    setTimeframe,
    category,
    setCategory,
    sortMode,
    setSortMode,
    reload: reloadEvents,
  } = useLocalEvents({ coordinate: userLocation, active });

  const sortActions = useMemo<MenuAction[]>(() => [
    { id: 'distance', title: 'Nearest', state: sortMode === 'distance' ? 'on' : 'off' },
    { id: 'soonest', title: 'Soonest', state: sortMode === 'soonest' ? 'on' : 'off' },
  ], [sortMode]);

  const categoryActions = useMemo<MenuAction[]>(() => [
    { id: 'all', title: 'All categories', state: category === 'all' ? 'on' : 'off' },
    { id: 'festival', title: 'Festivals', state: category === 'festival' ? 'on' : 'off' },
    { id: 'market', title: 'Markets', state: category === 'market' ? 'on' : 'off' },
    { id: 'music', title: 'Music', state: category === 'music' ? 'on' : 'off' },
    { id: 'arts', title: 'Arts', state: category === 'arts' ? 'on' : 'off' },
    { id: 'outdoors', title: 'Outdoors', state: category === 'outdoors' ? 'on' : 'off' },
    { id: 'history', title: 'History', state: category === 'history' ? 'on' : 'off' },
    { id: 'community', title: 'Community', state: category === 'community' ? 'on' : 'off' },
  ], [category]);

  const timeframeActions = useMemo<MenuAction[]>(() => [
    { id: 'weekend', title: 'This weekend', state: timeframe === 'weekend' ? 'on' : 'off' },
    { id: 'week', title: 'Next 7 days', state: timeframe === 'week' ? 'on' : 'off' },
    { id: 'month', title: 'Next 30 days', state: timeframe === 'month' ? 'on' : 'off' },
  ], [timeframe]);

  const renderSuggestion = useCallback(({ item }: { item: PlaceSuggestion }) => (
    <SuggestionCard
      suggestion={item}
      outcome={outcomeFor(item)}
      saving={savingId === item.external_id}
      onPress={pick}
    />
  ), [outcomeFor, pick, savingId]);

  /** Opens the event's own panel. `returnTo` is this pane's current overlay so
      dismissing the detail comes back to Discover rather than the home screen. */
  const openEvent = useCallback((event: LocalEvent) => {
    setOverlay({ kind: 'eventDetail', event, returnTo: overlay });
  }, [setOverlay, overlay]);

  const renderEvent = useCallback(({ item }: { item: LocalEvent }) => (
    <EventCard event={item} onPress={openEvent} />
  ), [openEvent]);

  const renderFeatured = useCallback(({ item }: { item: LocalEvent }) => (
    <FeaturedEventCard event={item} onPress={openEvent} />
  ), [openEvent]);


  const eventsEmptyState = useMemo(() => {
    if (eventsStatus === 'loading' || eventsStatus === 'idle') return null;
    if (eventsStatus === 'error') {
      return 'Could not load events right now. Pull to try again.';
    }
    if (outOfCoverage) {
      return 'Local events cover the DC, Maryland, and Virginia area for now — nothing to show at your location yet.';
    }
    if (category !== 'all') return 'No events in this category. Try another one.';
    return 'No events found nearby in this timeframe.';
  }, [eventsStatus, outOfCoverage, category]);

  const searchEmptyState = useMemo(() => {
    if (status === 'searching') return null;
    if (status === 'error') return 'Search is unavailable right now. Try again in a moment.';
    if (trimmedQuery.length < MIN_QUERY_LENGTH) return 'Keep typing to search for a place.';
    if (status === 'ready' && suggestions.length === 0) {
      return `No places found for "${trimmedQuery}".`;
    }
    return null;
  }, [status, trimmedQuery, suggestions.length]);

  /** Memoized because it hosts the featured strip: an image-carrying
      horizontal list has no business re-rendering every time this pane does. */
  const eventsHeader = useMemo(() => (
    <View>
      {/* The strip only earns its height when there is something in it, and it
          is hidden under a category filter because a filtered list is a
          deliberate search, not a browse. */}
      {featured.length > 0 && category === 'all' ? (
        <View style={styles.featuredSection}>
          <Text style={styles.sectionTitle}>Worth a trip</Text>
          <FlatList
            horizontal
            data={featured}
            keyExtractor={eventKeyExtractor}
            renderItem={renderFeatured}
            showsHorizontalScrollIndicator={false}
            ItemSeparatorComponent={FeaturedGap}
            // The strip sits inside the vertical list's header, so it must not
            // try to own the vertical gesture.
            nestedScrollEnabled
            snapToInterval={FEATURED_CARD_WIDTH + FEATURED_GAP}
            decelerationRate="fast"
            contentContainerStyle={styles.featuredContent}
          />
        </View>
      ) : null}

      {degradedSources.length > 0 ? (
        <Text style={styles.degradedNote}>
          Some event sources are unavailable — this list may be incomplete.
        </Text>
      ) : null}

      <View style={styles.filtersRow}>
        <FilterButton
          label={sortMode === 'distance' ? 'Nearest' : 'Soonest'}
          showIcon
          actions={sortActions}
          onSelect={(id) => {
            if (id === 'distance' || id === 'soonest') setSortMode(id);
          }}
        />
        <FilterButton
          label={CATEGORY_LABELS[category]}
          actions={categoryActions}
          onSelect={(id) => setCategory(id as DiscoverCategoryFilter)}
        />
        <FilterButton
          label={TIMEFRAME_LABELS[timeframe]}
          actions={timeframeActions}
          onSelect={(id) => setTimeframe(id as EventTimeframe)}
        />
      </View>

      {eventsStatus === 'loading' && events.length === 0 ? (
        <View style={styles.listLoading}>
          <ActivityIndicator size="small" />
        </View>
      ) : null}
    </View>
  ), [
    featured, category, renderFeatured, degradedSources.length,
    sortMode, sortActions, setSortMode, categoryActions, setCategory,
    timeframe, timeframeActions, setTimeframe, eventsStatus, events.length,
  ]);

  const listProps = {
    // The default window is 21 screens, so a 200-row list keeps roughly 170
    // rows mounted — and every event now carries a photo, so that is 170 live
    // image decodes. Five screens is still two above and two below the
    // viewport, which is ample for a flick.
    windowSize: 5,
    maxToRenderPerBatch: 6,
    initialNumToRender: 8,
    updateCellsBatchingPeriod: 50,
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
              onFocus={handleSearchFocus}
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
          keyExtractor={suggestionKeyExtractor}
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
          key="discover-events-list"
          data={events}
          keyExtractor={eventKeyExtractor}
          renderItem={renderEvent}
          {...listProps}
          onViewableItemsChanged={onViewableItemsChanged}
          onRefresh={reloadEvents}
          refreshing={eventsStatus === 'loading' && events.length > 0}
          ListEmptyComponent={eventsEmptyState ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>{eventsEmptyState}</Text>
            </View>
          ) : null}
          ListFooterComponent={events.length > 0 ? (
            <View style={styles.attribution}>
              <Text style={styles.attributionText}>
                Farmers markets © USDA · Park events © NPS · © OpenStreetMap
              </Text>
            </View>
          ) : null}
          ListHeaderComponent={eventsHeader}
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

  // Featured strip
  featuredSection: {
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
    color: '#1A1A1A',
    paddingBottom: 10,
  },
  featuredContent: {
    // Cancels the list's own horizontal padding so the strip can bleed to the
    // screen edge and the last card is not clipped by it.
    paddingRight: 16,
  },
  featuredGap: {
    width: FEATURED_GAP,
  },
  degradedNote: {
    fontSize: 12,
    lineHeight: 18,
    color: '#8A8A8A',
    paddingBottom: 8,
  },
  listLoading: {
    paddingVertical: 32,
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
