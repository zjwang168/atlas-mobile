import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useHome } from '@/features/home/HomeContext';
import { SaveAffordance } from '@/components/save-affordance/SaveAffordance';
import { MIN_QUERY_LENGTH } from '@/services/place/placeSearchService';
import { usePlaceSearch } from '@/services/place/usePlaceSearch';
import type { PlaceSaveOutcome } from '@/types/place';
import type { PlaceSuggestion } from '@/types/route';

type SearchPanelProps = {
  onClose: () => void;
};

function iconColor(scheme: ReturnType<typeof useColorScheme>): string {
  return scheme === 'dark' ? '#fafafa' : '#0a0a0a';
}

function formatDistance(metres: number | null | undefined): string | null {
  if (metres == null) return null;
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

type ResultRowProps = {
  suggestion: PlaceSuggestion;
  outcome: PlaceSaveOutcome | null;
  saving: boolean;
  onPress: (suggestion: PlaceSuggestion) => void;
};

/** Memoized: the list swaps its whole dataset on every settled keystroke, and
    rows that survive that swap shouldn't re-render with it. */
const ResultRow = memo(function ResultRow({ suggestion, outcome, saving, onPress }: ResultRowProps) {
  const scheme = useColorScheme();
  const handlePress = useCallback(() => onPress(suggestion), [onPress, suggestion]);
  const distance = formatDistance(suggestion.distance_m);
  const address = suggestion.full_address || suggestion.place_formatted || '';

  return (
    <Pressable
      onPress={handlePress}
      disabled={outcome !== null || saving}
      className="flex-row items-center gap-3 border-b border-border px-4 py-3 active:bg-accent"
    >
      <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Ionicons name="location-outline" size={20} color={iconColor(scheme)} />
      </View>

      <View className="flex-1">
        <Text className="bodyEmphasis text-text-primary" numberOfLines={1}>
          {suggestion.name}
        </Text>
        {address ? (
          <Text className="bodySmall text-text-secondary" numberOfLines={1}>
            {address}
          </Text>
        ) : null}
        {suggestion.category || distance ? (
          <View className="mt-1 flex-row items-center gap-2">
            {suggestion.category ? (
              <Badge variant="secondary">
                <Text>{suggestion.category}</Text>
              </Badge>
            ) : null}
            {distance ? <Text className="caption text-text-tertiary">{distance}</Text> : null}
          </View>
        ) : null}
        {outcome === 'duplicate' ? (
          <Text className="caption mt-1 text-text-tertiary">Already in My Places</Text>
        ) : null}
      </View>

      <SaveAffordance outcome={outcome} saving={saving} />
    </Pressable>
  );
});

export default function SearchPanel({ onClose }: SearchPanelProps) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const { userLocation, refreshSavedPlaces } = useHome();

  // The session, debounce, cancellation, and save-outcome machinery all live in
  // the hook — this component is the panel's presentation only.
  const { query, setQuery, suggestions, status, savingId, outcomes, pick } = usePlaceSearch({
    proximity: userLocation,
    onSaved: refreshSavedPlaces,
  });

  const trimmed = query.trim();

  const renderItem = useCallback(
    ({ item }: { item: PlaceSuggestion }) => (
      <ResultRow
        suggestion={item}
        outcome={outcomes[item.external_id] ?? null}
        saving={savingId === item.external_id}
        onPress={pick}
      />
    ),
    [pick, outcomes, savingId],
  );

  const keyExtractor = useCallback((item: PlaceSuggestion) => item.external_id, []);

  const emptyState = useMemo(() => {
    if (status === 'searching') return null;
    if (status === 'error') return 'Search is unavailable right now. Try again in a moment.';
    if (trimmed.length < MIN_QUERY_LENGTH) return 'Search for a place by name to add it to My Places.';
    if (status === 'ready' && suggestions.length === 0) return `No places found for "${trimmed}".`;
    return null;
  }, [status, trimmed, suggestions.length]);

  return (
    <View className="absolute inset-0 z-40 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-2 px-4 py-2">
        <Pressable onPress={onClose} hitSlop={8} className="p-1">
          <Ionicons name="arrow-back" size={24} color={iconColor(scheme)} />
        </Pressable>
        <View className="flex-1 flex-row items-center justify-center">
          <Input
            className="flex-1"
            placeholder="Search places"
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            onSubmitEditing={Keyboard.dismiss}
          />
          {status === 'searching' ? (
            <View className="absolute right-3">
              <ActivityIndicator size="small" />
            </View>
          ) : null}
        </View>
      </View>

      <FlatList
        data={suggestions}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={
          emptyState ? (
            <View className="px-6 py-10">
              <Text className="bodySmall text-center text-text-tertiary">{emptyState}</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          suggestions.length > 0 ? (
            <View className="px-4 py-3">
              {/* Required wherever Mapbox search results are displayed. */}
              <Text className="caption text-text-tertiary">© Mapbox © OpenStreetMap</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
