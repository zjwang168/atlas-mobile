import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { findPlaceDetail } from '../../../data/mockPlaceDetails';
import { PlaceDetail as PlaceDetailType } from '../../../types/place';
import BottomBar from '../../bottom-bar/BottomBar';
import PlaceBriefSection from './sections/PlaceBriefSection';
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
// bottom-7 (28px) + h-14.5 (58px) − panel bottomMargin (8px)
const BOTTOM_BAR_CLEARANCE = 78;

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
    if (dy < -SCREEN_HEIGHT * 0.25) {
      snapTo('full');
      return;
    }

    if (snapStateRef.current === 'brief') {
      snapTo(dy < -SCREEN_HEIGHT * 0.05 ? 'default' : 'brief');
      return;
    }

    if (snapStateRef.current === 'full') {
      snapTo(dy > SCREEN_HEIGHT * 0.15 ? 'default' : 'full');
      return;
    }

    snapTo(dy > SCREEN_HEIGHT * 0.15 ? 'brief' : 'default');
  };

  const dragToHeight = (dy: number) => {
    const nextHeight = Math.max(
      snapHeights.current.brief,
      Math.min(snapHeights.current.full, gestureStartHeight.current - dy)
    );
    panelHeight.setValue(nextHeight);
  };

  const resolveSnapRef = useRef(resolveSnap);
  resolveSnapRef.current = resolveSnap;
  const dragToHeightRef = useRef(dragToHeight);
  dragToHeightRef.current = dragToHeight;

  const panelPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          scrollY.current <= 0 && gestureState.dy > 4,
        onPanResponderGrant: () => {
          gestureStartHeight.current = snapHeights.current[snapStateRef.current];
        },
        onPanResponderMove: (_, gestureState) => dragToHeightRef.current(gestureState.dy),
        onPanResponderRelease: (_, gestureState) => resolveSnapRef.current(gestureState.dy),
        onPanResponderTerminate: (_, gestureState) => resolveSnapRef.current(gestureState.dy),
      }),
    []
  );

  const handlePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          gestureStartHeight.current = snapHeights.current[snapStateRef.current];
        },
        onPanResponderMove: (_, gestureState) => dragToHeightRef.current(gestureState.dy),
        onPanResponderRelease: (_, gestureState) => resolveSnapRef.current(gestureState.dy),
        onPanResponderTerminate: (_, gestureState) => resolveSnapRef.current(gestureState.dy),
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
        className="bg-gray-50/98"
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
        <View
          className="h-6 items-center justify-start pt-2.5"
          {...handlePanResponder.panHandlers}
        >
          <View className="h-1 w-9 rounded-sm bg-gray-300" />
        </View>

        {snapState === 'brief' ? (
          <CompactPlaceView
            place={place}
            onDismiss={dismissWithAnimation}
            onExpand={() => snapTo('default')}
            onLayout={(contentHeight) => {
              const total = HANDLE_HEIGHT + contentHeight + insets.bottom + BOTTOM_BAR_CLEARANCE;
              snapHeights.current.brief = total;
              panelHeight.setValue(total);
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
              <PlaceBriefSection place={place} />
              <PlaceInfoSection place={place} onEdit={onEdit} />
            </ScrollView>
          </>
        )}
      </Animated.View>
    </Animated.View>
    </>
  );
}

function CompactPlaceView({
  place,
  onDismiss,
  onExpand,
  onLayout,
}: {
  place: PlaceDetailType;
  onDismiss: () => void;
  onExpand: () => void;
  onLayout: (height: number) => void;
}) {
  return (
    <Pressable
      className="flex-row items-center gap-3 px-4 py-3"
      onPress={onExpand}
      onLayout={(e) => onLayout(e.nativeEvent.layout.height)}
    >
      <View className="flex-1">
        <Text numberOfLines={1} className="text-lg font-semibold text-gray-900">
          {place.name}
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-xs text-gray-500">
          {place.address}
        </Text>
      </View>

      <View className="flex-row items-center gap-1">
        <Pressable
          accessibilityLabel="Share place"
          onPress={(e) => e.stopPropagation()}
          className="h-10 w-10 items-center justify-center rounded-full bg-gray-100"
          style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
        >
          <Ionicons name="share-outline" size={19} color="#18181B" />
        </Pressable>

        <Pressable
          accessibilityLabel="Open in maps"
          onPress={(e) => e.stopPropagation()}
          className="h-10 w-10 items-center justify-center rounded-full bg-gray-100"
          style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
        >
          <Ionicons name="map-outline" size={19} color="#18181B" />
        </Pressable>

        <Pressable
          accessibilityLabel="Dismiss place details"
          onPress={(e) => { e.stopPropagation(); onDismiss(); }}
          className="h-10 w-10 items-center justify-center rounded-full bg-gray-100"
          style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
        >
          <Ionicons name="close" size={20} color="#18181B" />
        </Pressable>
      </View>
    </Pressable>
  );
}

function PlaceHeader({
  place,
  onDismiss,
}: {
  place: PlaceDetailType;
  onDismiss: () => void;
}) {
  return (
    <View className="flex-row items-center gap-2 px-4.5 pb-1 pt-1">
      <Text className="flex-1 text-2xl font-medium text-gray-900" numberOfLines={1}>
        {place.name}
      </Text>

      <Pressable
        accessibilityLabel="Dismiss place details"
        onPress={onDismiss}
        className="h-9 w-9 items-center justify-center rounded-full bg-gray-100"
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Ionicons name="close" size={18} color="#374151" />
      </Pressable>
    </View>
  );
}
