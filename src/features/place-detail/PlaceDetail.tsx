import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import { useHomePlaces } from '../home/HomeContext';
import { toPlaceDetail, updatePlaceName } from '../../services/place/placeService';
import ContentPanel from '../../components/content-panel/ContentPanel';
import { PlaceDetail as PlaceDetailType } from '../../types/place';
import PlaceInfoSection from './place-detail-sections/PlaceInfoSection';
import PlaceOverviewSection from './place-detail-sections/PlaceOverviewSection';

type PlaceDetailProps = {
  placeId: string | null;
  onDismiss: () => void;
  onEdit: (place: PlaceDetailType) => void;
  snapGroup?: string;
  onHeightChange?: (height: number) => void;
};

export default function PlaceDetail({ placeId, onDismiss, onEdit: _onEdit, snapGroup, onHeightChange }: PlaceDetailProps) {
  const { savedPlaces } = useHomePlaces();
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
      snapGroup={snapGroup}
      visible={isVisible}
      onHidden={() => setPlace(null)}
      zIndex={40}
      onHeightChange={onHeightChange}
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
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(place.name);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraftName(place.name);
  }, [editing, place.name]);

  const saveName = async () => {
    const nextName = draftName.trim();
    if (!nextName || saving || nextName === place.name) {
      if (nextName === place.name) setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await updatePlaceName(place.id, nextName);
      setEditing(false);
    } catch (error) {
      console.warn('[PlaceDetail] could not rename place:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="flex-row items-center px-4 pb-2 pt-1">
      {/* Center: place name title */}
      {editing ? (
        <TextInput
          accessibilityLabel="Edit place name"
          autoFocus
          value={draftName}
          onChangeText={setDraftName}
          onSubmitEditing={() => { void saveName(); }}
          returnKeyType="done"
          editable={!saving}
          selectTextOnFocus
          style={{ flex: 1, height: 44, color: foreground, fontSize: 24, fontWeight: '700', paddingHorizontal: 0, borderBottomWidth: 1, borderBottomColor: '#A1A1AA' }}
        />
      ) : (
        <Text className="flex-1 h2 text-foreground" numberOfLines={1}>
          {place.specialRole ? place.specialRole[0].toUpperCase() + place.specialRole.slice(1) : place.name}
        </Text>
      )}

      {editing ? (
        <View className="flex-row items-center">
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel editing place name" onPress={() => { setDraftName(place.name); setEditing(false); }} disabled={saving} style={{ width: 42, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={22} color="#71717A" />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Save place name" onPress={() => { void saveName(); }} disabled={saving || !draftName.trim()} style={{ width: 42, height: 44, alignItems: 'center', justifyContent: 'center', opacity: saving || !draftName.trim() ? 0.45 : 1 }}>
            <Ionicons name="checkmark" size={24} color="#12C170" />
          </Pressable>
        </View>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="Edit place name" onPress={() => setEditing(true)} style={{ width: 42, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="pencil-outline" size={20} color={foreground} />
        </Pressable>
      )}

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
        {/* Whole element, not just its text: `mt-0.5` lives on it, so leaving
            an empty one behind would still push the row taller. */}
        {place.address ? (
          <Text numberOfLines={1} className="mt-0.5 text-xs text-text-tertiary">
            {place.address}
          </Text>
        ) : null}
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
