import { ArrowLeftIcon } from 'phosphor-react-native/src/icons/ArrowLeft';
import { EyeIcon } from 'phosphor-react-native/src/icons/Eye';
import { EyeSlashIcon } from 'phosphor-react-native/src/icons/EyeSlash';
import { GitBranchIcon } from 'phosphor-react-native/src/icons/GitBranch';
import { MapTrifoldIcon } from 'phosphor-react-native/src/icons/MapTrifold';
import { MinusIcon } from 'phosphor-react-native/src/icons/Minus';
import { NavigationArrowIcon } from 'phosphor-react-native/src/icons/NavigationArrow';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';

import { Text } from '@/components/ui/text';

type ChatMapControlsProps = {
  topInset: number;
  routeVisible: boolean;
  routeLoading: boolean;
  routeAvailable: boolean;
  onReturn: () => void;
  onClose: () => void;
  onToggleRoute: () => void;
  placePopup?: ReactNode;
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

export function AtlasChatMapControls({ topInset, routeVisible, routeLoading, routeAvailable, onReturn, onClose, onToggleRoute, placePopup, notice }: ChatMapControlsProps) {
  const RouteIcon = routeVisible ? EyeSlashIcon : routeAvailable ? GitBranchIcon : EyeIcon;
  const routeLabel = routeVisible ? 'Hide route' : 'Show route';

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
    {notice ? <View pointerEvents="none" style={[styles.notice, { top: topInset + 62 }]}><Text style={styles.noticeText}>{notice}</Text></View> : null}
    <View pointerEvents="box-none" style={styles.routeLayer}>
      <Pressable accessibilityRole="button" accessibilityLabel={routeLabel} accessibilityState={{ busy: routeLoading }} disabled={routeLoading || !routeAvailable} onPress={onToggleRoute} style={({ pressed }) => [styles.routeButton, pressed && !routeLoading && routeAvailable && styles.controlPressed, (!routeAvailable || routeLoading) && styles.routeButtonDisabled]}>
        {routeLoading ? <ActivityIndicator size="small" color="#127A52" /> : <RouteIcon size={17} weight="bold" color="#127A52" />}
        <Text style={styles.routeText}>{routeLabel}</Text>
      </Pressable>
    </View>
    {placePopup ? <View pointerEvents="box-none" style={styles.placePopupLayer}><View pointerEvents="auto">{placePopup}</View></View> : null}
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
      {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : saved ? <MinusIcon size={19} weight="bold" color="#FFFFFF" /> : <PlusIcon size={19} weight="bold" color="#FFFFFF" />}
    </Pressable>
    <View style={styles.placeCopy}>
      <Text numberOfLines={1} style={styles.placeName}>{name}</Text>
      {address ? <Text numberOfLines={2} style={styles.placeAddress}>{address}</Text> : null}
      <Text style={styles.placeDistance}>{distanceLabel} from you</Text>
    </View>
    <View style={styles.placeActions}>
      <Pressable accessibilityRole="link" accessibilityLabel={`View ${name} in Google Maps`} onPress={openPlace} style={({ pressed }) => [styles.directionsButton, pressed && styles.controlPressed]}>
        <MapTrifoldIcon size={18} weight="bold" color="#FFFFFF" />
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
  routeLayer: { position: 'absolute', right: 16, bottom: 42 },
  routeButton: { minHeight: 44, paddingHorizontal: 15, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.96)', flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(18,122,82,0.24)', shadowColor: '#18181B', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  routeButtonDisabled: { opacity: 0.56 },
  routeText: { color: '#127A52', fontSize: 14, lineHeight: 19, fontWeight: '700' },
  controlPressed: { transform: [{ scale: 0.96 }], opacity: 0.86 },
  notice: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 31 },
  noticeText: { minHeight: 34, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 17, backgroundColor: 'rgba(24,24,27,0.94)', color: '#FFFFFF', fontSize: 13, lineHeight: 18, fontWeight: '700', overflow: 'hidden' },
  placePopupLayer: { position: 'absolute', left: 16, right: 16, bottom: '56%', alignItems: 'center', zIndex: 30 },
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
});
