import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type ImportScreenProps = {
  onClose: () => void;
  onSubmit: (text: string) => void;
};

export default function ImportScreen({ onClose, onSubmit }: ImportScreenProps) {
  const [text, setText] = useState('');

  const canSubmit = text.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TouchableOpacity style={styles.closeButton} onPress={onClose}>
        <Text style={styles.closeText}>×</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Import items</Text>
        <Text style={styles.subtitle}>
          Paste a link, note, or anything you want Atlas to understand.
        </Text>
      </View>

      <View style={styles.center}>
        <Text style={styles.sparkle}>✦</Text>
        <Text style={styles.centerTitle}>Turn messy content into places</Text>
        <Text style={styles.centerSubtitle}>
          Atlas will extract locations, categories, and details before saving.
        </Text>
      </View>

      <View style={styles.composerWrapper}>
        <View style={styles.composer}>
          <TouchableOpacity style={styles.attachButton}>
            <Text style={styles.attachText}>＋</Text>
          </TouchableOpacity>

          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Paste links or notes..."
            placeholderTextColor="#9A9AA0"
            multiline
            style={styles.input}
          />

          <TouchableOpacity
            disabled={!canSubmit}
            onPress={() => onSubmit(text)}
            style={[
              styles.sendButton,
              !canSubmit && styles.sendButtonDisabled,
            ]}
          >
            <Text style={styles.sendText}>↑</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  closeButton: {
    position: 'absolute',
    top: 58,
    right: 22,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F4F4F5',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },

  closeText: {
    fontSize: 30,
    lineHeight: 32,
    color: '#111',
  },

  header: {
    paddingTop: 126,
    paddingHorizontal: 24,
  },

  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#111',
  },

  subtitle: {
    marginTop: 10,
    fontSize: 16,
    lineHeight: 23,
    color: '#8A8A8E',
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 34,
    paddingBottom: 70,
  },

  sparkle: {
    fontSize: 34,
    marginBottom: 18,
  },

  centerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111',
    textAlign: 'center',
  },

  centerSubtitle: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: '#8A8A8E',
    textAlign: 'center',
  },

  composerWrapper: {
    paddingHorizontal: 14,
    paddingBottom: 18,
  },

  composer: {
    minHeight: 58,
    maxHeight: 150,
    borderRadius: 30,
    backgroundColor: '#F4F4F5',
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },

  attachButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },

  attachText: {
    fontSize: 26,
    color: '#111',
    lineHeight: 28,
  },

  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    lineHeight: 21,
    color: '#111',
  },

  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },

  sendButtonDisabled: {
    backgroundColor: '#D7D7DC',
  },

  sendText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 26,
  },
});