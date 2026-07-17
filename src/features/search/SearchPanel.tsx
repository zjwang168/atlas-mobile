import { useState } from 'react';
import {
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type SearchPanelProps = {
  onClose: () => void;
};

export default function SearchPanel({ onClose }: SearchPanelProps) {
  const { top } = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  return (
    <View style={[styles.container, { paddingTop: top + 60 }]}>
      {/* 标题栏 */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>搜索</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeText}>取消</Text>
        </TouchableOpacity>
      </View>

      {/* 搜索输入框 */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="搜索已保存的地点..."
          placeholderTextColor="#8E8E93"
          value={query}
          onChangeText={setQuery}
          autoFocus
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {/* 搜索结果占位 */}
      <View style={styles.centered}>
        {query.length === 0 ? (
          <Text style={styles.hintText}>输入关键词搜索已保存的地点</Text>
        ) : (
          <Text style={styles.hintText}>暂无搜索结果</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.96)',
    zIndex: 100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
  },
  closeButton: {
    padding: 6,
  },
  closeText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
  inputContainer: {
    marginHorizontal: 20,
    marginTop: 14,
    marginBottom: 10,
  },
  input: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#000',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  hintText: {
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
  },
});
