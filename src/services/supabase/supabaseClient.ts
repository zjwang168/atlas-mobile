import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

import { buildPlaceStableKey } from '../import/importService';
import type { ChatHistoryItem } from '../../features/home/HomeContext';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

function createUuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

// ---- Chat History Persistence ----

/**
 * Save a chat history item to Supabase `conversations` table.
 * Also saves associated locations to `conversation_locations`.
 */
export async function saveChatHistory(
  item: Omit<ChatHistoryItem, 'id' | 'createdAt'>,
): Promise<{ id: string; createdAt: string }> {
  const id = createUuidV4();
  const createdAt = new Date().toISOString();

  // Upsert conversation record
  const convRecord = {
    id,
    title: item.title,
    source_url: item.sourceUrl,
    source_type: item.sourceType ?? null,
    location_count: item.locationCount,
    created_at: createdAt,
    updated_at: createdAt,
  };

  const { error: convError } = await supabase
    .from('conversations')
    .upsert(convRecord);

  if (convError) {
    console.error('[saveChatHistory] conversation upsert error:', convError);
    throw convError;
  }

  // Save locations to conversation_locations
  if (item.places.length > 0) {
    const locationRecords = item.places.map((place) => ({
      id: createUuidV4(),
      conversation_id: id,
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      full_address: place.subtitle,
      hierarchy_level: 2,
      is_active: true,
      created_at: createdAt,
    }));

    const { error: locError } = await supabase
      .from('conversation_locations')
      .upsert(locationRecords);

    if (locError) {
      console.error('[saveChatHistory] locations upsert error:', locError);
      // Non-fatal — conversation record already saved
    }
  }

  return { id, createdAt };
}

/**
 * Load recent chat history items from Supabase `conversations` table.
 * Returns up to 50 items ordered by `updated_at` desc.
 * Each item includes places loaded from `conversation_locations`.
 */
export async function loadChatHistory(): Promise<ChatHistoryItem[]> {
  // Load conversations
  const { data: conversations, error: convError } = await supabase
    .from('conversations')
    .select('id, title, source_url, source_type, location_count, created_at')
    .order('updated_at', { ascending: false })
    .limit(50);

  if (convError) {
    console.error('[loadChatHistory] query error:', convError);
    return [];
  }

  if (!conversations || conversations.length === 0) {
    return [];
  }

  // Load locations for all conversations in one batch
  const conversationIds = conversations.map((c: any) => c.id);
  const { data: locations, error: locError } = await supabase
    .from('conversation_locations')
    .select('*')
    .in('conversation_id', conversationIds)
    .eq('is_active', true);

  if (locError) {
    console.error('[loadChatHistory] locations query error:', locError);
  }

  // Group locations by conversation_id
  const locationsByConvId: Record<string, any[]> = {};
  if (locations) {
    for (const loc of locations) {
      if (!locationsByConvId[loc.conversation_id]) {
        locationsByConvId[loc.conversation_id] = [];
      }
      locationsByConvId[loc.conversation_id].push(loc);
    }
  }

  // Reconstruct ChatHistoryItem[]
  return conversations.map((conv: any) => {
    const convLocations = locationsByConvId[conv.id] || [];
    return {
      id: conv.id,
      title: conv.title || 'Untitled',
      sourceUrl: conv.source_url || '',
      sourceType: conv.source_type ?? undefined,
      locationCount: conv.location_count || convLocations.length,
      places: convLocations.map((loc: any, index: number) => ({
        id: String(index + 1),
        stableKey: buildPlaceStableKey({
          name: loc.name || '',
          latitude: loc.latitude,
          longitude: loc.longitude,
          category: loc.category || '',
        }),
        name: loc.name || '',
        subtitle: loc.full_address || '',
        type: loc.category || 'Place',
        latitude: loc.latitude,
        longitude: loc.longitude,
      })),
      createdAt: conv.created_at,
    };
  });
}
