import { useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ContentPanel from '@/components/content-panel/ContentPanel';
import { mockPlaceDetails } from '../../../mock-data/mockPlaceDetails';
import type { PlannedPlace } from '../create-plan/plan-place/types';
import { newPlannedPlace } from '../create-plan/plan-place/types';

const FILTERS = ['Recommended', 'Nearby', 'Not Yet Visited'];

type AddPlaceProps = {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (places: PlannedPlace[]) => void;
};

export default function AddPlace({ visible, onDismiss, onSelect }: AddPlaceProps) {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function resetState() {
    setSearch('');
    setActiveFilter(null);
    setSelected(new Set());
  }

  const results = mockPlaceDetails.filter((p) => {
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.subtitle.toLowerCase().includes(q);
  });

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleConfirm() {
    const chosen = mockPlaceDetails
      .filter((p) => selected.has(p.id))
      .map((p) => newPlannedPlace(p));
    onSelect(chosen);
  }

  const confirmLabel =
    selected.size === 0
      ? 'Select places'
      : selected.size === 1
        ? 'Add 1 place'
        : `Add ${selected.size} places`;

  return (
    <ContentPanel
      visible={visible}
      onHidden={resetState}
      initialSnap="default"
      zIndex={50}
    >
      {({ reportScrollY, bottomInset }) => (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingTop: 4,
              paddingBottom: 8,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '600', color: '#09090b' }}>Add Places</Text>
            <Button variant="ghost" size="icon" className="rounded-full" onPress={onDismiss}>
              <Ionicons name="close" size={20} color="#3a3a3c" />
            </Button>
          </View>

          {/* Search bar */}
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <Input
              placeholder="Search places..."
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
            />
          </View>

          {/* Filter pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}
          >
            {FILTERS.map((filter) => (
              <TouchableOpacity
                key={filter}
                onPress={() => setActiveFilter(activeFilter === filter ? null : filter)}
              >
                <Badge variant={activeFilter === filter ? 'default' : 'outline'}>
                  <Text>{filter}</Text>
                </Badge>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={{ height: 1, backgroundColor: '#f4f4f5', marginHorizontal: 16 }} />

          {/* Results */}
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            scrollEventThrottle={16}
            onScroll={(e) => reportScrollY(e.nativeEvent.contentOffset.y)}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 4,
              paddingBottom: bottomInset + 16,
            }}
            ItemSeparatorComponent={() => (
              <View style={{ height: 1, backgroundColor: '#f4f4f5' }} />
            )}
            renderItem={({ item }) => {
              const isSelected = selected.has(item.id);
              return (
                <TouchableOpacity
                  onPress={() => toggleSelect(item.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 14,
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      style={{ fontSize: 15, fontWeight: '500', color: '#09090b' }}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <Text style={{ fontSize: 13, color: '#71717a' }} numberOfLines={1}>
                      {item.subtitle}
                    </Text>
                  </View>
                  <Button variant="ghost" size="icon" onPress={() => toggleSelect(item.id)}>
                    <Ionicons
                      name={isSelected ? 'checkmark-circle' : 'radio-button-off'}
                      size={22}
                      color={isSelected ? '#3b82f6' : '#d4d4d8'}
                    />
                  </Button>
                </TouchableOpacity>
              );
            }}
          />

          {/* Confirm button */}
          <View style={{ paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8 }}>
            <Button
              size="lg"
              className="rounded-full"
              disabled={selected.size === 0}
              onPress={handleConfirm}
            >
              <Text>{confirmLabel}</Text>
            </Button>
          </View>
        </KeyboardAvoidingView>
      )}
    </ContentPanel>
  );
}
