import { PlaceCover } from '@/components/place-cover/PlaceCover';
import { PlaceTagChip } from '@/components/place-tag-chip/PlaceTagChip';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { useHome } from '@/features/home/HomeContext';
import { queueAtlasPlacePhotoBackfill } from '@/services/atlas/atlasPlacesService';
import { toPlaceDetail } from '@/services/place/placeService';
import { typography } from '@/theme/typography';
import type { PlaceDetail } from '@/types/place';
import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowsDownUpIcon } from 'phosphor-react-native/src/icons/ArrowsDownUp';
import { CaretDownIcon } from 'phosphor-react-native/src/icons/CaretDown';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { CoffeeBeanIcon } from 'phosphor-react-native/src/icons/CoffeeBean';
import { ForkKnifeIcon } from 'phosphor-react-native/src/icons/ForkKnife';
import { ListDashesIcon } from 'phosphor-react-native/src/icons/ListDashes';
import { MapPinIcon } from 'phosphor-react-native/src/icons/MapPin';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';

// gray-200 in THEME.md's palette. Shared by every rule in this file so the
// home sheet and the full-list pages can't drift apart again.
const DIVIDER_COLOR = '#E0E0E0';
// Matches the filter chips in MyPlaces so both rows sit on the same pill height.
const CHIP_HEIGHT = 38;
const CARD_SIZE = 160;
const CARD_GAP = 12;
const SECTION_GAP = 16;
const MAX_SECTION_ITEMS = 12;
const LIST_THUMBNAIL_SIZE = 68;
const EARTH_RADIUS_KM = 6371;
const US_STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC',
};

export type CollectionFilter = 'all' | 'places' | 'atlas';
type PlacesSortMode = 'distance' | 'date';
type AtlasSortMode = 'recent' | 'alphabetical' | 'places';

type SortMode = 'recent' | 'location';

type AllPlacesProps = {
  onPlacePress?: (place: PlaceDetail) => void;
  bottomInset?: number;
  /** Reports vertical scroll offset so the panel can gate its drag gesture. */
  onScroll?: (y: number) => void;
  verticalScrollEnabled?: boolean;
  filter?: CollectionFilter;
  query?: string;
  onFilterChange?: (filter: CollectionFilter) => void;
  onDeleteInitiated?: (place: PlaceDetail) => void;
};

type PlaceTileProps = {
  place: PlaceDetail;
  onPress: (place: PlaceDetail) => void;
};

type DistancePlaceItem = {
  place: PlaceDetail;
  distanceKm: number;
  locationLabel: string;
  locationCount: number;
  dateLabel: string;
};

type VisibleLocation = Pick<
  DistancePlaceItem,
  'locationLabel' | 'locationCount' | 'dateLabel'
>;

type CountryIndexItem = {
  name: string;
  flag: string;
  count: number;
  firstPlaceIndex: number;
  cities: CityIndexItem[];
};

type CityIndexItem = {
  name: string;
  count: number;
  firstPlaceIndex: number;
};

type CountryIndexRow =
  | { kind: 'country'; item: CountryIndexItem }
  | { kind: 'city'; item: CityIndexItem; countryName: string };

const COUNTRY_FLAGS: Record<string, string> = Object.fromEntries(
  'Afghanistan:AF|Albania:AL|Algeria:DZ|Andorra:AD|Angola:AO|Antigua and Barbuda:AG|Argentina:AR|Armenia:AM|Australia:AU|Austria:AT|Azerbaijan:AZ|Bahamas:BS|Bahrain:BH|Bangladesh:BD|Barbados:BB|Belarus:BY|Belgium:BE|Belize:BZ|Benin:BJ|Bhutan:BT|Bolivia:BO|Bosnia and Herzegovina:BA|Botswana:BW|Brazil:BR|Brunei:BN|Bulgaria:BG|Burkina Faso:BF|Burundi:BI|Cambodia:KH|Cameroon:CM|Canada:CA|Cape Verde:CV|Central African Republic:CF|Chad:TD|Chile:CL|China:CN|Colombia:CO|Comoros:KM|Congo:CG|Costa Rica:CR|Croatia:HR|Cuba:CU|Cyprus:CY|Czechia:CZ|Denmark:DK|Djibouti:DJ|Dominica:DM|Dominican Republic:DO|Ecuador:EC|Egypt:EG|El Salvador:SV|Equatorial Guinea:GQ|Eritrea:ER|Estonia:EE|Eswatini:SZ|Ethiopia:ET|Fiji:FJ|Finland:FI|France:FR|Gabon:GA|Gambia:GM|Georgia:GE|Germany:DE|Ghana:GH|Greece:GR|Grenada:GD|Guatemala:GT|Guinea:GN|Guinea-Bissau:GW|Guyana:GY|Haiti:HT|Honduras:HN|Hong Kong:HK|Hungary:HU|Iceland:IS|India:IN|Indonesia:ID|Iran:IR|Iraq:IQ|Ireland:IE|Israel:IL|Italy:IT|Ivory Coast:CI|Jamaica:JM|Japan:JP|Jordan:JO|Kazakhstan:KZ|Kenya:KE|Kiribati:KI|Kosovo:XK|Kuwait:KW|Kyrgyzstan:KG|Laos:LA|Latvia:LV|Lebanon:LB|Lesotho:LS|Liberia:LR|Libya:LY|Liechtenstein:LI|Lithuania:LT|Luxembourg:LU|Madagascar:MG|Malawi:MW|Malaysia:MY|Maldives:MV|Mali:ML|Malta:MT|Marshall Islands:MH|Mauritania:MR|Mauritius:MU|Mexico:MX|Micronesia:FM|Moldova:MD|Monaco:MC|Mongolia:MN|Montenegro:ME|Morocco:MA|Mozambique:MZ|Myanmar:MM|Namibia:NA|Nauru:NR|Nepal:NP|Netherlands:NL|New Zealand:NZ|Nicaragua:NI|Niger:NE|Nigeria:NG|North Korea:KP|North Macedonia:MK|Norway:NO|Oman:OM|Pakistan:PK|Palau:PW|Palestine:PS|Panama:PA|Papua New Guinea:PG|Paraguay:PY|Peru:PE|Philippines:PH|Poland:PL|Portugal:PT|Qatar:QA|Romania:RO|Russia:RU|Rwanda:RW|Saint Kitts and Nevis:KN|Saint Lucia:LC|Saint Vincent and the Grenadines:VC|Samoa:WS|San Marino:SM|Sao Tome and Principe:ST|Saudi Arabia:SA|Senegal:SN|Serbia:RS|Seychelles:SC|Sierra Leone:SL|Singapore:SG|Slovakia:SK|Slovenia:SI|Solomon Islands:SB|Somalia:SO|South Africa:ZA|South Korea:KR|South Sudan:SS|Spain:ES|Sri Lanka:LK|Sudan:SD|Suriname:SR|Sweden:SE|Switzerland:CH|Syria:SY|Taiwan:TW|Tajikistan:TJ|Tanzania:TZ|Thailand:TH|Timor-Leste:TL|Togo:TG|Tonga:TO|Trinidad and Tobago:TT|Tunisia:TN|Turkey:TR|Turkmenistan:TM|Tuvalu:TV|Uganda:UG|Ukraine:UA|United Arab Emirates:AE|United Kingdom:GB|United States:US|Uruguay:UY|Uzbekistan:UZ|Vanuatu:VU|Vatican City:VA|Venezuela:VE|Vietnam:VN|Yemen:YE|Zambia:ZM|Zimbabwe:ZW'
    .split('|')
    .map((entry) => {
      const [name, code] = entry.split(':');
      return [name.toLocaleLowerCase().replace(/[^a-z]/g, '_'), code];
    }),
);

function countryFlag(country: string): string {
  const key = country
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const code = COUNTRY_FLAGS[key]
    ?? COUNTRY_FLAGS[key.replace('republic_of_', '')]
    ?? ({
      czech_republic: 'CZ',
      korea_south: 'KR',
      korea_republic_of: 'KR',
      taiwan_province_of_china: 'TW',
      united_states_of_america: 'US',
      uk: 'GB',
    } as Record<string, string>)[key];
  if (!code) return '';
  return String.fromCodePoint(...code.split('').map((letter) => 0x1F1A5 + letter.charCodeAt(0)));
}

function placeListKeyExtractor(item: DistancePlaceItem): string {
  return item.place.id;
}

function atlasListKeyExtractor(atlas: { id: string }): string {
  return atlas.id;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineDistanceKm(
  origin: [number, number],
  place: Pick<PlaceDetail, 'latitude' | 'longitude'>,
): number {
  const [originLongitude, originLatitude] = origin;
  const latitudeDelta = toRadians(place.latitude - originLatitude);
  const longitudeDelta = toRadians(place.longitude - originLongitude);
  const originLatitudeRadians = toRadians(originLatitude);
  const placeLatitudeRadians = toRadians(place.latitude);
  const haversine = (
    Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(originLatitudeRadians)
      * Math.cos(placeLatitudeRadians)
      * Math.sin(longitudeDelta / 2) ** 2
  );

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversine));
}

function abbreviateUsState(value: string): string {
  return value
    .split(',')
    .map((part) => {
      const trimmedPart = part.trim();
      return US_STATE_ABBREVIATIONS[trimmedPart.toLocaleLowerCase()] ?? trimmedPart;
    })
    .join(', ');
}

function getPlaceLocationLabel(place: PlaceDetail): string {
  const cityAndRegion = [place.city, place.region ? abbreviateUsState(place.region) : undefined]
    .filter((value, index, values): value is string => (
      Boolean(value) && values.indexOf(value) === index
    ));

  if (cityAndRegion.length > 0) return cityAndRegion.join(', ');
  if (place.address?.trim()) return abbreviateUsState(place.address);
  return place.country?.trim() || 'Saved places';
}

function formatDateAdded(value?: string): string {
  const date = new Date(value ?? '');
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function sortPlacesByDistance(
  places: PlaceDetail[],
  userLocation: [number, number],
): DistancePlaceItem[] {
  const groups = new Map<string, Array<{ place: PlaceDetail; distanceKm: number }>>();

  places.forEach((place) => {
    const locationLabel = getPlaceLocationLabel(place);
    const group = groups.get(locationLabel) ?? [];
    group.push({
      place,
      distanceKm: haversineDistanceKm(userLocation, place),
    });
    groups.set(locationLabel, group);
  });

  return Array.from(groups.entries())
    .map(([locationLabel, items]) => ({
      locationLabel,
      items: [...items].sort((a, b) => a.distanceKm - b.distanceKm),
      nearestDistanceKm: Math.min(...items.map((item) => item.distanceKm)),
    }))
    .sort((a, b) => a.nearestDistanceKm - b.nearestDistanceKm)
    .flatMap(({ locationLabel, items }) => items.map((item) => ({
      ...item,
      locationLabel,
      locationCount: items.length,
      dateLabel: '',
    })));
}

function sortPlacesByDate(
  places: PlaceDetail[],
  createdAtByPlaceId: Map<string, string>,
  userLocation: [number, number],
): DistancePlaceItem[] {
  const locationCounts = places.reduce((counts, place) => {
    const locationLabel = getPlaceLocationLabel(place);
    counts.set(locationLabel, (counts.get(locationLabel) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  return [...places]
    .sort((a, b) => {
      const aTimestamp = Date.parse(createdAtByPlaceId.get(a.id) ?? '');
      const bTimestamp = Date.parse(createdAtByPlaceId.get(b.id) ?? '');
      return (Number.isNaN(bTimestamp) ? 0 : bTimestamp)
        - (Number.isNaN(aTimestamp) ? 0 : aTimestamp);
    })
    .map((place) => {
      const locationLabel = getPlaceLocationLabel(place);
      return {
        place,
        distanceKm: haversineDistanceKm(userLocation, place),
        locationLabel,
        locationCount: locationCounts.get(locationLabel) ?? 1,
        dateLabel: formatDateAdded(createdAtByPlaceId.get(place.id)),
      };
    });
}

function CategoryChip({ category }: { category?: string }) {
  const sourceLabel = category?.trim() || 'Place';
  const isRestaurant = /restaurant|food|dining|café|cafe/i.test(sourceLabel);
  const label = isRestaurant
    ? 'Restaurant'
    : sourceLabel.toLocaleLowerCase().replace(/\p{L}+/gu, (word) => (
      word[0].toLocaleUpperCase() + word.slice(1)
    ));
  const Icon = isRestaurant ? ForkKnifeIcon : MapPinIcon;

  return (
    <View pointerEvents="none" style={styles.chipOuter}>
      <BlurView tint="light" intensity={80} style={styles.chipBlur} />
      <View style={styles.chipBg} />
      <View style={styles.chipContent}>
        <Icon size={13} weight="fill" color="#D4940A" />
        <Text numberOfLines={1} style={styles.chipLabel}>{label}</Text>
      </View>
    </View>
  );
}

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
            <PlaceCover category={place.category} specialRole={place.specialRole} iconSize={28} />
          )}
          <View pointerEvents="none" style={styles.imageTint} />
          <CategoryChip category={place.category} />
        </View>
      </View>
      <View style={styles.tileLabelBox}>
        <Text
          numberOfLines={2}
          style={[typography.captionMedium, styles.tileLabel]}
        >
          {place.name}
        </Text>
      </View>
    </PressableScale>
  );
});

const SavedPlaceListItem = memo(function SavedPlaceListItem({
  place,
  onPress,
}: PlaceTileProps) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={place.name}
      onPress={() => onPress(place)}
      scaleTo={0.985}
      style={styles.listItem}
    >
      <View style={styles.listImageShadow}>
        <View style={styles.listImageClip}>
          {place.thumbnailUrl ? (
            <Image
              source={{ uri: place.thumbnailUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
          ) : (
            <PlaceCover category={place.category} specialRole={place.specialRole} iconSize={22} />
          )}
        </View>
      </View>

      <View style={styles.listItemContent}>
        <View style={styles.listItemCopy}>
          <Text numberOfLines={1} style={[typography.bodyEmphasis, styles.listItemTitle]}>{place.name}</Text>
          <Text numberOfLines={2} style={[typography.bodySmall, styles.listItemDescription]}>
            {place.summary || place.subtitle || place.address}
          </Text>
        </View>
        {place.tags.length > 0 ? (
          <View style={styles.listTagsRow}>
            {place.tags.slice(0, 2).map((tag) => (
              <PlaceTagChip key={tag.id} label={tag.label} style={styles.listTagCap} />
            ))}
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
});

function PlacesListSeparator() {
  return <View style={styles.placesListSeparator} />;
}

function AtlasListSeparator() {
  return <View style={styles.atlasListSeparator} />;
}

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
        <Text style={[typography.bodySmallMedium, styles.sectionCount]}>
          {totalCount} {totalCount === 1 ? 'Place' : 'Places'}
        </Text>
      </PressableScale>

      {places.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ overflow: 'visible' }}
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

type AtlasPreview = {
  id: string;
  title: string;
  emoji: string;
  placeCount: number;
  thumbnailUrl?: string;
  createdAt: string;
  countryKeys: string[];
};

type AtlasRowProps = {
  atlas: AtlasPreview;
  onPress: (atlasId: string) => void;
};

const AtlasRow = memo(function AtlasRow({ atlas, onPress }: AtlasRowProps) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${atlas.title}, ${atlas.placeCount} places`}
      onPress={() => onPress(atlas.id)}
      scaleTo={0.985}
      style={styles.atlasRow}
    >
      <View style={styles.atlasThumbnail}>
        {atlas.thumbnailUrl ? (
          <Image
            source={{ uri: atlas.thumbnailUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <ListDashesIcon size={28} weight="regular" color="#A7A7A7" />
        )}
      </View>
      <View style={styles.atlasCopy}>
        <Text numberOfLines={1} style={[typography.bodyEmphasis, styles.atlasTitle]}>
          {atlas.title}
        </Text>
        <Text style={[typography.bodySmallMedium, styles.atlasCount]}>
          {atlas.placeCount} {atlas.placeCount === 1 ? 'Place' : 'Places'}
        </Text>
      </View>
      <CaretRightIcon size={16} weight="bold" color="#8A8A8A" />
    </PressableScale>
  );
});

function AtlasSection({
  atlases,
  onHeaderPress,
  onAtlasPress,
}: {
  atlases: AtlasPreview[];
  onHeaderPress: () => void;
  onAtlasPress: (atlasId: string) => void;
}) {
  return (
    <View style={styles.section}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="View all Atlas"
        onPress={onHeaderPress}
        scaleTo={0.985}
        style={styles.sectionHeader}
      >
        <View style={styles.sectionTitleGroup}>
          <Text style={[typography.h3, styles.sectionTitle]}>Atlas</Text>
          <CaretRightIcon size={16} weight="bold" color="#8A8A8A" />
        </View>
        <Text style={[typography.bodySmallMedium, styles.sectionCount]}>
          {atlases.length} Atlas
        </Text>
      </PressableScale>

      {atlases.length > 0 ? (
        <View style={styles.atlasList}>
          {atlases.map((atlas) => (
            <AtlasRow
              key={atlas.id}
              atlas={atlas}
              onPress={onAtlasPress}
            />
          ))}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={[typography.bodySmall, styles.emptyText]}>
            Your Atlas will appear here.
          </Text>
        </View>
      )}
    </View>
  );
}

function includesQuery(values: Array<string | null | undefined>, query: string): boolean {
  if (!query) return true;
  return values.some((value) => value?.toLocaleLowerCase().includes(query));
}

function getPlaceCountryKey(place: PlaceDetail): string | undefined {
  if (place.country?.trim()) return place.country.trim();

  const lastAddressPart = place.address
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  if (!lastAddressPart) return undefined;

  const normalized = lastAddressPart.toLocaleLowerCase();
  const isUsState = Boolean(US_STATE_ABBREVIATIONS[normalized])
    || Object.values(US_STATE_ABBREVIATIONS).includes(lastAddressPart.toUpperCase());
  return isUsState ? 'United States' : lastAddressPart;
}

function getPlaceCityKey(place: PlaceDetail): string | undefined {
  return place.city?.trim() || undefined;
}

function countryGroupKey(country: string): string {
  return country.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function CountriesIndex({
  visible,
  rows,
  onClose,
  onSelect,
}: {
  visible: boolean;
  rows: CountryIndexRow[];
  onClose: () => void;
  onSelect: (target: Pick<CountryIndexItem, 'name' | 'firstPlaceIndex'>) => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.countryIndexModal}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close country list"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.countryIndexSheet}>
          <View style={styles.countryIndexHandle} />
          <View style={styles.countryIndexHeader}>
            <Text style={styles.countryIndexTitle}>Countries</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close country list"
              onPress={onClose}
              hitSlop={8}
              style={styles.countryIndexClose}
            >
              <Text style={styles.countryIndexCloseLabel}>Done</Text>
            </Pressable>
          </View>
          <FlatList
            data={rows}
            keyExtractor={(row) => row.kind === 'country'
              ? `country-${row.item.name}`
              : `city-${row.countryName}-${row.item.name}`}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.countryIndexList}
            renderItem={({ item: row }) => row.kind === 'country' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Show saved places in ${row.item.name}`}
                onPress={() => onSelect(row.item)}
                style={({ pressed }) => [
                  styles.countryIndexRow,
                  pressed && styles.countryIndexRowPressed,
                ]}
              >
                <View style={styles.countryIndexFlag}>
                  <Text style={styles.countryIndexFlagLabel}>{row.item.flag || '•'}</Text>
                </View>
                <Text numberOfLines={1} style={styles.countryIndexName}>{row.item.name}</Text>
                <Text style={styles.countryIndexCount}>{row.item.count}</Text>
                <CaretRightIcon size={16} weight="bold" color="#B0B0B0" />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Show saved places in ${row.item.name}, ${row.countryName}`}
                onPress={() => onSelect(row.item)}
                style={({ pressed }) => [
                  styles.cityIndexRow,
                  pressed && styles.countryIndexRowPressed,
                ]}
              >
                <View style={styles.cityIndexBullet} />
                <Text numberOfLines={1} style={styles.cityIndexName}>{row.item.name}</Text>
                <Text style={styles.cityIndexCount}>{row.item.count}</Text>
                <CaretRightIcon size={14} weight="bold" color="#C2C2C2" />
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

function CountryJumpLoading({ country }: { country: string | null }) {
  if (!country) return null;
  return (
    <View pointerEvents="none" style={styles.countryJumpBackdrop}>
      <View style={styles.countryJumpNotice}>
        <ActivityIndicator size="small" color="#12A967" />
        <Text numberOfLines={1} style={styles.countryJumpText}>
          Opening {country}
        </Text>
      </View>
    </View>
  );
}

function AllPlaces({
  onPlacePress,
  bottomInset = 0,
  onScroll,
  verticalScrollEnabled = true,
  filter = 'all',
  query = '',
  onFilterChange,
}: AllPlacesProps) {
  const {
    overlay,
    savedPlaces,
    setOverlay,
    atlases,
    atlasPlaces,
    userLocation,
  } = useHome();
  const queuedAtlasCoverRowsRef = useRef(new Set<string>());

  const normalizedQuery = query.trim().toLocaleLowerCase();

  const detailedPlaces = useMemo(
    () => savedPlaces.map(toPlaceDetail),
    [savedPlaces],
  );

  const filteredPlaces = useMemo(
    () => detailedPlaces
      .filter((place) => includesQuery([
        place.name,
        place.subtitle,
        place.address,
        place.category,
        place.city,
        ...place.tags.map((tag) => tag.label),
      ], normalizedQuery)),
    [detailedPlaces, normalizedQuery],
  );

  const [sortMode, setSortMode] = useState<PlacesSortMode>('distance');
  const [atlasSortMode, setAtlasSortMode] = useState<AtlasSortMode>('recent');
  const createdAtByPlaceId = useMemo(
    () => new Map(savedPlaces.map((place) => [place.id, place.created_at])),
    [savedPlaces],
  );

  const distanceSortedPlaces = useMemo(
    () => sortPlacesByDistance(filteredPlaces, userLocation),
    [filteredPlaces, userLocation],
  );

  const dateSortedPlaces = useMemo(
    () => sortPlacesByDate(filteredPlaces, createdAtByPlaceId, userLocation),
    [createdAtByPlaceId, filteredPlaces, userLocation],
  );

  const sortedPlaces = sortMode === 'distance'
    ? distanceSortedPlaces
    : dateSortedPlaces;

  const countriesIndex = useMemo<CountryIndexItem[]>(() => {
    const entries = new Map<string, CountryIndexItem>();
    sortedPlaces.forEach(({ place }, index) => {
      const name = getPlaceCountryKey(place) ?? 'Other places';
      const key = countryGroupKey(name);
      let country = entries.get(key);
      if (!country) {
        country = {
          name,
          flag: countryFlag(name),
          count: 0,
          firstPlaceIndex: index,
          cities: [],
        };
        entries.set(key, country);
      }
      country.count += 1;

      const cityName = getPlaceCityKey(place);
      if (!cityName) return;
      let city = country.cities.find((item) => item.name === cityName);
      if (!city) {
        city = { name: cityName, count: 0, firstPlaceIndex: index };
        country.cities.push(city);
      }
      city.count += 1;
    });
    return Array.from(entries.values())
      .map((country) => ({
        ...country,
        cities: [...country.cities].sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sortedPlaces]);

  const countryIndexRows = useMemo<CountryIndexRow[]>(() => countriesIndex.flatMap((country) => [
    { kind: 'country' as const, item: country },
    ...country.cities.map((city) => ({
      kind: 'city' as const,
      item: city,
      countryName: country.name,
    })),
  ]), [countriesIndex]);

  const firstVisibleLocation = useMemo<VisibleLocation>(() => ({
    locationLabel: sortedPlaces[0]?.locationLabel ?? 'Saved places',
    locationCount: sortedPlaces[0]?.locationCount ?? 0,
    dateLabel: sortedPlaces[0]?.dateLabel ?? 'Date unavailable',
  }), [sortedPlaces]);

  const [visibleLocation, setVisibleLocation] = useState(firstVisibleLocation);
  const visibleLocationRef = useRef(firstVisibleLocation);
  const locationLabelOpacity = useRef(new Animated.Value(1)).current;
  const placesHeaderShadowOpacity = useRef(new Animated.Value(0)).current;
  const isPlacesHeaderShadowVisibleRef = useRef(false);
  const placesListRef = useRef<FlatList<DistancePlaceItem>>(null);
  const [countriesIndexOpen, setCountriesIndexOpen] = useState(false);
  const [jumpingCountry, setJumpingCountry] = useState<string | null>(null);
  const pendingJumpIndexRef = useRef<number | null>(null);
  const jumpRetryCountRef = useRef(0);
  const jumpRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAtlasViewableItemsChanged = useRef(() => {}).current;
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 55,
    minimumViewTime: 80,
  }).current;

  const updateVisibleLocation = useCallback((nextLocation: VisibleLocation) => {
    if (
      visibleLocationRef.current.locationLabel === nextLocation.locationLabel
      && visibleLocationRef.current.locationCount === nextLocation.locationCount
      && visibleLocationRef.current.dateLabel === nextLocation.dateLabel
    ) return;

    visibleLocationRef.current = nextLocation;
    locationLabelOpacity.stopAnimation();
    Animated.timing(locationLabelOpacity, {
      toValue: 0,
      duration: 90,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setVisibleLocation(nextLocation);
      Animated.timing(locationLabelOpacity, {
        toValue: 1,
        duration: 130,
        useNativeDriver: true,
      }).start();
    });
  }, [locationLabelOpacity]);

  const onViewableItemsChanged = useRef(({
    viewableItems,
  }: {
    viewableItems: ViewToken<DistancePlaceItem>[];
  }) => {
    const firstVisibleItem = viewableItems.find((token) => token.isViewable)?.item;
    if (!firstVisibleItem) return;
    const pendingIndex = pendingJumpIndexRef.current;
    if (pendingIndex !== null && viewableItems.some((token) => (
      token.isViewable && token.index === pendingIndex
    ))) {
      pendingJumpIndexRef.current = null;
      if (jumpRetryTimerRef.current) clearTimeout(jumpRetryTimerRef.current);
      jumpRetryTimerRef.current = null;
      if (jumpTimeoutRef.current) clearTimeout(jumpTimeoutRef.current);
      jumpTimeoutRef.current = null;
      setJumpingCountry(null);
    }
    updateVisibleLocation({
      locationLabel: firstVisibleItem.locationLabel,
      locationCount: firstVisibleItem.locationCount,
      dateLabel: firstVisibleItem.dateLabel,
    });
  }).current;

  useEffect(() => {
    visibleLocationRef.current = firstVisibleLocation;
    setVisibleLocation(firstVisibleLocation);
    locationLabelOpacity.setValue(1);
  }, [firstVisibleLocation, locationLabelOpacity]);

  useEffect(() => () => {
    if (jumpRetryTimerRef.current) clearTimeout(jumpRetryTimerRef.current);
    if (jumpTimeoutRef.current) clearTimeout(jumpTimeoutRef.current);
  }, []);

  const handlePlacesListScroll = useCallback((
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    onScroll?.(offsetY);

    const shouldShowShadow = offsetY > 2;
    if (isPlacesHeaderShadowVisibleRef.current === shouldShowShadow) return;

    isPlacesHeaderShadowVisibleRef.current = shouldShowShadow;
    placesHeaderShadowOpacity.stopAnimation();
    Animated.timing(placesHeaderShadowOpacity, {
      toValue: shouldShowShadow ? 1 : 0,
      duration: 140,
      useNativeDriver: true,
    }).start();
  }, [onScroll, placesHeaderShadowOpacity]);

  useEffect(() => {
    placesListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [sortMode]);

  const scrollToCountry = useCallback((country: Pick<CountryIndexItem, 'name' | 'firstPlaceIndex'>) => {
    if (jumpRetryTimerRef.current) clearTimeout(jumpRetryTimerRef.current);
    if (jumpTimeoutRef.current) clearTimeout(jumpTimeoutRef.current);
    setCountriesIndexOpen(false);
    setJumpingCountry(country.name);
    pendingJumpIndexRef.current = country.firstPlaceIndex;
    jumpRetryCountRef.current = 0;
    jumpTimeoutRef.current = setTimeout(() => {
      pendingJumpIndexRef.current = null;
      setJumpingCountry(null);
    }, 1800);
    requestAnimationFrame(() => {
      placesListRef.current?.recordInteraction();
      placesListRef.current?.scrollToIndex({
        index: country.firstPlaceIndex,
        animated: true,
        viewPosition: 0,
      });
    });
  }, []);

  const retryCountryJump = useCallback((index: number, averageItemLength: number) => {
    if (pendingJumpIndexRef.current !== index) return;
    const retryCount = jumpRetryCountRef.current;
    jumpRetryCountRef.current += 1;
    if (retryCount >= 2) {
      pendingJumpIndexRef.current = null;
      setJumpingCountry(null);
      return;
    }
    // Render the destination neighborhood first, then retry the exact index.
    // The loading notice stays up until the requested row is actually visible.
    placesListRef.current?.scrollToOffset({
      offset: Math.max(0, index * averageItemLength),
      animated: false,
    });
    if (jumpRetryTimerRef.current) clearTimeout(jumpRetryTimerRef.current);
    jumpRetryTimerRef.current = setTimeout(() => {
      if (pendingJumpIndexRef.current !== index) return;
      placesListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
    }, 120 + retryCount * 120);
  }, []);

  const sortMenuActions = useMemo<MenuAction[]>(() => [
    {
      id: 'distance',
      title: 'Distance',
      state: sortMode === 'distance' ? 'on' : 'off',
    },
    {
      id: 'date',
      title: 'Date added',
      state: sortMode === 'date' ? 'on' : 'off',
    },
  ], [sortMode]);

  const savedPreview = useMemo(
    () => filteredPlaces.slice(0, MAX_SECTION_ITEMS),
    [filteredPlaces],
  );

  useEffect(() => {
    // This is the Atlas list shown in the All tab. Restore covers for older
    // rows as well, but request just one stop per Atlas and let the shared
    // service queue serialize the work.
    atlases.forEach((atlas) => {
      const rows = atlasPlaces
        .filter((row) => row.atlas_id === atlas.id)
        .sort((a, b) => a.sort_order - b.sort_order);
      const hasCover = rows.some((row) => row.photo_url || (row.place_id && savedPlaces.some((place) => place.id === row.place_id && place.photo_url)));
      const candidate = rows.find((row) => !row.photo_url && row.place_name && row.latitude != null && row.longitude != null);
      if (hasCover || !candidate || queuedAtlasCoverRowsRef.current.has(candidate.id)) return;
      queuedAtlasCoverRowsRef.current.add(candidate.id);
      void queueAtlasPlacePhotoBackfill(candidate);
    });
  }, [atlasPlaces, atlases, savedPlaces]);

  const atlasPreviews = useMemo<AtlasPreview[]>(() => atlases
    .filter((atlas) => {
      if (includesQuery([atlas.title, atlas.description], normalizedQuery)) return true;
      const memberPlaceIds = new Set(
        atlasPlaces
          .filter((row) => row.atlas_id === atlas.id)
          .map((row) => row.place_id),
      );
      return detailedPlaces.some((place) => (
        memberPlaceIds.has(place.id)
        && includesQuery([place.name, place.subtitle], normalizedQuery)
      ));
    })
    .map((atlas) => {
      const memberRows = atlasPlaces
        .filter((row) => row.atlas_id === atlas.id)
        .sort((a, b) => a.sort_order - b.sort_order);
      const memberPlaces = memberRows
        .map((row) => detailedPlaces.find((place) => place.id === row.place_id))
        .filter((place): place is PlaceDetail => Boolean(place));
      const countryKeys = Array.from(new Set(
        memberPlaces
          .map(getPlaceCountryKey)
          .filter((country): country is string => Boolean(country)),
      ));
      return {
        id: atlas.id,
        title: atlas.title,
        emoji: atlas.emoji,
        placeCount: memberRows.length,
        // Atlas-owned stops (AI and direct Atlas search) are intentionally
        // not My Places records. Their photo lives on the join row, so use it
        // before falling back to a linked saved place.
        thumbnailUrl: memberRows.find((row) => Boolean(row.photo_url))?.photo_url ?? memberPlaces.find((place) => Boolean(place.thumbnailUrl))?.thumbnailUrl,
        createdAt: atlas.created_at,
        countryKeys,
      };
    }), [atlasPlaces, atlases, detailedPlaces, normalizedQuery]);

  const sortedAtlasPreviews = useMemo(() => [...atlasPreviews].sort((a, b) => {
    if (atlasSortMode === 'alphabetical') return a.title.localeCompare(b.title);
    if (atlasSortMode === 'places') return b.placeCount - a.placeCount;

    const aTimestamp = Date.parse(a.createdAt);
    const bTimestamp = Date.parse(b.createdAt);
    return (Number.isNaN(bTimestamp) ? 0 : bTimestamp)
      - (Number.isNaN(aTimestamp) ? 0 : aTimestamp);
  }), [atlasPreviews, atlasSortMode]);

  const atlasCountryCount = useMemo(() => new Set(
    atlasPreviews.flatMap((atlas) => atlas.countryKeys),
  ).size, [atlasPreviews]);

  const atlasSortMenuActions = useMemo<MenuAction[]>(() => [
    {
      id: 'recent',
      title: 'Recent',
      state: atlasSortMode === 'recent' ? 'on' : 'off',
    },
    {
      id: 'alphabetical',
      title: 'Alphabetical',
      state: atlasSortMode === 'alphabetical' ? 'on' : 'off',
    },
    {
      id: 'places',
      title: 'Most places',
      state: atlasSortMode === 'places' ? 'on' : 'off',
    },
  ], [atlasSortMode]);

  const handlePlacePress = useCallback((place: PlaceDetail) => {
    onPlacePress?.(place);
    setOverlay({ kind: 'placeDetail', placeId: place.id, returnTo: overlay });
  }, [onPlacePress, overlay, setOverlay]);

  const handleAtlasPress = useCallback((atlasId: string) => {
    setOverlay({ kind: 'atlasDetail', atlasId });
  }, [setOverlay]);

  const renderPlaceItem = useCallback(({ item }: { item: DistancePlaceItem }) => (
    <SavedPlaceListItem place={item.place} onPress={handlePlacePress} />
  ), [handlePlacePress]);

  const renderAtlasItem = useCallback(({ item }: { item: AtlasPreview }) => (
    <AtlasRow atlas={item} onPress={handleAtlasPress} />
  ), [handleAtlasPress]);

  const showPlaces = filter === 'all' || filter === 'places';
  const showAtlases = filter === 'all' || filter === 'atlas';
  if (filter === 'places') {
    return (
      <View style={styles.root}>
        <View style={styles.placesDivider} />
        <View style={styles.placesListHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Browse saved places by country"
            accessibilityHint="Choose a country and jump to its saved places"
            disabled={countriesIndex.length === 0}
            onPress={() => setCountriesIndexOpen(true)}
            hitSlop={6}
            style={({ pressed }) => [
              styles.placesLocationButton,
              pressed && styles.countryIndexButtonPressed,
            ]}
          >
            <Animated.View style={[styles.placesLocationCopy, { opacity: locationLabelOpacity }]}>
              <Text numberOfLines={1} style={[typography.subheader, styles.placesLocationLabel]}>
                {sortMode === 'date' ? (
                  visibleLocation.dateLabel
                ) : (
                  `${visibleLocation.locationLabel} · ${visibleLocation.locationCount} ${
                    visibleLocation.locationCount === 1 ? 'place' : 'places'
                  }`
                )}
              </Text>
            </Animated.View>
          </Pressable>
          <MenuView
            key={sortMode}
            actions={sortMenuActions}
            style={styles.sortMenu}
            onPressAction={({ nativeEvent }) => {
              if (nativeEvent.event === 'distance' || nativeEvent.event === 'date') {
                setSortMode(nativeEvent.event);
              }
            }}
          >
            <View
              accessible
              accessibilityRole="button"
              accessibilityLabel="Sort saved places"
              accessibilityHint="Choose distance or date added sorting"
              style={styles.sortButton}
            >
              <ArrowsDownUpIcon size={16} weight="bold" color="#717171" />
              <Text style={[typography.bodySmallEmphasis, styles.sortButtonLabel]}>
                {sortMode === 'distance' ? 'Distance' : 'Date added'}
              </Text>
              <CaretDownIcon size={12} weight="fill" color="#717171" />
            </View>
          </MenuView>
        </View>
        <View style={styles.placesListViewport}>
          <FlatList
            key="saved-places-list"
            ref={placesListRef}
            data={sortedPlaces}
            keyExtractor={placeListKeyExtractor}
            renderItem={renderPlaceItem}
            scrollEnabled={verticalScrollEnabled}
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={[
              styles.placesListContent,
              { paddingBottom: bottomInset + 44 },
            ]}
            ItemSeparatorComponent={PlacesListSeparator}
            ListEmptyComponent={(
              <View style={styles.emptyState}>
                <Text style={[typography.bodySmall, styles.emptyText]}>
                  {normalizedQuery
                    ? 'No saved places match your search.'
                    : 'Your saved places will appear here.'}
                </Text>
              </View>
            )}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onScroll={handlePlacesListScroll}
            scrollEventThrottle={16}
            viewabilityConfig={viewabilityConfig}
            onViewableItemsChanged={onViewableItemsChanged}
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              retryCountryJump(index, averageItemLength);
            }}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.placesHeaderShadow,
              { opacity: placesHeaderShadowOpacity },
            ]}
          >
            <LinearGradient
              colors={[
                'rgba(0,0,0,0.08)',
                'rgba(0,0,0,0.045)',
                'rgba(0,0,0,0)',
              ]}
              locations={[0, 0.42, 1]}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>
        <CountriesIndex
          visible={countriesIndexOpen}
          rows={countryIndexRows}
          onClose={() => setCountriesIndexOpen(false)}
          onSelect={scrollToCountry}
        />
        <CountryJumpLoading country={jumpingCountry} />
      </View>
    );
  }

  if (filter === 'atlas') {
    const atlasSortLabel = atlasSortMode === 'recent'
      ? 'Recent'
      : atlasSortMode === 'alphabetical'
        ? 'Alphabetical'
        : 'Most places';
    const atlasSummary = `${atlasPreviews.length} Atlas · ${atlasCountryCount} ${atlasCountryCount === 1 ? 'Country' : 'Countries'}`;

    return (
      <View style={styles.root}>
        <View style={styles.placesDivider} />
        <View style={styles.atlasListHeader}>
          <Text numberOfLines={1} style={[typography.subheader, styles.atlasSummaryLabel]}>
            {atlasSummary}
          </Text>
          <MenuView
            key={atlasSortMode}
            actions={atlasSortMenuActions}
            style={styles.sortMenu}
            onPressAction={({ nativeEvent }) => {
              if (
                nativeEvent.event === 'recent'
                || nativeEvent.event === 'alphabetical'
                || nativeEvent.event === 'places'
              ) {
                setAtlasSortMode(nativeEvent.event);
              }
            }}
          >
            <View
              accessible
              accessibilityRole="button"
              accessibilityLabel="Sort Atlas"
              style={styles.sortButton}
            >
              <ArrowsDownUpIcon size={16} weight="bold" color="#717171" />
              <Text style={[typography.bodySmallEmphasis, styles.sortButtonLabel]}>{atlasSortLabel}</Text>
              <CaretDownIcon size={12} weight="fill" color="#717171" />
            </View>
          </MenuView>
        </View>
        <View style={styles.placesListViewport}>
          <FlatList
            key="saved-atlas-list"
            data={sortedAtlasPreviews}
            keyExtractor={atlasListKeyExtractor}
            renderItem={renderAtlasItem}
            scrollEnabled={verticalScrollEnabled}
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={[
              styles.atlasPageListContent,
              { paddingBottom: bottomInset + 44 },
            ]}
            ItemSeparatorComponent={AtlasListSeparator}
            ListEmptyComponent={(
              <View style={styles.emptyState}>
                <Text style={[typography.bodySmall, styles.emptyText]}>
                  {normalizedQuery
                    ? 'No atlases match your search.'
                    : 'Your atlases will appear here.'}
                </Text>
              </View>
            )}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onScroll={handlePlacesListScroll}
            scrollEventThrottle={16}
            onViewableItemsChanged={onAtlasViewableItemsChanged}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.placesHeaderShadow,
              { opacity: placesHeaderShadowOpacity },
            ]}
          >
            <LinearGradient
              colors={[
                'rgba(0,0,0,0.08)',
                'rgba(0,0,0,0.045)',
                'rgba(0,0,0,0)',
              ]}
              locations={[0, 0.42, 1]}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
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
        {showPlaces ? (
          <PlacesSection
            title="Saved places"
            places={savedPreview}
            totalCount={normalizedQuery ? filteredPlaces.length : detailedPlaces.length}
            emptyMessage={normalizedQuery
              ? 'No saved places match your search.'
              : 'Your saved places will appear here.'}
            onHeaderPress={() => onFilterChange?.('places')}
            onPlacePress={handlePlacePress}
          />
        ) : null}
        {showPlaces && showAtlases ? <View style={styles.overviewDivider} /> : null}
        {showAtlases ? (
          <AtlasSection
            atlases={atlasPreviews}
            onHeaderPress={() => onFilterChange?.('atlas')}
            onAtlasPress={handleAtlasPress}
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
  placesDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    backgroundColor: DIVIDER_COLOR,
  },
  placesListHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 32,
  },
  placesLocationButton: {
    flex: 1,
    minHeight: 34,
    marginVertical: -7,
    paddingRight: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  countryIndexButtonPressed: {
    opacity: 0.58,
  },
  atlasListHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 32,
  },
  atlasSummaryLabel: {
    flex: 1,
    color: '#717171',
  },
  placesLocationCopy: {
    flex: 1,
  },
  placesLocationLabel: {
    color: '#717171',
  },
  placesListViewport: {
    flex: 1,
    position: 'relative',
  },
  placesHeaderShadow: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    zIndex: 3,
    height: 18,
  },
  countryIndexModal: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  countryJumpBackdrop: {
    position: 'absolute',
    top: 14,
    right: 16,
    left: 16,
    zIndex: 10,
    alignItems: 'center',
  },
  countryJumpNotice: {
    maxWidth: '78%',
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(250,250,250,0.98)',
    boxShadow: '0 7px 22px rgba(0,0,0,0.14)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  countryJumpText: {
    flexShrink: 1,
    color: '#303030',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  countryIndexSheet: {
    maxHeight: '68%',
    minHeight: 220,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: '#FAFAFA',
  },
  countryIndexHandle: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    marginTop: 9,
    marginBottom: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(60,60,67,0.22)',
  },
  countryIndexHeader: {
    height: 48,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E1E1E1',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  countryIndexTitle: {
    color: '#1A1A1A',
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 22,
  },
  countryIndexClose: {
    minWidth: 44,
    minHeight: 36,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  countryIndexCloseLabel: {
    color: '#12A967',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  countryIndexList: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 28,
  },
  countryIndexRow: {
    minHeight: 58,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5E5',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cityIndexRow: {
    minHeight: 42,
    paddingLeft: 46,
    paddingRight: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EDEDED',
  },
  cityIndexBullet: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#B6B6B6',
  },
  cityIndexName: {
    flex: 1,
    color: '#5E5E5E',
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
  },
  cityIndexCount: {
    color: '#A0A0A0',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  countryIndexRowPressed: {
    opacity: 0.58,
  },
  countryIndexFlag: {
    width: 28,
    alignItems: 'center',
  },
  countryIndexFlagLabel: {
    fontSize: 21,
    lineHeight: 26,
  },
  countryIndexName: {
    flex: 1,
    color: '#262626',
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 22,
  },
  countryIndexCount: {
    color: '#8A8A8A',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    fontVariant: ['tabular-nums'],
  },
  sortMenu: {
    alignSelf: 'flex-start',
  },
  sortButton: {
    height: CHIP_HEIGHT,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: DIVIDER_COLOR,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  sortButtonLabel: {
    color: '#717171',
  },
  placesListContent: {
    paddingHorizontal: 16,
  },
  atlasPageListContent: {
    paddingHorizontal: 16,
  },
  placesListSeparator: {
    height: 24,
  },
  atlasListSeparator: {
    height: 8,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  listImageShadow: {
    width: LIST_THUMBNAIL_SIZE,
    height: LIST_THUMBNAIL_SIZE,
    borderRadius: 12,
    borderCurve: 'continuous',
    boxShadow: '0 9px 9px rgba(0,0,0,0.09), 0 2px 5px rgba(0,0,0,0.11)',
  },
  listImageClip: {
    width: LIST_THUMBNAIL_SIZE,
    height: LIST_THUMBNAIL_SIZE,
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: '#E5E5EA',
  },
  listItemContent: {
    flex: 1,
    gap: 8,
  },
  listItemCopy: {
    gap: 4,
  },
  listItemTitle: {
    color: '#1A1A1A',
  },
  // Two lines of bodySmall, clamped so every row keeps the same height.
  listItemDescription: {
    height: 40,
    color: '#717171',
  },
  listTagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  listTagCap: {
    maxWidth: '48%',
  },
  contentScroll: {
    flex: 1,
  },
  contentContainer: {
    gap: SECTION_GAP,
  },
  section: {
    gap: 12,
  },
  overviewDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    backgroundColor: DIVIDER_COLOR,
  },
  sectionHeader: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  sectionTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Overrides h3's -1% tracking: at 20pt these two headings read too tight.
  sectionTitle: {
    color: '#1A1A1A',
    letterSpacing: 0,
  },
  sectionCount: {
    color: '#717171',
  },
  tilesRow: {
    gap: CARD_GAP,
    paddingHorizontal: 16,
    paddingBottom: 1,
  },
  tile: {
    width: CARD_SIZE,
    gap: 8,
  },
  imageShadow: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    borderRadius: 20,
    borderCurve: 'continuous',
    boxShadow: '0 7px 14px rgba(0,0,0,0.06), 0 59px 35px rgba(0,0,0,0.03)',
  },
  imageClip: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    borderRadius: 20,
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
  chipOuter: {
    position: 'absolute',
    top: 8,
    left: 8,
    maxWidth: CARD_SIZE - 16,
    borderRadius: 100,
    overflow: 'hidden',
    boxShadow: '0px 4px 13px rgba(0,0,0,0.15)',
  },
  chipBlur: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 100,
  },
  chipBg: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  chipContent: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingLeft: 6,
    paddingRight: 8,
    paddingVertical: 4,
  },
  // 13pt Medium — the type scale has no 13 tier, so this stays a local style.
  chipLabel: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    color: '#1A1A1A',
  },
  tileLabelBox: {
    width: CARD_SIZE,
    height: 40,
    paddingHorizontal: 4,
    justifyContent: 'flex-start',
  },
  tileLabel: {
    color: '#1A1A1A',
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
  atlasList: {
    gap: 8,
    paddingHorizontal: 16,
  },
  atlasRow: {
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
  atlasThumbnail: {
    width: 72,
    height: 72,
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: 'rgba(60,60,67,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  atlasCopy: {
    flex: 1,
    gap: 4,
  },
  atlasTitle: {
    color: '#1A1A1A',
  },
  atlasCount: {
    color: '#717171',
  },
});
