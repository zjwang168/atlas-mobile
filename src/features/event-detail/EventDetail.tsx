import ContentPanel from '@/components/content-panel/ContentPanel';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { EventCover, categoryStyle, formatWhen } from '@/features/discover/EventCard';
import { useHomeOverlay, useHomePlaces } from '@/features/home/HomeContext';
import { eventToParsedPlace } from '@/services/events/eventPlaceAdapter';
import { savePlaces } from '@/services/place/placeService';
import { addFlexiblePlaces } from '@/services/plan/planItineraryService';
import { fetchPlans } from '@/services/plan/planService';
import type { PlanRow } from '@/types/plan';
import type { LocalEvent } from '@/types/event';
import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import { ArrowSquareOutIcon } from 'phosphor-react-native/src/icons/ArrowSquareOut';
import { CalendarBlankIcon } from 'phosphor-react-native/src/icons/CalendarBlank';
import { CheckCircleIcon } from 'phosphor-react-native/src/icons/CheckCircle';
import { MapPinIcon } from 'phosphor-react-native/src/icons/MapPin';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { TicketIcon } from 'phosphor-react-native/src/icons/Ticket';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

const HERO_HEIGHT = 190;

/** What the save button is currently reporting. */
type SaveState = 'idle' | 'saving' | 'saved' | 'duplicate' | 'error';

type EventDetailProps = {
  /** Null hides the panel; the host keeps this mounted either way. */
  event: LocalEvent | null;
  onDismiss: () => void;
  snapGroup?: string;
  onHeightChange?: (height: number) => void;
};

function openMaps(event: LocalEvent) {
  // Same convention as PlaceCard: a coordinate query rather than the address
  // string, because an event's address is often a park name rather than
  // something a geocoder resolves.
  const query = encodeURIComponent(`${event.latitude},${event.longitude}`);
  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`).catch(
    (error) => console.warn('[EventDetail] could not open maps:', error),
  );
}

function InfoRow({
  Icon,
  label,
  value,
  onPress,
}: {
  Icon: typeof MapPinIcon;
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const body = (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Icon size={17} weight="fill" color="#717171" />
      </View>
      <View style={styles.infoText}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, onPress ? styles.infoValueLink : null]}>
          {value}
        </Text>
      </View>
      {onPress ? <ArrowSquareOutIcon size={15} weight="bold" color="#9A9A9A" /> : null}
    </View>
  );

  if (!onPress) return body;
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}
      onPress={onPress} scaleTo={0.99}>
      {body}
    </PressableScale>
  );
}

export function EventDetail({
  event,
  onDismiss,
  snapGroup,
  onHeightChange,
}: EventDetailProps) {
  const { refreshSavedPlaces, savedPlaces } = useHomePlaces();
  const { setOverlay } = useHomeOverlay();

  const [saveState, setSaveState] = useState<SaveState>('idle');
  /** The saved-place id this event became, needed to put it on a plan. */
  const [savedPlaceId, setSavedPlaceId] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [imageFailed, setImageFailed] = useState(false);

  // A fresh event means a fresh save state — the panel is reused, not remounted.
  useEffect(() => {
    setSaveState('idle');
    setSavedPlaceId(null);
    setImageFailed(false);
  }, [event?.id]);

  // Loaded when the panel opens rather than on demand: the plan menu has to
  // know its options before it is pressed, since a native menu cannot show a
  // spinner while it populates.
  useEffect(() => {
    if (!event) return;
    let cancelled = false;
    fetchPlans()
      .then((rows) => { if (!cancelled) setPlans(rows); })
      .catch((error) => console.warn('[EventDetail] could not load plans:', error));
    return () => { cancelled = true; };
  }, [event?.id]);

  /**
   * Already in My Places from an earlier visit. Matched on the provider id the
   * adapter writes, so this survives the panel being closed and reopened —
   * without it the button would offer to save something already saved.
   */
  const alreadySaved = useMemo(() => {
    if (!event) return null;
    return savedPlaces.find(
      (place) => place.external_place_id === event.id,
    ) ?? null;
  }, [event?.id, savedPlaces]);

  const effectiveSaveState: SaveState =
    saveState === 'idle' && alreadySaved ? 'duplicate' : saveState;
  const placeIdForPlan = savedPlaceId ?? alreadySaved?.id ?? null;

  const handleSave = useCallback(async () => {
    if (!event) return;
    setSaveState('saving');
    try {
      const result = await savePlaces([eventToParsedPlace(event)]);
      const row = result.inserted[0] ?? result.duplicates[0] ?? null;
      setSavedPlaceId(row?.id ?? null);
      setSaveState(result.inserted.length > 0 ? 'saved' : 'duplicate');
      await refreshSavedPlaces();
    } catch (error) {
      console.warn('[EventDetail] save failed:', error);
      setSaveState('error');
    }
  }, [event, refreshSavedPlaces]);

  const planActions = useMemo<MenuAction[]>(() => {
    if (plans.length === 0) {
      return [{ id: '__none', title: 'No plans yet', attributes: { disabled: true } }];
    }
    return plans.map((plan) => ({ id: plan.id, title: plan.title }));
  }, [plans]);

  const handlePickPlan = useCallback(async (planId: string) => {
    if (planId === '__none' || !event) return;
    // A plan holds saved places, so the event has to become one first. Doing it
    // here rather than demanding the user press Save first makes "add to plan"
    // a single action.
    let placeId = placeIdForPlan;
    if (!placeId) {
      try {
        const result = await savePlaces([eventToParsedPlace(event)]);
        placeId = (result.inserted[0] ?? result.duplicates[0])?.id ?? null;
        setSavedPlaceId(placeId);
        setSaveState(result.inserted.length > 0 ? 'saved' : 'duplicate');
        await refreshSavedPlaces();
      } catch (error) {
        console.warn('[EventDetail] save before plan add failed:', error);
        setSaveState('error');
        return;
      }
    }
    if (!placeId) return;
    try {
      await addFlexiblePlaces(planId, [placeId]);
      setOverlay({ kind: 'planDetail', planId });
    } catch (error) {
      console.warn('[EventDetail] could not add to plan:', error);
    }
  }, [event, placeIdForPlan, refreshSavedPlaces, setOverlay]);

  const when = event ? formatWhen(event) : null;
  const category = event ? categoryStyle(event.category) : null;

  return (
    <ContentPanel
      visible={event !== null}
      initialSnap="tall"
      minSnap="default"
      snapGroup={snapGroup}
      onHeightChange={onHeightChange}
      zIndex={45}
    >
      {({ reportScrollY, bottomInset }) => (event === null ? null : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 40 }]}
          showsVerticalScrollIndicator={false}
          // The panel needs the scroll offset to know when a downward drag is
          // a panel drag rather than a scroll — without it the sheet cannot be
          // pulled down from inside this content.
          onScroll={(e) => reportScrollY(e.nativeEvent.contentOffset.y)}
          scrollEventThrottle={16}
        >
          <View style={styles.hero}>
            {event.image_url && !imageFailed ? (
              <Image
                source={{ uri: event.image_url }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <EventCover category={event.category} iconSize={44} />
            )}
            {category ? (
              <View style={styles.heroBadge}>
                <category.Icon size={13} weight="fill" color={category.color} />
                <Text style={styles.heroBadgeLabel}>{category.label}</Text>
              </View>
            ) : null}
            {/* Last child so it sits above the fill-positioned image. */}
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onDismiss}
              scaleTo={0.9}
              style={styles.closeButton}
            >
              <XIcon size={15} weight="bold" color="#1A1A1A" />
            </PressableScale>
          </View>

          {/* Only a real photograph is credited. A stock category picture is
              not of this event, so captioning it would misdescribe it. */}
          {event.image_attribution && !event.image_is_stock && !imageFailed ? (
            <Text style={styles.credit}>Photo: {event.image_attribution}</Text>
          ) : null}

          <Text style={styles.title}>{event.title}</Text>
          {event.blurb ? <Text style={styles.blurb}>{event.blurb}</Text> : null}

          <View style={styles.infoBlock}>
            {when ? (
              <InfoRow Icon={CalendarBlankIcon} label="When" value={when} />
            ) : null}
            <InfoRow
              Icon={MapPinIcon}
              label="Where"
              value={event.address ?? event.location_name ?? 'Open in Maps'}
              onPress={() => openMaps(event)}
            />
            <InfoRow
              Icon={TicketIcon}
              label="Admission"
              value={event.is_free === true ? 'Free' : event.is_free === false
                ? 'Ticketed — see the organiser'
                : 'Not published'}
            />
            {event.url ? (
              <InfoRow
                Icon={ArrowSquareOutIcon}
                label="Details"
                value={hostOf(event.url)}
                onPress={() => { Linking.openURL(event.url!).catch(() => {}); }}
              />
            ) : null}
          </View>

          <View style={styles.actions}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Save to My Places"
              onPress={handleSave}
              disabled={effectiveSaveState === 'saving' || effectiveSaveState === 'saved'
                || effectiveSaveState === 'duplicate'}
              scaleTo={0.98}
              style={[styles.saveButton,
                effectiveSaveState === 'saved' || effectiveSaveState === 'duplicate'
                  ? styles.saveButtonDone : null]}
            >
              {effectiveSaveState === 'saving' ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  {effectiveSaveState === 'saved' || effectiveSaveState === 'duplicate' ? (
                    <CheckCircleIcon size={18} weight="fill" color="#FFFFFF" />
                  ) : (
                    <PlusIcon size={18} weight="bold" color="#FFFFFF" />
                  )}
                  <Text style={styles.saveButtonLabel}>{saveLabel(effectiveSaveState)}</Text>
                </>
              )}
            </PressableScale>

            <MenuView
              actions={planActions}
              onPressAction={({ nativeEvent }) => { void handlePickPlan(nativeEvent.event); }}
            >
              <View
                accessible
                accessibilityRole="button"
                accessibilityLabel="Add this event to a plan"
                style={styles.planButton}
              >
                <Text style={styles.planButtonLabel}>Add to plan</Text>
              </View>
            </MenuView>
          </View>

          {effectiveSaveState === 'error' ? (
            <Text style={styles.errorText}>
              Could not save right now. Try again in a moment.
            </Text>
          ) : null}
        </ScrollView>
      ))}
    </ContentPanel>
  );
}

function saveLabel(state: SaveState): string {
  if (state === 'saved') return 'Saved to My Places';
  if (state === 'duplicate') return 'Already in My Places';
  if (state === 'error') return 'Try again';
  return 'Save to My Places';
}

/** The bare host, so a long organiser URL doesn't wrap across three lines. */
function hostOf(url: string): string {
  const match = /^https?:\/\/([^/]+)/i.exec(url);
  return match ? match[1].replace(/^www\./, '') : url;
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    gap: 12,
  },
  hero: {
    height: HERO_HEIGHT,
    borderRadius: 18,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: 'rgba(60,60,67,0.06)',
  },
  closeButton: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  heroBadge: {
    position: 'absolute',
    left: 10,
    top: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 7,
    paddingRight: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  heroBadgeLabel: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    color: '#1A1A1A',
  },
  credit: {
    marginTop: -6,
    fontSize: 11,
    lineHeight: 15,
    color: '#9A9A9A',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
    color: '#1A1A1A',
  },
  blurb: {
    marginTop: -4,
    fontSize: 15,
    lineHeight: 21,
    color: '#4A4A4A',
  },
  infoBlock: {
    marginTop: 4,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 0.5,
    borderColor: '#EBEBEB',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  infoIcon: {
    width: 26,
    alignItems: 'center',
  },
  infoText: {
    flex: 1,
    gap: 1,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: '#9A9A9A',
  },
  infoValue: {
    fontSize: 15,
    lineHeight: 20,
    color: '#1A1A1A',
  },
  infoValueLink: {
    color: '#0B6E4F',
  },
  actions: {
    marginTop: 6,
    gap: 10,
  },
  saveButton: {
    height: 50,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: '#0B6E4F',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonDone: {
    backgroundColor: '#6B9E8A',
  },
  saveButtonLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  planButton: {
    height: 50,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  planButtonLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#C4453C',
    textAlign: 'center',
  },
});
