import { BlurView } from 'expo-blur';
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

type ContentPanelProps = {
  children: (props: ContentPanelRenderProps) => React.ReactNode;
  initialSnap?: SnapState;
  /**
   * When provided, the panel slides in/out based on this value.
   * Omit for panels that are always visible.
   */
  visible?: boolean;
  /** Called after the slide-out animation finishes */
  onHidden?: () => void;
  zIndex?: number;
};

const SCREEN_HEIGHT = Dimensions.get('window').height;
const HANDLE_HEIGHT = 24;

const defaultSnapHeights: Record<SnapState, number> = {
  compact: HANDLE_HEIGHT + 40,
  default: SCREEN_HEIGHT * 0.6,
  full: SCREEN_HEIGHT,
};

export default function ContentPanel({
  children,
  initialSnap = 'default',
  visible,
  onHidden,
  zIndex = 30,
}: ContentPanelProps) {
  const insets = useSafeAreaInsets();
  const snapHeights = useRef<Record<SnapState, number>>({ ...defaultSnapHeights });

  const [snapState, setSnapState] = useState<SnapState>(initialSnap);
  const snapStateRef = useRef<SnapState>(initialSnap);

  const panelHeight = useRef(new Animated.Value(snapHeights.current[initialSnap])).current;

  const borderRadiusTop = useRef(new Animated.Value(initialSnap === 'full' ? 0 : 36)).current;
  const borderRadiusBottom = useRef(new Animated.Value(initialSnap === 'full' ? 0 : 48)).current;
  const horizontalMargin = useRef(new Animated.Value(initialSnap === 'full' ? 0 : 8)).current;
  const bottomMargin = useRef(new Animated.Value(initialSnap === 'full' ? 0 : 8)).current;
  // Only used when `visible` prop is provided
  const translateY = useRef(new Animated.Value(visible === false ? 40 : 0)).current;
  const opacity = useRef(new Animated.Value(visible === false ? 0 : 1)).current;

  const scrollY = useRef(0);
  const gestureStartHeight = useRef(snapHeights.current[initialSnap]);
  const isDragging = useRef(false);

  const snapTo = (next: SnapState, animated = true) => {
    snapStateRef.current = next;
    setSnapState(next);
    Animated.parallel([
      Animated.timing(panelHeight, {
        toValue: snapHeights.current[next],
        duration: animated ? 240 : 0,
        useNativeDriver: false,
      }),
      Animated.timing(borderRadiusTop, {
        toValue: next === 'full' ? 0 : 36,
        duration: animated ? 240 : 0,
        useNativeDriver: false,
      }),
      Animated.timing(borderRadiusBottom, {
        toValue: next === 'full' ? 0 : 48,
        duration: animated ? 240 : 0,
        useNativeDriver: false,
      }),
      Animated.timing(horizontalMargin, {
        toValue: next === 'full' ? 0 : 8,
        duration: animated ? 240 : 0,
        useNativeDriver: false,
      }),
      Animated.timing(bottomMargin, {
        toValue: next === 'full' ? 0 : 8,
        duration: animated ? 240 : 0,
        useNativeDriver: false,
      }),
    ]).start();
  };

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

  const resolveSnap = (dy: number) => {
    const cur = snapStateRef.current;
    if (cur === 'compact') {
      if (dy < -SCREEN_HEIGHT * 0.45) snapTo('full');
      else if (dy < -SCREEN_HEIGHT * 0.05) snapTo('default');
      else snapTo('compact');
      return;
    }
    if (cur === 'full') {
      snapTo(dy > SCREEN_HEIGHT * 0.15 ? 'default' : 'full');
      return;
    }
    if (dy < -SCREEN_HEIGHT * 0.15) snapTo('full');
    else if (dy > SCREEN_HEIGHT * 0.15) snapTo('compact');
    else snapTo('default');
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
          gestureStartHeight.current = snapHeights.current[snapStateRef.current];
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
          gestureStartHeight.current = snapHeights.current[snapStateRef.current];
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
          paddingTop: snapState === 'full' ? insets.top : 0,
        }}
        {...panelPanResponder.panHandlers}
      >
        <BlurView
          className="absolute inset-0"
          intensity={90}
          tint="systemThickMaterialLight"
        />

        {/* Drag handle */}
        <View
          className="h-6 items-center justify-start pt-2.5"
          {...handlePanResponder.panHandlers}
        >
          <View className="h-1 w-12 rounded-sm bg-handle" />
        </View>

        {children({
          snapState,
          snapTo,
          setCompactHeight,
          reportScrollY: (y) => { scrollY.current = y; },
          bottomInset: insets.bottom,
        })}
      </Animated.View>
    </Animated.View>
  );
}
