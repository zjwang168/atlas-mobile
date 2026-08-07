import { MapPinCover } from '@/components/map-pin-cover/MapPinCover';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { useHome } from '@/features/home/HomeContext';
import { toPlaceDetail } from '@/services/place/placeService';
import { typography } from '@/theme/typography';
import type { PlaceDetail } from '@/types/place';
import { BookmarkSimpleIcon } from 'phosphor-react-native/src/icons/BookmarkSimple';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { NavigationArrowIcon } from 'phosphor-react-native/src/icons/NavigationArrow';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

const CARD_SIZE = 120;
const CARD_GAP = 12;
const SECTION_GAP = 16;
const MAX_SECTION_ITEMS = 12;

type Filter = 'all' | 'saved' | 'nearby';

type AllPlacesProps = {
  onPlacePress?: (place: PlaceDetail) => void;
  bottomInset?: number;
  /** Reports vertical scroll offset so the panel can gate its drag gesture. */
  onScroll?: (y: number) => void;
  verticalScrollEnabled?: boolean;
};

type FilterChipProps = {
  active: boolean;
  label: string;
  icon?: 'saved' | 'nearby';
  onPress: () => void;
};

function FilterChip({ active, label, icon, onPress }: FilterChipProps) {
  const Icon = icon === 'saved'
    ? BookmarkSimpleIcon
    : icon === 'nearby'
      ? NavigationArrowIcon
      : null;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Show ${label.toLowerCase()} places`}
      onPress={onPress}
      scaleTo={0.96}
      style={[
        styles.chip,
        active ? styles.chipActive : styles.chipInactive,
      ]}
    >
      {Icon ? (
        <Icon
          size={16}
          weight="fill"
          color={active ? '#12C170' : '#B0B0B0'}
        />
      ) : null}
      <Text
        style={[
          typography.bodySmallEmphasis,
          styles.chipLabel,
          { color: active ? '#0C8149' : '#717171' },
        ]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

type PlaceTileProps = {
  place: PlaceDetail;
  onPress: (place: PlaceDetail) => void;
};

const PlaceTile = memo(function PlaceTile({ place, onPress }: PlaceTileProps) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={place.name}
      onPress={() => onPress(place)}
      scaleTo={0.96}
      style={styles.tile}
    >
      <View style={styles.imageShadow}>
        <View style={styles.imageClip}>
          {place.thumbnailUrl ? (
            <Image
              source={{ uri: place.thumbnailUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
          ) : (
            <MapPinCover pinSize={28} />
          )}
          <View pointerEvents="none" style={styles.imageTint} />
        </View>
      </View>
      <View style={styles.tileLabelBox}>
        <Text
          numberOfLines={2}
          style={[typography.caption, styles.tileLabel]}
        >
          {place.name}
        </Text>
      </View>
    </PressableScale>
  );
});

type PlacesSectionProps = {
  title: string;
  places: PlaceDetail[];
  totalCount: number;
  emptyMessage: string;
  onHeaderPress: () => void;
  onPlacePress: (place: PlaceDetail) => void;
};

function PlacesSection({
  title,
  places,
  totalCount,
  emptyMessage,
  onHeaderPress,
  onPlacePress,
}: PlacesSectionProps) {
  return (
    <View style={styles.section}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`View all ${title.toLowerCase()}`}
        onPress={onHeaderPress}
        scaleTo={0.985}
        style={styles.sectionHeader}
      >
        <View style={styles.sectionTitleGroup}>
          <Text style={[typography.h3, styles.sectionTitle]}>{title}</Text>
          <CaretRightIcon size={16} weight="bold" color="#8A8A8A" />
        </View>
        <Text style={[typography.bodySmall, styles.sectionCount]}>
          {totalCount} {totalCount === 1 ? 'Place' : 'Places'}
        </Text>
      </PressableScale>

      {places.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tilesRow}
          decelerationRate="fast"
        >
          {places.map((place) => (
            <PlaceTile key={place.id} place={place} onPress={onPlacePress} />
          ))}
        </ScrollView>
      ) : (
        <View style={styles.emptyState}>
          <Text style={[typography.bodySmall, styles.emptyText]}>
            {emptyMessage}
          </Text>
        </View>
      )}
    </View>
  );
}

function distanceSquared(
  place: PlaceDetail,
  location: [number, number],
): number {
  const latitudeDelta = place.latitude - location[1];
  const longitudeDelta = (place.longitude - location[0])
    * Math.cos((location[1] * Math.PI) / 180);
  return latitudeDelta * latitudeDelta + longitudeDelta * longitudeDelta;
}

function AllPlaces({
  onPlacePress,
  bottomInset = 0,
  onScroll,
  verticalScrollEnabled = true,
}: AllPlacesProps) {
  const [activeFilter, setActiveFilter] = useState<Filter>('all');
  const {
    overlay,
    savedPlaces,
    setOverlay,
    userLocation,
  } = useHome();

  const detailedPlaces = useMemo(
    () => savedPlaces.map(toPlaceDetail),
    [savedPlaces],
  );

  // Front-end-only nearby ordering for now. This keeps the new interaction
  // useful without introducing a new discovery endpoint. When live nearby
  // results are available, only this data source needs to change.
  const nearbyPlaces = useMemo(
    () => [...detailedPlaces]
      .sort((a, b) => distanceSquared(a, userLocation) - distanceSquared(b, userLocation))
      .slice(0, MAX_SECTION_ITEMS),
    [detailedPlaces, userLocation],
  );

  const savedPreview = useMemo(
    () => detailedPlaces.slice(0, MAX_SECTION_ITEMS),
    [detailedPlaces],
  );

  const handlePlacePress = useCallback((place: PlaceDetail) => {
    onPlacePress?.(place);
    setOverlay({ kind: 'placeDetail', placeId: place.id, returnTo: overlay });
  }, [onPlacePress, overlay, setOverlay]);

  const showSaved = activeFilter === 'all' || activeFilter === 'saved';
  const showNearby = activeFilter === 'all' || activeFilter === 'nearby';

  return (
    <View style={styles.root}>
      <View style={styles.filtersViewport}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersRow}
        >
          <FilterChip
            active={activeFilter === 'all'}
            label="All"
            onPress={() => setActiveFilter('all')}
          />
          <FilterChip
            active={activeFilter === 'saved'}
            label="Saved"
            icon="saved"
            onPress={() => setActiveFilter('saved')}
          />
          <FilterChip
            active={activeFilter === 'nearby'}
            label="Nearby"
            icon="nearby"
            onPress={() => setActiveFilter('nearby')}
          />
        </ScrollView>
      </View>

      <ScrollView
        style={styles.contentScroll}
        scrollEnabled={verticalScrollEnabled}
        contentContainerStyle={[
          styles.contentContainer,
          { paddingBottom: bottomInset + 44 },
        ]}
        showsVerticalScrollIndicator={false}
        onScroll={(event) => onScroll?.(event.nativeEvent.contentOffset.y)}
      >
        {showSaved ? (
          <PlacesSection
            title="Saved Places"
            places={savedPreview}
            totalCount={detailedPlaces.length}
            emptyMessage="Your saved places will appear here."
            onHeaderPress={() => setActiveFilter('saved')}
            onPlacePress={handlePlacePress}
          />
        ) : null}
        {showNearby ? (
          <PlacesSection
            title="Nearby"
            places={nearbyPlaces}
            totalCount={nearbyPlaces.length}
            emptyMessage="Nearby places will appear here once you save a place."
            onHeaderPress={() => setActiveFilter('nearby')}
            onPlacePress={handlePlacePress}
          />
        ) : null}
      </ScrollView>

    </View>
  );
}

export default memo(AllPlaces);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    position: 'relative',
  },
  filtersViewport: {
    paddingTop: 4,
    paddingBottom: 16,
  },
  filtersRow: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    height: 36,
    borderRadius: 30,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  chipActive: {
    backgroundColor: '#E9FBF1',
    borderWidth: 1.5,
    borderColor: '#12C170',
  },
  chipInactive: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  chipLabel: {
    letterSpacing: -0.14,
  },
  contentScroll: {
    flex: 1,
  },
  contentContainer: {
    gap: SECTION_GAP,
  },
  section: {
    gap: 8,
  },
  sectionHeader: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  sectionTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    color: '#1A1A1A',
    letterSpacing: -0.34,
  },
  sectionCount: {
    color: '#717171',
    letterSpacing: -0.14,
    fontVariant: ['tabular-nums'],
  },
  tilesRow: {
    gap: CARD_GAP,
    paddingHorizontal: 16,
    paddingBottom: 1,
  },
  tile: {
    width: CARD_SIZE,
    gap: 6,
  },
  imageShadow: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    borderRadius: 24,
    borderCurve: 'continuous',
    boxShadow: '0 9px 9px rgba(0,0,0,0.09), 0 2px 5px rgba(0,0,0,0.11)',
  },
  imageClip: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    borderRadius: 24,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: '#E5E5EA',
  },
  imageTint: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  tileLabelBox: {
    width: CARD_SIZE,
    height: 36,
    paddingHorizontal: 4,
    justifyContent: 'flex-start',
  },
  tileLabel: {
    color: '#1A1A1A',
    fontWeight: '500',
    letterSpacing: -0.13,
  },
  emptyState: {
    minHeight: 120,
    borderRadius: 24,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(60,60,67,0.08)',
    backgroundColor: 'rgba(248,248,248,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 16,
    paddingHorizontal: 24,
  },
  emptyText: {
    color: '#717171',
    textAlign: 'center',
  },
});
