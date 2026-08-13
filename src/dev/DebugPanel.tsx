import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Reanimated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { fetchConversations, fetchMemories } from '@/services/api/apiService';
import { getCurrentUserId } from '@/services/local/localStore';
import { getLocalSyncDebug } from '@/services/local/syncQueue';
import { typography } from '@/theme/typography';

type DebugPanelProps = {
  onClose: () => void;
};

export default function DebugPanel({ onClose }: DebugPanelProps) {
  const [memories, setMemories] = useState<any[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [localSync, setLocalSync] = useState<{ queue: any[]; deadLetters: any[] }>({ queue: [], deadLetters: [] });
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const [mems, convs, userId] = await Promise.all([fetchMemories(), fetchConversations(), getCurrentUserId()]);
      setMemories(mems);
      setConversations(convs);
      setLocalSync(userId ? await getLocalSyncDebug(userId) : { queue: [], deadLetters: [] });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <Reanimated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={styles.container}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Memory Debug</Text>
          <Text style={styles.subtitle}>Long-term memory and conversation summaries</Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={20} color="#1A1A1A" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={[{ key: 'localSync' }, { key: 'memories' }, { key: 'conversations' }]}
        keyExtractor={(item) => item.key}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        renderItem={({ item }) => {
          if (item.key === 'localSync') {
            return (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Local sync</Text>
                <View style={styles.card}>
                  <Text style={styles.cardKey}>Queue</Text>
                  <Text style={styles.cardMeta}>{localSync.queue.length} pending writes</Text>
                  {localSync.queue.slice(0, 5).map((write) => (
                    <Text key={write.id} style={styles.cardValue} numberOfLines={3}>
                      {write.kind} · attempts {write.attempts}
                    </Text>
                  ))}
                </View>
                <View style={styles.card}>
                  <Text style={styles.cardKey}>Dead letters</Text>
                  <Text style={styles.cardMeta}>{localSync.deadLetters.length} failed writes</Text>
                  {localSync.deadLetters.slice(0, 5).map((write) => (
                    <Text key={write.id} style={styles.cardValue} numberOfLines={3}>
                      {write.kind} · {write.reason}
                    </Text>
                  ))}
                </View>
              </View>
            );
          }

          if (item.key === 'memories') {
            return (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Current memories</Text>
                {memories.map((memory) => (
                  <View key={memory.id} style={styles.card}>
                    <Text style={styles.cardKey}>{memory.key}</Text>
                    <Text style={styles.cardValue}>{memory.value}</Text>
                    <Text style={styles.cardMeta}>{memory.category}</Text>
                  </View>
                ))}
                {memories.length === 0 ? <Text style={styles.empty}>No memories yet.</Text> : null}
              </View>
            );
          }

          return (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Conversations</Text>
              {conversations.map((conversation) => (
                <View key={conversation.id} style={styles.card}>
                  <Text style={styles.cardKey}>{conversation.title}</Text>
                  <Text style={styles.cardMeta}>
                    {conversation.message_count ?? 0} messages · {conversation.location_count ?? 0} places
                  </Text>
                  {conversation.latest_summary ? (
                    <Text style={styles.cardValue} numberOfLines={4}>
                      {conversation.latest_summary}
                    </Text>
                  ) : null}
                  <Text style={styles.cardValue} numberOfLines={3}>
                    {conversation.updated_at ? `Updated: ${conversation.updated_at}` : ''}
                  </Text>
                </View>
              ))}
              {conversations.length === 0 ? <Text style={styles.empty}>No conversations yet.</Text> : null}
            </View>
          );
        }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF', paddingTop: 56 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: { ...typography.display, color: '#09090B' },
  subtitle: { marginTop: 4, ...typography.bodySmall, color: '#717171' },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { paddingHorizontal: 20, paddingBottom: 20 },
  sectionTitle: { ...typography.h3, color: '#09090B', marginBottom: 10 },
  card: {
    backgroundColor: '#F8F8FA',
    borderRadius: 18,
    padding: 12,
    marginBottom: 10,
  },
  cardKey: { ...typography.h3, color: '#111827' },
  cardValue: { marginTop: 4, ...typography.bodySmall, color: '#374151' },
  cardMeta: { marginTop: 4, ...typography.bodySmall, color: '#717171' },
  empty: { color: '#717171', fontSize: 13 },
});
