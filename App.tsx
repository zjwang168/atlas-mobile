import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

const places = [
  {
    id: '1',
    name: 'Noma Restaurant',
    subtitle: 'Downtown Seattle',
    latitude: 47.6095,
    longitude: -122.3419,
  },
  {
    id: '2',
    name: 'Hidden Sushi',
    subtitle: 'Belltown',
    latitude: 47.6131,
    longitude: -122.345,
  },
];

export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      <MapView
        style={styles.map}
        initialRegion={{
          latitude: 47.6062,
          longitude: -122.3321,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }}
      >
        {places.map((place) => (
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

      <View style={styles.bottomSheet}>
        <View style={styles.dragHandle} />

        <Text style={styles.sectionTitle}>Recent</Text>

        {places.map((place) => (
          <View key={place.id} style={styles.placeRow}>
            <View>
              <Text style={styles.placeName}>{place.name}</Text>
              <Text style={styles.placeSubtitle}>{place.subtitle}</Text>
            </View>
          </View>
        ))}

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
    backgroundColor: '#DDEEFF',
    zIndex: 0,
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

  bottomSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 330,
    paddingTop: 10,
    paddingHorizontal: 22,
    paddingBottom: 28,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    backgroundColor: 'rgba(245,245,247,0.94)',
    zIndex: 10,
  },

  dragHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#CFCFD4',
    marginBottom: 22,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#8A8A8E',
    marginBottom: 14,
  },

  placeRow: {
    paddingVertical: 14,
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
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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