import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  ScrollView,
  useColorScheme,
  View,
} from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

import { findPlaceDetail } from '../../../dummy-data/mockPlaceDetails';
import { PlaceDetail as PlaceDetailType } from '../../types/place';
import ContentPanel from '../../components/content-panel/ContentPanel';
import PlaceCompactView from './PlaceCompactView';
import PlaceOverviewSection from './place-detail-sections/PlaceOverviewSection';
import PlaceInfoSection from './place-detail-sections/PlaceInfoSection';

type PlaceDetailProps = {
  placeName: string | null;
  onDismiss: () => void;
  onEdit: (place: PlaceDetailType) => void;
};

export default function PlaceDetail({ placeName, onDismiss, onEdit: _onEdit }: PlaceDetailProps) {
  const [place, setPlace] = useState<PlaceDetailType | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (placeName) {
      const next = findPlaceDetail(placeName);
      if (next) setPlace(next);
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [placeName]);

  return (
    <ContentPanel
      initialSnap="default"
      visible={isVisible}
      onHidden={() => {
        setPlace(null);
        onDismiss();
      }}
      zIndex={40}
      compactContent={({ snapTo }) =>
        place ? (
          <PlaceCompactView
            place={place}
            onDismiss={() => setIsVisible(false)}
            onExpand={() => snapTo('default')}
          />
        ) : null
      }
    >
      {({ reportScrollY, bottomInset }) => {
        if (!place) return null;
        return (
          <>
            <PlaceHeader
              place={place}
              onDismiss={() => setIsVisible(false)}
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
