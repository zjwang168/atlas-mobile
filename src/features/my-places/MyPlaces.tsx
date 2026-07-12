import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { useHome } from '@/features/home/HomeContext';
import { typography } from '@/theme/typography';
import { Place } from '@/types/place';
import { SegmentedControl } from '@expo/ui/community/segmented-control';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { View } from 'react-native';
import AllPlaces from './all-places/AllPlaces';
import Atlas from './atlas/Atlas';

type Tab = 'allPlaces' | 'atlas';

type MyPlacesProps = {
  onPlacePress?: (place: Place) => void;
  onScroll?: (y: number) => void;
  bottomInset?: number;
  avatarUri?: string;
  avatarFallback?: string;
  onAvatarPress?: () => void;
  onSharePress?: () => void;
  /** Renders a condensed header only — used when the panel is in compact snap state */
  compact?: boolean;
};

export default function MyPlaces({
  onPlacePress,
  onScroll,
  bottomInset = 0,
  avatarUri,
  avatarFallback = 'U',
  onAvatarPress,
  onSharePress,
  compact = false,
}: MyPlacesProps) {
  const [activeTab, setActiveTab] = useState<Tab>('allPlaces');
  const { savedPlaces, refreshSavedPlaces, selectedPlaceId } = useHome();
  const savedCount = savedPlaces.length;

  // Native iOS UISegmentedControl (via @expo/ui). Rendered inside the scroll
  // content so it scrolls away rather than staying pinned.
  const segment = (
    <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
      <SegmentedControl
        values={['All places', 'Atlas']}
        selectedIndex={activeTab === 'allPlaces' ? 0 : 1}
        onChange={(e) =>
          setActiveTab(e.nativeEvent.selectedSegmentIndex === 0 ? 'allPlaces' : 'atlas')
        }
      />
    </View>
  );

  if (compact) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingVertical: 8,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '600', color: '#09090b' }}>
          My places
        </Text>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <PressableScale
            onPress={onSharePress}
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.65)',
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.12,
              shadowRadius: 20,
              elevation: 4,
            }}
          >
            <Ionicons name="share-outline" size={16} color="#000" />
          </PressableScale>
          <PressableScale onPress={onAvatarPress}>
            <Avatar alt={avatarFallback} style={{ width: 32, height: 32 }}>
              {avatarUri ? <AvatarImage source={{ uri: avatarUri }} /> : null}
              <AvatarFallback>
                <Text style={{ fontSize: 11, fontWeight: '500' }}>{avatarFallback}</Text>
              </AvatarFallback>
            </Avatar>
          </PressableScale>
        </View>
      </View>
    );
  }

  // Title + share + avatar. Rendered at the top of the scroll content (in the
  // list header) so @gorhom can treat the list as the sheet's scrollable.
  const titleRow = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 4,
        paddingBottom: 12,
      }}
    >
      <Text style={[typography.display, { color: '#09090b' }]}>
        My places{savedCount > 0 ? ` (${savedCount})` : ''}
      </Text>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <PressableScale
          onPress={onSharePress}
          style={{
            width: 40,
            height: 40,
            borderRadius: 33,
            backgroundColor: 'rgba(255,255,255,0.65)',
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.12,
            shadowRadius: 20,
            elevation: 4,
          }}
        >
          <Ionicons name="share-outline" size={20} color="#000" />
        </PressableScale>
        <PressableScale
          onPress={onAvatarPress}
          style={{
            borderRadius: 999,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.12,
            shadowRadius: 20,
            elevation: 4,
          }}
        >
          <Avatar alt={avatarFallback} style={{ width: 40, height: 40 }}>
            {avatarUri ? <AvatarImage source={{ uri: avatarUri }} /> : null}
            <AvatarFallback>
              <Text className="text-sm font-medium">{avatarFallback}</Text>
            </AvatarFallback>
          </Avatar>
        </PressableScale>
      </View>
    </View>
  );

  // Title pinned at the top of the panel; the segment + list scroll below it.
  return (
    <View style={{ flex: 1 }}>
      {titleRow}
      {activeTab === 'allPlaces' ? (
        <AllPlaces
          listHeader={segment}
          onScroll={onScroll}
          onPlacePress={onPlacePress}
          bottomInset={bottomInset}
          selectedPlaceId={selectedPlaceId}
        />
      ) : (
        <View style={{ flex: 1 }}>
          {segment}
          <Atlas />
        </View>
      )}
    </View>
  );
}
