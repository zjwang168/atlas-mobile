import { BlurView } from 'expo-blur';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
  type BottomSheetBackgroundProps,
} from '@gorhom/bottom-sheet';
import { memo, useCallback, useMemo, useRef, type ReactNode } from 'react';
import {
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

import { useContentPanelSnapGroup } from '@/components/content-panel/ContentPanelSnapProvider';
import type { SnapState } from '@/components/content-panel/ContentPanel';
import type { Place } from '@/types/place';
import MyPlaces, { type PlacesView } from '../my-places/MyPlaces';

const SNAP_POINTS = ['40%', '54%', '94%'];
const SNAP_STATES: SnapState[] = ['short', 'default', 'tall'];
const FLOATING_GAP = 8;
const BOTTOM_BAR_CLEARANCE = 84;

type PlacesBottomSheetProps = {
  visible: boolean;
  activeTab?: string;
  snapGroup?: string;
  activeView: PlacesView;
  onPlacePress: (place: Place) => void;
  onHeightChange?: (height: number) => void;
  onDismissed?: () => void;
  bottomBar?: ReactNode;
};

function snapStateToIndex(state: SnapState): number {
  if (state === 'compact' || state === 'short') return 0;
  if (state === 'full' || state === 'tall') return 2;
  return 1;
}

function PlacesSheetBackground({ style }: BottomSheetBackgroundProps) {
  return (
    <Animated.View pointerEvents="none" style={[style, styles.background]}>
      <BlurView
        pointerEvents="none"
        tint="systemUltraThinMaterialLight"
        intensity={16}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.backgroundFrost} />
    </Animated.View>
  );
}

function PlacesBottomSheet({
  visible,
  snapGroup,
  activeView,
  onPlacePress,
  onHeightChange,
  bottomBar,
}: PlacesBottomSheetProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const { height: screenHeight } = useWindowDimensions();
  const [groupSnapState, setGroupSnapState] = useContentPanelSnapGroup(
    snapGroup,
    'default',
  );
  const animatedIndex = useSharedValue(snapStateToIndex(groupSnapState));
  const animatedPosition = useSharedValue(screenHeight);
  const snapPoints = useMemo(() => SNAP_POINTS, []);
  const controlledIndex = visible ? snapStateToIndex(groupSnapState) : -1;

  // `bottomInset` creates the real detached gap. At the tallest snap, move the
  // hosting container down by the same amount so the panel finishes edge-to-edge.
  const containerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          animatedIndex.value,
          [0, 1, 2],
          [0, 0, FLOATING_GAP],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const sheetAnimatedStyle = useAnimatedStyle(() => {
    const index = animatedIndex.value;
    return {
      marginHorizontal: interpolate(
        index,
        [0, 1, 2],
        [FLOATING_GAP, FLOATING_GAP, 0],
        Extrapolation.CLAMP,
      ),
      borderTopLeftRadius: 36,
      borderTopRightRadius: 36,
      borderBottomLeftRadius: interpolate(
        index,
        [0, 1, 2],
        [48, 48, 0],
        Extrapolation.CLAMP,
      ),
      borderBottomRightRadius: interpolate(
        index,
        [0, 1, 2],
        [48, 48, 0],
        Extrapolation.CLAMP,
      ),
    };
  });

  const reportHeight = useCallback((height: number) => {
    onHeightChange?.(Math.max(0, height));
  }, [onHeightChange]);

  useAnimatedReaction(
    () => screenHeight - animatedPosition.value,
    (height, previousHeight) => {
      if (previousHeight === null || Math.abs(height - previousHeight) > 0.5) {
        runOnJS(reportHeight)(height);
      }
    },
    [reportHeight, screenHeight],
  );

  const handleSheetChange = useCallback((index: number) => {
    if (index < 0 || index >= SNAP_STATES.length) return;
    setGroupSnapState(SNAP_STATES[index]);
  }, [setGroupSnapState]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={2}
        disappearsOnIndex={1}
        opacity={0.22}
        pressBehavior="none"
      />
    ),
    [],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={controlledIndex}
      snapPoints={snapPoints}
      animatedIndex={animatedIndex}
      animatedPosition={animatedPosition}
      detached
      bottomInset={FLOATING_GAP}
      containerStyle={containerAnimatedStyle as unknown as StyleProp<ViewStyle>}
      enableDynamicSizing={false}
      enablePanDownToClose={false}
      enableOverDrag={false}
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      backgroundComponent={PlacesSheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      style={[styles.sheetShell, sheetAnimatedStyle]}
    >
      <BottomSheetView style={styles.content}>
        <MyPlaces
          onPlacePress={onPlacePress}
          bottomInset={BOTTOM_BAR_CLEARANCE}
          activeView={activeView}
        />
        {bottomBar}
      </BottomSheetView>
    </BottomSheet>
  );
}

export default memo(PlacesBottomSheet);

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
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255,255,255,0.90)',
  },
  handleIndicator: {
    width: 36,
    height: 5,
    backgroundColor: 'rgba(60,60,67,0.25)',
  },
  content: {
    flex: 1,
  },
});
