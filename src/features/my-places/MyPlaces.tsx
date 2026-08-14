import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import type { Place, PlaceDetail } from '@/types/place';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { ListDashesIcon } from 'phosphor-react-native/src/icons/ListDashes';
import { MapPinIcon } from 'phosphor-react-native/src/icons/MapPin';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import AllPlaces, {
  type CollectionFilter,
} from './all-places/AllPlaces';

export type PlacesView = CollectionFilter;

type MyPlacesProps = {
  onPlacePress?: (place: Place) => void;
  onScroll?: (y: number) => void;
  bottomInset?: number;
  activeView?: PlacesView;
  verticalScrollEnabled?: boolean;
  active?: boolean;
  /** Renders a condensed label only — used when the panel is compact. */
  compact?: boolean;
  onDeleteInitiated?: (place: PlaceDetail) => void;
};

// Filter-row chips. RN clamps borderRadius to half the height, so at CHIP_HEIGHT
// these render as pills either way — CHIP_RADIUS records the design's intent.
const CHIP_HEIGHT = 38;
const CHIP_RADIUS = 20;
// The expanded search bar only exists while the field has focus, so it is
// always in the taller of the two states Discover animates between.
const SEARCH_FOCUSED_HEIGHT = 44;

const FILTERS: Array<{
  value: PlacesView;
  label: string;
  icon?: typeof MapPinIcon;
}> = [
  { value: 'all', label: 'All' },
  { value: 'places', label: 'Places', icon: MapPinIcon },
  // Keep the persisted `atlas` value for API compatibility; this saved-place
  // collection is now presented to users as a List.
  { value: 'atlas', label: 'Atlas', icon: ListDashesIcon },
];

function MyPlaces({
  onPlacePress,
  onScroll,
  bottomInset = 0,
  activeView = 'all',
  verticalScrollEnabled = true,
  active = true,
  compact = false,
  onDeleteInitiated,
}: MyPlacesProps) {
  const [selectedView, setSelectedView] = useState<PlacesView>(activeView);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<TextInput>(null);

  const releaseSearchFocus = useCallback(() => {
    searchInputRef.current?.blur();
    const focusedInput = TextInput.State.currentlyFocusedInput();
    if (focusedInput) TextInput.State.blurTextInput(focusedInput);
    Keyboard.dismiss();
  }, []);

  useEffect(() => {
    setSelectedView(activeView);
  }, [activeView]);

  useEffect(() => {
    if (!searchExpanded || !active) return;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [active, searchExpanded]);

  useEffect(() => {
    if (active) return;
    releaseSearchFocus();
  }, [active, releaseSearchFocus]);

  if (compact) {
    return (
      <View style={styles.compact}>
        <Text style={styles.compactLabel}>
          {selectedView === 'atlas' ? 'Atlas' : 'Places'}
        </Text>
      </View>
    );
  }

  const handleFilterChange = (nextFilter: PlacesView) => {
    Keyboard.dismiss();
    setSelectedView(nextFilter);
  };

  return (
    <View style={styles.root}>
      {searchExpanded ? (
        <View style={styles.searchRow}>
          <Pressable
            accessibilityRole="search"
            onPress={() => searchInputRef.current?.focus()}
            style={styles.searchField}
          >
            <MagnifyingGlassIcon size={20} weight="bold" color="#717171" />
            <TextInput
              ref={searchInputRef}
              autoFocus
              editable={active}
              showSoftInputOnFocus={active}
              value={query}
              onChangeText={setQuery}
              placeholder="Search places of interests..."
              placeholderTextColor="#717171"
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.searchInput}
            />
          </Pressable>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Close search"
            onPress={() => {
              releaseSearchFocus();
              setQuery('');
              setSearchExpanded(false);
            }}
            scaleTo={0.9}
            style={styles.closeButton}
          >
            <XIcon size={16} weight="bold" color="#717171" />
          </PressableScale>
        </View>
      ) : (
        <View style={styles.filterRow}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Search saved places and lists"
            onPress={() => setSearchExpanded(true)}
            scaleTo={0.94}
            style={styles.searchButton}
          >
            <MagnifyingGlassIcon size={20} weight="bold" color="#717171" />
          </PressableScale>

          {FILTERS.map(({ value, label, icon: Icon }) => {
            const active = selectedView === value;
            return (
              <PressableScale
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Show ${label.toLowerCase()}`}
                onPress={() => handleFilterChange(value)}
                scaleTo={0.96}
                style={[
                  styles.filterChip,
                  value === 'all' && styles.allFilterChip,
                  active && styles.filterChipActive,
                ]}
              >
                {Icon ? (
                  <Icon
                    size={16}
                    weight="fill"
                    color={active ? '#FFFFFF' : '#A7A7A7'}
                  />
                ) : null}
                <Text
                  style={[
                    typography.bodySmallEmphasis,
                    styles.filterLabel,
                    active && styles.filterLabelActive,
                  ]}
                >
                  {label}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      )}

      <AllPlaces
        onScroll={onScroll}
        onPlacePress={onPlacePress}
        bottomInset={bottomInset}
        verticalScrollEnabled={verticalScrollEnabled}
        filter={selectedView}
        query={query}
        onFilterChange={setSelectedView}
        onDeleteInitiated={onDeleteInitiated}
      />
    </View>
  );
}

export default memo(MyPlaces);

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  compact: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  compactLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: '#09090B',
  },
  // No fixed height — the row is sized by CHIP_HEIGHT so the gap below stays
  // constant whatever the chips do.
  filterRow: {
    paddingTop: 4,
    paddingBottom: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchButton: {
    width: 52,
    height: CHIP_HEIGHT,
    borderRadius: CHIP_RADIUS,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChip: {
    height: CHIP_HEIGHT,
    borderRadius: CHIP_RADIUS,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  allFilterChip: {
    paddingHorizontal: 16,
  },
  filterChipActive: {
    backgroundColor: '#12C170',
  },
  filterLabel: {
    color: '#717171',
  },
  filterLabelActive: {
    color: '#FFFFFF',
  },
  // Swaps in place for filterRow — keep the vertical rhythm identical so
  // toggling search doesn't shift the list below.
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 16,
    marginHorizontal: 16,
    gap: 8,
  },
  // Matches Discover's search field — the two are the same control in two modes.
  searchField: {
    flex: 1,
    height: SEARCH_FOCUSED_HEIGHT,
    paddingHorizontal: 16,
    borderRadius: CHIP_RADIUS,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(0,0,0,0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  closeButton: {
    width: SEARCH_FOCUSED_HEIGHT,
    height: SEARCH_FOCUSED_HEIGHT,
    borderRadius: SEARCH_FOCUSED_HEIGHT / 2,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Takes size/weight from bodySmallMedium but deliberately drops its
  // lineHeight: on iOS a lineHeight on TextInput breaks vertical centring.
  searchInput: {
    flex: 1,
    height: SEARCH_FOCUSED_HEIGHT,
    paddingHorizontal: 0,
    paddingVertical: 0,
    color: '#1A1A1A',
    fontSize: typography.body.fontSize,
    fontWeight: typography.body.fontWeight,
  },
});
