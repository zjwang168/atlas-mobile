// src/features/home/HomeScreen.tsx
import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { mockPlaces } from '../../data/mockPlaces';
import MapboxMap, { MapMarker } from '../map/MapboxMap';

// ---- Types ----

/** Represents a place data item from mock data */
interface PlaceData {
  id: string;
  name: string;
  subtitle: string;
  latitude: number;
  longitude: number;
}

// ---- Helpers ----

/**
 * Converts PlaceData items into MapMarker format
 * expected by the MapboxMap component.
 */
const toMapMarkers = (places: PlaceData[]): MapMarker[] =>
  places.map((place) => ({
    id: place.id,
    latitude: place.latitude,
    longitude: place.longitude,
    title: place.name,
    description: place.subtitle,
  }));

// ---- Component ----

/**
 * Home screen displaying a full-screen Mapbox map
 * with markers from the mock places dataset.
 */
const HomeScreen: React.FC = () => {
  // Transform mock data into map markers
  const markers: MapMarker[] = toMapMarkers(mockPlaces);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* Header overlay */}
      <View style={styles.header}>
        <Text style={styles.title}>OurAtlas</Text>
        <Text style={styles.subtitle}>
          {markers.length} place{markers.length !== 1 ? 's' : ''} to explore
        </Text>
      </View>

      {/* Mapbox map filling the remaining space */}
      <MapboxMap
        markers={markers}
        centerCoordinate={[-122.3321, 47.6062]} // Seattle center [longitude, latitude]
        zoomLevel={12}
        onMarkerPress={(marker) => {
          console.log('Marker pressed:', marker.title);
          // TODO: Navigate to PlaceDetailScreen
        }}
      />
    </SafeAreaView>
  );
};

// ---- Styles ----

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  subtitle: {
    fontSize: 14,
    color: '#666666',
    marginTop: 4,
  },
});

export default HomeScreen;
