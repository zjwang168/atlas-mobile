import Ionicons from '@expo/vector-icons/Ionicons';
import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { GlassView } from 'expo-glass-effect';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import TopBlurFade from '../../../components/ui/top-blur-fade';
import { buildPlaceStableKey, type ParseResult } from '../../../services/import/importService';
import { typography } from '../../../theme/typography';
import { useHome } from '../../home/HomeContext';
import MapboxMap, { type MapMarker } from '../../map/MapboxMap';
import PlaceDetail from '../../place-detail/PlaceDetail';

const COLOR = {
  primary: '#12C170',
  primaryLight: '#E9FBF1',
  primaryStrong: '#0C8149',
  bg: '#FFFFFF',
  bgSecondary: '#F7F7F7',
  borderStrong: '#E0E0E0',
  textPrimary: '#1A1A1A',
  textSecondary: '#717171',
  foreground: '#09090B',
  divider: 'rgba(60,60,67,0.1)',
} as const;

type SaveScreenProps = {
  result: ParseResult;
  onClose: () => void;
  onSave: (selectedIds: string[]) => void;
  onAddToPlan: (selectedIds: string[]) => void;
};

/**
 * Results screen — *replaces* the home screen (not an overlay). Extracted places
 * sit on the live map; a floating panel matched to the home ContentPanel
 * (55% height, 8px gaps, radius 36/48) lists them.
 *
 * - Tap a row → open the (teammate's) PlaceDetail.
 * - Tap only the checkmark → toggle selection.
 *
 * Bottom actions are native iOS 26 Expo UI buttons (glass + prominent-glass).
 */
export default function SaveScreen({ result, onClose, onSave, onAddToPlan }: SaveScreenProps) {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const { savedPlaces } = useHome();

  const getPlaceKey = useCallback((place: { stableKey?: string; name: string; latitude: number; longitude: number; type: string }) => {
    return place.stableKey || buildPlaceStableKey({
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      category: place.type || '',
    });
  }, []);

  const savedKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const place of savedPlaces) {
      set.add(getPlaceKey({
        stableKey: place.stableKey,
        name: place.name,
        latitude: place.latitude,
        longitude: place.longitude,
        type: place.category || '',
      }));
    }
    return set;
  }, [getPlaceKey, savedPlaces]);

  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(result.places.map((p) => [p.id, !savedKeySet.has(getPlaceKey(p))]))
  );
  const [detailName, setDetailName] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(result.places[0]?.id ?? null);

  const selectedIds = useMemo(
    () => result.places.filter((p) => selected[p.id] && !savedKeySet.has(getPlaceKey(p))).map((p) => p.id),
    [getPlaceKey, result.places, savedKeySet, selected]
  );
  const selectableIds = useMemo(
    () => result.places.filter((p) => !savedKeySet.has(getPlaceKey(p))).map((p) => p.id),
    [getPlaceKey, result.places, savedKeySet]
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected[id]);

  const markers: MapMarker[] = useMemo(
    () =>
      result.places.map((p) => ({
        id: p.id,
        latitude: p.latitude,
        longitude: p.longitude,
        title: p.name,
        description: p.subtitle,
      })),
    [result.places]
  );

  const toggleOne = (id: string) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  const toggleAll = () =>
    setSelected((prev) => ({
      ...prev,
      ...Object.fromEntries(selectableIds.map((id) => [id, !allSelected])),
    }));

  useEffect(() => {
    setSelected((prev) => {
      const next = { ...prev };
      for (const place of result.places) {
        const key = getPlaceKey(place);
        if (savedKeySet.has(key)) {
          next[place.id] = false;
        } else if (next[place.id] === undefined) {
          next[place.id] = true;
        }
      }
      return next;
    });
  }, [getPlaceKey, result.places, savedKeySet]);

  // Match the home ContentPanel "default" snap geometry.
  const panelHeight = screenH * 0.55;
  const minPanelHeight = screenH * 0.34;
  const maxPanelHeight = screenH * 0.82;
  const animatedPanelHeight = useRef(new Animated.Value(panelHeight)).current;
  const currentPanelHeight = useRef(panelHeight);
  const startPanelHeight = useRef(panelHeight);
  const selectedPlace = result.places.find((place) => place.id === selectedPlaceId);
  const mapCenter = selectedPlace
    ? [selectedPlace.longitude, selectedPlace.latitude] as [number, number]
    : result.centerCoordinate;

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (selectedPlaceId && result.places.length > 0) {
      const idx = result.places.findIndex((p) => p.id === selectedPlaceId);
      if (idx >= 0) {
        scrollRef.current?.scrollTo({ y: idx * 76, animated: true });
      }
    }
  }, [selectedPlaceId, result.places]);

  const mapZoom = selectedPlaceId ? 15 : 12;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          startPanelHeight.current = currentPanelHeight.current;
        },
        onPanResponderMove: (_, gesture) => {
          const nextHeight = Math.max(
            minPanelHeight,
            Math.min(maxPanelHeight, startPanelHeight.current - gesture.dy),
          );
          currentPanelHeight.current = nextHeight;
          animatedPanelHeight.setValue(nextHeight);
        },
        onPanResponderRelease: () => {},
      }),
    [animatedPanelHeight, maxPanelHeight, minPanelHeight],
  );

  const sentimentLabel = (sentiment?: string | null) => {
    if (sentiment === 'positive') return 'Recommended';
    if (sentiment === 'negative') return 'Not recommended';
    return 'Neutral';
  };

  return (
    <View style={styles.container}>
      {/* Live map background */}
      <MapboxMap
        style={StyleSheet.absoluteFill}
        markers={markers}
        centerCoordinate={mapCenter}
        zoomLevel={mapZoom}
        selectedMarkerId={selectedPlaceId}
        onMarkerPress={(marker) => {
          setSelectedPlaceId(marker.id);
        }}
      />

      {/* Top map blur fade — same as the home screen. */}
      <TopBlurFade height={insets.top + 64} />

      {/* Source link pill */}
      <View style={[styles.pillWrap, { top: insets.top + 8 }]}>
        <View style={styles.pill}>
          <View style={styles.thumb}>
            {result.sourceThumbnail ? (
              <>
                <Image source={{ uri: result.sourceThumbnail }} style={styles.fill} />
                <View style={styles.thumbOverlay} />
              </>
            ) : null}
            <Ionicons name="link" size={24} color="#FFFFFF" />
          </View>
          <Text style={styles.pillText} numberOfLines={2}>
            {result.sourceTitle}
          </Text>
          <View style={styles.pillButton}>
            <Ionicons name="arrow-up" size={16} color={COLOR.textPrimary} style={styles.arrowRotate} />
          </View>
        </View>
      </View>

      {/* Floating results panel — matches home ContentPanel. */}
      <Animated.View style={[styles.panel, { height: animatedPanelHeight }]}>
        <View style={styles.dragHandleWrap} {...panResponder.panHandlers}>
          <View style={styles.dragHandle} />
        </View>
        <View style={styles.header}>
          <Text style={styles.title}>Save places</Text>
          <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.7}>
            <Ionicons name="close" size={20} color={COLOR.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{result.places.length} places</Text>
          </View>
          <TouchableOpacity onPress={toggleAll} activeOpacity={0.6} hitSlop={8}>
            <Text style={styles.deselectText}>{allSelected ? 'Deselect all' : 'Select all'}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.list}
          contentContainerStyle={{ paddingBottom: 150 }}
          showsVerticalScrollIndicator={false}
        >
          {result.places.map((place, i) => (
            <Pressable
              key={place.id}
              style={[
                styles.row,
                i > 0 && styles.rowDivider,
                selectedPlaceId === place.id && styles.rowActive,
              ]}
              onPress={() => setSelectedPlaceId(place.id)}
            >
              <View style={styles.rowThumb}>
                <View style={styles.rowThumbClip}>
                  {place.imageUri ? (
                    <Image source={{ uri: place.imageUri }} style={styles.fill} />
                  ) : (
                    <Ionicons name="image-outline" size={22} color="#B0B0B0" />
                  )}
                </View>
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {place.name}
                </Text>
                <Text style={styles.rowSubtitle} numberOfLines={2}>
                  {place.subtitle}
                </Text>
                <View style={[
                  styles.sentimentChip,
                  place.sentiment === 'positive' && styles.sentimentPositive,
                  place.sentiment === 'negative' && styles.sentimentNegative,
                ]}>
                  <Text style={styles.sentimentText}>{sentimentLabel(place.sentiment)}</Text>
                </View>
              </View>
              <View style={styles.checkWrap}>
                {savedKeySet.has(getPlaceKey(place)) ? (
                  <View style={styles.savedBadge}>
                    <Text style={styles.savedBadgeText}>Saved</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => toggleOne(place.id)}
                    hitSlop={10}
                    activeOpacity={0.7}
                    style={[styles.check, selected[place.id] ? styles.checkOn : styles.checkOff]}
                  >
                    {selected[place.id] ? <Ionicons name="checkmark" size={16} color="#FFFFFF" /> : null}
                  </TouchableOpacity>
                )}
              </View>
            </Pressable>
          ))}
        </ScrollView>

        {/* Bottom gradient-blur fade behind the buttons. */}
        <MaskedView
          style={styles.fade}
          pointerEvents="none"
          maskElement={
            <LinearGradient
              colors={['transparent', 'black']}
              locations={[0, 0.55]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <BlurView intensity={32} tint="light" style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.95)']}
            locations={[0, 0.7]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </MaskedView>
      </Animated.View>

      {/* Action bar — custom buttons (exact 52h, equal halves). The frosted
          material is the native iOS 26 Liquid Glass via GlassView; the green CTA
          is a solid prominent capsule. */}
      <View style={[styles.actionBar, { bottom: Math.max(insets.bottom, 20) }]} pointerEvents="box-none">
        {/* Add to plan — liquid-glass capsule */}
        <View style={styles.btnShadow}>
          <Pressable
            style={styles.btnGlassClip}
            onPress={() => onAddToPlan(selectedIds)}
            disabled={selectedIds.length === 0}
          >
            <GlassView style={StyleSheet.absoluteFill} glassEffectStyle="regular" isInteractive />
            <Text style={styles.btnLabelDark}>Add to plan</Text>
          </Pressable>
        </View>

        {/* Save places — prominent green capsule */}
        <Pressable
          style={[styles.btnShadow, styles.btnGreen, selectedIds.length === 0 && styles.btnDisabled]}
          onPress={() => onSave(selectedIds)}
          disabled={selectedIds.length === 0}
        >
          <Text style={styles.btnLabelLight}>Save places</Text>
        </Pressable>
      </View>

      {/* Teammate's place detail — opened by tapping a row. */}
      <PlaceDetail placeName={detailName} onDismiss={() => setDetailName(null)} onEdit={() => {}} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLOR.bg },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  // Source pill (bg-secondary, 0.5 border, radius 24; thumb 56/18; arrow btn 32)
  pillWrap: { position: 'absolute', left: 12, right: 12 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLOR.bgSecondary,
    borderWidth: 0.5,
    borderColor: COLOR.borderStrong,
    borderRadius: 24,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: '#9AA0A6',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  pillText: { flex: 1, ...typography.bodySmallEmphasis, color: COLOR.textPrimary, letterSpacing: -0.14 },
  pillButton: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowRotate: { transform: [{ rotate: '45deg' }] },

  // Floating panel — matches home ContentPanel default snap.
  panel: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    backgroundColor: COLOR.bg,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    borderBottomLeftRadius: 48,
    borderBottomRightRadius: 48,
    overflow: 'hidden',
    paddingTop: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 12,
  },
  dragHandleWrap: {
    height: 24,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 9,
  },
  dragHandle: {
    width: 48,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C7C7CC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: { ...typography.display, color: COLOR.foreground, letterSpacing: -0.28 },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  countBadge: { backgroundColor: COLOR.primaryLight, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  countText: { ...typography.subheader, color: COLOR.primaryStrong },
  deselectText: { ...typography.h3, fontWeight: '400', color: COLOR.textSecondary },

  // List — rows top-aligned; image 56/16 with soft shadow
  list: { flex: 1, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12 },
  rowActive: { backgroundColor: '#F2FBF6', borderRadius: 18, paddingHorizontal: 8 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLOR.divider },
  rowThumb: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: COLOR.bgSecondary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  rowThumbClip: {
    width: 56,
    height: 56,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 4 },
  rowName: { ...typography.h3, color: COLOR.textPrimary, letterSpacing: -0.17 },
  rowSubtitle: { ...typography.bodySmall, color: COLOR.textSecondary, letterSpacing: -0.14 },
  sentimentChip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  sentimentPositive: {
    backgroundColor: '#E9FBF1',
  },
  sentimentNegative: {
    backgroundColor: '#FDECEC',
  },
  sentimentText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLOR.textPrimary,
  },
  checkWrap: {
    alignItems: 'center',
    gap: 8,
  },
  savedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#E9FBF1',
  },
  savedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLOR.primaryStrong,
    letterSpacing: 0.2,
  },
  check: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: COLOR.primary },
  checkOff: { borderWidth: 1.5, borderColor: '#D7D7DC' },
  checkSavedDisabled: { opacity: 0.45 },

  // Bottom fade + action bar
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 130 },
  actionBar: { position: 'absolute', left: 20, right: 20, flexDirection: 'row', gap: 10 },

  // Buttons — equal halves, exact 52h capsules
  btnShadow: {
    flex: 1,
    height: 52,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 6,
  },
  btnGlassClip: {
    flex: 1,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  btnGreen: {
    backgroundColor: COLOR.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.45,
  },
  btnLabelDark: { fontSize: 16, fontWeight: '600', color: COLOR.textPrimary },
  btnLabelLight: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
