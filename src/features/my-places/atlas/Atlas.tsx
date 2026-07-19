import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import { mockAtlasPlaces, mockAtlases } from '../../../../mock-data/mockAtlases';
import { ScrollView, View } from 'react-native';
import { AtlasPlaceCard } from './AtlasPlaceCard';

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
    <ScrollView contentContainerStyle={{ paddingVertical: 16 }}>
      {mockAtlases.map((atlas) => (
        <View key={atlas.id} style={{ marginBottom: 24 }}>
          <Text
            className="text-text-primary"
            style={[typography.h3, { paddingHorizontal: 16, marginBottom: 12 }]}
          >
            {atlas.title}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
          >
            {mockAtlasPlaces
              .filter((atlasPlace) => atlasPlace.atlasId === atlas.id)
              .map((atlasPlace) => (
                <AtlasPlaceCard key={atlasPlace.id} name={atlasPlace.name} thumbnailUrl={atlasPlace.thumbnailUrl} />
              ))}
          </ScrollView>
        </View>
      ))}
    </ScrollView>
  );
}
