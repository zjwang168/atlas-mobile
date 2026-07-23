import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '../supabase/supabaseClient';
import { CACHE_VERSION, cacheKey, type LocalCacheKey } from './cacheKeys';

type CacheEnvelope<T> = {
  version: number;
  data: T;
};

const mutexes = new Map<string, Promise<unknown>>();

function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = mutexes.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (mutexes.get(key) === next) mutexes.delete(key);
    });
  mutexes.set(key, next);
  return next;
}

export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function getCached<T>(userId: string, key: LocalCacheKey): Promise<T | null> {
  const storageKey = cacheKey(userId, key);
  return serialize(storageKey, async () => {
    const raw = await AsyncStorage.getItem(storageKey);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as CacheEnvelope<T>;
    if (envelope.version !== CACHE_VERSION) return null;
    return envelope.data;
  });
}

export async function setCached<T>(userId: string, key: LocalCacheKey, value: T): Promise<void> {
  const storageKey = cacheKey(userId, key);
  await serialize(storageKey, async () => {
    const envelope: CacheEnvelope<T> = { version: CACHE_VERSION, data: value };
    await AsyncStorage.setItem(storageKey, JSON.stringify(envelope));
  });
}

export async function updateCached<T>(
  userId: string,
  key: LocalCacheKey,
  update: (current: T | null) => T,
): Promise<T> {
  const storageKey = cacheKey(userId, key);
  return serialize(storageKey, async () => {
    const raw = await AsyncStorage.getItem(storageKey);
    const current = raw ? (JSON.parse(raw) as CacheEnvelope<T>) : null;
    const data = current?.version === CACHE_VERSION ? current.data : null;
    const next = update(data);
    const envelope: CacheEnvelope<T> = { version: CACHE_VERSION, data: next };
    await AsyncStorage.setItem(storageKey, JSON.stringify(envelope));
    return next;
  });
}

export async function clearUserCache(userId: string): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const prefix = `local:${userId}:`;
  const userKeys = keys.filter((key) => key.startsWith(prefix));
  if (userKeys.length > 0) {
    await AsyncStorage.multiRemove(userKeys);
  }
}
