import { BlurView } from 'expo-blur';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
  type BottomSheetBackgroundProps,
} from '@gorhom/bottom-sheet';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PanelGrabber from './PanelGrabber';
import { useContentPanelSnapGroup } from './ContentPanelSnapProvider';

export type SnapState = 'compact' | 'short' | 'default' | 'tall' | 'full';

export type ContentPanelRenderProps = {
  snapState: SnapState;
  snapTo: (state: SnapState, animated?: boolean) => void;
  setCompactHeight: (height: number) => void;
  reportScrollY: (y: number) => void;
  bottomInset: number;
};

type CompactContentRenderProps = {
  snapTo: (state: SnapState, animated?: boolean) => void;
};

type ContentPanelProps = {
  children: (props: ContentPanelRenderProps) => React.ReactNode;
  compactContent?: (props: CompactContentRenderProps) => React.ReactNode;
  initialSnap?: SnapState;
  snapGroup?: string;
  snapState?: SnapState;
  onSnapStateChange?: (state: SnapState) => void;
  visible?: boolean;
  onHidden?: () => void;
  zIndex?: number;
  height?: number;
  defaultSnapHeight?: number;
  maxHeight?: number;
  onHeightChange?: (height: number) => void;
  frosted?: boolean;
  showHandle?: boolean;
  allowedSnaps?: SnapState[];
  snapPointHeights?: Partial<Record<SnapState, number>>;
  edgeToEdgeHeight?: number;
  preserveTopRadius?: boolean;
  minSnap?: SnapState;
};

const SCREEN_HEIGHT = Dimensions.get('window').height;
const HANDLE_HEIGHT = 24;
const FLOATING_GAP = 8;
const SNAP_STATES: SnapState[] = ['short', 'default', 'tall'];
const SNAP_POINTS = ['40%', '54%', '94%'];
const SNAP_ORDER: SnapState[] = ['compact', 'short', 'default', 'tall', 'full'];

export const SNAP_HEIGHTS: Record<SnapState, number> = {
  compact: HANDLE_HEIGHT + 40,
  short: SCREEN_HEIGHT * 0.40,
  default: SCREEN_HEIGHT * 0.54,
  tall: SCREEN_HEIGHT * 0.94,
  full: SCREEN_HEIGHT * 0.94,
};

function snapRank(state: SnapState): number {
  return SNAP_ORDER.indexOf(state);
}

function toPanelSnapState(state: SnapState): SnapState {
  if (state === 'compact') return 'short';
  if (state === 'full') return 'tall';
  return state;
}

function normalizeToAllowedSnap(state: SnapState, allowedSnaps: SnapState[]): SnapState {
  const normalized = toPanelSnapState(state);
  if (allowedSnaps.includes(normalized)) return normalized;
  return allowedSnaps.reduce((nearest, candidate) => {
    const nearestDistance = Math.abs(snapRank(nearest) - snapRank(normalized));
    const candidateDistance = Math.abs(snapRank(candidate) - snapRank(normalized));
    return candidateDistance < nearestDistance ? candidate : nearest;
  });
}

function resolveAllowedSnaps(allowedSnaps?: SnapState[], minSnap?: SnapState): SnapState[] {
  const floor = toPanelSnapState(minSnap ?? 'short');
  const requested = allowedSnaps?.map(toPanelSnapState) ?? SNAP_STATES;
  const states = SNAP_STATES.filter(
    (state) => requested.includes(state) && snapRank(state) >= snapRank(floor),
  );
  return states.length > 0 ? states : SNAP_STATES;
}

function PlacesSheetBackground({ style, frosted }: BottomSheetBackgroundProps & { frosted: boolean }) {
  return (
    <Animated.View pointerEvents="none" style={[style, styles.background]}>
      {frosted ? (
        <BlurView
          pointerEvents="none"
          tint="systemUltraThinMaterialLight"
          intensity={16}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          frosted ? styles.backgroundFrost : styles.backgroundSolid,
        ]}
      />
    </Animated.View>
  );
}

export default function ContentPanel({
  children,
  initialSnap = 'default',
  snapGroup,
  snapState: controlledSnapState,
  onSnapStateChange,
  visible = true,
  onHidden,
  zIndex,
  height,
  onHeightChange,
  frosted = true,
  showHandle = false,
  allowedSnaps,
  minSnap,
}: ContentPanelProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [localSnapState, setLocalSnapState] = useState<SnapState>(toPanelSnapState(initialSnap));
  const activeSnapGroup = controlledSnapState === undefined ? snapGroup : undefined;
  const [groupSnapState, setGroupSnapState] = useContentPanelSnapGroup(activeSnapGroup, toPanelSnapState(initialSnap));
  const animatedIndex = useSharedValue(0);
  const animatedPosition = useSharedValue(screenHeight);

  const resolvedSnaps = useMemo(
    () => (height === undefined ? resolveAllowedSnaps(allowedSnaps, minSnap) : (['default'] as SnapState[])),
    [allowedSnaps, height, minSnap],
  );

  const snapPoints = useMemo(() => {
    if (height !== undefined) return [Math.max(1, Math.round(height))];
    return resolvedSnaps.map((state) => SNAP_POINTS[SNAP_STATES.indexOf(state)]);
  }, [height, resolvedSnaps]);

  const currentSnapState = useMemo(() => {
    const inherited = controlledSnapState ?? (activeSnapGroup ? groupSnapState : localSnapState);
    return normalizeToAllowedSnap(inherited, resolvedSnaps);
  }, [activeSnapGroup, controlledSnapState, groupSnapState, localSnapState, resolvedSnaps]);

  const currentIndex = visible ? Math.max(0, resolvedSnaps.indexOf(currentSnapState)) : -1;

  const updateSnapState = useCallback((state: SnapState) => {
    const normalized = normalizeToAllowedSnap(state, resolvedSnaps);
    setLocalSnapState(normalized);
    setGroupSnapState(normalized);
    onSnapStateChange?.(normalized);
  }, [onSnapStateChange, resolvedSnaps, setGroupSnapState]);

  const snapTo = useCallback((state: SnapState) => {
    const normalized = normalizeToAllowedSnap(state, resolvedSnaps);
    const nextIndex = resolvedSnaps.indexOf(normalized);
    updateSnapState(normalized);
    if (visible && nextIndex >= 0) sheetRef.current?.snapToIndex(nextIndex);
  }, [resolvedSnaps, updateSnapState, visible]);

  const handleGrabberDragEnd = useCallback((translationY: number) => {
    const currentIndex = resolvedSnaps.indexOf(currentSnapState);
    const direction = translationY < 0 ? 1 : -1;
    const nextState = resolvedSnaps[currentIndex + direction];
    if (nextState) snapTo(nextState);
  }, [currentSnapState, resolvedSnaps, snapTo]);

  const reportHeight = useCallback((panelHeight: number) => {
    onHeightChange?.(Math.max(0, panelHeight));
  }, [onHeightChange]);

  useAnimatedReaction(
    () => screenHeight - animatedPosition.value,
    (panelHeight, previousHeight) => {
      if (previousHeight === null || Math.abs(panelHeight - previousHeight) > 0.5) {
        runOnJS(reportHeight)(panelHeight);
      }
    },
    [reportHeight, screenHeight],
  );

  const handleChange = useCallback((index: number) => {
    if (index < 0) {
      onHidden?.();
      return;
    }
    const next = resolvedSnaps[index];
    if (next) updateSnapState(next);
  }, [onHidden, resolvedSnaps, updateSnapState]);

  const handleClose = useCallback(() => {
    onHidden?.();
  }, [onHidden]);

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          animatedIndex.value,
          [0, Math.max(0, snapPoints.length - 2), Math.max(0, snapPoints.length - 1)],
          [0, 0, FLOATING_GAP],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const sheetAnimatedStyle = useAnimatedStyle(() => {
    const lastIndex = Math.max(0, snapPoints.length - 1);
    return {
      marginHorizontal: interpolate(
        animatedIndex.value,
        [0, lastIndex],
        [FLOATING_GAP, 0],
        Extrapolation.CLAMP,
      ),
      borderTopLeftRadius: 36,
      borderTopRightRadius: 36,
      borderBottomLeftRadius: interpolate(
        animatedIndex.value,
        [0, lastIndex],
        [48, 0],
        Extrapolation.CLAMP,
      ),
      borderBottomRightRadius: interpolate(
        animatedIndex.value,
        [0, lastIndex],
        [48, 0],
        Extrapolation.CLAMP,
      ),
    };
  });

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={Math.max(1, snapPoints.length - 1)}
        disappearsOnIndex={Math.max(0, snapPoints.length - 2)}
        opacity={0.22}
        pressBehavior="none"
      />
    ),
    [snapPoints.length],
  );

  const renderBackground = useCallback(
    (props: BottomSheetBackgroundProps) => <PlacesSheetBackground {...props} frosted={frosted} />,
    [frosted],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={currentIndex}
      snapPoints={snapPoints}
      animatedIndex={animatedIndex}
      animatedPosition={animatedPosition}
      detached
      bottomInset={FLOATING_GAP}
      containerStyle={[
        containerAnimatedStyle as unknown as StyleProp<ViewStyle>,
        zIndex === undefined ? undefined : { zIndex },
      ]}
      enableDynamicSizing={false}
      enablePanDownToClose={false}
      enableOverDrag={false}
      enableContentPanningGesture={false}
      handleComponent={null}
      onChange={handleChange}
      onClose={handleClose}
      backdropComponent={renderBackdrop}
      backgroundComponent={renderBackground}
      style={[styles.sheetShell, sheetAnimatedStyle]}
    >
      <BottomSheetView style={styles.content}>
        <PanelGrabber onDragEnd={handleGrabberDragEnd} />
        {children({
          snapState: currentSnapState,
          snapTo,
          setCompactHeight: () => {},
          reportScrollY: () => {},
          bottomInset: insets.bottom,
        })}
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetShell: {
    overflow: 'hidden',
    boxShadow: '0 -2px 22px rgba(0,0,0,0.08)',
  },
  background: {
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  backgroundFrost: {
    backgroundColor: 'rgba(255,255,255,0.90)',
  },
  backgroundSolid: {
    backgroundColor: '#FFFFFF',
  },
  content: {
    flex: 1,
  },
});
