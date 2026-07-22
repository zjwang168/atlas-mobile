import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import { mockAtlases } from '../../../../mock-data/mockAtlases';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, TouchableOpacity, useColorScheme, View } from 'react-native';
import { AtlasCard } from './AtlasCard';

const CATEGORY_PILLS = ['All', 'Restaurants', 'Museums', 'Trails', 'Cafes', 'Landmarks'];

function CategoryPillsRow() {
  const colorScheme = useColorScheme();
  const foreground = colorScheme === 'dark' ? '#fafafa' : '#0a0a0a';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexDirection: 'row', gap: 6 }}
        style={{ flex: 1 }}
      >
        {CATEGORY_PILLS.map((label) =>
          label === 'All' ? (
            <Badge key={label} variant="default" style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text className="text-white" style={typography.caption}>
                {label}
              </Text>
            </Badge>
          ) : (
            <Badge key={label} variant="outline" style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text style={typography.caption}>{label}</Text>
            </Badge>
          )
        )}
      </ScrollView>
      <TouchableOpacity>
        <Ionicons name="list-outline" size={20} color={foreground} />
      </TouchableOpacity>
      <TouchableOpacity>
        <Ionicons name="add" size={20} color={foreground} />
      </TouchableOpacity>
    </View>
  );
}

export default function Atlas() {
  if (mockAtlases.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <Text style={{ fontSize: 17, color: '#808080', textAlign: 'center' }}>
          Your curated atlas will appear here.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <CategoryPillsRow />
      <ScrollView contentContainerStyle={{ paddingVertical: 0 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16, marginTop: 8, marginBottom: 80, }}>
          {mockAtlases.map((atlas) => (
            <AtlasCard key={atlas.id} atlasId={atlas.id} emoji={atlas.emoji} title={atlas.title} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
