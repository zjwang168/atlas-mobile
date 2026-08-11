import { ArrowLeftIcon } from 'phosphor-react-native/src/icons/ArrowLeft';
import { BookmarkIcon } from 'phosphor-react-native/src/icons/Bookmark';
import { MinusIcon } from 'phosphor-react-native/src/icons/Minus';
import { NavigationArrowIcon } from 'phosphor-react-native/src/icons/NavigationArrow';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { ActivityIndicator, Animated, Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Text } from '@/components/ui/text';

const GOOGLE_MAPS_ICON = require('../../../../assets/icons/google-maps2.png');

type ChatMapControlsProps = {
  topInset: number;
  onReturn: () => void;
  onClose: () => void;
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

export function AtlasChatMapControls({ topInset, onReturn, onClose, placePopup, notice }: ChatMapControlsProps) {
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
    <View pointerEvents="box-none" style={styles.placePopupLayer}><MapPlacePopupTransition content={placePopup} /></View>
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
