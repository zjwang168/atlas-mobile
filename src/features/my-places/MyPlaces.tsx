import { useState } from 'react';
import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Place } from '@/types/place';
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
  bottomInset = 0,
  avatarUri,
  avatarFallback = 'U',
  onAvatarPress,
  onSharePress,
  compact = false,
}: MyPlacesProps) {
  const [activeTab, setActiveTab] = useState<Tab>('allPlaces');

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

  return (
    <View style={{ flex: 1 }}>
      {/* Header: "My places" title + share + avatar */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: 16,
        }}
      >
        <Text
          style={{
            fontSize: 28,
            fontWeight: '600',
            lineHeight: 34,
            color: '#09090b',
          }}
        >
          My places
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

      {/* Segmented control — native iOS UISegmentedControl via @expo/ui */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        <SegmentedControl
          values={['All places', 'Atlas']}
          selectedIndex={activeTab === 'allPlaces' ? 0 : 1}
          onChange={(e) =>
            setActiveTab(e.nativeEvent.selectedSegmentIndex === 0 ? 'allPlaces' : 'atlas')
          }
        />
      </View>

      {/* Content */}
      {activeTab === 'allPlaces' ? (
        <AllPlaces onPlacePress={onPlacePress} bottomInset={bottomInset} />
      ) : (
        <Atlas />
      )}
    </View>
  );
}
