import {
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
  } from 'react-native';
  
  const extractedPlaces = [
    {
      id: '1',
      name: 'Hidden Sushi',
      subtitle: 'Downtown Seattle',
      type: 'Restaurant',
    },
    {
      id: '2',
      name: 'Late Night Ramen',
      subtitle: 'Capitol Hill',
      type: 'Ramen',
    },
  ];
  
  type Props = {
    onClose: () => void;
    onSave: () => void;
  };
  
  export default function PreviewScreen({ onClose, onSave }: Props) {
    return (
      <View style={styles.overlay}>
        <View style={styles.backdrop} />
  
        <View style={styles.sheet}>
          <TouchableOpacity style={styles.backButton} onPress={onClose}>
            <Text style={styles.backText}>‹</Text>
          </TouchableOpacity>
  
          <Text style={styles.title}>Seattle</Text>
          <Text style={styles.subtitle}>2 places found from your content</Text>
  
          <View style={styles.list}>
            {extractedPlaces.map((place) => (
              <View key={place.id} style={styles.placeCard}>
                <View style={styles.placeText}>
                  <Text style={styles.placeName}>{place.name}</Text>
                  <Text style={styles.placeSubtitle}>{place.subtitle}</Text>
  
                  <View style={styles.tag}>
                    <Text style={styles.tagText}>{place.type}</Text>
                  </View>
                </View>
  
                <TouchableOpacity style={styles.trashButton}>
                  <Text style={styles.trash}>🗑</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
  
          <TouchableOpacity style={styles.saveButton} onPress={onSave}>
            <Text style={styles.saveButtonText}>Save 2 places</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  
  const styles = StyleSheet.create({
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 110,
      justifyContent: 'flex-end',
    },
  
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.22)',
    },
  
    sheet: {
      marginHorizontal: 14,
      marginBottom: 14,
      paddingTop: 28,
      paddingHorizontal: 22,
      paddingBottom: 24,
      borderRadius: 34,
      backgroundColor: 'rgba(245,245,247,0.98)',
    },
  
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: '#FFFFFF',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },
  
    backText: {
      fontSize: 34,
      lineHeight: 34,
      fontWeight: '500',
    },
  
    title: {
      fontSize: 38,
      fontWeight: '800',
      color: '#000',
    },
  
    subtitle: {
      marginTop: 6,
      fontSize: 16,
      color: '#8A8A8E',
    },
  
    list: {
      marginTop: 24,
      gap: 14,
    },
  
    placeCard: {
      flexDirection: 'row',
      backgroundColor: '#FFFFFF',
      borderRadius: 26,
      padding: 18,
      alignItems: 'center',
    },
  
    placeText: {
      flex: 1,
    },
  
    placeName: {
      fontSize: 20,
      fontWeight: '800',
      color: '#000',
    },
  
    placeSubtitle: {
      marginTop: 5,
      fontSize: 15,
      color: '#8A8A8E',
    },
  
    tag: {
      marginTop: 10,
      alignSelf: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: '#F0F0F4',
    },
  
    tagText: {
      fontSize: 13,
      fontWeight: '700',
      color: '#555',
    },
  
    trashButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: '#F0F0F4',
      alignItems: 'center',
      justifyContent: 'center',
    },
  
    trash: {
      fontSize: 18,
    },
  
    saveButton: {
      marginTop: 24,
      height: 58,
      borderRadius: 22,
      backgroundColor: '#000',
      alignItems: 'center',
      justifyContent: 'center',
    },
  
    saveButtonText: {
      color: '#FFF',
      fontSize: 18,
      fontWeight: '800',
    },
  });