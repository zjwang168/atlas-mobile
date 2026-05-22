import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { mockPlaces } from '../../data/mockPlaces';

export default function HomeScreen() {
  const snapPoints = useMemo(() => ['18%', '42%', '82%'], []);

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: 47.6062,
          longitude: -122.3321,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }}
      >
        {mockPlaces.map((place) => (
          <Marker
            key={place.id}
            coordinate={{
              latitude: place.latitude,
              longitude: place.longitude,
            }}
            title={place.name}
            description={place.subtitle}
          />
        ))}
      </MapView>

      <TouchableOpacity style={styles.profileButton}>
        <Text style={styles.profileEmoji}>🐶</Text>
      </TouchableOpacity>

      <BottomSheet
        index={1}
        snapPoints={snapPoints}
        enablePanDownToClose={false}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.handleIndicator}
      >
        <BottomSheetScrollView
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionTitle}>Recent</Text>

          {mockPlaces.map((place) => (
            <View key={place.id} style={styles.placeRow}>
              <Text style={styles.placeName}>{place.name}</Text>
              <Text style={styles.placeSubtitle}>{place.subtitle}</Text>
            </View>
          ))}

          <View style={{ height: 100 }} />
        </BottomSheetScrollView>
      </BottomSheet>

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.circleButton}>
          <Text style={styles.searchIcon}>⌕</Text>
        </TouchableOpacity>

        <View style={styles.searchPill}>
          <Text style={styles.searchText}>Ask, search, or make...</Text>
        </View>

        <TouchableOpacity style={styles.circleButton}>
          <Text style={styles.plus}>＋</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  map: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  profileButton: {
    position: 'absolute',
    top: 70,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    zIndex: 10,
  },

  profileEmoji: {
    fontSize: 26,
  },

  sheetBackground: {
    backgroundColor: 'rgba(245,245,247,0.95)',
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
  },

  handleIndicator: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#CFCFD4',
  },

  sheetContent: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 130,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#8A8A8E',
    marginBottom: 14,
  },

  placeRow: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DADAE0',
  },

  placeName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
  },

  placeSubtitle: {
    marginTop: 5,
    fontSize: 16,
    color: '#8A8A8E',
  },

  bottomBar: {
    position: 'absolute',
    left: 22,
    right: 22,
    bottom: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    zIndex: 20,
  },

  circleButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(255,255,255,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  searchIcon: {
    fontSize: 30,
    color: '#000',
  },

  plus: {
    fontSize: 34,
    lineHeight: 36,
    color: '#000',
  },

  searchPill: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.96)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },

  searchText: {
    fontSize: 16,
    color: '#9A9AA0',
  },
});