import type { Atlas } from '@/types/atlas';

const NOW = new Date().toISOString();

export const mockAtlases: Atlas[] = [
  {
    id: 'atlas-mock-1',
    owner_id: null,
    title: 'New York Museum',
    emoji: '🏛️',
    description: null,
    visibility: 'private',
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'atlas-mock-2',
    owner_id: null,
    title: 'Rome Landmarks',
    emoji: '🏟️',
    description: null,
    visibility: 'private',
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'atlas-mock-3',
    owner_id: null,
    title: 'California Hiking Trails',
    emoji: '🥾',
    description: null,
    visibility: 'private',
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'atlas-mock-4',
    owner_id: null,
    title: 'Tokyo Ramen Crawl',
    emoji: '🍜',
    description: null,
    visibility: 'private',
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'atlas-mock-5',
    owner_id: null,
    title: 'Paris Cafes',
    emoji: '☕',
    description: null,
    visibility: 'private',
    created_at: NOW,
    updated_at: NOW,
  },
];

/** How many places `AtlasDetail` pulls in for each mock atlas. There's no real
    `atlas_places` join data yet, so `AtlasDetail` fills each atlas with this many
    places drawn from `HomeContext.savedPlaces` (the current local cache) instead
    of fabricated place records — this keeps every atlas place a real, resolvable
    saved place rather than one `PlaceDetail`/`PlaceCard` can't look up. */
export const mockAtlasPlaceCounts: Record<string, number> = {
  'atlas-mock-1': 2,
  'atlas-mock-2': 2,
  'atlas-mock-3': 2,
  'atlas-mock-4': 2,
  'atlas-mock-5': 2,
};
