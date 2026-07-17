import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  useColorScheme,
  View,
} from 'react-native';

import { useHome } from '../home/HomeContext';
import { toPlaceDetail } from '../../services/place/placeService';
import ContentPanel from '../../components/content-panel/ContentPanel';
import { PlaceDetail as PlaceDetailType } from '../../types/place';
import PlaceInfoSection from './place-detail-sections/PlaceInfoSection';
import PlaceOverviewSection from './place-detail-sections/PlaceOverviewSection';

type PlaceDetailProps = {
  placeId: string | null;
  onDismiss: () => void;
  onBack?: () => void;
  onEdit: (place: PlaceDetailType) => void;
  onHeightChange?: (height: number) => void;
};

export default function PlaceDetail({ placeId, onDismiss, onBack, onEdit: _onEdit, onHeightChange }: PlaceDetailProps) {
  const { savedPlaces } = useHome();
  const [place, setPlace] = useState<PlaceDetailType | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (placeId) {
      setNotFound(false);
      const row = savedPlaces.find((p) => p.id === placeId);
      if (row) {
        setPlace(toPlaceDetail(row));
      } else {
        setPlace(null);
        setNotFound(true);
      }
      setIsVisible(true);
    } else {
      setNotFound(false);
      setIsVisible(false);
    }
  }, [placeId, savedPlaces]);

  return (
    <ContentPanel
      initialSnap="default"
      visible={isVisible}
      onHidden={() => setPlace(null)}
      zIndex={40}
      onHeightChange={onHeightChange}
      compactContent={({ snapTo }) =>
        place ? (
          <PlaceCompactView
            place={place}
            onDismiss={onDismiss}
            onExpand={() => snapTo('default')}
          />
        ) : null
      }
    >
      {({ reportScrollY, bottomInset }) => {
        if (!place) {
          if (notFound) {
            return (
              <View className="flex-1 items-center justify-center px-8">
                <Ionicons name="search-outline" size={48} color="#999" />
                <Text className="mt-4 text-lg font-medium text-foreground">
                  Place not found
                </Text>
                <Text className="mt-2 text-center text-sm text-text-tertiary">
                  We couldn't find details for this place. It may have been removed.
                </Text>
                <Button
                  className="mt-6"
                  variant="outline"
                  onPress={onDismiss}
                >
                  <Text>Go back</Text>
                </Button>
              </View>
            );
          }
          return null;
        }
        return (
          <>
            <PlaceHeader
              place={place}
              onDismiss={onDismiss}
              onBack={onBack}
            />
            <ScrollView
              bounces
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              onScroll={(e) => reportScrollY(e.nativeEvent.contentOffset.y)}
              contentContainerStyle={{ paddingBottom: bottomInset + 56 }}
            >
              <PlaceOverviewSection place={place} />
              <PlaceInfoSection place={place} />
            </ScrollView>
          </>
        );
      }}
    </ContentPanel>
  );
}

function PlaceHeader({
  place,
  onDismiss,
  onBack,
}: {
  place: PlaceDetailType;
  onDismiss: () => void;
  onBack?: () => void;
}) {
  const colorScheme = useColorScheme();
  const foreground = colorScheme === 'dark' ? '#fafafa' : '#0a0a0a';

  return (
    <View className="flex-row items-center px-4 pb-2 pt-1">
      {/* Left: back button */}
      {onBack ? (
        <Button
          accessibilityLabel="Go back"
          onPress={onBack}
          size="icon"
          variant="ghost"
          className="h-12 w-12 rounded-full bg-background"
        >
          <Ionicons name="arrow-back" size={24} color={foreground} />
        </Button>
      ) : (
        <View className="h-12 w-12" />
      )}

      {/* Center: place name title */}
      <Text className="flex-1 text-center text-lg font-semibold text-foreground" numberOfLines={1}>
        Place Details
      </Text>

      {/* Right: close button */}
      <Button
        accessibilityLabel="Dismiss place details"
        onPress={onDismiss}
        size="icon"
        variant="ghost"
        className="h-12 w-12 rounded-full bg-background"
      >
        <Ionicons name="close" size={24} color={foreground} />
      </Button>
    </View>
  );
}

function PlaceCompactView({
  place,
  onDismiss,
  onExpand,
}: {
  place: PlaceDetailType;
  onDismiss: () => void;
  onExpand: () => void;
}) {
  const colorScheme = useColorScheme();
  const foreground = colorScheme === 'dark' ? '#fafafa' : '#18181B';

  return (
    <Pressable
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 }}
      onPress={onExpand}
    >
      <View className="flex-1">
        <Text numberOfLines={1} className="text-lg font-semibold text-foreground">
          {place.name}
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-xs text-text-tertiary">
          {place.address}
        </Text>
      </View>

      <View className="flex-row items-center gap-1">
        <Button
          accessibilityLabel="Share place"
          onPress={(e) => e.stopPropagation()}
          size="icon"
          variant="ghost"
          className="rounded-full bg-background"
        >
          <Ionicons name="share-outline" size={19} color={foreground} />
        </Button>

        <Button
          accessibilityLabel="Open in maps"
          onPress={(e) => e.stopPropagation()}
          size="icon"
          variant="ghost"
          className="rounded-full bg-background"
        >
          <Ionicons name="map-outline" size={19} color={foreground} />
        </Button>

        <Button
          accessibilityLabel="Dismiss place details"
          onPress={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          size="icon"
          variant="ghost"
          className="rounded-full bg-background"
        >
          <Ionicons name="close" size={20} color={foreground} />
        </Button>
      </View>
    </Pressable>
  );
}
