import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { Image, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';

type PlanCardProps = {
  title: string;
  placeCount: number;
  imageUrl?: string;
  /** When true, renders the "Create a plan" empty state card */
  create?: boolean;
  /** When true, shows the delete button in the top-right corner */
  deletionMode?: boolean;
  onPress?: () => void;
  onDeletePress?: () => void;
};

function PlanCard({ title, placeCount, imageUrl, create = false, deletionMode = false, onPress, onDeletePress }: PlanCardProps) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={{ flex: 1, gap: 10 }}>
      {/* Thumbnail wrapper — relative so the delete badge can be positioned over it */}
      <View style={{ aspectRatio: 1 }}>
        <View
          style={{
            flex: 1,
            borderRadius: 10,
            overflow: 'hidden',
            backgroundColor: '#f0f0f0',
            borderWidth: create ? 1.5 : 0,
            borderColor: create ? '#c7c7cc' : 'transparent',
            borderStyle: create ? 'dashed' : 'solid',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {create ? (
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: 'rgba(255,255,255,0.9)',
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 8,
                elevation: 3,
              }}
            >
              <Ionicons name="add" size={24} color="#1a1a1a" />
            </View>
          ) : imageUrl ? (
            <Image source={{ uri: imageUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <View
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: 'rgba(166,166,166,0.35)',
              }}
            />
          )}
        </View>

        {/* Delete button — only visible on real plans in deletion mode */}
        {deletionMode && !create && (
          <Button
            variant="ghost"
            size="icon"
            onPress={onDeletePress}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90"
          >
            <Ionicons name="close" size={14} color="#1a1a1a" />
          </Button>
        )}
      </View>

      {/* Labels */}
      <View style={{ gap: 2 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 15, fontWeight: '500', color: '#1a1a1a', letterSpacing: -0.3 }}
        >
          {title}
        </Text>
        <Text style={{ fontSize: 13, color: '#ababab' }}>
          {placeCount} {placeCount === 1 ? 'place' : 'places'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default memo(PlanCard);
