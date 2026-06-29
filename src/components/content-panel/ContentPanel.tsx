import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type SnapState = 'compact' | 'default' | 'full';

export type ContentPanelRenderProps = {
  snapState: SnapState;
  snapTo: (state: SnapState, animated?: boolean) => void;
  /** Update the compact snap height dynamically (e.g. from an onLayout callback) */
  setCompactHeight: (height: number) => void;
  /** Report current scroll position so the panel can decide when to capture drag gestures */
  reportScrollY: (y: number) => void;
  /** Safe-area bottom inset — pass to child scroll views for correct padding */
  bottomInset: number;
};

type CompactContentRenderProps = {
  snapTo: (state: SnapState, animated?: boolean) => void;
};

type ContentPanelProps = {
  children: (props: ContentPanelRenderProps) => React.ReactNode;
  /**
   * When provided, rendered instead of children when snapState is 'compact'.
   * ContentPanel automatically measures its height and updates the compact snap point.
   */
  compactContent?: (props: CompactContentRenderProps) => React.ReactNode;
  initialSnap?: SnapState;
  /**
   * Controlled snap state. When provided the panel animates to this snap position
   * whenever the value changes. Internal gestures still work, but call
   * `onSnapStateChange` so the parent can keep its state in sync.
   */
  snapState?: SnapState;
  /** Called when an internal gesture changes the snap state (controlled mode). */
  onSnapStateChange?: (state: SnapState) => void;
  /**
   * When provided, the panel slides in/out based on this value.
   * Omit for panels that are always visible.
   */
  visible?: boolean;
  /** Called after the slide-out animation finishes */
  onHidden?: () => void;
  zIndex?: number;
  /** When provided, overrides snap-based height and pins the panel to this exact pixel height. */
  height?: number;
  /** When provided, overrides the 'default' snap height and snaps to it immediately. User can still drag freely. */
  defaultSnapHeight?: number;
};

const SCREEN_HEIGHT = Dimensions.get('window').height;
const HANDLE_HEIGHT = 24;

// Height above which releasing snaps to full screen
const TOP_SNAP_THRESHOLD = SCREEN_HEIGHT * 0.75;
// Height below which releasing snaps to compact
const BOTTOM_SNAP_THRESHOLD = SCREEN_HEIGHT * 0.25;

const defaultSnapHeights: Record<SnapState, number> = {
  compact: HANDLE_HEIGHT + 40,
  default: SCREEN_HEIGHT * 0.55,
  full: SCREEN_HEIGHT,
};

export default function ContentPanel({
  children,
  compactContent,
  initialSnap = 'default',
  snapState: controlledSnapState,
  onSnapStateChange,
  visible,
  onHidden,
  zIndex = 30,
  height,
  defaultSnapHeight,
}: ContentPanelProps) {
  const insets = useSafeAreaInsets();
  const snapHeights = useRef<Record<SnapState, number>>({ ...defaultSnapHeights });

  const [snapState, setSnapState] = useState<SnapState>(controlledSnapState ?? initialSnap);
  const snapStateRef = useRef<SnapState>(controlledSnapState ?? initialSnap);

  const panelHeight = useRef(new Animated.Value(snapHeights.current[initialSnap])).current;

  // Tracks the actual current panel height (updated via listener) so gesture start
  // height is always correct even when in free-height mode between snap points.
  const currentPanelHeight = useRef(snapHeights.current[initialSnap]);
  useEffect(() => {
    const id = panelHeight.addListener(({ value }) => {
      currentPanelHeight.current = value;
    });
    return () => panelHeight.removeListener(id);
  }, []);

  // Visual properties derived from panelHeight so they track live drag without
  // needing separate parallel animations.
  const borderRadiusTop = useRef(
    panelHeight.interpolate({
      inputRange: [TOP_SNAP_THRESHOLD, SCREEN_HEIGHT],
      outputRange: [36, 0],
      extrapolate: 'clamp',
    }),
  ).current;
  const borderRadiusBottom = useRef(
    panelHeight.interpolate({
      inputRange: [TOP_SNAP_THRESHOLD, SCREEN_HEIGHT],
      outputRange: [48, 0],
      extrapolate: 'clamp',
    }),
  ).current;
  const horizontalMargin = useRef(
    panelHeight.interpolate({
      inputRange: [TOP_SNAP_THRESHOLD, SCREEN_HEIGHT],
      outputRange: [8, 0],
      extrapolate: 'clamp',
    }),
  ).current;
  const bottomMargin = useRef(
    panelHeight.interpolate({
      inputRange: [TOP_SNAP_THRESHOLD, SCREEN_HEIGHT],
      outputRange: [8, 0],
      extrapolate: 'clamp',
    }),
  ).current;

  // Derived from panelHeight so the safe-area padding fades in smoothly as
  // the panel approaches full screen, instead of jumping on snap state change.
  // useMemo re-creates the interpolation if insets.top ever changes.
  const animatedPaddingTop = useMemo(
    () =>
      panelHeight.interpolate({
        inputRange: [TOP_SNAP_THRESHOLD, SCREEN_HEIGHT],
        outputRange: [0, insets.top],
        extrapolate: 'clamp',
      }),
    [insets.top],
  );

  // Override snap-based height when a fixed `height` prop is supplied
  useEffect(() => {
    if (height === undefined) return;
    Animated.timing(panelHeight, {
      toValue: height,
      duration: 240,
      useNativeDriver: false,
    }).start();
  }, [height]);

  // Update the 'default' snap point and animate to it when defaultSnapHeight changes
  useEffect(() => {
    if (defaultSnapHeight === undefined) {
      // Restore the original default snap height when prop is removed
      snapHeights.current.default = defaultSnapHeights.default;
      return;
    }
    snapHeights.current.default = defaultSnapHeight;
    // Snap to the new default height immediately
    snapStateRef.current = 'default';
    setSnapState('default');
    Animated.timing(panelHeight, {
      toValue: defaultSnapHeight,
      duration: 240,
      useNativeDriver: false,
    }).start();
  }, [defaultSnapHeight]);

  // Only used when `visible` prop is provided
  const translateY = useRef(new Animated.Value(visible === false ? 40 : 0)).current;
  const opacity = useRef(new Animated.Value(visible === false ? 0 : 1)).current;

  const scrollY = useRef(0);
  const gestureStartHeight = useRef(snapHeights.current[initialSnap]);
  const isDragging = useRef(false);

  const snapTo = (next: SnapState, animated = true) => {
    snapStateRef.current = next;
    setSnapState(next);
    onSnapStateChange?.(next);
    if (!animated) {
      panelHeight.setValue(snapHeights.current[next]);
      return;
    }
    Animated.spring(panelHeight, {
      toValue: snapHeights.current[next],
      useNativeDriver: false,
      damping: 22,
      stiffness: 200,
      mass: 0.9,
    }).start();
  };

  // Respond to controlled snapState changes from the parent
  useEffect(() => {
    if (controlledSnapState === undefined) return;
    if (controlledSnapState !== snapStateRef.current) {
      snapTo(controlledSnapState);
    }
  }, [controlledSnapState]);

  const setCompactHeight = (height: number) => {
    snapHeights.current.compact = height;
    if (snapStateRef.current === 'compact' && !isDragging.current) {
      panelHeight.setValue(height);
    }
  };

  // Slide + fade in/out when `visible` prop changes
  useEffect(() => {
    if (visible === undefined) return;
    if (visible) {
      snapTo(initialSnap, false);
      translateY.setValue(40);
      opacity.setValue(0);
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 280, useNativeDriver: false }),
        Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: false }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: 40, duration: 220, useNativeDriver: false }),
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: false }),
      ]).start(({ finished }) => {
        if (finished) onHidden?.();
      });
    }
  }, [visible]);

  const resolveSnap = (dy: number, vy: number = 0) => {
    const finalHeight = Math.max(
      snapHeights.current.compact,
      Math.min(snapHeights.current.full, gestureStartHeight.current - dy),
    );
    // Bias the height using release velocity so a fast flick snaps farther
    // vy is px/ms (negative = upward). Multiply by 150 to convert to a height offset.
    const biasedHeight = finalHeight - vy * 150;
    const states: SnapState[] = ['compact', 'default', 'full'];
    const nearest = states.reduce((best, s) =>
      Math.abs(biasedHeight - snapHeights.current[s]) <
      Math.abs(biasedHeight - snapHeights.current[best])
        ? s
        : best,
    );
    snapTo(nearest);
  };

  const dragToHeight = (dy: number) => {
    panelHeight.setValue(
      Math.max(
        snapHeights.current.compact,
        Math.min(snapHeights.current.full, gestureStartHeight.current - dy),
      ),
    );
  };

  const resolveSnapRef = useRef(resolveSnap);
  resolveSnapRef.current = resolveSnap;
  const dragToHeightRef = useRef(dragToHeight);
  dragToHeightRef.current = dragToHeight;

  // Captures all directions — used on the drag handle bar
  const handlePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          isDragging.current = true;
          gestureStartHeight.current = currentPanelHeight.current;
        },
        onPanResponderMove: (_, gs) => dragToHeightRef.current(gs.dy),
        onPanResponderRelease: (_, gs) => {
          isDragging.current = false;
          resolveSnapRef.current(gs.dy, gs.vy);
        },
        onPanResponderTerminate: (_, gs) => {
          isDragging.current = false;
          resolveSnapRef.current(gs.dy, gs.vy);
        },
      }),
    [],
  );

  return (
    <Animated.View
      className="absolute shadow-lg"
      pointerEvents="box-none"
      style={{
        zIndex,
        borderTopLeftRadius: borderRadiusTop,
        borderTopRightRadius: borderRadiusTop,
        borderBottomLeftRadius: borderRadiusBottom,
        borderBottomRightRadius: borderRadiusBottom,
        bottom: bottomMargin,
        left: horizontalMargin,
        right: horizontalMargin,
        elevation: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.08,
        shadowRadius: 16,
        opacity,
        transform: [{ translateY }],
      }}
    >
      <Animated.View
        style={{
          borderTopLeftRadius: borderRadiusTop,
          borderTopRightRadius: borderRadiusTop,
          borderBottomLeftRadius: borderRadiusBottom,
          borderBottomRightRadius: borderRadiusBottom,
          height: panelHeight,
          overflow: 'hidden',
          paddingTop: animatedPaddingTop,
        }}
      >
        <View className="absolute inset-0" style={{ backgroundColor: '#FFFFFF' }} />

        {/* Drag handle — the 24px area is always the drag hotspot, but the
            visible bar only shows at full screen. */}
        <View
          className="h-5 items-center justify-start pt-2"
          {...handlePanResponder.panHandlers}
        >
          <View
            className="h-1 w-12 rounded-sm bg-handle"
            style={{ opacity: snapState === 'full' ? 1 : 0 }}
          />
        </View>

        {/* Always mount children so internal state is preserved across compact/default transitions */}
        <View style={{ display: snapState === 'compact' && compactContent ? 'none' : 'flex', flex: 1 }}>
          {children({
            snapState,
            snapTo,
            setCompactHeight,
            reportScrollY: (y) => { scrollY.current = y; },
            bottomInset: insets.bottom,
          })}
        </View>
        {compactContent && (
          <View
            style={{ display: snapState === 'compact' ? 'flex' : 'none' }}
            onLayout={e => {
              if (snapState === 'compact') setCompactHeight(e.nativeEvent.layout.height + HANDLE_HEIGHT);
            }}
          >
            <View style={{ paddingBottom: insets.bottom + 36 }}>
              {compactContent({ snapTo })}
            </View>
          </View>
        )}
      </Animated.View>
    </Animated.View>
  );
}
