import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

export type AtlasTab = { key: string; label: string };

type AtlasDayTabsProps = {
  tabs: AtlasTab[];
  activeKey: string;
  onSelect: (key: string) => void;
};

/**
 * Overview / Day N switcher above the itinerary. Rendered only when the trip
 * actually has days to switch between — a single-day Atlas shows its stops
 * directly instead of a tab row with one tab in it.
 */
export const AtlasDayTabs = memo(function AtlasDayTabs({ tabs, activeKey, onSelect }: AtlasDayTabsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            onPress={() => onSelect(tab.key)}
            style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.tabPressed]}
          >
            <Text style={[typography.bodySmallMedium, active ? styles.labelActive : styles.label]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  tab: {
    minHeight: 36,
    paddingHorizontal: 16,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  tabActive: { backgroundColor: '#1A1A1A' },
  tabPressed: { opacity: 0.6 },
  label: { color: '#717171' },
  labelActive: { color: '#FFFFFF' },
});
