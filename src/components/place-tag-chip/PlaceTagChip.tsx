import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import type { Icon } from 'phosphor-react-native';
import { CoffeeBeanIcon } from 'phosphor-react-native/src/icons/CoffeeBean';
import { ForkKnifeIcon } from 'phosphor-react-native/src/icons/ForkKnife';
import { memo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

type PlaceTagChipSize = 'sm' | 'md';

type PlaceTagChipProps = {
  label: string;
  icon?: Icon;
  iconColor?: string;
  size?: PlaceTagChipSize;
  style?: StyleProp<ViewStyle>;
};

/** Falls back to reading the label when the caller has no category of its own —
    the saved-places list only ever has the tag's text to go on. */
function iconForLabel(label: string): { icon: Icon; color: string } {
  const normalized = label.toLocaleLowerCase();
  const isCafe = normalized.includes('cafe') || normalized.includes('coffee');
  return isCafe
    ? { icon: CoffeeBeanIcon, color: '#FF6259' }
    : { icon: ForkKnifeIcon, color: '#F5A000' };
}

export const PlaceTagChip = memo(function PlaceTagChip({
  label,
  icon,
  iconColor,
  size = 'sm',
  style,
}: PlaceTagChipProps) {
  const derived = iconForLabel(label);
  const Glyph = icon ?? derived.icon;

  return (
    <View style={[styles.chip, size === 'md' && styles.chipMd, style]}>
      <Glyph size={14} weight="fill" color={iconColor ?? derived.color} />
      <Text numberOfLines={1} style={[styles.label, size === 'md' && styles.labelMd]}>
        {label}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  chip: {
    minHeight: 24,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 100,
    backgroundColor: 'rgba(0,0,0,0.05)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  // The label sits closer to the leading glyph than to the pill's trailing
  // edge, so the horizontal padding is asymmetric rather than centred.
  chipMd: {
    minHeight: 28,
    paddingLeft: 8,
    paddingRight: 10,
  },
  // 13pt Medium — the type scale has no 13 tier, so this stays a local style.
  label: {
    flexShrink: 1,
    color: '#717171',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  labelMd: {
    ...typography.captionMedium,
  },
});
