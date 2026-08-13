import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

import { buildPlaceStableKey } from '../place/placeIdentity';
import type { ChatHistoryItem } from '../../features/home/HomeContext';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ---------------------------------------------------------------------------
// Auth helpers — email/password for now (placeholder UI until Qihang's design;
// Apple Sign-In can be added later as another provider).
// ---------------------------------------------------------------------------

export async function signUpWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

/** Start the password reset flow for a simple email/password account. */
export async function sendPasswordResetEmail(email: string) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw new Error(error.message);
  return data;
}

/** Send an email OTP to a Gmail mailbox (or any email inbox). */
export async function sendEmailOtp(email: string, shouldCreateUser = true) {
  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser,
    },
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Verify the email OTP sent to the user. */
export async function verifyEmailOtp(email: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Verify a recovery OTP sent for password reset. */
export async function verifyRecoveryOtp(email: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'recovery',
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Silent anonymous sign-in — every device gets a stable identity so rows
    always have a user_id and RLS holds. Called by AuthGate when no session. */
export async function signInAnonymously() {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error(error.message);
  return data;
}

/** Upgrade the current anonymous user to a permanent email account.
    Keeps the same user id, so all existing rows stay owned by this user. */
export async function upgradeToEmailAccount(email: string, password: string) {
  const { data, error } = await supabase.auth.updateUser({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

/** Set a password on the currently signed-in user after an OTP verification step. */
export async function setCurrentUserPassword(password: string) {
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export const CHAT_SOURCE_TYPES = [
  'smart_text',
  'image_scan',
  'find_image_places',
  'reddit_links',
  'youtube_links',
  'tiktok_links',
  'instagram_reels',
  'facebook_reels',
  'any_links',
] as const;

export type ChatSourceType = (typeof CHAT_SOURCE_TYPES)[number];

function normalizeChatSourceType(value?: string | null): ChatSourceType | undefined {
  if (!value) return undefined;
  if ((CHAT_SOURCE_TYPES as readonly string[]).includes(value)) return value as ChatSourceType;
  return undefined;
}

function inferChatSourceType(item: { sourceUrl?: string; title?: string; sourceType?: string | null }): ChatSourceType {
  const explicit = normalizeChatSourceType(item.sourceType);
  if (explicit) return explicit;

  const sourceUrl = (item.sourceUrl || '').toLowerCase();
  const title = (item.title || '').toLowerCase();
  const haystack = `${sourceUrl} ${title}`;

  if (title === 'atlas ai chat' || title.includes('atlas ai chat')) {
    return 'smart_text';
  }
  if (title.includes('youtube')) {
    return 'youtube_links';
  }
  if (title.includes('tiktok')) {
    return 'tiktok_links';
  }
  if (title.includes('instagram')) {
    return 'instagram_reels';
  }
  if (title.includes('facebook')) {
    return 'facebook_reels';
  }
  if (title.includes('reddit')) {
    return 'reddit_links';
  }
  if (haystack.includes('find_image_places') || haystack.includes('find image place') || haystack.includes('photo')) {
    return 'find_image_places';
  }
  if (haystack.includes('image_scan') || haystack.includes('scan image') || haystack.includes('scan_images')) {
    return 'image_scan';
  }
  if (haystack.includes('youtube.com') || haystack.includes('youtu.be') || haystack.includes('youtube')) {
    return 'youtube_links';
  }
  if (haystack.includes('tiktok.com') || haystack.includes('tiktok')) {
    return 'tiktok_links';
  }
  if (haystack.includes('instagram.com/reel') || haystack.includes('instagram.com/reels')) {
    return 'instagram_reels';
  }
  if (haystack.includes('facebook.com') || haystack.includes('fb.watch')) {
    return 'facebook_reels';
  }
  if (haystack.includes('reddit.com') || haystack.includes('reddit')) {
    return 'reddit_links';
  }
  if (haystack.includes('http://') || haystack.includes('https://') || haystack.includes('www.')) {
    return 'any_links';
  }
  if (haystack.includes('smart text') || haystack.includes('smart_text') || haystack.includes('atlas ai')) {
    return 'smart_text';
  }
  return 'smart_text';
}

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
  const sourceType = inferChatSourceType(item);

  // Upsert conversation record
  const convRecord = {
    id,
    title: item.title,
    source_url: item.sourceUrl,
    source_type: sourceType,
    location_count: item.locationCount,
    message_count: item.messageCount ?? 0,
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

const CHAT_HISTORY_PAGE_SIZE = 50;

/**
 * Load chat history items from Supabase `conversations` table.
 * Supports cursor-based pagination so the UI can fetch older conversations
 * when the user scrolls down.
 */
export async function loadChatHistory(options?: {
  limit?: number;
  beforeUpdatedAt?: string;
}): Promise<ChatHistoryItem[]> {
  const limit = options?.limit ?? CHAT_HISTORY_PAGE_SIZE;
  let query = supabase
    .from('conversations')
    .select('id, title, source_url, source_type, location_count, message_count, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (options?.beforeUpdatedAt) {
    query = query.lt('updated_at', options.beforeUpdatedAt);
  }

  const { data: conversations, error: convError } = await query;

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
      sourceType: normalizeChatSourceType(conv.source_type) ?? inferChatSourceType({
        sourceUrl: conv.source_url || '',
        title: conv.title || '',
        sourceType: conv.source_type ?? undefined,
      }),
      locationCount: conv.location_count || convLocations.length,
      messageCount: conv.message_count || 0,
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
      updatedAt: conv.updated_at,
    };
  });
}

export async function countChatHistory(): Promise<number> {
  const { count, error } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true });

  if (error) {
    console.error('[countChatHistory] query error:', error);
    return 0;
  }

  return count ?? 0;
}
