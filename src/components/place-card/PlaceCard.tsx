import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, ScrollView, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { PlaceTag } from '@/types/place';

type PlaceCardProps = {
  name: string;
  description: string;
  imageUrl?: string;
  tags?: PlaceTag[];
  date?: string;
  onPress?: () => void;
};

export default function PlaceCard({
  name,
  description,
  imageUrl,
  tags = [],
  date,
  onPress,
}: PlaceCardProps) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={{ gap: 16 }}>
      {/* Title + image row */}
      <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text
            className="text-text-primary"
            style={{ fontSize: 17, fontWeight: '500', lineHeight: 24, marginBottom: 4 }}
            numberOfLines={1}
          >
            {name}
          </Text>
          <Text
            numberOfLines={3}
            className="text-text-secondary"
            style={{ fontSize: 15, lineHeight: 20, height: 60 }}
          >
            {description}
          </Text>
        </View>
        <View
          style={{
            width: 96,
            height: 96,
            borderRadius: 10,
            overflow: 'hidden',
            backgroundColor: '#e5e5ea',
            flexShrink: 0,
          }}
        >
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : null}
        </View>
      </View>

      {/* Tags + date row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ flexDirection: 'row', gap: 6 }}
        >
          {tags.slice(0, 3).map((tag) => (
            <View
              key={tag.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingLeft: 12,
                paddingRight: 6,
                paddingVertical: 4,
                borderRadius: 100,
                borderWidth: 1,
                borderColor: '#dfdfdf',
                backgroundColor: '#fff',
              }}
            >
              <Text style={{ fontSize: 13, color: '#000' }}>{tag.label}</Text>
              <Ionicons name="chevron-forward" size={16} color="#999" />
            </View>
          ))}
        </ScrollView>
        {date ? (
          <Text style={{ fontSize: 13, color: '#ababab', marginLeft: 8, flexShrink: 0 }}>
            {date}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}
