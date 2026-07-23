export const CACHE_VERSION = 1;

export const LOCAL_CACHE_KEYS = {
  savedPlaces: 'savedPlaces',
  savedPlacesIndex: 'savedPlacesIndex',
  atlases: 'atlases',
  atlasPlaces: 'atlasPlaces',
  planRows: 'planRows',
  writeQueue: 'writeQueue',
  deadLetters: 'deadLetters',
} as const;

export type LocalCacheKey = (typeof LOCAL_CACHE_KEYS)[keyof typeof LOCAL_CACHE_KEYS];

export function cacheKey(userId: string, key: LocalCacheKey): string {
  return `local:${userId}:${key}`;
}

export function isLocalId(id: string): boolean {
  return id.startsWith('local-');
}

export function createLocalId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
