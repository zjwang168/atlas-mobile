import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { findPlaceDetail } from '../../../data/mockPlaceDetails';
import { PlaceDetail as PlaceDetailType } from '../../../types/place';
import BottomBar from '../../bottom-bar/BottomBar';
import PlaceCompactView from './PlaceCompactView';
import PlaceOverviewSection from './sections/PlaceOverviewSection';
import PlaceInfoSection from './sections/PlaceInfoSection';

type SnapState = 'brief' | 'default' | 'full';

type PlaceDetailProps = {
  placeName: string | null;
  onDismiss: () => void;
  onEdit: (place: PlaceDetailType) => void;
  onOpenImport: () => void;
};

const SCREEN_HEIGHT = Dimensions.get('window').height;
const HANDLE_HEIGHT = 24;
const BOTTOM_BAR_CLEARANCE = 24;

export default function PlaceDetail({
  placeName,
  onDismiss,
  onEdit,
  onOpenImport,
}: PlaceDetailProps) {
  const insets = useSafeAreaInsets();
  const snapHeights = useRef<Record<SnapState, number>>({
    brief: 100,
    default: SCREEN_HEIGHT * 0.6,
    full: SCREEN_HEIGHT,
  });
  const [place, setPlace] = useState<PlaceDetailType | null>(null);
  const [snapState, setSnapState] = useState<SnapState>('default');
  const snapStateRef = useRef<SnapState>('default');
  const panelHeight = useRef(new Animated.Value(snapHeights.current.default)).current;
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const borderRadius = useRef(new Animated.Value(40)).current;
  const horizontalMargin = useRef(new Animated.Value(8)).current;
  const bottomMargin = useRef(new Animated.Value(8)).current;
  const scrollY = useRef(0);
  const gestureStartHeight = useRef(snapHeights.current.default);
  const isDragging = useRef(false);

  useEffect(() => {
    if (placeName) {
      const nextPlace = findPlaceDetail(placeName);
      if (!nextPlace) {
        return;
      }

      setPlace(nextPlace);
      snapTo('default', false);
      translateY.setValue(SCREEN_HEIGHT);
      Animated.timing(translateY, {
        duration: 260,
        toValue: 0,
        useNativeDriver: false,
      }).start();
      return;
    }

    if (place) {
      Animated.timing(translateY, {
        duration: 220,
        toValue: SCREEN_HEIGHT,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) {
          setPlace(null);
        }
      });
    }
  }, [placeName]);

  const dismissWithAnimation = () => {
    Animated.timing(translateY, {
      duration: 220,
      toValue: SCREEN_HEIGHT,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        setPlace(null);
        onDismiss();
      }
    });
  };

  const snapTo = (nextSnapState: SnapState, animated = true) => {
    snapStateRef.current = nextSnapState;
    setSnapState(nextSnapState);
    Animated.parallel([
      Animated.timing(panelHeight, {
        duration: animated ? 240 : 0,
        toValue: snapHeights.current[nextSnapState],
        useNativeDriver: false,
      }),
      Animated.timing(borderRadius, {
        duration: animated ? 240 : 0,
        toValue: nextSnapState === 'full' ? 0 : 40,
        useNativeDriver: false,
      }),
      Animated.timing(horizontalMargin, {
        duration: animated ? 240 : 0,
        toValue: nextSnapState === 'full' ? 0 : 8,
        useNativeDriver: false,
      }),
      Animated.timing(bottomMargin, {
        duration: animated ? 240 : 0,
        toValue: nextSnapState === 'full' ? 0 : 8,
        useNativeDriver: false,
      }),
    ]).start();
  };

  const resolveSnap = (dy: number) => {
    if (snapStateRef.current === 'brief') {
      // Require a larger drag to jump directly to full from the compact view.
      if (dy < -SCREEN_HEIGHT * 0.45) snapTo('full');
      else if (dy < -SCREEN_HEIGHT * 0.05) snapTo('default');
      else snapTo('brief');
      return;
    }

    if (snapStateRef.current === 'full') {
      snapTo(dy > SCREEN_HEIGHT * 0.15 ? 'default' : 'full');
      return;
    }

    // From default, a short upward drag reaches full since the panel is already 60% tall.
    if (dy < -SCREEN_HEIGHT * 0.15) snapTo('full');
    else if (dy > SCREEN_HEIGHT * 0.15) snapTo('brief');
    else snapTo('default');
  };

  const dragToHeight = (dy: number) => {
    const nextHeight = Math.max(
      snapHeights.current.brief,
      Math.min(snapHeights.current.full, gestureStartHeight.current - dy)
    );
    panelHeight.setValue(nextHeight);
  };

  // Refs so PanResponder callbacks always call the latest closure without recreating the responder.
  const resolveSnapRef = useRef(resolveSnap);
  resolveSnapRef.current = resolveSnap;
  const dragToHeightRef = useRef(dragToHeight);
  dragToHeightRef.current = dragToHeight;

  // Only captures downward drag at scroll top to collapse the panel.
  // All other gestures (upward swipes, scrolled content) pass through to the ScrollView.
  const panelPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          scrollY.current <= 0 && gestureState.dy > 4,
        onPanResponderGrant: () => {
          isDragging.current = true;
          gestureStartHeight.current = snapHeights.current[snapStateRef.current];
        },
        onPanResponderMove: (_, gestureState) => dragToHeightRef.current(gestureState.dy),
        onPanResponderRelease: (_, gestureState) => {
          isDragging.current = false;
          resolveSnapRef.current(gestureState.dy);
        },
        onPanResponderTerminate: (_, gestureState) => {
          isDragging.current = false;
          resolveSnapRef.current(gestureState.dy);
        },
      }),
    []
  );

  // Always captures — used for the drag handle bar so any swipe direction changes snap state.
  const handlePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          isDragging.current = true;
          gestureStartHeight.current = snapHeights.current[snapStateRef.current];
        },
        onPanResponderMove: (_, gestureState) => dragToHeightRef.current(gestureState.dy),
        onPanResponderRelease: (_, gestureState) => {
          isDragging.current = false;
          resolveSnapRef.current(gestureState.dy);
        },
        onPanResponderTerminate: (_, gestureState) => {
          isDragging.current = false;
          resolveSnapRef.current(gestureState.dy);
        },
      }),
    []
  );

  if (!place) {
    return null;
  }

  return (
    <>
    <BottomBar onOpenImport={onOpenImport} />
    <Animated.View
      className="absolute z-30 shadow-lg"
      pointerEvents="box-none"
      style={[
        {
          borderRadius,
          bottom: bottomMargin,
          left: horizontalMargin,
          right: horizontalMargin,
          elevation: 12,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.08,
          shadowRadius: 16,
          transform: [{ translateY }],
        },
      ]}
    >
      <Animated.View
        style={[
          {
            borderRadius,
            height: panelHeight,
            overflow: 'hidden',
            paddingTop: snapState === 'full' ? insets.top : 0,
          },
        ]}
        {...panelPanResponder.panHandlers}
      >
        <BlurView
          className="absolute inset-0"
          intensity={90}
          tint="systemThickMaterialLight"
        />
        <View
          className="h-6 items-center justify-start pt-2.5"
          {...handlePanResponder.panHandlers}
        >
          <View className="h-1 w-12 rounded-sm bg-shader" />
        </View>

        {snapState === 'brief' ? (
          <PlaceCompactView
            place={place}
            onDismiss={dismissWithAnimation}
            onExpand={() => snapTo('default')}
            onLayout={(contentHeight) => {
              const total = HANDLE_HEIGHT + contentHeight + insets.bottom + BOTTOM_BAR_CLEARANCE;
              snapHeights.current.brief = total;
              if (!isDragging.current) {
                panelHeight.setValue(total);
              }
            }}
          />
        ) : (
          <>
            <PlaceHeader
              place={place}
              onDismiss={dismissWithAnimation}
            />
            <ScrollView
              bounces
              scrollEnabled
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              onScroll={(event) => {
                scrollY.current = event.nativeEvent.contentOffset.y;
              }}
              contentContainerStyle={{ paddingBottom: insets.bottom + 56 }}
            >
              <PlaceOverviewSection place={place} />
              <PlaceInfoSection place={place} />
            </ScrollView>
          </>
        )}
      </Animated.View>
    </Animated.View>
    </>
  );
}

function PlaceHeader({
  place,
  onDismiss,
}: {
  place: PlaceDetailType;
  onDismiss: () => void;
}) {
  const colorScheme = useColorScheme();
  const foreground = colorScheme === 'dark' ? '#fafafa' : '#0a0a0a';

  return (
    <View className="flex-row items-center px-4 pb-2 pt-1">
      <Text className="flex-1 text-2xl font-medium text-foreground" numberOfLines={1}>
        {place.name}
      </Text>

      <Pressable
        accessibilityLabel="Dismiss place details"
        onPress={onDismiss}
        className="h-12 w-12 items-center justify-center rounded-full bg-background"
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Ionicons name="close" size={24} color={foreground} />
      </Pressable>
    </View>
  );
}
