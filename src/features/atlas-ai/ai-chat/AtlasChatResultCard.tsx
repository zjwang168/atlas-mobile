import MapboxMap, { type MapMarker } from '@/features/map/MapboxMap';
import type { AtlasChatPresentation } from '@/services/api/apiService';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { MapTrifoldIcon } from 'phosphor-react-native/src/icons/MapTrifold';
import { NavigationArrowIcon } from 'phosphor-react-native/src/icons/NavigationArrow';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { Image, Linking, Pressable, StyleSheet, View, type ImageStyle } from 'react-native';
import { Text } from '@/components/ui/text';

const GOOGLE_MAPS_ICON = require('../../../../assets/icons/google-maps2.png');

type Props = {
  presentation: AtlasChatPresentation;
  pendingAction?: {
    action_id: string;
    kind: 'save_places' | 'create_atlas' | 'save_special_place' | 'delete_special_place';
    title: string;
    places: AtlasChatPresentation['places'];
    special_role?: 'home' | 'office' | 'school' | null;
    operation?: 'create' | 'update' | 'delete' | null;
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

export default function AtlasChatResultCard({ presentation, pendingAction, onConfirm, onCancel, onOpenMap }: Props) {
  const hasPendingAction = Boolean(pendingAction);
  const featuredPlace = presentation.places[0];
  const specialPlaceName = pendingAction?.places[0]?.name?.trim();
  const specialRole = pendingAction?.special_role;
  const hasSinglePlace = presentation.places.length === 1 && Boolean(featuredPlace);
  const placeSubtitle = featuredPlace
    ? [featuredPlace.category, featuredPlace.full_address || featuredPlace.description]
      .filter(Boolean)
      .join(' · ')
    : '';
  const mapPlaces = [...(presentation.special_places ?? []), ...presentation.places];
  const commuteRoute = presentation.commute_route?.route;
  const markers: MapMarker[] = [
    ...(presentation.user_location ? [{
      id: 'chat-user-location',
      latitude: presentation.user_location.latitude,
      longitude: presentation.user_location.longitude,
      tone: 'location' as const,
      pulsing: true,
    }] : []),
    ...(presentation.special_places ?? []).map((place) => ({
      id: `chat-special-${place.role}`,
      latitude: place.latitude,
      longitude: place.longitude,
      title: place.name || place.role[0].toUpperCase() + place.role.slice(1),
      tone: commuteRoute ? 'atlas' as const : place.role,
    })),
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
            bounds={boundsForPlaces(mapPlaces, presentation.user_location)}
            padding={{
              paddingTop: 56,
              paddingRight: 24,
              paddingBottom: featuredPlace ? 94 : 24,
              paddingLeft: 24,
            }}
            cameraKey={presentation.kind + ':' + presentation.title + ':' + presentation.places.map((place) => place.name).join('|')}
            routeGeoJSON={commuteRoute ?? presentation.route?.route}
            routeVariant={commuteRoute ? 'commute' : undefined}
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
      {hasPendingAction ? (
        <View style={styles.confirmRow}>
          <Text style={styles.confirmText}>{pendingAction?.kind === 'create_atlas' ? 'Ready to create this Atlas?' : pendingAction?.kind === 'delete_special_place' ? `Delete your ${specialRole}?` : pendingAction?.kind === 'save_special_place' ? `${pendingAction.operation === 'update' ? 'Replace' : 'Save'} ${specialPlaceName || 'this location'} as your ${specialRole}?` : 'Ready to add these places?'}</Text>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel proposed action" onPress={onCancel} style={styles.cancelButton}>
              <XIcon size={17} color="#52525B" weight="bold" />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Confirm proposed action" onPress={onConfirm} style={styles.confirmButton}>
              <CheckIcon size={17} color="#FFFFFF" weight="bold" />
              <Text style={styles.confirmButtonText}>{pendingAction?.kind === 'create_atlas' ? 'Create' : pendingAction?.kind === 'delete_special_place' ? 'Delete' : pendingAction?.kind === 'save_special_place' ? 'Save' : 'Add'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {hasSinglePlace ? (
        <View style={styles.googleMapsRow}>
          <Text style={styles.googleMapsPrompt}>Check {featuredPlace!.name} on Google Maps?</Text>
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
  actionPressed: { transform: [{ scale: 0.95 }], opacity: 0.86 },
});
