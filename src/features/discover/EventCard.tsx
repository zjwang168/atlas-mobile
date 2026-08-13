/**
 * The two card shapes the Discover browse list renders: a wide row for the
 * distance-sorted list, and a tall card for the featured strip along the top.
 *
 * Both take a `LocalEvent` straight from the backend and are memoized — the
 * list swaps its whole dataset whenever a filter changes, and the featured
 * strip carries images.
 */

import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import type { EventCategory, LocalEvent } from '@/types/event';
import { CalendarBlankIcon } from 'phosphor-react-native/src/icons/CalendarBlank';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { ConfettiIcon } from 'phosphor-react-native/src/icons/Confetti';
import { MapPinIcon } from 'phosphor-react-native/src/icons/MapPin';
import { MusicNotesIcon } from 'phosphor-react-native/src/icons/MusicNotes';
import { PaletteIcon } from 'phosphor-react-native/src/icons/Palette';
import { ParkIcon } from 'phosphor-react-native/src/icons/Park';
import { ShoppingBagIcon } from 'phosphor-react-native/src/icons/ShoppingBag';
import { UsersThreeIcon } from 'phosphor-react-native/src/icons/UsersThree';
import { memo, useCallback } from 'react';
import { Image, View } from 'react-native';

// -- Category presentation -------------------------------------------------

/** Icon and accent per normalized category. The accents are the only literal
    colours here: they are category identity, like a map pin's hue, not theme
    surface, and the same six are used by the featured badge and the row chip. */
const CATEGORY_STYLE: Record<EventCategory, { Icon: typeof ConfettiIcon; color: string; label: string }> = {
  festival: { Icon: ConfettiIcon, color: '#E4572E', label: 'Festival' },
  market: { Icon: ShoppingBagIcon, color: '#E91E8E', label: 'Market' },
  music: { Icon: MusicNotesIcon, color: '#7B5CD6', label: 'Music' },
  arts: { Icon: PaletteIcon, color: '#2F80ED', label: 'Arts' },
  outdoors: { Icon: ParkIcon, color: '#4CAF50', label: 'Outdoors' },
  history: { Icon: CalendarBlankIcon, color: '#B8860B', label: 'History' },
  community: { Icon: UsersThreeIcon, color: '#0F9D8F', label: 'Community' },
};

export function categoryStyle(category: EventCategory) {
  return CATEGORY_STYLE[category] ?? CATEGORY_STYLE.community;
}

/** Every category block is saturated, so the glyph is the light one on all of
    them. Icons cannot read CSS variables — see THEME.md. */
const GLYPH_COLOR = '#fafafa';

/**
 * Cover for an event with no photo.
 *
 * `PlaceCover` is not reusable here: it buckets *place* categories by keyword,
 * and five of the seven event categories miss its vocabulary entirely —
 * "Music", "Festival", "Arts", "History", and "Community" all fall through to
 * the neutral grey, which turned the featured strip into a wall of grey blocks.
 * The accents below are already the card's category identity, so the cover
 * reuses those instead of feeding a place-shaped matcher event-shaped words.
 */
export function EventCover({ category, iconSize }: { category: EventCategory; iconSize: number }) {
  const { Icon, color } = categoryStyle(category);
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: color,
      }}
    >
      <Icon size={iconSize} weight="fill" color={GLYPH_COLOR} />
    </View>
  );
}

// -- Formatting ------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The one line that answers "when".
 *
 * A dated event gets its day and clock time; a recurring one falls back to the
 * source's own schedule text ("Saturdays, 7am to noon"). Reading `starts_at`
 * first and `schedule_text` second is the contract — neither source nor
 * category tells you which an event has.
 */
export function formatWhen(event: LocalEvent): string | null {
  if (!event.starts_at) return event.schedule_text;

  const start = new Date(event.starts_at);
  if (Number.isNaN(start.getTime())) return event.schedule_text;

  const today = new Date();
  const isToday = start.toDateString() === today.toDateString();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const isTomorrow = start.toDateString() === tomorrow.toDateString();

  const day = isToday
    ? 'Today'
    : isTomorrow
      ? 'Tomorrow'
      : `${WEEKDAYS[start.getDay()]}, ${MONTHS[start.getMonth()]} ${start.getDate()}`;

  // Midnight is what the backend uses for "date known, time unknown", so
  // printing "12:00 AM" would invent a precision the source did not have.
  if (start.getHours() === 0 && start.getMinutes() === 0) return day;

  const hour = start.getHours() % 12 || 12;
  const minutes = start.getMinutes().toString().padStart(2, '0');
  const meridiem = start.getHours() < 12 ? 'AM' : 'PM';
  return `${day} · ${hour}:${minutes} ${meridiem}`;
}

export function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

// -- List row --------------------------------------------------------------

type EventCardProps = {
  event: LocalEvent;
  onPress: (event: LocalEvent) => void;
};

export const EventCard = memo(function EventCard({ event, onPress }: EventCardProps) {
  const handlePress = useCallback(() => onPress(event), [onPress, event]);
  const { Icon, color, label } = categoryStyle(event.category);
  const when = formatWhen(event);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={event.title}
      onPress={handlePress}
      scaleTo={0.985}
      className="flex-row items-center gap-4 rounded-[20px] border-[0.5px] border-border bg-card py-2 pl-2 pr-5"
    >
      <View className="h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-xl bg-muted">
        {event.image_url ? (
          <Image
            source={{ uri: event.image_url }}
            className="h-full w-full"
            resizeMode="cover"
          />
        ) : (
          <EventCover category={event.category} iconSize={22} />
        )}
      </View>

      <View className="flex-1 gap-1">
        <Text numberOfLines={1} className="text-base font-semibold leading-[22px] text-text-primary">
          {event.title}
        </Text>

        {when ? (
          <Text numberOfLines={1} className="text-[13px] leading-[18px] text-text-secondary">
            {when}
          </Text>
        ) : null}

        <View className="flex-row items-center gap-1">
          <View className="flex-row items-center gap-[3px] rounded-full bg-muted py-[3px] pl-1.5 pr-2">
            <Icon size={13} weight="fill" color={color} />
            <Text className="text-xs font-medium leading-[18px] text-text-secondary">{label}</Text>
          </View>
          <Text className="text-xs font-medium leading-[18px] text-text-secondary">
            {formatDistance(event.distance_km)}
          </Text>
          {event.is_free ? (
            <Text className="text-xs font-medium leading-[18px] text-text-tertiary">· Free</Text>
          ) : null}
        </View>
      </View>

      <CaretRightIcon size={16} weight="bold" color="#C7C7C7" />
    </PressableScale>
  );
});

// -- Featured strip card ---------------------------------------------------

/** Width of a featured card. Fixed rather than screen-relative so the next
    card always peeks in from the right and the strip reads as scrollable. */
export const FEATURED_CARD_WIDTH = 260;

export const FeaturedEventCard = memo(function FeaturedEventCard({
  event,
  onPress,
}: EventCardProps) {
  const handlePress = useCallback(() => onPress(event), [onPress, event]);
  const { Icon, color, label } = categoryStyle(event.category);
  const when = formatWhen(event);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={event.title}
      onPress={handlePress}
      scaleTo={0.97}
      style={{ width: FEATURED_CARD_WIDTH }}
      className="overflow-hidden rounded-[20px] border-[0.5px] border-border bg-card"
    >
      <View className="h-[132px] w-full items-center justify-center bg-muted">
        {event.image_url ? (
          <Image
            source={{ uri: event.image_url }}
            className="h-full w-full"
            resizeMode="cover"
          />
        ) : (
          <EventCover category={event.category} iconSize={34} />
        )}
        <View className="absolute left-2.5 top-2.5 flex-row items-center gap-[3px] rounded-full bg-background/90 py-1 pl-1.5 pr-2">
          <Icon size={12} weight="fill" color={color} />
          <Text className="text-[11px] font-semibold leading-4 text-text-primary">{label}</Text>
        </View>
      </View>

      <View className="gap-1 px-3 py-2.5">
        <Text numberOfLines={1} className="text-[15px] font-semibold leading-5 text-text-primary">
          {event.title}
        </Text>
        {/* The blurb is what makes this strip worth scrolling — it is the only
            place a caller learns why an event is interesting rather than just
            near. Falls back to the when-line so the card is never one line. */}
        <Text numberOfLines={2} className="text-xs leading-[17px] text-text-secondary">
          {event.blurb ?? when ?? ''}
        </Text>
        <View className="flex-row items-center gap-1 pt-0.5">
          <MapPinIcon size={12} weight="fill" color="#8A8A8A" />
          <Text numberOfLines={1} className="flex-1 text-[11px] font-medium leading-4 text-text-tertiary">
            {formatDistance(event.distance_km)}
            {when && event.blurb ? ` · ${when}` : ''}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
});
