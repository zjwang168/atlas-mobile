import { elevation } from '@/theme/elevation';
import { memo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

type DetailCardProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * The white rounded card every Place Detail section sits in. Shared so the
 * radius, hairline border and shadow stay identical across sections — they read
 * as one stack of cards, and a section that draws its own shell drifts.
 */
export const DetailCard = memo(function DetailCard({ children, style }: DetailCardProps) {
  return (
    <View className="bg-card border-border" style={[styles.card, style]}>
      {children}
    </View>
  );
});

/** Hairline rule between stacked rows inside a card. */
export const CardDivider = memo(function CardDivider() {
  return <View className="bg-border" style={styles.divider} />;
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 0.5,
    padding: 8,
    gap: 8,
    ...elevation.card,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 6,
  },
});
