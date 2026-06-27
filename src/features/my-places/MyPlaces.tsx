import { useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
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
};

export default function MyPlaces({
  onPlacePress,
  bottomInset = 0,
  avatarUri,
  avatarFallback = 'U',
  onAvatarPress,
  onSharePress,
}: MyPlacesProps) {
  const [activeTab, setActiveTab] = useState<Tab>('allPlaces');

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
          <TouchableOpacity
            onPress={onSharePress}
            activeOpacity={0.7}
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
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onAvatarPress}
            activeOpacity={0.85}
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
          </TouchableOpacity>
        </View>
      </View>

      {/* Segmented control */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: 'rgba(118,118,128,0.12)',
            borderRadius: 100,
            padding: 2,
            height: 36,
          }}
        >
          <TouchableOpacity
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              borderRadius: 20,
              backgroundColor: activeTab === 'allPlaces' ? '#fff' : 'transparent',
            }}
            onPress={() => setActiveTab('allPlaces')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="location-sharp"
              size={18}
              color={activeTab === 'allPlaces' ? '#1a1a1a' : '#717171'}
            />
            <Text
              style={{
                fontSize: 15,
                fontWeight: '600',
                lineHeight: 20,
                color: activeTab === 'allPlaces' ? '#1a1a1a' : '#717171',
              }}
            >
              All places
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              borderRadius: 20,
              backgroundColor: activeTab === 'atlas' ? '#fff' : 'transparent',
            }}
            onPress={() => setActiveTab('atlas')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="map-outline"
              size={18}
              color={activeTab === 'atlas' ? '#1a1a1a' : '#717171'}
            />
            <Text
              style={{
                fontSize: 15,
                fontWeight: '600',
                lineHeight: 20,
                color: activeTab === 'atlas' ? '#1a1a1a' : '#717171',
              }}
            >
              Atlas
            </Text>
          </TouchableOpacity>
        </View>
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
