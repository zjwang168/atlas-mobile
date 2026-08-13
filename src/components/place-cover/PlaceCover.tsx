import { BedIcon } from 'phosphor-react-native/src/icons/Bed';
import { BuildingsIcon } from 'phosphor-react-native/src/icons/Buildings';
import { CameraIcon } from 'phosphor-react-native/src/icons/Camera';
import { ForkKnifeIcon } from 'phosphor-react-native/src/icons/ForkKnife';
import { GraduationCapIcon } from 'phosphor-react-native/src/icons/GraduationCap';
import { HouseIcon } from 'phosphor-react-native/src/icons/House';
import { MapPinIcon } from 'phosphor-react-native/src/icons/MapPin';
import { ShoppingBagIcon } from 'phosphor-react-native/src/icons/ShoppingBag';
import { TreeIcon } from 'phosphor-react-native/src/icons/Tree';
import { View } from 'react-native';

export type PlaceCategoryKey =
  | 'attraction'
  | 'food'
  | 'outdoors'
  | 'shopping'
  | 'lodging'
  | 'neutral';

export type PlaceSpecialRole = 'home' | 'office' | 'school';

/**
 * Keywords that put a place in each bucket, most specific bucket first — the
 * first bucket with a hit wins, so `coffee_shop` lands in food rather than
 * shopping.
 *
 * Matching is on whole words, not substrings: a category arrives as free text
 * (Mapbox's `poi_category` for a suggestion, the `category` column for a saved
 * place), and substring matching quietly turns "theater" into food and
 * "barber" into a bar.
 */
const CATEGORY_KEYWORDS: [PlaceCategoryKey, string[]][] = [
  ['food', ['restaurant', 'cafe', 'coffee', 'bar', 'pub', 'bakery', 'food', 'dining',
    'brewery', 'dessert', 'deli', 'diner', 'bistro', 'eatery', 'pizzeria', 'sushi']],
  ['outdoors', ['park', 'trail', 'garden', 'beach', 'hiking', 'nature', 'mountain',
    'forest', 'lake', 'campground', 'outdoors', 'playground', 'scenic']],
  ['attraction', ['museum', 'gallery', 'landmark', 'monument', 'tourist', 'attraction',
    'historic', 'temple', 'church', 'shrine', 'castle', 'theatre', 'theater', 'zoo',
    'aquarium', 'viewpoint', 'memorial', 'palace']],
  ['shopping', ['shop', 'store', 'mall', 'market', 'boutique', 'retail', 'supermarket', 'mart']],
  ['lodging', ['hotel', 'hostel', 'motel', 'lodging', 'resort', 'inn', 'guesthouse']],
];

/** Bucket a free-text category. Anything unrecognised — or absent — is neutral. */
export function placeCategoryKey(category?: string | null): PlaceCategoryKey {
  if (!category) return 'neutral';
  const words = new Set(category.toLowerCase().split(/[^a-z]+/).filter(Boolean));
  for (const [key, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((word) => words.has(word))) return key;
  }
  return 'neutral';
}

const CATEGORY_COVERS: Record<PlaceCategoryKey, { Icon: typeof MapPinIcon; className: string }> = {
  attraction: { Icon: CameraIcon, className: 'bg-category-attraction' },
  food: { Icon: ForkKnifeIcon, className: 'bg-category-food' },
  outdoors: { Icon: TreeIcon, className: 'bg-category-outdoors' },
  shopping: { Icon: ShoppingBagIcon, className: 'bg-category-shopping' },
  lodging: { Icon: BedIcon, className: 'bg-category-lodging' },
  neutral: { Icon: MapPinIcon, className: 'bg-category-neutral' },
};

/** Every category block is saturated in both themes, so the glyph is the light
    one either way. Icons cannot read CSS variables — see THEME.md. */
const GLYPH_COLOR = '#fafafa';

const SPECIAL_COVERS: Record<PlaceSpecialRole, { Icon: typeof HouseIcon; backgroundColor: string }> = {
  home: { Icon: HouseIcon, backgroundColor: '#4A7FA8' },
  office: { Icon: BuildingsIcon, backgroundColor: '#596EAB' },
  school: { Icon: GraduationCapIcon, backgroundColor: '#3D8B86' },
};

type PlaceCoverProps = {
  category?: string | null;
  specialRole?: PlaceSpecialRole | null;
  iconSize?: number;
};

/** Fallback cover for a place thumbnail with no photo — a category-coloured
    block with a matching glyph. Fills its parent; the caller owns sizing,
    corner radius, and overflow clipping. Absolutely positioned to fill (rather
    than `flex: 1`) so it renders correctly regardless of the parent's own
    `alignItems`/`justifyContent` — a `flex: 1` child shrinks to its content
    size instead of stretching when the parent doesn't use the (non-default)
    `alignItems: 'stretch'`. */
export function PlaceCover({ category, specialRole, iconSize = 28 }: PlaceCoverProps) {
  const specialCover = specialRole ? SPECIAL_COVERS[specialRole] : null;
  const { Icon, className } = CATEGORY_COVERS[placeCategoryKey(category)];

  if (specialCover) {
    const { Icon: SpecialIcon, backgroundColor } = specialCover;
    return (
      <View
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          backgroundColor,
        }}
      >
        <SpecialIcon size={iconSize} weight="fill" color={GLYPH_COLOR} />
      </View>
    );
  }

  return (
    <View
      className={className}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Icon size={iconSize} weight="fill" color={GLYPH_COLOR} />
    </View>
  );
}
