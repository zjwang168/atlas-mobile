import MapboxMap, { type MapMarker } from '@/features/map/MapboxMap';
import type { AtlasChatPresentation, AtlasTransportMode } from '@/services/api/apiService';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { MapTrifoldIcon } from 'phosphor-react-native/src/icons/MapTrifold';
import { NavigationArrowIcon } from 'phosphor-react-native/src/icons/NavigationArrow';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Linking, Pressable, StyleSheet, View, type ImageStyle } from 'react-native';
import { Text } from '@/components/ui/text';

const GOOGLE_MAPS_ICON = require('../../../../assets/icons/google-maps2.png');

type Props = {
  presentation: AtlasChatPresentation;
  pendingAction?: {
    action_id: string;
    kind: 'save_places' | 'create_atlas';
    title: string;
    places: AtlasChatPresentation['places'];
  } | null;
  onConfirm?: () => void;
  onCancel?: () => void;
  onOpenMap?: () => void;
};

const PLACE_IMAGE_STYLE: ImageStyle = {
  width: 56,
  height: 56,
  borderRadius: 16,
  backgroundColor: '#E7E7E7',
};

const TRANSPORT_PRESENTATION: Record<AtlasTransportMode, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  walk: { label: 'Walk', icon: 'walk-outline' },
  bike: { label: 'Bike', icon: 'bicycle-outline' },
  drive: { label: 'Drive', icon: 'car-outline' },
  taxi: { label: 'Taxi', icon: 'car-sport-outline' },
  bus: { label: 'Bus', icon: 'bus-outline' },
  coach: { label: 'Coach', icon: 'bus-outline' },
  subway: { label: 'Subway', icon: 'train-outline' },
  train: { label: 'Train', icon: 'train-outline' },
  ferry: { label: 'Ferry', icon: 'boat-outline' },
  flight: { label: 'Flight', icon: 'airplane-outline' },
};

function boundsForPlaces(places: AtlasChatPresentation['places'], userLocation?: AtlasChatPresentation['user_location']) {
  const outcomeCoordinates = places.map(
    (place) => [place.longitude, place.latitude] as [number, number],
  );
  const coordinates = [
    ...outcomeCoordinates,
    ...(userLocation ? [[userLocation.longitude, userLocation.latitude] as [number, number]] : []),
  ];
  // With a single outcome, add a reflected coordinate so that result itself
  // stays centered while the user's green location marker remains in frame.
  if (outcomeCoordinates.length === 1 && userLocation) {
    const [outcomeLongitude, outcomeLatitude] = outcomeCoordinates[0];
    coordinates.push([
      outcomeLongitude * 2 - userLocation.longitude,
      outcomeLatitude * 2 - userLocation.latitude,
    ]);
  }
  if (!coordinates.length) return undefined;
  const longitudes = coordinates.map(([longitude]) => longitude);
  const latitudes = coordinates.map(([, latitude]) => latitude);
  const west = Math.min(...longitudes);
  const east = Math.max(...longitudes);
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  const lngPad = Math.max(0.003, (east - west) * 0.24);
  const latPad = Math.max(0.003, (north - south) * 0.24);
  return { ne: [east + lngPad, north + latPad] as [number, number], sw: [west - lngPad, south - latPad] as [number, number] };
}

function AtlasItineraryPreview({ presentation }: { presentation: AtlasChatPresentation }) {
  if (presentation.kind !== 'atlas_draft' || !presentation.places.length) return null;
  return <View style={styles.itineraryPreview}>
    <View style={styles.itineraryHeader}>
      <Text style={styles.itineraryTitle}>Itinerary preview</Text>
      <Text style={styles.itineraryCount}>{presentation.places.length} stops</Text>
    </View>
    {presentation.planning_note ? <Text style={styles.planningNote}>{presentation.planning_note}</Text> : null}
    {presentation.places.map((place, index) => {
      const transport = place.transport ? TRANSPORT_PRESENTATION[place.transport] : null;
      const nextPlace = presentation.places[index + 1];
      const legTransport = nextPlace?.transport ? TRANSPORT_PRESENTATION[nextPlace.transport] : null;
      return <View key={place.external_id || `${place.name}-${index}`} style={styles.itineraryEntry}>
        <View style={styles.itineraryEntryRow}>
          <View style={styles.itineraryNumber}><Text style={styles.itineraryNumberText}>{index + 1}</Text></View>
          <View style={styles.itineraryEntryCopy}>
            {(place.timeline_time || transport) ? <View style={styles.itineraryMeta}>
              {place.timeline_time ? <View style={styles.timeTag}><Ionicons name="time-outline" size={12} color="#2677B5" /><Text style={styles.timeTagText}>{place.timeline_day ? `Day ${place.timeline_day} · ` : ''}{place.timeline_time}</Text></View> : null}
              {transport ? <View style={styles.transportTag}><Ionicons name={transport.icon} size={12} color="#64748B" /><Text style={styles.transportTagText}>{transport.label}</Text></View> : null}
            </View> : null}
            <Text numberOfLines={1} style={styles.itineraryPlaceName}>{place.name}</Text>
            {place.full_address ? <Text numberOfLines={1} style={styles.itineraryAddress}>{place.full_address}</Text> : null}
          </View>
        </View>
        {nextPlace && (legTransport || nextPlace.travel_duration_minutes != null) ? <View style={styles.itineraryLeg}>
          <View style={styles.itineraryLegLine} />
          <Text style={styles.itineraryLegText}>{legTransport?.label ?? 'Travel'}{nextPlace.travel_duration_minutes != null ? ` · ${nextPlace.travel_duration_minutes} min` : ''} to next stop</Text>
        </View> : null}
      </View>;
    })}
  </View>;
}

export default function AtlasChatResultCard({ presentation, pendingAction, onConfirm, onCancel, onOpenMap }: Props) {
  const hasPendingAction = Boolean(pendingAction);
  const featuredPlace = presentation.places[0];
  const hasSinglePlace = presentation.places.length === 1 && Boolean(featuredPlace);
  const placeSubtitle = featuredPlace
    ? [featuredPlace.category, featuredPlace.full_address || featuredPlace.description]
      .filter(Boolean)
      .join(' · ')
    : '';
  const markers: MapMarker[] = [
    ...(presentation.user_location ? [{
      id: 'chat-user-location',
      latitude: presentation.user_location.latitude,
      longitude: presentation.user_location.longitude,
      tone: 'location' as const,
      pulsing: true,
    }] : []),
    ...presentation.places.map((place, index) => ({
      id: place.external_id || 'chat-place-' + index,
      latitude: place.latitude,
      longitude: place.longitude,
      tone: 'recommended' as const,
    })),
  ];
  const openPlaceInGoogleMaps = () => {
    if (!featuredPlace) return;
    const destination = `${featuredPlace.latitude},${featuredPlace.longitude}`;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`;
    Linking.openURL(url).catch((error) => console.warn('[AtlasChatResultCard] could not open Google Maps place:', error));
  };
  const openDirectionsInGoogleMaps = () => {
    if (!featuredPlace) return;
    const destination = `${featuredPlace.latitude},${featuredPlace.longitude}`;
    const origin = presentation.user_location
      ? `&origin=${encodeURIComponent(`${presentation.user_location.latitude},${presentation.user_location.longitude}`)}`
      : '';
    const url = `https://www.google.com/maps/dir/?api=1${origin}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    Linking.openURL(url).catch((error) => console.warn('[AtlasChatResultCard] could not open Google Maps directions:', error));
  };

  return (
    <View style={styles.card}>
      <View style={styles.mapPreview}>
        <View pointerEvents="none" style={styles.mapPreviewContent}>
          <MapboxMap
            markers={markers}
            bounds={boundsForPlaces(presentation.places, presentation.user_location)}
            padding={{
              paddingTop: 56,
              paddingRight: 24,
              paddingBottom: featuredPlace ? 94 : 24,
              paddingLeft: 24,
            }}
            cameraKey={presentation.kind + ':' + presentation.title + ':' + presentation.places.map((place) => place.name).join('|')}
            routeGeoJSON={presentation.route?.route}
            style={styles.map}
            compassEnabled={false}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open map for ${presentation.title}`}
          onPress={onOpenMap}
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={styles.mapCaption}>
          <MapTrifoldIcon size={15} color="#191919" weight="bold" />
          <Text numberOfLines={1} style={styles.mapCaptionText}>{presentation.title}</Text>
        </View>
        <View pointerEvents="none" style={styles.openMapButton}>
          <MapTrifoldIcon size={19} color="#191919" weight="bold" />
        </View>
        {featuredPlace ? (
          <View pointerEvents="none" style={styles.placeSummary}>
            {featuredPlace.photo_url ? (
              <Image source={{ uri: featuredPlace.photo_url }} style={PLACE_IMAGE_STYLE} />
            ) : (
              <View style={styles.placeImageFallback}>
                <Text style={styles.placeImageFallbackText}>1</Text>
              </View>
            )}
            <View style={styles.placeCopy}>
              <Text numberOfLines={1} style={styles.placeName}>{featuredPlace.name}</Text>
              {placeSubtitle ? <Text numberOfLines={2} style={styles.placeSubtitle}>{placeSubtitle}</Text> : null}
            </View>
          </View>
        ) : null}
      </View>
      <AtlasItineraryPreview presentation={presentation} />
      {hasPendingAction ? (
        <View style={styles.confirmRow}>
          <Text style={styles.confirmText}>{pendingAction?.kind === 'create_atlas' ? 'Ready to create this Atlas?' : 'Ready to add these places?'}</Text>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel proposed action" onPress={onCancel} style={styles.cancelButton}>
              <XIcon size={17} color="#52525B" weight="bold" />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Confirm proposed action" onPress={onConfirm} style={styles.confirmButton}>
              <CheckIcon size={17} color="#FFFFFF" weight="bold" />
              <Text style={styles.confirmButtonText}>{pendingAction?.kind === 'create_atlas' ? 'Create' : 'Add'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {hasSinglePlace ? (
        <View style={styles.googleMapsRow}>
          <Text style={styles.googleMapsPrompt}>Check it on Google Maps?</Text>
          <View style={styles.googleMapsActions}>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`View ${featuredPlace!.name} in Google Maps`}
              onPress={openPlaceInGoogleMaps}
              style={({ pressed }) => [styles.googleMapsAction, styles.googleMapsViewAction, pressed && styles.actionPressed]}
            >
              <Image source={GOOGLE_MAPS_ICON} style={styles.googleMapsIcon} />
            </Pressable>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Navigate to ${featuredPlace!.name} in Google Maps`}
              onPress={openDirectionsInGoogleMaps}
              style={({ pressed }) => [styles.googleMapsAction, styles.googleMapsNavigateAction, pressed && styles.actionPressed]}
            >
              <NavigationArrowIcon size={18} color="#FFFFFF" weight="bold" />
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 14 },
  mapPreview: { height: 246, borderRadius: 26, overflow: 'hidden', backgroundColor: '#E9E9E7' },
  mapPreviewContent: { flex: 1 },
  map: { flex: 1, width: '100%' },
  mapCaption: { position: 'absolute', top: 12, left: 12, right: 58, minHeight: 32, paddingHorizontal: 11, borderRadius: 16, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(255,255,255,0.94)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(24,24,27,0.12)' },
  mapCaptionText: { flexShrink: 1, color: '#191919', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  openMapButton: { position: 'absolute', top: 12, right: 12, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.94)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(24,24,27,0.12)' },
  placeSummary: { position: 'absolute', left: 10, right: 10, bottom: 10, minHeight: 72, padding: 8, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.97)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(24,24,27,0.10)', shadowColor: '#18181B', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  placeImageFallback: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#DDF4E7' },
  placeImageFallbackText: { color: '#126B45', fontSize: 18, lineHeight: 22, fontWeight: '800' },
  placeCopy: { flex: 1, minWidth: 0, paddingRight: 5 },
  placeName: { color: '#18181B', fontSize: 16, lineHeight: 21, fontWeight: '700' },
  placeSubtitle: { color: '#626267', fontSize: 13, lineHeight: 18, marginTop: 2 },
  confirmRow: { minHeight: 58, paddingHorizontal: 2, paddingTop: 12, paddingBottom: 2, flexDirection: 'row', alignItems: 'center', gap: 10 },
  confirmText: { flex: 1, color: '#3F3F46', fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cancelButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F4F4F5', alignItems: 'center', justifyContent: 'center' },
  confirmButton: { minHeight: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: '#121212', flexDirection: 'row', alignItems: 'center', gap: 6 },
  confirmButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  googleMapsRow: { minHeight: 58, paddingHorizontal: 2, paddingTop: 12, paddingBottom: 2, flexDirection: 'row', alignItems: 'center', gap: 10 },
  googleMapsPrompt: { flex: 1, color: '#3F3F46', fontSize: 13, lineHeight: 18 },
  googleMapsActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  googleMapsAction: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  googleMapsViewAction: { backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: '#DADCE0' },
  googleMapsNavigateAction: { backgroundColor: '#16A34A' },
  googleMapsIcon: { width: 26, height: 26, resizeMode: 'contain' },
  itineraryPreview: { marginTop: 12, paddingHorizontal: 2 },
  itineraryHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 2, marginBottom: 8 },
  itineraryTitle: { color: '#18181B', fontSize: 15, lineHeight: 20, fontWeight: '800' },
  itineraryCount: { color: '#8A8A91', fontSize: 12, lineHeight: 17 },
  planningNote: { color: '#667085', fontSize: 12, lineHeight: 17, marginBottom: 8, paddingHorizontal: 2 },
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
  itineraryLeg: { minHeight: 26, marginLeft: 11, paddingLeft: 22, paddingTop: 4, paddingBottom: 4, justifyContent: 'center' },
  itineraryLegLine: { position: 'absolute', left: 0, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: '#DDE2E7' },
  itineraryLegText: { color: '#8A8A91', fontSize: 10, lineHeight: 14 },
  actionPressed: { transform: [{ scale: 0.95 }], opacity: 0.86 },
});
