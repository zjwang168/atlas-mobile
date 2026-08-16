import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { MapPinIcon } from 'phosphor-react-native/src/icons/MapPin';
import { PhoneIcon } from 'phosphor-react-native/src/icons/Phone';
import { Fragment, memo } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { PlaceDetail } from '../../../types/place';
import { CardDivider, DetailCard } from './DetailCard';

type PlaceLocationCardProps = {
  place: PlaceDetail;
};

/**
 * Address and phone, each row present only when that field has a value. Opening
 * hours are deliberately absent: nothing populates `schedule`, and an hours row
 * derived from an empty schedule reports every place as closed.
 */
export const PlaceLocationCard = memo(function PlaceLocationCard({ place }: PlaceLocationCardProps) {
  const rows: React.ReactNode[] = [];

  if (place.address) {
    rows.push(
      <InfoRow
        key="address"
        label="Location"
        value={place.address}
        Glyph={MapPinIcon}
        accessibilityLabel="Open this place in Maps"
        onPress={() => openInMaps(place)}
      />,
    );
  }

  if (place.phoneNumber) {
    rows.push(
      <InfoRow
        key="phone"
        label="Phone"
        value={place.phoneNumber}
        Glyph={PhoneIcon}
        accessibilityLabel={`Call ${place.name}`}
        onPress={() => { void Linking.openURL(`tel:${place.phoneNumber}`).catch(() => {}); }}
      />,
    );
  }

  if (rows.length === 0) return null;

  return (
    <DetailCard>
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index > 0 ? <CardDivider /> : null}
          {row}
        </Fragment>
      ))}
    </DetailCard>
  );
});

function InfoRow({
  label,
  value,
  Glyph,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  value: string;
  Glyph: typeof MapPinIcon;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowLabel}>
        <Glyph size={18} weight="fill" color="#8E8E93" />
        <Text className="text-text-tertiary" style={typography.bodySmall}>
          {label}
        </Text>
      </View>
      <Text className="text-text-primary" style={[typography.bodySmallRelaxed, styles.rowValue]}>
        {value}
      </Text>
      <CaretRightIcon size={14} weight="bold" color="#C7C7CC" />
    </Pressable>
  );
}

/** Apple Maps on iOS, Google Maps elsewhere — coordinates, with the name as the label. */
function openInMaps(place: PlaceDetail) {
  const coords = `${place.latitude},${place.longitude}`;
  const url = Platform.OS === 'ios'
    ? `http://maps.apple.com/?ll=${coords}&q=${encodeURIComponent(place.name)}`
    : `geo:${coords}?q=${encodeURIComponent(place.name)}`;
  void Linking.openURL(url).catch(() => {});
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 6,
    paddingVertical: 10,
  },
  rowPressed: {
    opacity: 0.55,
  },
  rowLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: 96,
  },
  rowValue: {
    flex: 1,
  },
});
