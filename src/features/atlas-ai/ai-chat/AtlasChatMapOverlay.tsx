import { ArrowLeftIcon } from 'phosphor-react-native/src/icons/ArrowLeft';
import { BookmarkIcon } from 'phosphor-react-native/src/icons/Bookmark';
import { MinusIcon } from 'phosphor-react-native/src/icons/Minus';
import { NavigationArrowIcon } from 'phosphor-react-native/src/icons/NavigationArrow';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Animated, Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Text } from '@/components/ui/text';
import type { AtlasChatPresentation, AtlasTransportMode } from '@/services/api/apiService';

const GOOGLE_MAPS_ICON = require('../../../../assets/icons/google-maps2.png');

type ChatMapControlsProps = {
  topInset: number;
  onReturn: () => void;
  onClose: () => void;
  placePopup?: ReactNode;
  atlasItinerary?: ReactNode;
  notice?: string | null;
};

type ChatMapPlacePopupProps = {
  name: string;
  address?: string | null;
  distanceLabel: string;
  origin: [number, number];
  destination: [number, number];
  saved: boolean;
  saving: boolean;
  onToggleSaved: () => void;
};

const TRANSPORT_PRESENTATION: Record<AtlasTransportMode, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  walk: { label: 'Walk', icon: 'walk-outline' }, bike: { label: 'Bike', icon: 'bicycle-outline' },
  drive: { label: 'Drive', icon: 'car-outline' }, taxi: { label: 'Taxi', icon: 'car-sport-outline' },
  bus: { label: 'Bus', icon: 'bus-outline' }, coach: { label: 'Coach', icon: 'bus-outline' },
  subway: { label: 'Subway', icon: 'train-outline' }, train: { label: 'Train', icon: 'train-outline' },
  ferry: { label: 'Ferry', icon: 'boat-outline' }, flight: { label: 'Flight', icon: 'airplane-outline' },
};

function MapNotice({ notice }: { notice?: string | null }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [displayedNotice, setDisplayedNotice] = useState<string | null>(notice ?? null);

  useEffect(() => {
    if (notice) {
      setDisplayedNotice(notice);
      opacity.setValue(0);
      const animation = Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true });
      animation.start();
      return () => animation.stop();
    }
    if (!displayedNotice) return;
    const animation = Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true });
    animation.start(({ finished }) => {
      if (finished) setDisplayedNotice(null);
    });
    return () => animation.stop();
  }, [displayedNotice, notice, opacity]);

  if (!displayedNotice) return null;
  return <Animated.View pointerEvents="none" style={[styles.notice, { opacity }]}><Text style={styles.noticeText}>{displayedNotice}</Text></Animated.View>;
}

function MapPlacePopupTransition({ content }: { content?: ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.96)).current;
  const [displayedContent, setDisplayedContent] = useState<ReactNode>(content ?? null);

  useEffect(() => {
    if (content) {
      setDisplayedContent(content);
      opacity.setValue(0);
      scale.setValue(0.96);
      const animation = Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, damping: 18, stiffness: 220, useNativeDriver: true }),
      ]);
      animation.start();
      return () => animation.stop();
    }
    if (!displayedContent) return;
    const animation = Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 190, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 0.97, duration: 190, useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => {
      if (finished) setDisplayedContent(null);
    });
    return () => animation.stop();
  }, [content, displayedContent, opacity, scale]);

  if (!displayedContent) return null;
  return <Animated.View pointerEvents="auto" style={{ opacity, transform: [{ scale }] }}>{displayedContent}</Animated.View>;
}

export function AtlasChatMapControls({ topInset, onReturn, onClose, placePopup, atlasItinerary, notice }: ChatMapControlsProps) {
  return <View pointerEvents="box-none" style={styles.controlLayer}>
    <View style={[styles.header, { top: topInset + 10 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Return to chat" onPress={onReturn} style={({ pressed }) => [styles.returnButton, pressed && styles.controlPressed]}>
        <ArrowLeftIcon size={18} weight="bold" color="#18181B" />
        <Text style={styles.returnText}>Return to chat</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Close map and return to My Places" onPress={onClose} style={({ pressed }) => [styles.iconButton, pressed && styles.controlPressed]}>
        <XIcon size={21} weight="bold" color="#18181B" />
      </Pressable>
    </View>
    <View pointerEvents="none" style={[styles.noticeLayer, { top: topInset + 62 }]}><MapNotice notice={notice} /></View>
    <View pointerEvents="box-none" style={[styles.placePopupLayer, Boolean(atlasItinerary) && styles.placePopupAboveItinerary]}><MapPlacePopupTransition content={placePopup} /></View>
    {atlasItinerary ? <View pointerEvents="box-none" style={styles.itineraryLayer}>{atlasItinerary}</View> : null}
  </View>;
}

/** Read-only Atlas detail surface for an unconfirmed chat draft. */
export function AtlasChatMapItinerary({ presentation }: { presentation: AtlasChatPresentation }) {
  if (presentation.kind !== 'atlas_draft' || !presentation.places.length) return null;
  return <View accessibilityLabel={`${presentation.title} itinerary`} style={styles.itineraryPanel}>
    <View style={styles.itineraryHandle} />
    <View style={styles.itineraryHeader}>
      <View style={styles.itineraryHeaderCopy}>
        <Text numberOfLines={1} style={styles.itineraryTitle}>{presentation.title}</Text>
        <Text style={styles.itinerarySubtitle}>{presentation.places.length} stops</Text>
      </View>
    </View>
    {presentation.planning_note ? <Text numberOfLines={2} style={styles.planningNote}>{presentation.planning_note}</Text> : null}
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.itineraryList}>
      {presentation.places.map((place, index) => {
        const transport = place.transport ? TRANSPORT_PRESENTATION[place.transport] : null;
        const nextPlace = presentation.places[index + 1];
        const nextTransport = nextPlace?.transport ? TRANSPORT_PRESENTATION[nextPlace.transport] : null;
        return <View key={place.external_id || `${place.name}-${index}`} style={styles.itineraryEntry}>
          <View style={styles.itineraryEntryRow}>
            <View style={styles.itineraryNumber}><Text style={styles.itineraryNumberText}>{index + 1}</Text></View>
            <View style={styles.itineraryEntryCopy}>
              {(place.timeline_time || transport) ? <View style={styles.itineraryMeta}>
                {place.timeline_time ? <View style={styles.timeTag}><Ionicons name="time-outline" size={12} color="#2677B5" /><Text style={styles.timeTagText}>{place.timeline_day ? `Day ${place.timeline_day} · ` : ''}{place.timeline_time}</Text></View> : null}
                {transport ? <View accessibilityLabel={transport.label} style={styles.transportTag}><Ionicons name={transport.icon} size={12} color="#64748B" /><Text style={styles.transportTagText}>{transport.label}</Text></View> : null}
              </View> : null}
              <Text numberOfLines={1} style={styles.itineraryPlaceName}>{place.name}</Text>
              {place.full_address ? <Text numberOfLines={1} style={styles.itineraryAddress}>{place.full_address}</Text> : null}
            </View>
          </View>
          {nextPlace && (nextTransport || nextPlace.travel_duration_minutes != null) ? <View style={styles.itineraryLeg}>
            <View style={styles.itineraryLegLine} />
            <Text style={styles.itineraryLegText}>{nextTransport?.label ?? 'Travel'}{nextPlace.travel_duration_minutes != null ? ` · ${nextPlace.travel_duration_minutes} min` : ''} to next stop</Text>
          </View> : null}
        </View>;
      })}
    </ScrollView>
  </View>;
}

export function AtlasChatMapPlacePopup({ name, address, distanceLabel, origin, destination, saved, saving, onToggleSaved }: ChatMapPlacePopupProps) {
  const openPlace = () => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${destination[1]},${destination[0]}`)}`;
    Linking.openURL(url).catch((error) => console.warn('[AtlasChatMap] could not open Google Maps place:', error));
  };

  const openDirections = () => {
    const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(`${origin[1]},${origin[0]}`)}&destination=${encodeURIComponent(`${destination[1]},${destination[0]}`)}&travelmode=driving`;
    Linking.openURL(url).catch((error) => console.warn('[AtlasChatMap] could not open Google Maps directions:', error));
  };

  return <View style={styles.placePopup}>
    <Pressable accessibilityRole="button" accessibilityLabel={saved ? `Remove ${name} from My Places` : `Save ${name} to My Places`} accessibilityState={{ busy: saving, selected: saved }} disabled={saving} onPress={onToggleSaved} style={({ pressed }) => [styles.saveButton, saved && styles.removeButton, saving && styles.buttonDisabled, pressed && !saving && styles.controlPressed]}>
      {saved ? <MinusIcon size={19} weight="bold" color="#FFFFFF" /> : saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <BookmarkIcon size={18} weight="fill" color="#FFFFFF" />}
    </Pressable>
    <View style={styles.placeCopy}>
      <Text numberOfLines={1} style={styles.placeName}>{name}</Text>
      {address ? <Text numberOfLines={2} style={styles.placeAddress}>{address}</Text> : null}
      <Text style={styles.placeDistance}>{distanceLabel} from you</Text>
    </View>
    <View style={styles.placeActions}>
      <Pressable accessibilityRole="link" accessibilityLabel={`View ${name} in Google Maps`} onPress={openPlace} style={({ pressed }) => [styles.directionsButton, styles.googleMapsButton, pressed && styles.controlPressed]}>
        <Image source={GOOGLE_MAPS_ICON} style={styles.googleMapsIcon} />
      </Pressable>
      <Pressable accessibilityRole="link" accessibilityLabel={`Navigate to ${name} in Google Maps`} onPress={openDirections} style={({ pressed }) => [styles.directionsButton, pressed && styles.controlPressed]}>
        <NavigationArrowIcon size={18} weight="bold" color="#FFFFFF" />
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  controlLayer: { ...StyleSheet.absoluteFill },
  header: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  returnButton: { minHeight: 42, paddingHorizontal: 14, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.96)', flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(24,24,27,0.14)', shadowColor: '#18181B', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  returnText: { color: '#18181B', fontSize: 14, lineHeight: 19, fontWeight: '700' },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.96)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(24,24,27,0.14)', shadowColor: '#18181B', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  controlPressed: { transform: [{ scale: 0.96 }], opacity: 0.86 },
  noticeLayer: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 31 },
  notice: { alignItems: 'center' },
  noticeText: { minHeight: 34, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 17, backgroundColor: 'rgba(24,24,27,0.94)', color: '#FFFFFF', fontSize: 13, lineHeight: 18, fontWeight: '700', overflow: 'hidden' },
  placePopupLayer: { position: 'absolute', left: 16, right: 16, bottom: 150, alignItems: 'center', zIndex: 30 },
  placePopupAboveItinerary: { bottom: 322 },
  itineraryLayer: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20 },
  itineraryPanel: { maxHeight: 304, paddingTop: 8, paddingHorizontal: 16, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: 'rgba(255,255,255,0.98)', borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#E2E5E8', shadowColor: '#111827', shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: -5 }, elevation: 9 },
  itineraryHandle: { alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: '#D8DCE0', marginBottom: 8 },
  itineraryHeader: { flexDirection: 'row', alignItems: 'center', paddingBottom: 7 },
  itineraryHeaderCopy: { flex: 1, minWidth: 0 },
  itineraryTitle: { color: '#202024', fontSize: 17, lineHeight: 22, fontWeight: '800' },
  itinerarySubtitle: { color: '#85858C', fontSize: 12, lineHeight: 17, marginTop: 1 },
  planningNote: { color: '#667085', fontSize: 12, lineHeight: 17, paddingBottom: 7 },
  itineraryList: { paddingBottom: 16 },
  itineraryEntry: { position: 'relative' },
  itineraryEntryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  itineraryNumber: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E77B32', marginTop: 1 },
  itineraryNumberText: { color: '#FFFFFF', fontSize: 11, lineHeight: 14, fontWeight: '800' },
  itineraryEntryCopy: { flex: 1, minWidth: 0, paddingBottom: 3 },
  itineraryMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5, marginBottom: 3 },
  timeTag: { minHeight: 23, paddingHorizontal: 7, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EAF4FF' },
  timeTagText: { color: '#2677B5', fontSize: 11, lineHeight: 15, fontWeight: '700' },
  transportTag: { minHeight: 23, paddingHorizontal: 7, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F1F4F5' },
  transportTagText: { color: '#64748B', fontSize: 11, lineHeight: 15, fontWeight: '700' },
  itineraryPlaceName: { color: '#202024', fontSize: 14, lineHeight: 19, fontWeight: '700' },
  itineraryAddress: { color: '#85858C', fontSize: 11, lineHeight: 16, marginTop: 1 },
  itineraryLeg: { minHeight: 23, marginLeft: 11, paddingLeft: 22, paddingTop: 3, paddingBottom: 3, justifyContent: 'center' },
  itineraryLegLine: { position: 'absolute', left: 0, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: '#DDE2E7' },
  itineraryLegText: { color: '#8A8A91', fontSize: 10, lineHeight: 14 },
  placePopup: { width: '100%', maxWidth: 312, minHeight: 76, paddingHorizontal: 15, paddingVertical: 13, borderRadius: 14, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 10, shadowColor: '#111827', shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 8 },
  saveButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#16A34A' },
  removeButton: { backgroundColor: '#64748B' },
  buttonDisabled: { opacity: 0.6 },
  placeCopy: { flex: 1, minWidth: 0, gap: 2 },
  placeName: { color: '#18181B', fontSize: 14, lineHeight: 19, fontWeight: '800' },
  placeAddress: { color: '#52525B', fontSize: 12, lineHeight: 16 },
  placeDistance: { color: '#127A52', fontSize: 12, lineHeight: 16, fontWeight: '700', marginTop: 2 },
  placeActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  directionsButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#16A34A' },
  googleMapsButton: { backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: '#DADCE0' },
  googleMapsIcon: { width: 25, height: 25, resizeMode: 'contain' },
});
