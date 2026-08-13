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
import { type ParseResult } from '../../../services/import/importService';
import { isSamePlace } from '../../../services/place/placeService';
import { typography } from '../../../theme/typography';
import { useHomePlaces } from '../../home/HomeContext';
import MapboxMap, { type MapboxMapHandle, type MapMarker } from '../../map/MapboxMap';
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
  sessionTheme: string;
  onClose: () => void;
  onSave: (selectedIds: string[]) => void;
  onSaveAndAskAI: (selectedIds: string[]) => void;
};

function PlaceThumbnail({ uri }: { uri?: string }) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  if (!uri || failedUri === uri) return null;

  return (
    <View style={styles.rowThumb}>
      <Image source={{ uri }} style={styles.fill} onError={() => setFailedUri(uri)} />
    </View>
  );
}

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
export default function SaveScreen({ result, sessionTheme, onClose, onSave, onSaveAndAskAI }: SaveScreenProps) {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const { savedPlaces } = useHomePlaces();

  const isPlaceAlreadySaved = useCallback(
    (place: { name: string; latitude: number; longitude: number }) =>
      savedPlaces.some((s) => isSamePlace(place, s)),
    [savedPlaces],
  );

  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(result.places.map((p) => [p.id, !isPlaceAlreadySaved(p)]))
  );
  const [detailPlaceId, setDetailPlaceId] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(result.places[0]?.id ?? null);

  const selectedIds = useMemo(
    () => result.places.filter((p) => selected[p.id] && !isPlaceAlreadySaved(p)).map((p) => p.id),
    [isPlaceAlreadySaved, result.places, selected]
  );
  const selectableIds = useMemo(
    () => result.places.filter((p) => !isPlaceAlreadySaved(p)).map((p) => p.id),
    [isPlaceAlreadySaved, result.places]
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected[id]);
  const recognitionConfidence = result.places.length === 1 ? result.places[0]?.confidence : null;
  const recognizedPlaceName = result.places[0]?.name;

  const selectedPlace = result.places.find((place) => place.id === selectedPlaceId);
  const markers: MapMarker[] = useMemo(
    () =>
      result.places
        // The focused marker is green. Remove duplicate blue markers before
        // rendering so MarkerView draw order can never expose both states.
        .filter((place) => !selectedPlace || place.id === selectedPlace.id || !isSamePlace(place, selectedPlace))
        .map((place) => ({
          id: place.id,
          latitude: place.latitude,
          longitude: place.longitude,
          title: place.name,
          description: place.subtitle,
        })),
    [result.places, selectedPlace]
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
        if (isPlaceAlreadySaved(place)) {
          next[place.id] = false;
        } else if (next[place.id] === undefined) {
          next[place.id] = true;
        }
      }
      return next;
    });
  }, [isPlaceAlreadySaved, result.places]);

  // Match the home ContentPanel "default" snap geometry.
  const panelHeight = screenH * 0.55;
  const minPanelHeight = screenH * 0.34;
  const maxPanelHeight = screenH * 0.82;
  const animatedPanelHeight = useRef(new Animated.Value(panelHeight)).current;
  const screenTransition = useRef(new Animated.Value(0)).current;
  const currentPanelHeight = useRef(panelHeight);
  const startPanelHeight = useRef(panelHeight);
  const mapRef = useRef<MapboxMapHandle>(null);
  const [mapPaddingBottom, setMapPaddingBottom] = useState(panelHeight);
  const mapCenter = selectedPlace
    ? [selectedPlace.longitude, selectedPlace.latitude] as [number, number]
    : result.centerCoordinate;

  const scrollRef = useRef<ScrollView>(null);
  const rowOffsetsRef = useRef<Record<string, number>>({});
  const [measuredRows, setMeasuredRows] = useState(0);

  useEffect(() => {
    if (!selectedPlaceId) return;
    const offset = rowOffsetsRef.current[selectedPlaceId];
    if (offset !== undefined) scrollRef.current?.scrollTo({ y: offset, animated: true });
  }, [measuredRows, selectedPlaceId]);

  const mapZoom = selectedPlaceId ? 15 : 12;

  useEffect(() => {
    Animated.spring(screenTransition, {
      toValue: 1,
      damping: 20,
      stiffness: 190,
      mass: 0.74,
      useNativeDriver: true,
    }).start();
  }, [screenTransition]);

  const runExitAction = useCallback((action: (ids: string[]) => void) => {
    // Start the next surface while this sheet is fading out. Waiting for the
    // exit callback leaves a visible My Places frame before AI Chat can mount.
    action(selectedIds);
    Animated.timing(screenTransition, {
      toValue: 0,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [screenTransition, selectedIds]);

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
          mapRef.current?.setPaddingBottom(nextHeight);
        },
        onPanResponderRelease: () => setMapPaddingBottom(currentPanelHeight.current),
        onPanResponderTerminate: () => setMapPaddingBottom(currentPanelHeight.current),
      }),
    [animatedPanelHeight, maxPanelHeight, minPanelHeight],
  );

  const sentimentLabel = (sentiment?: string | null) => {
    if (sentiment === 'positive') return 'Recommended';
    if (sentiment === 'negative') return 'Not recommended';
    return 'Neutral';
  };

  return (
    <Animated.View style={[styles.container, { opacity: screenTransition }]}>
      {/* Live map background */}
      <MapboxMap
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        markers={markers}
        centerCoordinate={mapCenter}
        zoomLevel={mapZoom}
        cameraAnimationDurationMs={360}
        selectedMarkerId={selectedPlaceId}
        padding={{ paddingTop: 0, paddingBottom: mapPaddingBottom, paddingLeft: 0, paddingRight: 0 }}
        onMarkerPress={(marker) => {
          setSelectedPlaceId(marker.id);
        }}
      />

      {/* Top map blur fade — same as the home screen. */}
      <TopBlurFade height={insets.top + 64} />

      {/* Keep the completed session identifiable without falling back to a raw URL. */}
      <View style={[styles.pillWrap, { top: insets.top + 8 }]}>
        <View style={styles.pill}>
          <View style={styles.thumb}>
            <Ionicons name="compass-outline" size={17} color="#FFFFFF" />
          </View>
          <Text style={styles.pillText} numberOfLines={1}>
            {sessionTheme}
          </Text>
        </View>
      </View>

      {/* Floating results panel — matches home ContentPanel. */}
      <Animated.View
        style={[
          styles.panel,
          {
            transform: [{ translateY: screenTransition.interpolate({ inputRange: [0, 1], outputRange: [screenH * 0.42, 0] }) }],
          },
        ]}
      >
        <Animated.View style={[styles.panelContent, { height: animatedPanelHeight }]}>
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
                onLayout={(event) => {
                  const offset = event.nativeEvent.layout.y;
                  if (rowOffsetsRef.current[place.id] === offset) return;
                  rowOffsetsRef.current[place.id] = offset;
                  setMeasuredRows((count) => count + 1);
                }}
              >
                <PlaceThumbnail uri={place.imageUri} />
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
                  {isPlaceAlreadySaved(place) ? (
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
      </Animated.View>

      {/* Action bar — custom buttons (exact 52h, equal halves). The frosted
          material is the native iOS 26 Liquid Glass via GlassView; the green CTA
          is a solid prominent capsule. */}
      <Animated.View
        style={[
          styles.actionBar,
          {
            bottom: Math.max(insets.bottom, 20),
            transform: [{ translateY: screenTransition.interpolate({ inputRange: [0, 1], outputRange: [screenH * 0.18, 0] }) }],
          },
        ]}
        pointerEvents="box-none"
      >
        {recognitionConfidence != null && recognizedPlaceName ? (
          <View style={styles.recognitionNote}>
            <Ionicons name="sparkles" size={15} color={COLOR.primaryStrong} />
            <Text style={styles.recognitionNoteText} numberOfLines={2}>
              {`I have ${Math.round(recognitionConfidence * 100)}% confidence this place is ${recognizedPlaceName}. Happy exploring.`}
            </Text>
          </View>
        ) : null}
        {/* Save places — liquid-glass capsule */}
        <View style={styles.btnShadow}>
          <Pressable
            style={styles.btnGlassClip}
            onPress={() => runExitAction(onSave)}
            disabled={selectedIds.length === 0}
          >
            <GlassView style={StyleSheet.absoluteFill} glassEffectStyle="regular" isInteractive />
            <Text style={styles.btnLabelDark}>Save places</Text>
          </Pressable>
        </View>

        {/* Save and Ask AI — prominent green capsule */}
        <Pressable
          style={[styles.btnShadow, styles.btnGreen, selectedIds.length === 0 && styles.btnDisabled]}
          onPress={() => runExitAction(onSaveAndAskAI)}
          disabled={selectedIds.length === 0}
        >
          <View style={styles.askAIContent}>
            <Ionicons name="sparkles" size={16} color="#FFFFFF" />
            <Text style={styles.btnLabelLight}>Save and Ask AI</Text>
          </View>
        </Pressable>
      </Animated.View>

      {/* Teammate's place detail — opened by tapping a row. */}
      <PlaceDetail placeId={detailPlaceId} onDismiss={() => setDetailPlaceId(null)} onEdit={() => {}} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: COLOR.bg },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  // Completed import theme — matches the compact source pill in the waiting view.
  pillWrap: { position: 'absolute', left: 20, right: 20, alignItems: 'center' },
  pill: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: COLOR.bg,
    borderWidth: 1,
    borderColor: '#E5ECE8',
    borderRadius: 22,
    paddingVertical: 7,
    paddingLeft: 7,
    paddingRight: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  thumb: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLOR.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: { flexShrink: 1, ...typography.bodyEmphasis, color: COLOR.textPrimary, letterSpacing: 0 },

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
    paddingTop: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 12,
  },
  panelContent: {
    backgroundColor: COLOR.bg,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    borderBottomLeftRadius: 48,
    borderBottomRightRadius: 48,
    overflow: 'hidden',
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

  // List — photo-less places become intentional text-first rows.
  list: { flex: 1, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12 },
  rowActive: { backgroundColor: '#F2FBF6', borderRadius: 18, paddingHorizontal: 8 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLOR.divider },
  rowThumb: {
    width: 56,
    height: 56,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
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
  recognitionNote: { position: 'absolute', bottom: 64, left: 0, right: 0, minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: '#D8EEE2', shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 },
  recognitionNoteText: { flex: 1, color: COLOR.primaryStrong, fontSize: 12, lineHeight: 17, fontWeight: '600' },

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
  askAIContent: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  btnLabelLight: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
});
