// src/features/home/SearchBar.tsx
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

// ---- Types ----

interface SearchBarProps {
  /** Called when user presses the send button with a URL */
  onSend: (url: string) => void;
  /** Whether a request is currently in flight */
  isLoading: boolean;
  /** Called when the history button is pressed */
  onHistoryPress: () => void;
}

// ---- Constants ----

/** Simple heuristic: does this look like a URL? */
const isLikelyUrl = (text: string): boolean => {
  return /^https?:\/\/\S+/i.test(text.trim());
};

/** Check if the URL looks like a Reddit post */
const isRedditUrl = (text: string): boolean => {
  return isLikelyUrl(text) && /reddit\.com/i.test(text);
};

// ---- Component ----

const SearchBar: React.FC<SearchBarProps> = ({
  onSend,
  isLoading,
  onHistoryPress,
}) => {
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);

  const canSend = text.trim().length > 0 && !isLoading;

  /** Handle text submission */
  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(text.trim());
    // Keep the text visible so the user knows what they sent
  }, [canSend, text, onSend]);

  /** When the input gains focus, check clipboard for a Reddit URL */
  const handleFocus = useCallback(async () => {
    try {
      const clipboardContent = await Clipboard.getStringAsync();
      if (clipboardContent && isRedditUrl(clipboardContent) && clipboardContent !== text) {
        Alert.alert(
          'Detect link from Reddit?',
          `We found a link on your clipboard:\n${clipboardContent.substring(0, 80)}…`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Paste',
              onPress: () => setText(clipboardContent),
            },
          ],
        );
      }
    } catch {
      // Clipboard access may fail; silently ignore.
    }
  }, [text]);

  return (
    <View style={styles.container}>
      {/* History button — left */}
      <TouchableOpacity style={styles.historyButton} onPress={onHistoryPress}>
        <Text style={styles.historyIcon}>☰</Text>
      </TouchableOpacity>

      {/* Text input — center */}
      <View style={styles.inputWrapper}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          onFocus={handleFocus}
          placeholder="Paste a Reddit link..."
          placeholderTextColor="#9A9AA0"
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isLoading}
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
      </View>

      {/* Send button — right */}
      <TouchableOpacity
        style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
        onPress={handleSend}
        disabled={!canSend}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.sendIcon}>↑</Text>
        )}
      </TouchableOpacity>
    </View>
  );
};

// ---- Styles ----

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 56,
    left: 12,
    right: 12,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: 28,
    paddingHorizontal: 6,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  historyButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F0F0F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyIcon: {
    fontSize: 20,
    color: '#333',
  },
  inputWrapper: {
    flex: 1,
    marginHorizontal: 8,
  },
  input: {
    height: 40,
    fontSize: 16,
    color: '#111',
    paddingHorizontal: 4,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#D7D7DC',
  },
  sendIcon: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
});

export default SearchBar;
