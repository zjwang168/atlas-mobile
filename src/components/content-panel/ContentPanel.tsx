import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type SnapState = 'compact' | 'short' | 'default' | 'tall' | 'full';

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

const defaultSnapHeights: Record<SnapState, number> = {
  compact: HANDLE_HEIGHT + 40,
  short: SCREEN_HEIGHT * 0.40,
  default: SCREEN_HEIGHT * 0.55,
  tall: SCREEN_HEIGHT * 0.70,
  full: SCREEN_HEIGHT,
};

const SNAP_ORDER: SnapState[] = ['compact', 'short', 'default', 'tall', 'full'];

// Height at which the panel starts losing its card border-radius / margins as it approaches full screen
const FULL_TRANSITION_START = SCREEN_HEIGHT * 0.75;

export default function ContentPanel({
  children,
  compactContent,
  initialSnap = 'default',
  snapState: controlledSnapState,
  onSnapStateChange,
  visible,
  onHidden,
  zIndex,
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
      inputRange: [FULL_TRANSITION_START, SCREEN_HEIGHT],
      outputRange: [36, 0],
      extrapolate: 'clamp',
    }),
  ).current;
  const borderRadiusBottom = useRef(
    panelHeight.interpolate({
      inputRange: [FULL_TRANSITION_START, SCREEN_HEIGHT],
      outputRange: [48, 0],
      extrapolate: 'clamp',
    }),
  ).current;
  const horizontalMargin = useRef(
    panelHeight.interpolate({
      inputRange: [FULL_TRANSITION_START, SCREEN_HEIGHT],
      outputRange: [8, 0],
      extrapolate: 'clamp',
    }),
  ).current;
  const bottomMargin = useRef(
    panelHeight.interpolate({
      inputRange: [FULL_TRANSITION_START, SCREEN_HEIGHT],
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
        inputRange: [FULL_TRANSITION_START, SCREEN_HEIGHT],
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
      duration: 260,
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
      duration: 260,
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
  const prevControlledSnapState = useRef(controlledSnapState);
  useLayoutEffect(() => {
    const prev = prevControlledSnapState.current;
    prevControlledSnapState.current = controlledSnapState;

    if (controlledSnapState === undefined) {
      // Control removed — return to initial position
      if (prev !== undefined) snapTo(initialSnap);
      return;
    }
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
      snapTo(controlledSnapState ?? initialSnap, false);
      translateY.setValue(40);
      opacity.setValue(0);
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 260, useNativeDriver: false }),
        Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: false }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: 40, duration: 260, useNativeDriver: false }),
        Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: false }),
      ]).start(({ finished }) => {
        if (finished) onHidden?.();
      });
    }
  }, [visible]);

  const resolveSnap = (dy: number) => {
    const finalHeight = Math.max(
      snapHeights.current.compact,
      Math.min(snapHeights.current.full, gestureStartHeight.current - dy),
    );
    // Always snap to the nearest defined snap point — no free-height zone.
    let nearest: SnapState = SNAP_ORDER[0];
    let minDist = Infinity;
    for (const state of SNAP_ORDER) {
      const dist = Math.abs(finalHeight - snapHeights.current[state]);
      if (dist < minDist) { minDist = dist; nearest = state; }
    }
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

  // Captures downward drag only when scroll is at the top
  const panelPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gs) => scrollY.current <= 0 && gs.dy > 4,
        onPanResponderGrant: () => {
          isDragging.current = true;
          gestureStartHeight.current = currentPanelHeight.current;
        },
        onPanResponderMove: (_, gs) => dragToHeightRef.current(gs.dy),
        onPanResponderRelease: (_, gs) => {
          isDragging.current = false;
          resolveSnapRef.current(gs.dy);
        },
        onPanResponderTerminate: (_, gs) => {
          isDragging.current = false;
          resolveSnapRef.current(gs.dy);
        },
      }),
    [],
  );

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
          resolveSnapRef.current(gs.dy);
        },
        onPanResponderTerminate: (_, gs) => {
          isDragging.current = false;
          resolveSnapRef.current(gs.dy);
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
        {...panelPanResponder.panHandlers}
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
